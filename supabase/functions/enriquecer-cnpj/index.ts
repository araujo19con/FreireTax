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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

// Fail-closed: sem ALLOWED_ORIGINS configurado, nenhuma origem cross-domain é aceita.
// Em produção, setar ALLOWED_ORIGINS="https://freire-tax.vercel.app" no Supabase.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[enriquecer-cnpj] ALLOWED_ORIGINS não configurado — CORS rejeitará todas as origens cross-domain"
  );
}

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
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeCNPJ(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

// Validação mod-11 real — rejeita CNPJs com dígitos verificadores incorretos.
// Sem isso, qualquer string de 14 dígitos passava (ex: 00000000000000).
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

async function fetchBrasilAPI(
  cnpj: string
): Promise<{ ok: true; data: BrasilAPICNPJ } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: "application/json" },
    });
    if (r.status === 404)
      return { ok: false, error: "CNPJ não encontrado na Receita", status: 404 };
    if (r.status === 400) return { ok: false, error: "CNPJ inválido", status: 400 };
    if (r.status === 429)
      return { ok: false, error: "Rate limit — tente novamente em instantes", status: 429 };
    if (!r.ok) return { ok: false, error: `BrasilAPI retornou ${r.status}`, status: r.status };
    const data = (await r.json()) as BrasilAPICNPJ;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 500 };
  }
}

// ---------------------------------------------------------------------------
// ReceitaWS — fallback quando BrasilAPI não tem o CNPJ
// BrasilAPI usa snapshot mensal (Minha Receita); ReceitaWS consulta o RFB ao vivo
// ---------------------------------------------------------------------------

interface ReceitaWSResponse {
  status?: "OK" | "ERROR";
  message?: string;
  cnpj?: string;
  abertura?: string; // DD/MM/YYYY
  situacao?: string;
  data_situacao?: string; // DD/MM/YYYY
  motivo_situacao?: string;
  nome?: string;
  fantasia?: string;
  porte?: string;
  natureza_juridica?: string;
  capital_social?: string; // "100.000,00"
  atividade_principal?: Array<{ code: string; text: string }>;
  atividades_secundarias?: Array<{ code: string; text: string }>;
  qsa?: Array<{ qual?: string; nome?: string }>;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  email?: string;
  telefone?: string;
  simples?: { optante?: boolean; data_opcao?: string };
  simei?: { optante?: boolean };
}

async function fetchReceitaWS(
  cnpj: string
): Promise<{ ok: true; data: ReceitaWSResponse } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { Accept: "application/json" },
    });
    if (r.status === 429)
      return { ok: false, error: "ReceitaWS rate limit (3/min no plano grátis)", status: 429 };
    if (r.status === 504) return { ok: false, error: "ReceitaWS timeout", status: 504 };
    if (!r.ok) return { ok: false, error: `ReceitaWS retornou ${r.status}`, status: r.status };
    const data = (await r.json()) as ReceitaWSResponse;
    if (data.status === "ERROR") {
      return { ok: false, error: data.message ?? "CNPJ não encontrado", status: 404 };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 500 };
  }
}

