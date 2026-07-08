// Supabase Edge Function: enriquecer-telefones
//
// Enriquecimento de TELEFONE (foco móvel/WhatsApp) — 100% GRÁTIS, sem cartão.
// Fonte primária: OpenStreetMap via Nominatim (dados abertos) — muitos negócios
// têm telefone/whatsapp/site nas tags. 1 chamada por empresa (extratags=1).
// Fallback: raspa o site da empresa (tag website do OSM ou domínio do e-mail RFB).
//
// Respeita a política do Nominatim: User-Agent identificável + no máx ~1 req/s
// (por isso o delay de 1100ms). Mantenha o cron modesto (ex.: limite=50/dia).
//
// Consome public.v_fila_telefones. Grava em empresa_contatos (o trigger
// recalc_empresa_contatos_cache atualiza contatos_count; a view de qualidade
// sobe o score ao ganhar um móvel).
//
// Chamada (service-role no Authorization):
//   POST /functions/v1/enriquecer-telefones?limite=20
//   POST /functions/v1/enriquecer-telefones?dry=1

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const UA = "FreireTaxCRM/1.0 (enriquecimento-contatos; +https://freire-tax.vercel.app)";
const FREEMAIL = /@(gmail|hotmail|outlook|yahoo|bol|uol|terra|live|icloud|globo|ig|msn)\./i;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// Normaliza telefone BR para dígitos nacionais (10 fixo / 11 móvel).
function normalizeBRPhone(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  return d;
}
const isMobile = (d: string) => d.length === 11 && d[2] === "9";

// Tags do OSM podem trazer VÁRIOS telefones num campo ("+55 83 3341 2100;+55 83 3310 6018").
// Separa, valida cada um e prefere um MÓVEL.
function pickBRPhone(raw: string): string | null {
  const cands = (raw ?? "")
    .split(/[;,/]+/)
    .map((p) => normalizeBRPhone(p))
    .filter((d): d is string => !!d);
  return cands.find(isMobile) ?? cands[0] ?? null;
}
function formatBRPhone(d: string): string {
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return d;
}

