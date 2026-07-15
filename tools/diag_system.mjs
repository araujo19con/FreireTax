#!/usr/bin/env node
/**
 * tools/diag_system.mjs — diagnóstico system-wide da cobertura de decisor,
 * rankeado por capital_social (proxy de porte; faturamento_* está vazio no DB).
 * Read-only. Exporta worklist priorizada das empresas SEM decisor.
 *
 * Uso:
 *   set -a && . ./tools/.env.local && set +a
 *   node tools/diag_system.mjs [--top N]   (default 300)
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });
const argv = process.argv.slice(2);
const TOP = argv.includes("--top") ? Number(argv[argv.indexOf("--top") + 1]) : 300;
const STATUS = argv.includes("--status") ? argv[argv.indexOf("--status") + 1] : null; // ex: prospect
const CAP_MAX = argv.includes("--cap-max") ? Number(argv[argv.indexOf("--cap-max") + 1]) : null; // teto capital

async function main() {
  // 1) todas empresas (campos p/ priorizar e guiar pesquisa)
  const emp = [];
  for (let f = 0; ; f += 1000) {
    let q = supabase.from("empresas")
      .select("id,nome,razao_social,cnpj,uf,municipio,porte,capital_social,qsa,telefone_receita,email_receita,telefones,contatos_count,status")
      .range(f, f + 999);
    if (STATUS) q = q.eq("status", STATUS);
    const { data, error } = await q;
    if (error) throw new Error("empresas: " + error.message);
    emp.push(...data);
    if (data.length < 1000) break;
  }
  if (STATUS) console.log(`Filtro status='${STATUS}': ${emp.length} empresas.`);
  if (CAP_MAX) console.log(`Teto capital: R$${CAP_MAX.toLocaleString("pt-BR")}`);
  // 2) empresa_ids que JÁ têm decisor (query só papel=decisor, paginado)
  const decisorSet = new Set();
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from("empresa_contatos")
      .select("empresa_id").eq("papel", "decisor").range(f, f + 999);
    if (error) throw new Error("contatos decisor: " + error.message);
    data.forEach((c) => decisorSet.add(c.empresa_id));
    if (data.length < 1000) break;
  }
  console.log("Total empresas:", emp.length, "| já com decisor:", decisorSet.size);

  let semD = emp.filter((e) => !decisorSet.has(e.id));
  if (CAP_MAX) semD = semD.filter((e) => (Number(e.capital_social) || 0) <= CAP_MAX);
  console.log("SEM decisor" + (CAP_MAX ? " (abaixo do teto)" : "") + ":", semD.length);

  // priorizar: capital_social desc (faturamento vazio no DB)
  semD.sort((a, b) => (Number(b.capital_social) || 0) - (Number(a.capital_social) || 0));

  const hasTel = (e) => !!e.telefone_receita || (Array.isArray(e.telefones) && e.telefones.length > 0);
  const qsaCount = (e) => Array.isArray(e.qsa) ? e.qsa.length : 0;

  const top = semD.slice(0, TOP);
  console.log(`\nTop ${top.length} sem decisor (por capital_social):`);
  console.log("  já com algum telefone:", top.filter(hasTel).length, "| com email_receita:", top.filter((e) => e.email_receita).length, "| com QSA:", top.filter((e) => qsaCount(e) > 0).length, "| com CNPJ:", top.filter((e) => e.cnpj).length);
  console.log("  UF:", JSON.stringify(top.reduce((a, e) => ((a[e.uf || "null"] = (a[e.uf || "null"] || 0) + 1), a), {})));

  const worklist = top.map((e) => ({
    id: e.id, nome: e.nome, razao_social: e.razao_social || null, cnpj: e.cnpj || null,
    uf: e.uf || null, municipio: e.municipio || null, porte: e.porte || null,
    capital_social: e.capital_social,
    qsa: Array.isArray(e.qsa) ? e.qsa.map((x) => ({ nome: x.nome || x.nome_socio, qual: x.qual || x.qualificacao })) : [],
    telefone_receita: e.telefone_receita || null, email_receita: e.email_receita || null,
    tem_telefone: hasTel(e),
  }));
  fs.writeFileSync("tools/worklist_system.json", JSON.stringify(worklist, null, 1));
  console.log(`\n[export] tools/worklist_system.json com ${worklist.length} alvos.`);
  console.log("Amostra top 25:");
  top.slice(0, 25).forEach((e) => console.log(`  [${e.uf || "?"}] ${e.nome} | cap R$${Number(e.capital_social || 0).toLocaleString("pt-BR")} | ${e.cnpj || "sem cnpj"} | QSA:${qsaCount(e)}${hasTel(e) ? " | tem tel" : ""}`));
}
main().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
