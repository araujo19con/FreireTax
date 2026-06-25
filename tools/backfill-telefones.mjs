#!/usr/bin/env node
/**
 * tools/backfill-telefones.mjs
 *
 * Backfill dos telefones que o sistema descartava (2º telefone do BrasilAPI,
 * array do CNPJa). Lê o `cnpj_cache.payload` (resposta crua já em cache —
 * inclui ddd_telefone_2), monta o array completo e grava em `empresas.telefones`.
 * O trigger derive_contatos_from_rfb (migration 20260625000000) materializa cada
 * número novo como empresa_contatos (tipo fixo/movel classificado automático).
 *
 * NÃO re-busca a Receita (usa só o cache) → rápido, sem rate limit. Idempotente
 * e resumível (pula empresas cujo telefones já cobre os números do cache).
 * Para os enriquecidos via CNPJa (cache só tem 1 fone) ou nunca enriquecidos,
 * rode depois o BulkEnrich "Todas as empresas" na UI (edge function já corrigida
 * captura o array do CNPJa server-side).
 *
 *   export SUPABASE_URL="https://<ref>.supabase.co"        # ou VITE_SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node tools/backfill-telefones.mjs [--dry-run] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i < 0 ? null : argv[i + 1];
};
const DRY_RUN = has("--dry-run");
const LIMIT = flag("--limit") ? Number(flag("--limit")) : Infinity;

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const digits = (s) => String(s ?? "").replace(/\D/g, "");

/** Normaliza um telefone BR: tira 55 do país, exige 10/11 díg, rejeita lixo
 *  (tudo zero / dígito repetido tipo 0000000000, 9999999999). null se inválido. */
function cleanPhone(s) {
  let d = digits(s);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d)) return null;
  return d;
}

/** Extrai todos os telefones válidos do payload cru do cache. */
function phonesFromPayload(p) {
  if (!p || typeof p !== "object") return [];
  const raw = [];
  // BrasilAPI: ddd_telefone_1 / ddd_telefone_2 (ReceitaWS guarda a string em _1, pode ter "/")
  for (const k of ["ddd_telefone_1", "ddd_telefone_2"]) {
    const v = p[k];
    if (v) for (const part of String(v).split(/[/;]/)) raw.push(part);
  }
  // CNPJa convertido pode ter trazido _telefones (após o fix da edge function)
  if (Array.isArray(p._telefones)) raw.push(...p._telefones);
  const out = [];
  const seen = new Set();
  for (const r of raw) {
    const d = cleanPhone(r);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

async function main() {
  // 1) Cache BrasilAPI (cnpj digits -> payload). Tabela costuma ser pequena.
  console.log("> Lendo cnpj_cache...");
  const cache = new Map();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("cnpj_cache")
        .select("cnpj, payload, sucesso")
        .eq("sucesso", true)
        .order("cnpj")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao ler cnpj_cache: " + error.message);
      for (const c of data ?? []) cache.set(digits(c.cnpj), c.payload);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`> ${cache.size} CNPJs no cache.`);

  // 2) Empresas (id, cnpj, telefone_receita, telefones já gravado).
  console.log("> Lendo empresas...");
  const empresas = [];
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, cnpj, telefone_receita, telefones")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao ler empresas: " + error.message);
      empresas.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`> ${empresas.length} empresas.`);

  // 3) Para cada empresa com payload no cache, computa o array completo.
  //    Só atualiza quando há número NOVO além do que já está em telefones.
  const updates = [];
  let semCache = 0;
  for (const e of empresas) {
    const payload = cache.get(digits(e.cnpj));
    if (!payload) {
      semCache++;
      continue;
    }
    const phones = phonesFromPayload(payload);
    if (!phones.length) continue;
    const jaTem = new Set((Array.isArray(e.telefones) ? e.telefones : []).map(digits));
    // inclui o telefone_receita pra não considerar "novo" o que já é o principal
    if (e.telefone_receita) jaTem.add(digits(e.telefone_receita));
    const novos = phones.filter((d) => !jaTem.has(d));
    if (!novos.length) continue; // idempotente: nada a ganhar
    updates.push({ id: e.id, telefones: phones });
    if (updates.length >= LIMIT) break;
  }

  console.log(
    `> ${updates.length} empresas com telefone novo a materializar ` +
      `(${semCache} sem cache — re-enriquecer via UI depois).`
  );
  if (!updates.length) return;

  if (DRY_RUN) {
    console.table(updates.slice(0, 10).map((u) => ({ emp: u.id.slice(0, 8), telefones: u.telefones.join(", ") })));
    console.log("> [dry-run] nada gravado.");
    return;
  }

  // 4) UPDATE por empresa (valores distintos) — dispara o trigger que
  //    materializa só os números novos (dedup por 'tel:'+dígitos).
  let n = 0;
  for (const u of updates) {
    const { error } = await supabase.from("empresas").update({ telefones: u.telefones }).eq("id", u.id);
    if (error) {
      console.error(`\n  falha ${u.id.slice(0, 8)}: ${error.message}`);
      continue;
    }
    n++;
    if (n % 25 === 0) process.stdout.write(`\r> Atualizadas ${n}/${updates.length}...`);
  }
  process.stdout.write("\n");
  console.log(`> Pronto. ${n} empresas com telefones backfilled (trigger materializou os celulares novos).`);
}

main().catch((e) => {
  console.error("\nFALHA:", e.message);
  process.exit(1);
});