// Nome pra buscar em listagens: a MARCA (fantasia) casa muito melhor que a
// razão social formal ("Redepharma" acha; "REDEPHARMA LTDA" não). Remove
// sufixos societários que atrapalham o match.
function cleanName(s: string): string {
  return (s ?? "")
    .replace(/\bEM RECUPERACAO JUDICIAL\b/gi, "")
    .replace(/\bS[\/.]?A\b/gi, " ")
    .replace(/\bLTDA\.?\b/gi, " ")
    .replace(/\bEIRELI\b/gi, " ")
    .replace(/\s[-–]\s*(ME|EPP)\b/gi, " ")
    .replace(/\bEPP\b/gi, " ")
    .replace(/\s+ME\s*$/i, " ")
    .replace(/[-–\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface OsmHit {
  phone: string | null;
  phoneFromWhatsapp: boolean; // tag whatsapp/mobile => tratar como móvel/whatsapp
  website: string | null;
  address: string;
}

// ---------------------------------------------------------------------------
// OpenStreetMap / Nominatim — telefone + site numa chamada (extratags)
// ---------------------------------------------------------------------------
async function nominatim(
  razao: string,
  municipio: string,
  uf: string,
): Promise<{ apiError: boolean; hit: OsmHit | null }> {
  try {
    const q = encodeURIComponent(`${razao} ${municipio} ${uf}`);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&addressdetails=1&limit=1&countrycodes=br&q=${q}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!r.ok) return { apiError: true, hit: null }; // 429/503/etc — não é "sem dado"
    const arr = await r.json();
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) return { apiError: false, hit: null };
    const t = p.extratags ?? {};
    // Prioriza whatsapp/móvel; depois fixo.
    const wa = t["contact:whatsapp"] ?? t["whatsapp"] ?? t["contact:mobile"] ?? t["mobile"];
    const fixo = t["contact:phone"] ?? t["phone"];
    const website = t["contact:website"] ?? t["website"] ?? t["url"] ?? null;
    return {
      apiError: false,
      hit: {
        phone: wa ?? fixo ?? null,
        phoneFromWhatsapp: !!wa,
        website,
        address: p.display_name ?? "",
      },
    };
  } catch {
    return { apiError: true, hit: null };
  }
}

// Fallback: raspa o site e extrai o 1º telefone BR plausível (prioriza móvel).
async function scrapePhoneFromSite(url: string): Promise<string | null> {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(u, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    clearTimeout(t);
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 300_000);
    const re = /\(?\b(\d{2})\)?[\s.-]?(9?\d{4})[\s.-]?(\d{4})\b/g;
    let m: RegExpExecArray | null;
    let firstFixed: string | null = null;
    while ((m = re.exec(html)) !== null) {
      const d = normalizeBRPhone(m[1] + m[2] + m[3]);
      if (!d) continue;
      if (isMobile(d)) return d;
      if (!firstFixed) firstFixed = d;
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
  email_receita: string | null;
  nome_fantasia: string | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: "env vars missing (SUPABASE_URL / SERVICE_ROLE_KEY)" }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (jwtRole(token) !== "service_role" && token !== SERVICE_ROLE) {
    return json({ error: "unauthorized (service-role requerida)" }, 401);
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const limite = Math.min(60, Math.max(1, parseInt(url.searchParams.get("limite") ?? "20", 10) || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: fila, error: filaErr } = await admin
    .from("v_fila_telefones")
    .select("empresa_id, razao_social, municipio, uf, cnpj, email_receita, nome_fantasia")
    .limit(limite);
  if (filaErr) return json({ error: "falha ao ler fila", detail: filaErr.message }, 500);
  if (dry) return json({ ok: true, dry: true, fila }, 200);

  const rows = (fila ?? []) as FilaRow[];
  const res = {
    processadas: 0, com_telefone: 0, moveis: 0, sem_achar: 0, erros_api: 0, falhas: 0,
    osm_com_place: 0, // diagnóstico: quantas o Nominatim retornou um lugar (se ~0, IP do edge bloqueado)
    detalhes: [] as unknown[],
  };

  for (const row of rows) {
    res.processadas++;
    let phone: string | null = null;
    let waHint = false;
    let website: string | null = null;
    let apiError = false;
    let fonte = "osm";

    // 1) OpenStreetMap. Guarda: o endereço retornado precisa conter o município
    // (evita casar com empresa homônima de outra cidade).
    // Busca pela marca (fantasia) — casa melhor que a razão social formal.
    const searchName = cleanName(row.nome_fantasia || "") || cleanName(row.razao_social);
    const osm = await nominatim(searchName, row.municipio, row.uf);
    apiError = osm.apiError;
    if (osm.hit) {
      res.osm_com_place++;
      website = osm.hit.website;
      const muni = stripAccents(row.municipio).toLowerCase();
      const addrOk = stripAccents(osm.hit.address).toLowerCase().includes(muni);
      if (osm.hit.phone && addrOk) {
        phone = osm.hit.phone;
        waHint = osm.hit.phoneFromWhatsapp;
      }
    }

    // 2) Fallback: site (tag do OSM ou domínio do e-mail RFB corporativo).
    if (!phone) {
      let site = website;
      if (!site && row.email_receita && row.email_receita.includes("@") && !FREEMAIL.test(row.email_receita)) {
        site = row.email_receita.split("@")[1]?.trim() || null;
      }
      if (site) {
        const p = await scrapePhoneFromSite(site);
        if (p) { phone = p; fonte = "website"; }
      }
    }

    const digits = phone ? pickBRPhone(phone) : null;

    if (!digits) {
      // Erro de API (rate-limit/queda): NÃO grava backoff — evita falso-negativo.
      if (apiError) { res.erros_api++; await sleep(1100); continue; }
      res.sem_achar++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte: "osm",
        sucesso: false, erro: "sem telefone encontrado",
      });
      await sleep(1100);
      continue;
    }

    const movel = isMobile(digits) || waHint;
    const { error: insErr } = await admin.from("empresa_contatos").insert({
      empresa_id: row.empresa_id,
      telefone: formatBRPhone(digits),
      tipo_telefone: movel ? "movel" : "fixo",
      whatsapp: movel,
      papel: "geral",
      origem: "enriquecimento",
      dedup_key: `tel:${digits}`,
    });

    if (insErr && insErr.code !== "23505") {
      res.falhas++;
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte, sucesso: false, erro: `gravar: ${insErr.message}`,
      });
    } else {
      res.com_telefone++;
      if (movel) res.moveis++;
      res.detalhes.push({ empresa: row.razao_social, telefone: formatBRPhone(digits), tipo: movel ? "movel" : "fixo", fonte });
      await admin.from("enriquecimento_log").insert({
        empresa_id: row.empresa_id, cnpj: row.cnpj, fonte, sucesso: true,
      });
    }

    await sleep(1100); // política Nominatim: ~1 req/s
  }

  return json({ ok: true, ...res }, 200);
});
