#!/usr/bin/env node
/**
 * tools/insert_decisor_gestor.mjs
 *
 * Ferramenta PERMANENTE (não apagar) pra gravar contatos de gestores/diretores
 * (papel=decisor) achados via pesquisa web, em qualquer UF. Substitui o padrão
 * antigo de criar um insert_gestores_XXX.mjs por lote e apagar depois.
 *
 * Uso:
 *   1) Escreva um arquivo JSON com os achados (ver formato abaixo).
 *   2) Rode com --dry-run primeiro pra conferir.
 *   3) Rode sem --dry-run pra gravar de verdade.
 *
 * Formato do JSON (array de grupos — cada grupo pode aplicar a 1 ou várias
 * empresas que casem com o mesmo padrão, útil pra SPEs do mesmo grupo controlador):
 *
 * [
 *   {
 *     "uf": "RN",
 *     "empresaLike": "%NOME DA EMPRESA%",
 *     "todasQueCasarem": false,  // true = aplica a TODAS as empresas que casarem
 *                                 // (útil pra clusters de SPE); false = só a primeira
 *     "contatos": [
 *       { "nome": "...", "cargo": "...", "confianca": "alta|média|baixa",
 *         "fonte": "URL ou descrição", "linkedin": "URL opcional" }
 *     ]
 *   }
 * ]
 *
 *   export SUPABASE_URL="https://<ref>.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *   node tools/insert_decisor_gestor.mjs --file lote.json --dry-run
 *   node tools/insert_decisor_gestor.mjs --file lote.json
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const fileIdx = argv.indexOf("--file");
const FILE = fileIdx >= 0 ? argv[fileIdx + 1] : null;
if (!FILE) {
  console.error("Uso: node insert_decisor_gestor.mjs --file <lote.json> [--dry-run]");
  process.exit(1);
}

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function normNome(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

async function main() {
  const grupos = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  let inseridos = 0, jaExistia = 0, empresaNaoAchada = 0;

  for (const grupo of grupos) {
    const uf = grupo.uf || "PB";
    const { data: empresas, error } = await supabase
      .from("empresas").select("id, nome").eq("uf", uf).ilike("nome", grupo.empresaLike)
      .limit(grupo.todasQueCasarem ? 1000 : 3);
    if (error) { console.error("erro busca empresa:", grupo.empresaLike, error.message); continue; }
    if (!empresas || empresas.length === 0) {
      console.log(`[SEM MATCH] (${uf}) ${grupo.empresaLike}`);
      empresaNaoAchada++;
      continue;
    }
    const alvos = grupo.todasQueCasarem ? empresas : [empresas[0]];
    if (!grupo.todasQueCasarem && empresas.length > 1) {
      console.log(`  (obs: ${empresas.length} matches p/ ${grupo.empresaLike}, usando "${empresas[0].nome}" — revise se não for a certa)`);
    }
    if (grupo.todasQueCasarem) {
      console.log(`--- ${grupo.empresaLike} (${uf}): aplicando a ${alvos.length} empresas ---`);
    }
    for (const empresa of alvos) {
      for (const c of grupo.contatos) {
        const dedupKey = "decisor_web:" + normNome(c.nome);
        const { data: existing } = await supabase
          .from("empresa_contatos").select("id").eq("empresa_id", empresa.id).eq("dedup_key", dedupKey).maybeSingle();
        if (existing) { jaExistia++; continue; }
        console.log(`[${DRY_RUN ? "DRY" : "INSERT"}] (${uf}) ${empresa.nome} -> ${c.nome} (${c.cargo}) [confiança: ${c.confianca}]${c.linkedin ? " [LinkedIn]" : ""}`);
        if (!DRY_RUN) {
          const { error: insErr } = await supabase.from("empresa_contatos").insert({
            empresa_id: empresa.id,
            nome: c.nome,
            cargo: c.cargo,
            papel: "decisor",
            origem: "outro",
            linkedin: c.linkedin || null,
            observacoes: `Pesquisa web (confiança: ${c.confianca}). Fonte: ${c.fonte}`,
            dedup_key: dedupKey,
          });
          if (insErr) { console.error("  erro insert:", insErr.message); continue; }
        }
        inseridos++;
      }
    }
  }
  console.log(`\n=== Resumo: ${inseridos} inseridos, ${jaExistia} já existiam, ${empresaNaoAchada} empresas sem match ===`);
}

main().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
