// Supabase Edge Function: backup-completo
//
// Gera snapshot JSON com TODOS os dados das tabelas críticas do sistema.
// Pode ser invocada de 2 formas:
//
// 1) Via cron (pg_cron → http extension): roda autenticada com SERVICE_ROLE,
//    gera snapshot e salva no bucket "backups" como
//    backups/<YYYY-MM-DD>/<HHMMSS>-<motivo>.json. Limpa snapshots > 90 dias.
//
// 2) Via frontend (admin clica botão): mesmo endpoint, mas user precisa ter
//    role admin. Suporta 2 modos via query param:
//    - ?mode=download → retorna o JSON direto pra download (browser baixa)
//    - ?mode=storage  → salva no bucket e retorna metadata (path, tamanho)
//
// Body opcional: { motivo?: string }   (default: "manual")
//
// Tabelas dumpadas (ordem importa para restauração — pais antes de filhos):
//   profiles, user_roles, empresas, acoes_tributarias, criterios_elegibilidade,
//   elegibilidade, prospeccoes, propostas_templates, propostas, tarefas,
//   subtarefas, tarefa_comentarios, reunioes, templates_mensagem, templates_tarefa
//
// NOTA: tarefa_anexos contém só metadados (binários ficam em Storage e não
// entram neste backup). Backup do storage é separado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Ordem de dump — pais antes de filhos pra facilitar restauração futura.
const TABELAS = [
  "profiles",
  "user_roles",
  "empresas",
  "acoes_tributarias",
  "criterios_elegibilidade",
  "elegibilidade",
  "prospeccoes",
  "propostas_templates",
  "propostas",
  "tarefas",
  "subtarefas",
  "tarefa_comentarios",
  "tarefa_anexos",
  "reunioes",
  "templates_mensagem",
  "templates_tarefa",
  "cnpj_cache",
] as const;

const RETENCAO_DIAS = 90;

interface BackupSnapshot {
  versao: 1;
  gerado_em: string;
  motivo: string;
  estatisticas: Record<string, number>;
  dados: Record<string, unknown[]>;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, cors);
  }

  // ===== Auth =====
  // Cliente com SERVICE_ROLE pra ler tudo (RLS bypass) — necessário pra backup completo.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validação: ou requisição vem com SERVICE_ROLE no header (cron), ou usuário é admin.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return json({ ok: false, error: "Faltando authorization header" }, 401, cors);
  }

  const isCronCall = token === serviceKey;

  if (!isCronCall) {
    // Verifica se o token pertence a um usuário admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Token inválido" }, 401, cors);
    }
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) {
      return json({ ok: false, error: "Apenas admin pode gerar backup" }, 403, cors);
    }
  }

  // ===== Parse body & query =====
  let body: { motivo?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // body opcional, segue
  }
  const motivo = (body.motivo ?? (isCronCall ? "cron" : "manual")).slice(0, 40)
    .replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "manual";

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "storage"; // default storage
  if (mode !== "storage" && mode !== "download") {
    return json({ ok: false, error: "mode deve ser 'storage' ou 'download'" }, 400, cors);
  }

  // ===== Dump =====
  const snapshot: BackupSnapshot = {
    versao: 1,
    gerado_em: new Date().toISOString(),
    motivo,
    estatisticas: {},
    dados: {},
  };

  for (const tabela of TABELAS) {
    try {
      // Paginação: pega tudo em chunks de 1000 pra não estourar limite do PostgREST
      const linhas: unknown[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await adminClient
          .from(tabela)
          .select("*")
          .range(offset, offset + PAGE - 1);
        if (error) {
          console.error(`Erro dumpando ${tabela}:`, error);
          snapshot.dados[tabela] = [];
          snapshot.estatisticas[tabela] = -1; // sentinela de erro
          break;
        }
        linhas.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        offset += PAGE;
      }
      snapshot.dados[tabela] = linhas;
      snapshot.estatisticas[tabela] = linhas.length;
    } catch (e) {
      console.error(`Falha em ${tabela}:`, e);
      snapshot.dados[tabela] = [];
      snapshot.estatisticas[tabela] = -1;
    }
  }

  const conteudo = JSON.stringify(snapshot, null, 2);
  const tamanhoBytes = new TextEncoder().encode(conteudo).length;

  // ===== Modo download: devolve JSON direto =====
  if (mode === "download") {
    const dataIso = new Date().toISOString().slice(0, 10);
    const horaIso = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    return new Response(conteudo, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="tax-trakker-backup-${dataIso}-${horaIso}-${motivo}.json"`,
      },
    });
  }

  // ===== Modo storage: upload no bucket =====
  const agora = new Date();
  const dataPath = agora.toISOString().slice(0, 10);
  const horaPath = agora.toISOString().slice(11, 19).replace(/:/g, "");
  const path = `${dataPath}/${horaPath}-${motivo}.json`;

  const { error: upErr } = await adminClient.storage
    .from("backups")
    .upload(path, conteudo, {
      contentType: "application/json",
      upsert: false,
    });

  if (upErr) {
    return json({ ok: false, error: `Erro upload: ${upErr.message}` }, 500, cors);
  }

  // Retenção: lista tudo, mantém só últimos 90 dias
  try {
    await limparBackupsAntigos(adminClient);
  } catch (e) {
    console.warn("Falha na limpeza de retenção:", e);
    // não falha o backup por isso
  }

  return json({
    ok: true,
    path,
    tamanho_bytes: tamanhoBytes,
    estatisticas: snapshot.estatisticas,
    gerado_em: snapshot.gerado_em,
  }, 200, cors);
});

// ---------------------------------------------------------------------------
// Limpeza: deleta snapshots cuja pasta-data é mais antiga que RETENCAO_DIAS.
// ---------------------------------------------------------------------------
async function limparBackupsAntigos(client: ReturnType<typeof createClient>) {
  // Lista pastas top-level (cada pasta = uma data YYYY-MM-DD)
  const { data: pastas } = await client.storage.from("backups").list("", { limit: 1000 });
  if (!pastas) return;

  const limite = new Date();
  limite.setDate(limite.getDate() - RETENCAO_DIAS);
  const limiteStr = limite.toISOString().slice(0, 10);

  for (const pasta of pastas) {
    const nome = pasta.name;
    // Só processa nomes que parecem data ISO
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nome)) continue;
    if (nome >= limiteStr) continue;

    // Lista arquivos da pasta antiga e deleta todos
    const { data: arquivos } = await client.storage.from("backups").list(nome, { limit: 1000 });
    if (!arquivos || arquivos.length === 0) continue;
    const paths = arquivos.map((a) => `${nome}/${a.name}`);
    await client.storage.from("backups").remove(paths);
  }
}
