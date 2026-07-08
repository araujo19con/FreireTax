// Supabase Edge Function: enriquecer-telefones
//
// Enriquecimento de TELEFONE (foco móvel/WhatsApp) — grátis.
// Fonte primária: Google Places API (New) Text Search — listagens de empresa
// têm o celular atual que a RFB não tem. 1 chamada Pro por empresa (campo
// telefone é Pro): 5.000/mês grátis. Fallback sem key: raspa o site da empresa.
//
// Consome public.v_fila_telefones. Grava em empresa_contatos (o trigger
// recalc_empresa_contatos_cache atualiza contatos_count; a view de qualidade
// sobe o score ao ganhar um móvel).
//
// Chamada (service-role no Authorization, igual enriquecer-fila):
//   POST /functions/v1/enriquecer-telefones?limite=20
//   POST /functions/v1/enriquecer-telefones?dry=1
//
// Env:
//   GOOGLE_PLACES_API_KEY  (opcional) — sem ela, roda só o tier de site.
//     supabase secrets set GOOGLE_PLACES_API_KEY=... --project-ref <ref>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jwtRole(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    return JSON.parse(atob(b64 + pad)).role ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// Normaliza um telefone BR para dígitos nacionais (10 fixo / 11 móvel).
function normalizeBRPhone(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d)) return null; // 0000..., 9999...
  return d;
}

// Móvel BR: 11 dígitos com o 3º dígito (após DDD) = 9.
function isMobile(digits: string): boolean {
  return digits.length === 11 && digits[2] === "9";
}

function formatBRPhone(digits: string): string {
  if (digits.length === 11)
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digits.length === 10)
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return digits;
}

// ---------------------------------------------------------------------------
// Google Places (New) — Text Search com telefone/website numa chamada só
// ---------------------------------------------------------------------------
interface PlacesHit {
  phone: string | null;
  website: string | null;
  address: string;
}

async function googlePlaces(
  key: string,
  razao: string,
  municipio: string,
  uf: string,
): Promise<PlacesHit | null> {
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Só campos Pro necessários — mantém a chamada no tier grátis Pro.
        "X-Goog-FieldMask":
          "places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.formattedAddress,places.displayName",
      },
      body: JSON.stringify({
        textQuery: `${razao} ${municipio} ${uf} Brasil`,
        regionCode: "BR",
        languageCode: "pt-BR",
        maxResultCount: 1,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const p = data?.places?.[0];
    if (!p) return null;
    return {
      phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      address: p.formattedAddress ?? "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback: raspa o site da empresa e extrai o 1º telefone BR plausível
// ---------------------------------------------------------------------------
async function scrapePhoneFromSite(url: string): Promise<string | null> {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(u, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (contact-enrichment)" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 300_000);
    // Padrão BR: (DD) 9xxxx-xxxx / (DD) xxxx-xxxx, com ou sem parênteses/traço.
    const re = /\(?\b(\d{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;
    let m: RegExpExecArray | null;
    let firstFixed: string | null = null;
    while ((m = re.exec(html)) !== null) {
      const digits = normalizeBRPhone(m[1] + m[2] + m[3]);
      if (!digits) continue;
      if (isMobile(digits)) return digits; // prioriza móvel
      if (!firstFixed) firstFixed = digits;
    }
    return firstFixed;
  } catch {
    return null;
  }
}

interface FilaRow {
  empresa_id: string;
  razao_social: string;
  municipio: string;
  uf: string;
  cnpj: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: "env vars missing (SUPABASE_URL / SERVICE_ROLE_KEY)" }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (jwtRole(token) !== "service_role" && token !== SERVICE_ROLE) {
    return json({ error: "unauthorized (service-role requerida)" }, 401);
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const limite = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limite") ?? "20", 10) || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: fila, error: filaErr } = await admin
    .from("v_fila_telefones")
    .select("empresa_id, razao_social, municipio, uf, cnpj")
    .limit(limite);
  if (filaErr) return json({ error: "falha ao ler fila", detail: filaErr.message }, 500);
  if (dry) return json({ ok: true, dry: true, tem_places_key: !!PLACES_KEY, fila }, 200);

  const rows = (fila ?? []) as FilaRow[];
  const res = {
    processadas: 0, com_telefone: 0, moveis: 0, sem_achar: 0, falhas: 0,
    tem_places_key: !!PLACES_KEY, detalhes: [] as unknown[],
  };

  for (const row of rows) {
    res.processadas++;
    let phone: string | null = null;
    let website: string | null = null;
    let fonte = "google_places";

    // 1) Google Places (se houver key). Guarda: o endereço retornado precisa
    // conter o município — evita casar com empresa homônima de outra cidade.
    if (PLACES_KEY) {
      const hit = await googlePlaces(PLACES_KEY, row.razao_social, row.municipio, row.uf);
      if (hit) {
        website = hit.website;
        const muni = stripAccents(row.municipio).toLowerCase();
        const addrOk = stripAccents(hit.address).toLowerCase().includes(muni);
        if (hit.phone && addrOk) phone = hit.phone;
      }
    }

    // 2) Fallback: site (do Places ou já conhecido). Sem key, só roda se houver site.
    if (!phone && website) {
      const p = await scrapePhoneFromSite(website);
      if (p) { phone = p; fonte = "website"; }
    }

    const digits = phone ? normalizeBRPhone(phone) : null;

    if (!digits) {
      res.sem_achar++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte: PLACES_KEY ? "google_places" : "website",
        sucesso: false, erro: "sem telefone encontrado",
      });
      await sleep(200);
      continue;
    }

    const movel = isMobile(digits);
    const { error: insErr } = await admin.from("empresa_contatos").insert({
      empresa_id: row.empresa_id,
      telefone: formatBRPhone(digits),
      tipo_telefone: movel ? "movel" : "fixo",
      whatsapp: movel,
      papel: "geral",
      origem: "enriquecimento",
      dedup_key: `tel:${digits}`,
    });

    // 23505 = telefone já existe (dedup) — não é falha.
    if (insErr && insErr.code !== "23505") {
      res.falhas++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte,
        sucesso: false, erro: `gravar contato: ${insErr.message}`,
      });
    } else {
      res.com_telefone++;
      if (movel) res.moveis++;
      res.detalhes.push({ empresa: row.razao_social, telefone: formatBRPhone(digits), tipo: movel ? "movel" : "fixo", fonte });
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte, sucesso: true,
      });
    }

    await sleep(200);
  }

  return json({ ok: true, ...res }, 200);
});
