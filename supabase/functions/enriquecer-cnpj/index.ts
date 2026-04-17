// Supabase Edge Function: enriquecer-cnpj
//
// Consulta dados da Receita Federal via BrasilAPI (grátis, sem auth)
// e normaliza resultado para preencher empresas.
//
// Body: { cnpj: string, force?: boolean, empresa_id?: string }
//   - cnpj: com ou sem máscara (será normalizado)
//   - force: se true, ignora cache
//   - empresa_id: se fornecido, atualiza a empresa diretamente no DB
//
// Return: { ok: true, data: {...}, cached: boolean }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

function normalizeCNPJ(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}
function validCNPJ(s: string): boolean {
  return normalizeCNPJ(s).length === 14;
}

// Mapeia situacao_cadastral da BrasilAPI pro enum do DB
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

function mapPorte(desc: string | null): string | null {
  if (!desc) return "NAO_INFORMADO";
  const s = desc.toUpperCase();
  if (s.includes("MICROEMPREENDEDOR") || s === "MEI") return "MEI";
  if (s.includes("MICRO") || s === "ME") return "ME";
  if (s.includes("PEQUENO") || s === "EPP") return "EPP";
  if (s.includes("DEMAIS") || s.includes("GRANDE") || s.includes("MEDIO")) return "DEMAIS";
  return "NAO_INFORMADO";
}

/**
 * BrasilAPI response shape (simplificado):
 * https://brasilapi.com.br/docs#tag/CNPJ
 */
interface BrasilAPICNPJ {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  data_inicio_atividade?: string; // YYYY-MM-DD
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
  email?: string;
  qsa?: Array<{
    nome_socio?: string;
    qualificacao_socio?: string;
    data_entrada_sociedade?: string;
    cnpj_cpf_do_socio?: string;
  }>;
}

async function fetchBrasilAPI(cnpj: string): Promise<{ ok: true; data: BrasilAPICNPJ } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json" },
    });
    if (r.status === 404) return { ok: false, error: "CNPJ não encontrado na Receita", status: 404 };
    if (r.status === 400) return { ok: false, error: "CNPJ inválido", status: 400 };
    if (r.status === 429) return { ok: false, error: "Rate limit — tente novamente em instantes", status: 429 };
    if (!r.ok) return { ok: false, error: `BrasilAPI retornou ${r.status}`, status: r.status };
    const data = (await r.json()) as BrasilAPICNPJ;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 500 };
  }
}

// Normaliza o payload da BrasilAPI para o shape que gravamos em empresas
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

serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing auth" }, 401, cors);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: errAuth } = await asUser.auth.getUser();
    if (errAuth || !caller) return json({ error: "invalid token" }, 401, cors);

    const body = (await req.json().catch(() => null)) as {
      cnpj?: string; force?: boolean; empresa_id?: string;
    } | null;

    if (!body?.cnpj || !validCNPJ(body.cnpj)) {
      return json({ error: "cnpj inválido (precisa 14 dígitos)" }, 400, cors);
    }

    const cnpj = normalizeCNPJ(body.cnpj);
    const force = !!body.force;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Checa cache (válido por 90 dias a menos que force=true)
    let cached = false;
    let raw: BrasilAPICNPJ | null = null;
    let erroApi: string | null = null;

    if (!force) {
      const { data: cacheRow } = await admin
        .from("cnpj_cache")
        .select("*")
        .eq("cnpj", cnpj)
        .maybeSingle();

      if (cacheRow && cacheRow.sucesso) {
        const ageMs = Date.now() - new Date(cacheRow.consultado_em).getTime();
        const ninety = 90 * 24 * 60 * 60 * 1000;
        if (ageMs < ninety) {
          raw = cacheRow.payload as BrasilAPICNPJ;
          cached = true;
        }
      }
    }

    // 2) Se não tem cache válido, consulta BrasilAPI
    if (!raw) {
      const result = await fetchBrasilAPI(cnpj);
      if (result.ok) {
        raw = result.data;
        // cacheia
        await admin.from("cnpj_cache").upsert({
          cnpj,
          payload: raw,
          fonte: "brasilapi",
          consultado_em: new Date().toISOString(),
          sucesso: true,
          erro: null,
        });
      } else {
        erroApi = result.error;
        // cacheia o erro também (evita martelar API com CNPJs inválidos)
        await admin.from("cnpj_cache").upsert({
          cnpj,
          payload: {},
          fonte: "brasilapi",
          consultado_em: new Date().toISOString(),
          sucesso: false,
          erro: erroApi,
        });
      }
    }

    // 3) Se houve erro, atualiza empresa com o erro (se empresa_id fornecido)
    if (erroApi) {
      if (body.empresa_id) {
        await admin.from("empresas")
          .update({ receita_erro: erroApi, receita_atualizada_em: new Date().toISOString() })
          .eq("id", body.empresa_id);
      }
      return json({ ok: false, error: erroApi, cnpj }, 400, cors);
    }

    if (!raw) {
      return json({ ok: false, error: "sem dados" }, 500, cors);
    }

    const normalized = normalizeForDB(raw);

    // 4) Se empresa_id fornecido, atualiza diretamente
    if (body.empresa_id) {
      const { error: upErr } = await admin
        .from("empresas")
        .update(normalized)
        .eq("id", body.empresa_id);
      if (upErr) {
        return json({ ok: false, error: "erro ao gravar empresa", detail: upErr.message }, 500, cors);
      }
    }

    return json({ ok: true, cached, data: normalized, raw }, 200, cors);
  } catch (e) {
    return json({ error: (e as Error).message }, 500, cors);
  }
});
