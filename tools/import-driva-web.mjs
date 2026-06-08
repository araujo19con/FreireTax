#!/usr/bin/env node
/**
 * tools/import-driva-web.mjs
 *
 * Complementa o import da DRIVA com a presença WEB/SOCIAL da empresa
 * (site, LinkedIn, Instagram, Facebook) — vinda das colunas concatenadas da
 * aba "RFB". Grava em empresas.metadados (campos personalizados, sem migration;
 * aparecem no detalhe da empresa). Útil pra pesquisa do decisor (LinkedIn) e
 * pra ter o domínio.
 *
 * NÃO sobrescreve chaves de metadados já existentes. Idempotente.
 *
 *   export SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
 *   node tools/import-driva-web.mjs --file "../(DRIVA) empresas PB.xlsx" [--dry-run]
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const has = (n) => argv.includes(n);
const FILE = (flag("--file") || "../(DRIVA) empresas PB.xlsx").toString();
const DRY = has("--dry-run");

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
const cleanCNPJ = (s) => { const d = onlyDigits(s); return d.length === 14 ? d : null; };
// primeira URL de uma lista "a.com, b.com"
const first = (s) => { const v = String(s ?? "").split(",")[0].trim(); return v || null; };
const filePath = isAbsolute(FILE) ? FILE : join(__dirname, "..", FILE);

async function main() {
  const wb = XLSX.read(await readFile(filePath), { type: "buffer" });
  const rfb = wb.Sheets["RFB"] ? XLSX.utils.sheet_to_json(wb.Sheets["RFB"], { defval: "" }) : [];
  console.log(`> RFB: ${rfb.length} empresas na planilha.`);

  // web por CNPJ
  const webByCnpj = new Map();
  for (const r of rfb) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    if (!cnpj) continue;
    const web = {};
    const site = first(r["Sites Concatenados"]);
    const lkd = first(r["Linkedin Concatenado"]);
    const fb = first(r["Facebook Concatenado"]);
    const ig = first(r["Instagram Concatenado"]);
    if (site) web["Site"] = site;
    if (lkd) web["LinkedIn"] = lkd;
    if (fb) web["Facebook"] = fb;
    if (ig) web["Instagram"] = ig;
    if (Object.keys(web).length) webByCnpj.set(cnpj, web);
  }
  console.log(`> ${webByCnpj.size} empresas com presença web na planilha.`);

  // mapa cnpj(digitos) -> empresa_id (base guarda formatado)
  const cnpjToId = new Map();
  {
    const PAGE = 1000; let from = 0;
    for (;;) {
      const { data, error } = await supabase.from("empresas").select("id, cnpj").not("cnpj", "is", null).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao ler empresas: " + error.message);
      for (const e of data ?? []) { const c = cleanCNPJ(e.cnpj); if (c) cnpjToId.set(c, e.id); }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }

  let atualizadas = 0, semMatch = 0, semNovo = 0;
  for (const [cnpj, web] of webByCnpj) {
    const id = cnpjToId.get(cnpj);
    if (!id) { semMatch++; continue; }
    const { data: cur, error } = await supabase.from("empresas").select("metadados").eq("id", id).single();
    if (error) throw new Error("Falha ao ler metadados: " + error.message);
    const meta = (cur?.metadados && typeof cur.metadados === "object") ? cur.metadados : {};
    // não sobrescreve o que já existe
    let mudou = false;
    for (const [k, v] of Object.entries(web)) {
      if (!meta[k]) { meta[k] = v; mudou = true; }
    }
    if (!mudou) { semNovo++; continue; }
    if (DRY) { atualizadas++; continue; }
    const { error: upErr } = await supabase.from("empresas").update({ metadados: meta }).eq("id", id);
    if (upErr) throw new Error("Falha ao gravar metadados: " + upErr.message);
    atualizadas++;
    process.stdout.write(`\r> Atualizadas ${atualizadas}...`);
  }
  process.stdout.write("\n");
  console.log(`> ${DRY ? "[dry-run] " : ""}empresas com web gravada: ${atualizadas} | já tinham: ${semNovo} | sem cadastro: ${semMatch}`);
}

main().catch((e) => { console.error("\nFALHA:", e.message); process.exit(1); });