// DD/MM/YYYY → YYYY-MM-DD
function parseDateBR(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// "100.000,00" → 100000.00
function parseBRNumber(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// CNPJa Open — fallback secundário (5 req/min, sem auth)
// Endpoint: https://open.cnpja.com/office/{cnpj}
// ---------------------------------------------------------------------------

interface CNPJaResponse {
  updated?: string;
  taxId?: string;
  alias?: string | null;
  founded?: string; // YYYY-MM-DD
  company?: {
    name?: string;
    equity?: number;
    nature?: { id?: number; text?: string };
    size?: { id?: number; acronym?: string; text?: string };
    simples?: { optant?: boolean; since?: string | null };
    simei?: { optant?: boolean; since?: string | null };
    members?: Array<{
      since?: string;
      person?: { name?: string; taxId?: string };
      role?: { text?: string };
    }>;
  };
  statusDate?: string;
  status?: { id?: number; text?: string };
  reason?: { text?: string };
  address?: {
    street?: string;
    number?: string;
    details?: string;
    district?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  phones?: Array<{ type?: string; area?: string; number?: string }>;
  emails?: Array<{ address?: string }>;
  mainActivity?: { id?: number; text?: string };
  sideActivities?: Array<{ id?: number; text?: string }>;
}

async function fetchCNPJa(
  cnpj: string
): Promise<{ ok: true; data: CNPJaResponse } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch(`https://open.cnpja.com/office/${cnpj}`, {
      headers: { Accept: "application/json" },
    });
    if (r.status === 404) return { ok: false, error: "CNPJ não encontrado (CNPJa)", status: 404 };
    if (r.status === 429)
      return { ok: false, error: "CNPJa rate limit (5/min no plano grátis)", status: 429 };
    if (r.status === 504) return { ok: false, error: "CNPJa timeout", status: 504 };
    if (!r.ok) return { ok: false, error: `CNPJa retornou ${r.status}`, status: r.status };
    const data = (await r.json()) as CNPJaResponse;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 500 };
  }
}

function cnpjaToBrasilAPI(r: CNPJaResponse): BrasilAPICNPJ {
  const phone = r.phones?.[0];
  const ddd = phone ? `${phone.area ?? ""}${phone.number ?? ""}` : undefined;
  // size.acronym: "ME" | "EPP" | "MEI" | "DEMAIS" — compatível com mapPorte
  const porteRaw = r.company?.size?.acronym ?? r.company?.size?.text;
  return {
    cnpj: r.taxId ?? "",
    razao_social: r.company?.name,
    nome_fantasia: r.alias ?? undefined,
    data_inicio_atividade: r.founded,
    descricao_situacao_cadastral: r.status?.text,
    data_situacao_cadastral: r.statusDate,
    descricao_motivo_situacao_cadastral: r.reason?.text || undefined,
    natureza_juridica: r.company?.nature?.text,
    capital_social: r.company?.equity ?? undefined,
    porte: porteRaw,
    descricao_porte: porteRaw,
    opcao_pelo_simples: r.company?.simples?.optant,
    data_opcao_pelo_simples: r.company?.simples?.since ?? null,
    opcao_pelo_mei: r.company?.simei?.optant,
    cnae_fiscal: r.mainActivity?.id != null ? String(r.mainActivity.id) : undefined,
    cnae_fiscal_descricao: r.mainActivity?.text,
    cnaes_secundarios: (r.sideActivities ?? [])
      .filter((a) => a.id != null)
      .map((a) => ({ codigo: String(a.id), descricao: a.text ?? "" })),
    logradouro: r.address?.street,
    numero: r.address?.number,
    complemento: r.address?.details,
    bairro: r.address?.district,
    municipio: r.address?.city,
    uf: r.address?.state,
    cep: r.address?.zip,
    ddd_telefone_1: ddd,
    email: r.emails?.[0]?.address,
    qsa: (r.company?.members ?? []).map((m) => ({
      nome_socio: m.person?.name,
      qualificacao_socio: m.role?.text,
      data_entrada_sociedade: m.since,
      cnpj_cpf_do_socio: m.person?.taxId,
    })),
  };
}

