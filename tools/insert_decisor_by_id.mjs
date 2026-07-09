#!/usr/bin/env node
/**
 * tools/insert_decisor_by_id.mjs
 *
 * Grava contatos papel=decisor casando por empresa_id EXATO (sem match por nome —
 * elimina bugs de mojibake / séries numeradas de SPE). Lê um ou mais arquivos JSON
 * no formato:
 *
 *   [ { "id": "<empresa_id>", "nome": "<só p/ log>",
 *       "contatos": [ { "nome": "...", "cargo": "...", "confianca": "alta|média|baixa",
 *                       "fonte": "URL/descrição", "linkedin": "URL opcional",
 *                       "telefone": "opcional", "email": "opcional" } ] } ]
 *
 * Uso:
 *   set -a && . ./tools/.env.local && set +a
 *   node tools/insert_decisor_by_id.mjs --glob 'tools/found_terco_*.json' --dry-run
 *   node tools/insert_decisor_by_id.mjs --glob 'tools/found_terco_*.json'
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const globIdx = argv.indexOf("--glob");
const GLOB = globIdx >= 0 ? argv[globIdx + 1] : null;
const fileIdx = argv.indexOf("--file");
const FILE = fileIdx >= 0 ? argv[fileIdx + 1] : null;
if (!GLOB && !FILE) { console.error("Uso: --glob '<padrão>' ou --file <arquivo>"); process.exit(1); }

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function normNome(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function resolveFiles() {
  if (FILE) return [FILE];
  // glob simples: dir + prefixo até '*'
  const dir = path.dirname(GLOB);
  const base = path.basename(GLOB);
  const [pre, post] = base.split("*");
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(pre) && (post ? f.endsWith(post) : true))
    .map((f) => path.join(dir, f));
}

async function main() {
  const files = resolveFiles();
  console.log(`Arquivos: ${files.length} -> ${files.map((f) => path.basename(f)).join(", ")}`);
  let inseridos = 0, jaExistia = 0, semContato = 0, empresasVistas = 0;

  for (const file of files) {
    let registros;
    try { registros = JSON.parse(fs.readFileSync(file, "utf-8")); }
    catch (e) { console.error(`[skip] ${file}: JSON inválido (${e.message})`); continue; }
    if (!Array.isArray(registros)) { console.error(`[skip] ${file}: não é array`); continue; }

    for (const reg of registros) {
      empresasVistas++;
      if (!reg.id) { console.error(`[skip] registro sem id: ${reg.nome || "?"}`); continue; }
      const contatos = Array.isArray(reg.contatos) ? reg.contatos : [];
      if (!contatos.length) { semContato++; continue; }
      for (const c of contatos) {
        if (!c.nome || !c.nome.trim()) continue;
        const dedupKey = "decisor_web:" + normNome(c.nome);
        const { data: existing } = await supabase
          .from("empresa_contatos").select("id").eq("empresa_id", reg.id).eq("dedup_key", dedupKey).maybeSingle();
        if (existing) { jaExistia++; continue; }
        console.log(`[${DRY_RUN ? "DRY" : "INSERT"}] ${reg.nome || reg.id} -> ${c.nome} (${c.cargo || "?"}) [${c.confianca || "?"}]${c.linkedin ? " [LI]" : ""}${c.telefone ? " [tel]" : ""}${c.email ? " [email]" : ""}`);
        if (!DRY_RUN) {
          const { error: insErr } = await supabase.from("empresa_contatos").insert({
            empresa_id: reg.id,
            nome: c.nome.trim(),
            cargo: c.cargo || null,
            papel: "decisor",
            origem: "outro",
            linkedin: c.linkedin || null,
            telefone: c.telefone || null,
            email: c.email || null,
            observacoes: `Pesquisa web ação terço (confiança: ${c.confianca || "?"}). Fonte: ${c.fonte || "n/d"}`,
            dedup_key: dedupKey,
          });
          if (insErr) { console.error("  erro insert:", insErr.message); continue; }
        }
        inseridos++;
      }
    }
  }
  console.log(`\n=== Resumo: ${inseridos} inseridos, ${jaExistia} já existiam, ${semContato} empresas sem contato achado, ${empresasVistas} empresas processadas ===`);
}
main().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
