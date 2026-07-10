#!/usr/bin/env node
/**
 * Detecta clusters de SPE (Sociedades de Propósito Específico) numeradas.
 * Ex: "Central Eólica Acauã I", "II", "III" → marca como 1 grupo, pesquisa controlador 1x.
 * Usa regex: remove sufixo numérico/romano, agrupa por prefixo, retorna JSON pronto.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function baseKey(nome) {
  return nome
    .replace(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|\d+)\s*$/gi, "")
    .trim()
    .toUpperCase();
}

async function detectClusters(uf = "RN") {
  console.log(`\n📊 Detectando clusters SPE em ${uf}...`);

  let idsComDecisor = new Set();
  let from = 0;
  while (true) {
    const { data } = await supabase.from("empresa_contatos").select("empresa_id").eq("papel","decisor").range(from, from+999);
    if (!data || !data.length) break;
    data.forEach(c => idsComDecisor.add(c.empresa_id));
    if (data.length < 1000) break;
    from += 1000;
  }

  const { data: empresas } = await supabase
    .from("empresas")
    .select("id, nome")
    .eq("uf", uf)
    .eq("porte", "DEMAIS")
    .order("nome");

  const faltam = empresas.filter(e => !idsComDecisor.has(e.id));
  const grupos = {};

  faltam.forEach(e => {
    const base = baseKey(e.nome);
    if (!grupos[base]) grupos[base] = [];
    grupos[base].push(e.nome);
  });

  const clusters = Object.entries(grupos)
    .filter(([k, v]) => v.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (clusters.length === 0) {
    console.log("✅ Nenhum cluster encontrado.");
    return [];
  }

  console.log(`\n🔗 ${clusters.length} clusters detectados:\n`);
  clusters.forEach(([base, nomes]) => {
    console.log(`  ${base} (${nomes.length}):`);
    nomes.forEach(n => console.log(`    - ${n}`));
  });

  // Gera JSON pronto pra pesquisa (1 pesquisa por base, todasQueCasarem: true)
  const jsonProto = clusters.map(([base, nomes]) => ({
    uf,
    empresaLike: `%${base}%`,
    todasQueCasarem: true,
    contatos: [
      {
        nome: "[PESQUISAR_CONTROLADOR]",
        cargo: "[DETECTADO_AUTO: cluster SPE com " + nomes.length + " SPEs]",
        confianca: "média",
        fonte: "cluster-auto-detect"
      }
    ]
  }));

  const outFile = `tools/clusters_${uf.toLowerCase()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(jsonProto, null, 2));
  console.log(`\n💾 JSON gerado: ${outFile}`);
  console.log(`📝 PRÓXIMO: pesquise o controlador de cada cluster, depois execute:\n   rtk node tools/insert_decisor_gestor.mjs --file ${outFile}\n`);

  return clusters;
}

detectClusters(process.argv[2] || "RN").catch(e => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
