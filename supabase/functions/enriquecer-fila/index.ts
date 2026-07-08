// Supabase Edge Function: enriquecer-fila
//
// Orquestrador AUTÔNOMO de enriquecimento de contatos.
// Consome a view public.v_fila_enriquecimento (empresas com contato ausente/
// fraco, priorizadas por pipeline e valor potencial), consulta a Receita via
// BrasilAPI e grava em `empresas`. O trigger derive_contatos_from_rfb (já
// existente) materializa os contatos (sócios + canais) em empresa_contatos.
//
// NÃO tem auth de usuário: é chamada por pg_cron com a SERVICE-ROLE key no
// header Authorization. Rejeita qualquer chamada sem essa key. Ver README.md.
//
// Chamada:
//   POST /functions/v1/enriquecer-fila?limite=25
//   POST /functions/v1/enriquecer-fila?dry=1      (só devolve a fila, não grava)
//   Header: Authorization: Bearer <SERVICE_ROLE_KEY>
//
// A cascata completa (BrasilAPI -> CNPJa -> ReceitaWS) e o merge de celular
// vivem em `enriquecer-cnpj` (enriquecimento manual/avulso). Aqui usamos só a
// BrasilAPI (snapshot mensal, sem rate limit prático) para o processamento em
// lote ficar simples e confiável. Fonte de verdade do mapeamento: enriquecer-cnpj.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeCNPJ(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

// Lê o claim `role` de um JWT sem verificar assinatura (a plataforma, com
// verify_jwt on, já validou a assinatura antes de chegar aqui).
function jwtRole(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const payload = JSON.parse(atob(b64 + pad));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function validCNPJ(s: string): boolean {
  const cnpj = normalizeCNPJ(s);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(base[i], 10) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== parseInt(cnpj[12], 10)) return false;
  const d2 = calc(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d2 === parseInt(cnpj[13], 10);
}

function mapSituacao(desc: string | null): string | null {
  if (!desc) return null;
  const s = desc.toUpperCase();
  if (s.includes("ATIVA")) return "ATIVA";
  if (s.includes("BAIXADA")) return "BAIXADA";
  if (s.includes("SUSPENSA")) return "SUSPENSA";
  if (s.includes("INAPTA")) return "INAPTA";
  if (s.includes("NULA")) return "NULA";
  return null;
}

function mapPorte(desc: string | null): string {
  if (!desc) return "NAO_INFORMADO";
  const s = desc.toUpperCase();
  if (s.includes("MICROEMPREENDEDOR") || s === "MEI") return "MEI";
  if (s.includes("MICRO") || s === "ME") return "ME";
  if (s.includes("PEQUENO") || s === "EPP") return "EPP";
  if (s.includes("DEMAIS") || s.includes("GRANDE") || s.includes("MEDIO")) return "DEMAIS";
  return "NAO_INFORMADO";
}

interface BrasilAPICNPJ {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  data_inicio_atividade?: string;
  descricao_situacao_cadastral?: string;
  data_situacao_cadastral?: string;
  descricao_motivo_situacao_cadastral?: string;
  natureza_juridica?: string;
  capital_social?: number;
  porte?: string;
  descricao_porte?: string;
  opcao_pelo_simples?: boolean;
  data_opcao_pelo_simples?: string | null;
  opcao_pelo_mei?: boolean;
  cnae_fiscal?: number | string;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo: number | string; descricao: string }>;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  email?: string;
  qsa?: Array<{
    nome_socio?: string;
    qualificacao_socio?: string;
    data_entrada_sociedade?: string;
    cnpj_cpf_do_socio?: string;
  }>;
}

async function fetchBrasilAPI(
  cnpj: string
): Promise<{ ok: true; data: BrasilAPICNPJ } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json" },
    });
    if (r.status === 404) return { ok: false, error: "CNPJ não encontrado na Receita", status: 404 };
    if (r.status === 400) return { ok: false, error: "CNPJ inválido", status: 400 };
    if (r.status === 429) return { ok: false, error: "Rate limit BrasilAPI", status: 429 };
    if (!r.ok) return { ok: false, error: `BrasilAPI retornou ${r.status}`, status: r.status };
    const data = (await r.json()) as BrasilAPICNPJ;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 500 };
  }
}

