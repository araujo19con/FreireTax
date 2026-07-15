#!/usr/bin/env node
/**
 * tools/diag_terco.mjs — diagnóstico do estado de enriquecimento da ação do terço
 * (Rescisória do Tema 985). Read-only. Mapeia empresas vinculadas e cobertura de
 * contatos (decisor/socio) pra evitar retrabalho.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

async function pageAll(table, cols, applyFilter) {
  const out = [];
  let from = 0;
  const step = 1000;
  for (;;) {
    let q = supabase.from(table).select(cols).range(from, from + step - 1);
    q = applyFilter ? applyFilter(q) : q;
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

async function main() {
  // 1) achar a ação do terço
  const { data: acoes, error: acErr } = await supabase
    .from("acoes_tributarias")
    .select("id, nome")
    .or("nome.ilike.%terço%,nome.ilike.%terco%,nome.ilike.%985%,nome.ilike.%rescis%,nome.ilike.%férias%,nome.ilike.%ferias%");
  if (acErr) throw new Error("acoes: " + acErr.message);
  console.log("== Ações candidatas (terço/985/rescisória) ==");
  for (const a of acoes) console.log(`  ${a.id}  ${a.nome}`);
  if (!acoes.length) { console.log("Nenhuma ação encontrada. Listando todas:");
    const { data: todas } = await supabase.from("acoes_tributarias").select("id, nome");
    for (const a of todas) console.log(`  ${a.id}  ${a.nome}`);
    return;
  }

  for (const acao of acoes) {
    // empresas elegíveis/vinculadas a essa ação
    const eleg = await pageAll("elegibilidade", "empresa_id, status_qualificacao, elegivel", (q) => q.eq("acao_id", acao.id));
    if (!eleg.length) continue;
    console.log(`\n===== AÇÃO: ${acao.nome} (${eleg.length} vínculos) =====`);
    const statusCount = {};
    for (const e of eleg) statusCount[e.status_qualificacao] = (statusCount[e.status_qualificacao] || 0) + 1;
    console.log("  Status elegibilidade:", JSON.stringify(statusCount));

    const empresaIds = [...new Set(eleg.map((e) => e.empresa_id).filter(Boolean))];
    // dados das empresas
    const empresas = [];
    for (let i = 0; i < empresaIds.length; i += 300) {
      const slice = empresaIds.slice(i, i + 300);
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome, cnpj, uf, porte, capital_social, contatos_count, quantidade_funcionarios, qsa, telefone_receita, email_receita, telefones")
        .in("id", slice);
      if (error) throw new Error("empresas: " + error.message);
      empresas.push(...data);
    }
    // contatos dessas empresas — paginar com .range() DENTRO de cada slice:
    // empresas grandes têm dezenas de sócios, e sem .range() o PostgREST trunca
    // em 1000 linhas por slice, subcontando decisores e inflando a worklist.
    const contatos = [];
    for (let i = 0; i < empresaIds.length; i += 100) {
      const slice = empresaIds.slice(i, i + 100);
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("empresa_contatos")
          .select("empresa_id, papel, nome, cargo, email, telefone, whatsapp, linkedin")
          .in("empresa_id", slice)
          .range(from, from + 999);
        if (error) throw new Error("empresa_contatos: " + error.message);
        contatos.push(...data);
        if (data.length < 1000) break;
      }
    }
    const byEmp = new Map();
    for (const c of contatos) {
      if (!byEmp.has(c.empresa_id)) byEmp.set(c.empresa_id, []);
      byEmp.get(c.empresa_id).push(c);
    }

    const qsaCount = (emp) => Array.isArray(emp.qsa) ? emp.qsa.length : 0;
    let comDecisor = 0, comSocioContato = 0, comQsa = 0, comTelContato = 0, comEmailContato = 0,
        comLinkedin = 0, comTelReceita = 0, comEmailReceita = 0, semNada = 0;
    const semDecisor = [];
    for (const emp of empresas) {
      const cs = byEmp.get(emp.id) || [];
      const hasDecisor = cs.some((c) => c.papel === "decisor");
      if (hasDecisor) comDecisor++;
      if (cs.some((c) => c.papel === "socio")) comSocioContato++;
      if (qsaCount(emp) > 0) comQsa++;
      if (cs.some((c) => c.telefone)) comTelContato++;
      if (cs.some((c) => c.email)) comEmailContato++;
      if (cs.some((c) => c.linkedin)) comLinkedin++;
      if (emp.telefone_receita) comTelReceita++;
      if (emp.email_receita) comEmailReceita++;
      if (cs.length === 0 && qsaCount(emp) === 0) semNada++;
      if (!hasDecisor) semDecisor.push(emp);
    }
    console.log(`  Empresas únicas: ${empresas.length}`);
    console.log(`  UF:`, JSON.stringify(empresas.reduce((a, e) => ((a[e.uf] = (a[e.uf]||0)+1), a), {})));
    console.log(`  Porte:`, JSON.stringify(empresas.reduce((a, e) => ((a[e.porte||"?"] = (a[e.porte||"?"]||0)+1), a), {})));
    console.log(`  DADOS JÁ EXISTENTES (não retrabalhar):`);
    console.log(`    QSA RFB (sócios): ${comQsa} | contato papel=socio: ${comSocioContato} | contato papel=decisor: ${comDecisor}`);
    console.log(`    tel receita: ${comTelReceita} | email receita: ${comEmailReceita} | tel contato: ${comTelContato} | email contato: ${comEmailContato} | LinkedIn: ${comLinkedin}`);
    console.log(`    Sem QSA e sem contato: ${semNada}`);
    console.log(`  --> SEM DECISOR (alvos de enriquecimento): ${semDecisor.length}`);
    // ordena por capital_social desc pra priorizar
    semDecisor.sort((a, b) => (Number(b.capital_social)||0) - (Number(a.capital_social)||0));
    console.log("  Top 50 alvos sem decisor (por capital social) — com QSA disponível pra guiar:");
    for (const e of semDecisor.slice(0, 50)) {
      const socios = Array.isArray(e.qsa) ? e.qsa.map(s => s.nome || s.nome_socio || s.qual || JSON.stringify(s)).slice(0,3).join("; ") : "";
      console.log(`    [${e.uf}] ${e.nome} | cap:${e.capital_social||"-"} | cnpj:${e.cnpj||"-"} | QSA(${qsaCount(e)}): ${socios||"(sem QSA)"}`);
    }
    // exporta worklist completa pra alimentar enriquecimento
    const worklist = semDecisor.map(e => ({
      id: e.id, uf: e.uf, nome: e.nome, cnpj: e.cnpj, porte: e.porte,
      capital_social: e.capital_social,
      qsa: Array.isArray(e.qsa) ? e.qsa.map(s => ({ nome: s.nome || s.nome_socio, qual: s.qual || s.qualificacao })) : [],
      tem_tel_receita: !!e.telefone_receita, tem_email_receita: !!e.email_receita,
    }));
    const fs = await import("node:fs");
    fs.writeFileSync("tools/worklist_terco.json", JSON.stringify(worklist, null, 2));
    console.log(`\n  [export] tools/worklist_terco.json com ${worklist.length} alvos sem decisor.`);
  }
}
main().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