// Normaliza ReceitaWS no mesmo shape da BrasilAPI (BrasilAPICNPJ) para reaproveitar normalizeForDB
function receitaWSToBrasilAPI(r: ReceitaWSResponse): BrasilAPICNPJ {
  const cep = r.cep?.replace(/\D/g, "") ?? "";
  return {
    cnpj: r.cnpj ?? "",
    razao_social: r.nome,
    nome_fantasia: r.fantasia,
    data_inicio_atividade: parseDateBR(r.abertura) ?? undefined,
    descricao_situacao_cadastral: r.situacao,
    data_situacao_cadastral: parseDateBR(r.data_situacao) ?? undefined,
    descricao_motivo_situacao_cadastral: r.motivo_situacao,
    natureza_juridica: r.natureza_juridica,
    capital_social: parseBRNumber(r.capital_social) ?? undefined,
    porte: r.porte,
    descricao_porte: r.porte,
    opcao_pelo_simples: r.simples?.optante,
    data_opcao_pelo_simples: parseDateBR(r.simples?.data_opcao ?? null),
    opcao_pelo_mei: r.simei?.optante,
    cnae_fiscal: r.atividade_principal?.[0]?.code?.replace(/\D/g, ""),
    cnae_fiscal_descricao: r.atividade_principal?.[0]?.text,
    cnaes_secundarios: (r.atividades_secundarias ?? [])
      .filter((a) => a.code && a.code !== "00.00-0-00")
      .map((a) => ({ codigo: a.code.replace(/\D/g, ""), descricao: a.text })),
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    municipio: r.municipio,
    uf: r.uf,
    cep,
    ddd_telefone_1: r.telefone,
    email: r.email,
    qsa: (r.qsa ?? []).map((s) => ({
      nome_socio: s.nome,
      qualificacao_socio: s.qual,
    })),
  };
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

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  let step = "init";
  try {
    step = "read-env";
    // Supabase Edge Runtime auto-popula estas vars. Se alguma estiver undefined,
    // falha cedo com mensagem clara (em vez de propagar "undefined" pra createClient).
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
      return json(
        {
          error: "env vars missing",
          detail: {
            SUPABASE_URL: !!SUPABASE_URL,
            ANON_KEY: !!ANON_KEY,
            SERVICE_ROLE: !!SERVICE_ROLE,
          },
        },
        500,
        cors
      );
    }

    step = "auth";
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader) return json({ error: "missing auth", step }, 401, cors);

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: errAuth,
    } = await asUser.auth.getUser();
    if (errAuth || !caller) {
      return json({ error: "invalid token", step, detail: errAuth?.message }, 401, cors);
    }

    step = "parse-body";
    const body = (await req.json().catch(() => null)) as {
      cnpj?: string;
      force?: boolean;
      empresa_id?: string;
    } | null;

    if (!body?.cnpj || !validCNPJ(body.cnpj)) {
      return json({ error: "cnpj inválido (precisa 14 dígitos)", step }, 400, cors);
    }

    const cnpj = normalizeCNPJ(body.cnpj);
    const force = !!body.force;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Checa cache (válido por 90 dias a menos que force=true)
    let cached = false;
    let raw: BrasilAPICNPJ | null = null;
    let erroApi: string | null = null;
    let fonte = "brasilapi";

    if (!force) {
      step = "read-cache";
      const { data: cacheRow, error: cacheErr } = await admin
        .from("cnpj_cache")
        .select("*")
        .eq("cnpj", cnpj)
        .maybeSingle();
      if (cacheErr) {
        return json({ error: "falha ao ler cache", step, detail: cacheErr.message }, 500, cors);
      }

      if (cacheRow && cacheRow.sucesso) {
        const ageMs = Date.now() - new Date(cacheRow.consultado_em).getTime();
        const ninety = 90 * 24 * 60 * 60 * 1000;
        if (ageMs < ninety) {
          raw = cacheRow.payload as BrasilAPICNPJ;
          cached = true;
          if (cacheRow.fonte) fonte = cacheRow.fonte as string;
        }
      }
    }

    // 2) Se não tem cache válido, cascata: BrasilAPI → CNPJa → ReceitaWS (só em 404)
    //    BrasilAPI: snapshot mensal (Minha Receita) — rápido, sem rate limit prático
    //    CNPJa Open: live, 5 req/min — pega o que faltou
    //    ReceitaWS: live, 3 req/min — último recurso
    //    Erros não-404 (5xx/429/timeout) propagam pro cliente retentar com backoff
    if (!raw) {
      step = "fetch-brasilapi";
      const ba = await fetchBrasilAPI(cnpj);
      if (ba.ok) {
        raw = ba.data;
      } else if (ba.status === 404) {
        step = "fetch-cnpja";
        const cn = await fetchCNPJa(cnpj);
        if (cn.ok) {
          raw = cnpjaToBrasilAPI(cn.data);
          fonte = "cnpja";
        } else if (cn.status === 429) {
          // Rate limit — propaga pro cliente retentar (não tenta ReceitaWS para
          // não compor rate limits entre serviços)
          erroApi = cn.error;
        } else {
          // CNPJa também 404 ou outro erro: tenta ReceitaWS como último recurso
          step = "fetch-receitaws";
          const fb = await fetchReceitaWS(cnpj);
          if (fb.ok) {
            raw = receitaWSToBrasilAPI(fb.data);
            fonte = "receitaws";
          } else {
            // ReceitaWS rate limit propaga; outros erros mantêm "não encontrado" original
            erroApi = fb.status === 429 ? fb.error : ba.error;
          }
        }
      } else {
        erroApi = ba.error;
      }

      // Cache: sucesso preserva fonte; falha grava como brasilapi (mantém compat)
      step = raw ? "upsert-cache-success" : "upsert-cache-error";
      const { error: cacheUpErr } = await admin.from("cnpj_cache").upsert({
        cnpj,
        payload: raw ?? {},
        fonte,
        consultado_em: new Date().toISOString(),
        sucesso: !!raw,
        erro: raw ? null : erroApi,
      });
      if (cacheUpErr) console.warn("upsert cache failed:", cacheUpErr.message);
    }

    // 3) Se houve erro, atualiza empresa com o erro (se empresa_id fornecido)
    if (erroApi) {
      if (body.empresa_id) {
        step = "mark-empresa-error";
        await admin
          .from("empresas")
          .update({ receita_erro: erroApi, receita_atualizada_em: new Date().toISOString() })
          .eq("id", body.empresa_id);
      }
      // Rate limit retorna 429 para o cliente saber que vale retentar
      const httpStatus = erroApi.toLowerCase().includes("rate limit") ? 429 : 400;
      return json({ ok: false, error: erroApi, cnpj, step }, httpStatus, cors);
    }

    if (!raw) {
      return json({ ok: false, error: "sem dados", step }, 500, cors);
    }

    step = "normalize";
    const normalized = normalizeForDB(raw);

    // 4) Se empresa_id fornecido, atualiza diretamente
    if (body.empresa_id) {
      // Antes de gravar, lê as flags _manual pra preservar valores que o usuário
      // setou no dialog ou importou via planilha. Se a flag for true, dropamos
      // o campo correspondente do payload — RFB nunca sobrescreve valor manual.
      step = "read-flags-manual";
      const { data: existing, error: readErr } = await admin
        .from("empresas")
        .select("email_manual, telefone_manual")
        .eq("id", body.empresa_id)
        .maybeSingle();
      if (readErr) {
        // Falha defensiva: se a coluna ainda não existe (migration não aplicada),
        // segue sem proteção em vez de quebrar enrichment de toda a base.
        console.warn("[enriquecer-cnpj] read flags manual failed:", readErr.message);
      }

      const finalPayload: Record<string, unknown> = { ...normalized };
      if (existing?.email_manual) delete finalPayload.email_receita;
      if (existing?.telefone_manual) delete finalPayload.telefone_receita;

      step = "update-empresa";
      const { error: upErr } = await admin
        .from("empresas")
        .update(finalPayload)
        .eq("id", body.empresa_id);
      if (upErr) {
        return json(
          { ok: false, error: "erro ao gravar empresa", step, detail: upErr.message },
          500,
          cors
        );
      }
    }

    return json({ ok: true, cached, fonte, data: normalized, raw }, 200, cors);
  } catch (e) {
    const err = e as Error;
    console.error(`[enriquecer-cnpj] step=${step} error=${err.message}\n${err.stack}`);
    return json({ error: err.message, step, stack: err.stack?.split("\n").slice(0, 5) }, 500, cors);
  }
});