// Normaliza para o shape gravado em `empresas` (espelha enriquecer-cnpj, ramo BrasilAPI).
function normalizeForDB(raw: BrasilAPICNPJ) {
  return {
    razao_social: raw.razao_social ?? null,
    nome_fantasia: raw.nome_fantasia ?? null,
    data_abertura: raw.data_inicio_atividade ?? null,
    situacao_cadastral: mapSituacao(raw.descricao_situacao_cadastral ?? null),
    situacao_cadastral_data: raw.data_situacao_cadastral ?? null,
    motivo_situacao: raw.descricao_motivo_situacao_cadastral ?? null,
    natureza_juridica: raw.natureza_juridica ?? null,
    capital_social: raw.capital_social ?? null,
    porte: mapPorte(raw.descricao_porte ?? raw.porte ?? null),
    opcao_simples: raw.opcao_pelo_simples ?? null,
    data_opcao_simples: raw.data_opcao_pelo_simples ?? null,
    opcao_mei: raw.opcao_pelo_mei ?? null,
    cnae_principal: raw.cnae_fiscal != null ? String(raw.cnae_fiscal) : null,
    cnae_principal_desc: raw.cnae_fiscal_descricao ?? null,
    cnaes_secundarios: raw.cnaes_secundarios ?? [],
    logradouro: raw.logradouro ?? null,
    numero_endereco: raw.numero ?? null,
    complemento: raw.complemento ?? null,
    bairro: raw.bairro ?? null,
    municipio: raw.municipio ?? null,
    uf: raw.uf ?? null,
    cep: raw.cep ?? null,
    telefone_receita: raw.ddd_telefone_1 ?? null,
    telefones: Array.from(
      new Set(
        [raw.ddd_telefone_1, raw.ddd_telefone_2]
          .map((p) => {
            let d = (p ?? "").replace(/\D/g, "");
            if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
            return d;
          })
          .filter((d) => (d.length === 10 || d.length === 11) && !/^(\d)\1+$/.test(d))
      )
    ),
    email_receita: raw.email ?? null,
    qsa: (raw.qsa ?? []).map((s) => ({
      nome: s.nome_socio ?? null,
      qualificacao: s.qualificacao_socio ?? null,
      data_entrada: s.data_entrada_sociedade ?? null,
      documento: s.cnpj_cpf_do_socio ?? null,
    })),
    receita_atualizada_em: new Date().toISOString(),
    receita_erro: null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FilaRow {
  empresa_id: string;
  cnpj: string;
  nome: string | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: "env vars missing (SUPABASE_URL / SERVICE_ROLE_KEY)" }, 500);
  }

  // Proteção: exige um JWT com role=service_role no Authorization. A plataforma
  // (verify_jwt on) já valida a ASSINATURA antes de chegar aqui; então basta
  // conferir o claim role — robusto a rotação e ao novo sistema de chaves.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (jwtRole(token) !== "service_role" && token !== SERVICE_ROLE) {
    return json({ error: "unauthorized (service-role requerida)" }, 401);
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const limite = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limite") ?? "25", 10) || 25));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) Puxa o lote da fila (já priorizada pela view)
  const { data: fila, error: filaErr } = await admin
    .from("v_fila_enriquecimento")
    .select("empresa_id, cnpj, nome")
    .limit(limite);

  if (filaErr) return json({ error: "falha ao ler fila", detail: filaErr.message }, 500);
  if (dry) return json({ ok: true, dry: true, fila }, 200);

  const rows = (fila ?? []) as FilaRow[];
  const resultado = { processadas: 0, sucesso: 0, sem_dados: 0, falhas: 0, detalhes: [] as unknown[] };

  for (const row of rows) {
    resultado.processadas++;
    const cnpj = normalizeCNPJ(row.cnpj);

    if (!validCNPJ(cnpj)) {
      resultado.falhas++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj, fonte: "brasilapi",
        sucesso: false, erro: "CNPJ inválido (mod-11)",
      });
      continue;
    }

    // contatos antes + flags manuais
    const { data: antes } = await admin
      .from("empresas")
      .select("contatos_count, email_manual, telefone_manual")
      .eq("id", row.empresa_id)
      .maybeSingle();

    // BrasilAPI com 1 retry em 429
    let ba = await fetchBrasilAPI(cnpj);
    if (!ba.ok && ba.status === 429) {
      await sleep(1200);
      ba = await fetchBrasilAPI(cnpj);
    }

    if (!ba.ok) {
      if (ba.status === 404) resultado.sem_dados++;
      else resultado.falhas++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj, fonte: "brasilapi",
        sucesso: false, erro: ba.error, contatos_antes: antes?.contatos_count ?? null,
      });
      await sleep(350);
      continue;
    }

    // Grava (preservando e-mail/telefone manuais do usuário)
    const payload: Record<string, unknown> = { ...normalizeForDB(ba.data) };
    if (antes?.email_manual) delete payload.email_receita;
    if (antes?.telefone_manual) delete payload.telefone_receita;

    const { error: upErr } = await admin.from("empresas").update(payload).eq("id", row.empresa_id);

    // contatos depois (o trigger derive_contatos_from_rfb já rodou na transação do UPDATE)
    const { data: depois } = await admin
      .from("empresas")
      .select("contatos_count")
      .eq("id", row.empresa_id)
      .maybeSingle();

    if (upErr) {
      resultado.falhas++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj, fonte: "brasilapi",
        sucesso: false, erro: `gravar empresa: ${upErr.message}`,
        contatos_antes: antes?.contatos_count ?? null,
      });
    } else {
      resultado.sucesso++;
      resultado.detalhes.push({
        empresa: row.nome, cnpj,
        contatos: `${antes?.contatos_count ?? 0} -> ${depois?.contatos_count ?? 0}`,
      });
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj, fonte: "brasilapi", sucesso: true,
        contatos_antes: antes?.contatos_count ?? null,
        contatos_depois: depois?.contatos_count ?? null,
      });
    }

    // Respeita o rate limit da BrasilAPI (gotcha conhecido: 350ms entre chamadas)
    await sleep(350);
  }

  return json({ ok: true, ...resultado }, 200);
});
