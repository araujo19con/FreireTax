#!/usr/bin/env node
/**
 * tools/import-rfb-slim.mjs
 *
 * Importa um slim da Receita Federal (CNPJ, razão social, nome fantasia,
 * UF, município) pra tabela public.rfb_estabelecimentos_busca no Supabase.
 *
 * Permite buscar CNPJ a partir do nome da empresa (fuzzy via pg_trgm).
 *
 * ============================================================================
 * Pré-requisitos
 * ============================================================================
 *
 * 1. Baixar os ZIPs da RFB do mês mais recente:
 *    https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/
 *
 *    Pegue todos os arquivos:
 *      - Empresas0.zip ... Empresas9.zip
 *      - Estabelecimentos0.zip ... Estabelecimentos9.zip
 *      - Municipios.zip
 *
 * 2. Descompacte tudo num diretório local. Você verá arquivos com extensão
 *    .EMPRECSV, .ESTABELE, .MUNICCSV (sem extensão tradicional, mas são CSVs).
 *
 * 3. Configure variáveis de ambiente:
 *      export SUPABASE_URL="https://<projeto>.supabase.co"
 *      export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"   # NÃO use anon!
 *
 * 4. Rode:
 *      node tools/import-rfb-slim.mjs --from-dir <pasta-com-csvs> --ufs RN,PB
 *
 *    Flags:
 *      --from-dir <path>   Diretório com os CSVs descompactados (obrigatório)
 *      --ufs <RN,PB,...>   UFs pra importar (default: RN,PB)
 *      --truncate          Apaga a tabela antes de importar (refresh full)
 *      --dry-run           Só conta quantas linhas baixariam, sem gravar
 *      --batch <N>         Tamanho do batch de upsert (default: 1000)
 *
 * ============================================================================
 * Algoritmo
 * ============================================================================
 *
 *  1. Lê Municipios.csv (~5500 linhas) → Map<codigo, nome>
 *  2. Stream dos estabelecimentos × 10 arquivos
 *     - Filtra SITUACAO_CADASTRAL = '02' (ATIVA) AND UF IN (ufsAlvo)
 *     - Coleta { cnpj_basico, cnpj_completo, nome_fantasia, uf, municipio_cod }
 *     - Resolve municipio_cod → nome via Map do passo 1
 *  3. Stream dos empresas × 10 arquivos
 *     - Filtra: só cnpj_basico que aparecem no resultado do passo 2
 *     - Pega razao_social
 *  4. Faz upsert em batches no Supabase
 *
 * Memória esperada (RN+PB):
 *   - Estabelecimentos filtrados: ~350k × ~120 bytes = ~40 MB
 *   - Mapa razão social: ~350k × ~80 bytes = ~30 MB
 *   Total: <100 MB. Roda em qualquer máquina.
 *
 * Tempo esperado (RN+PB, conexão 100 Mbps + Supabase Free):
 *   - Stream local: ~5-10 min
 *   - Upsert: ~3-5 min (limit Free)
 * ============================================================================
 */

import { readFile, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  return args[i + 1] ?? true;
}
function has(name) {
  return args.includes(name);
}

const FROM_DIR = flag("--from-dir");
const UFS = (flag("--ufs") || "RN,PB").toString().split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const TRUNCATE = has("--truncate");
const DRY_RUN = has("--dry-run");
const BATCH_SIZE = Number(flag("--batch") || 1000);

if (!FROM_DIR || FROM_DIR === true) {
  console.error("ERRO: --from-dir <pasta> é obrigatório");
  console.error("Uso: node tools/import-rfb-slim.mjs --from-dir <pasta> [--ufs RN,PB] [--truncate]");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// CSV streaming (RFB usa ; como separador, latin1, sem header, sem aspas
// escapadas — formato bem simples)
// ---------------------------------------------------------------------------

/**
 * Lê CSV linha-a-linha em latin1, separador `;`, sem header.
 * Yield array de campos (com aspas removidas).
 */
async function* readCSV(filePath) {
  const stream = createReadStream(filePath, { encoding: "latin1" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    // Parser simples: separa por ;, remove aspas envolvendo cada campo
    const fields = line.split(";").map((f) => {
      if (f.length >= 2 && f.startsWith('"') && f.endsWith('"')) {
        return f.slice(1, -1).replace(/""/g, '"');
      }
      return f;
    });
    yield fields;
  }
}

// ---------------------------------------------------------------------------
// Indexação por extensão de arquivo
// ---------------------------------------------------------------------------
async function listFilesByExt(dir) {
  const all = await readdir(dir);
  const groups = { EMPRECSV: [], ESTABELE: [], MUNICCSV: [] };
  for (const f of all) {
    const upper = f.toUpperCase();
    if (upper.endsWith(".EMPRECSV")) groups.EMPRECSV.push(join(dir, f));
    else if (upper.endsWith(".ESTABELE")) groups.ESTABELE.push(join(dir, f));
    else if (upper.endsWith(".MUNICCSV")) groups.MUNICCSV.push(join(dir, f));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Passo 1 — Municipios
// CSV: CODIGO;NOME
// ---------------------------------------------------------------------------
async function lerMunicipios(files) {
  const map = new Map();
  for (const f of files) {
    for await (const row of readCSV(f)) {
      if (row.length < 2) continue;
      const codigo = row[0]?.trim();
      const nome = row[1]?.trim();
      if (codigo && nome) map.set(codigo, nome);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Passo 2 — Estabelecimentos
// Colunas (índices):
//   0: CNPJ_BASICO (8)
//   1: CNPJ_ORDEM (4)
//   2: CNPJ_DV (2)
//   3: IDENTIFICADOR_MATRIZ_FILIAL (1=Matriz, 2=Filial)
//   4: NOME_FANTASIA
//   5: SITUACAO_CADASTRAL ('01'=NULA, '02'=ATIVA, '03'=SUSPENSA, '04'=INAPTA, '08'=BAIXADA)
//   6: DATA_SITUACAO_CADASTRAL
//   7: MOTIVO_SITUACAO_CADASTRAL
//   8..18: outros (cidade exterior, país, datas, CNAE, endereço)
//  19: UF
//  20: MUNICIPIO (código)
// ---------------------------------------------------------------------------
async function processEstabelecimentos(files, ufsAlvo, municipiosMap) {
  const ufsSet = new Set(ufsAlvo);
  // Result: Map<cnpj_basico, Array<{cnpj_completo, nome_fantasia, uf, municipio}>>
  // Uma empresa pode ter filiais em UFs diferentes — todas viram registros separados
  const porBasico = new Map();
  let totalLidos = 0;
  let totalFiltrados = 0;

  for (const f of files) {
    process.stderr.write(`  → lendo ${f.split(/[\\/]/).pop()}\n`);
    for await (const row of readCSV(f)) {
      totalLidos++;
      if (totalLidos % 500_000 === 0) {
        process.stderr.write(`     ${totalLidos.toLocaleString("pt-BR")} linhas lidas, ${totalFiltrados.toLocaleString("pt-BR")} retidas\n`);
      }
      if (row.length < 21) continue;
      const situacao = row[5];
      if (situacao !== "02") continue;
      const uf = row[19];
      if (!uf || !ufsSet.has(uf)) continue;
      const cnpjBasico = row[0];
      const cnpjOrdem = row[1];
      const cnpjDv = row[2];
      if (!cnpjBasico || cnpjBasico.length !== 8) continue;
      const cnpj = (cnpjBasico + cnpjOrdem + cnpjDv).replace(/\D/g, "");
      if (cnpj.length !== 14) continue;

      const nomeFantasia = (row[4] ?? "").trim() || null;
      const municipioCod = row[20];
      const municipio = municipiosMap.get(municipioCod) ?? null;

      const arr = porBasico.get(cnpjBasico) ?? [];
      arr.push({ cnpj, nome_fantasia: nomeFantasia, uf, municipio });
      porBasico.set(cnpjBasico, arr);
      totalFiltrados++;
    }
  }
  process.stderr.write(`  Total lidos: ${totalLidos.toLocaleString("pt-BR")} | Filtrados: ${totalFiltrados.toLocaleString("pt-BR")}\n`);
  return porBasico;
}

// ---------------------------------------------------------------------------
// Passo 3 — Empresas (razão social)
// Colunas:
//   0: CNPJ_BASICO
//   1: RAZAO_SOCIAL
//   2: NATUREZA_JURIDICA
//   3..6: outros
// ---------------------------------------------------------------------------
async function carregarRazoesSociais(files, basicosAlvo) {
  const map = new Map();
  let lidos = 0;
  for (const f of files) {
    process.stderr.write(`  → lendo ${f.split(/[\\/]/).pop()}\n`);
    for await (const row of readCSV(f)) {
      lidos++;
      if (lidos % 1_000_000 === 0) {
        process.stderr.write(`     ${lidos.toLocaleString("pt-BR")} linhas lidas\n`);
      }
      if (row.length < 2) continue;
      const cnpjBasico = row[0];
      if (!basicosAlvo.has(cnpjBasico)) continue;
      const razao = (row[1] ?? "").trim();
      if (razao) map.set(cnpjBasico, razao);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Passo 4 — Upsert em batches
// ---------------------------------------------------------------------------
async function upsertBatches(rows) {
  let inseridos = 0;
  let falhas = 0;
  const total = rows.length;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("rfb_estabelecimentos_busca")
      .upsert(chunk, { onConflict: "cnpj" });
    if (error) {
      falhas += chunk.length;
      process.stderr.write(`  ✗ batch ${i / BATCH_SIZE} falhou: ${error.message}\n`);
    } else {
      inseridos += chunk.length;
    }
    const pct = Math.round(((i + chunk.length) / total) * 100);
    process.stderr.write(`\r  upsert ${(i + chunk.length).toLocaleString("pt-BR")}/${total.toLocaleString("pt-BR")} (${pct}%) — ok ${inseridos.toLocaleString("pt-BR")} falhas ${falhas}`);
  }
  process.stderr.write("\n");
  return { inseridos, falhas };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== Import RFB slim → Supabase ===`);
  console.log(`  Pasta:    ${FROM_DIR}`);
  console.log(`  UFs:      ${UFS.join(", ")}`);
  console.log(`  Truncate: ${TRUNCATE}`);
  console.log(`  Dry-run:  ${DRY_RUN}`);
  console.log(`  Batch:    ${BATCH_SIZE}`);
  console.log();

  const t0 = Date.now();

  // 0. Lista arquivos
  const groups = await listFilesByExt(FROM_DIR);
  console.log(`Arquivos detectados:`);
  console.log(`  Empresas:        ${groups.EMPRECSV.length}`);
  console.log(`  Estabelecimentos:${groups.ESTABELE.length}`);
  console.log(`  Municípios:      ${groups.MUNICCSV.length}`);

  if (groups.ESTABELE.length === 0 || groups.EMPRECSV.length === 0 || groups.MUNICCSV.length === 0) {
    console.error("\nERRO: arquivos faltando. Confira a pasta — esperado .EMPRECSV, .ESTABELE, .MUNICCSV");
    process.exit(1);
  }

  // 1. Municípios
  console.log(`\n[1/4] Lendo municípios...`);
  const municipios = await lerMunicipios(groups.MUNICCSV);
  console.log(`  → ${municipios.size.toLocaleString("pt-BR")} municípios carregados`);

  // 2. Estabelecimentos
  console.log(`\n[2/4] Lendo estabelecimentos (filtro: ATIVAS + UF ∈ {${UFS.join(",")}})...`);
  const estabsPorBasico = await processEstabelecimentos(groups.ESTABELE, UFS, municipios);
  const totalEstabs = [...estabsPorBasico.values()].reduce((a, b) => a + b.length, 0);
  console.log(`  → ${totalEstabs.toLocaleString("pt-BR")} estabelecimentos de ${estabsPorBasico.size.toLocaleString("pt-BR")} empresas únicas`);

  if (totalEstabs === 0) {
    console.error("\nERRO: nenhum estabelecimento encontrado. Verifique se os arquivos estão corretos.");
    process.exit(1);
  }

  // 3. Razões sociais (só dos CNPJ_BASICOs que retivemos)
  console.log(`\n[3/4] Carregando razões sociais...`);
  const razoes = await carregarRazoesSociais(groups.EMPRECSV, new Set(estabsPorBasico.keys()));
  console.log(`  → ${razoes.size.toLocaleString("pt-BR")} razões sociais carregadas`);

  // 4. Monta payload final
  const agora = new Date().toISOString();
  const rows = [];
  let semRazao = 0;
  for (const [basico, estabs] of estabsPorBasico) {
    const razao = razoes.get(basico);
    if (!razao) { semRazao++; continue; }
    for (const est of estabs) {
      rows.push({
        cnpj: est.cnpj,
        razao_social: razao,
        nome_fantasia: est.nome_fantasia,
        uf: est.uf,
        municipio: est.municipio,
        atualizado_em: agora,
      });
    }
  }
  console.log(`  → ${rows.length.toLocaleString("pt-BR")} rows prontos (${semRazao} estabelecimentos sem razão social ignorados)`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — não gravando.");
    return;
  }

  // 5. Truncate opcional
  if (TRUNCATE) {
    console.log(`\n[4/4a] Truncando tabela rfb_estabelecimentos_busca...`);
    // Não dá pra TRUNCATE via JS client; uso delete amplo.
    const { error } = await supabase.from("rfb_estabelecimentos_busca").delete().neq("cnpj", "");
    if (error) {
      console.error(`  ✗ erro: ${error.message}`);
      process.exit(1);
    }
    console.log(`  ✓ tabela limpa`);
  }

  // 6. Upsert
  console.log(`\n[4/4] Upserting ${rows.length.toLocaleString("pt-BR")} rows...`);
  const { inseridos, falhas } = await upsertBatches(rows);

  const dt = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== Concluído em ${dt}s ===`);
  console.log(`  Inseridos: ${inseridos.toLocaleString("pt-BR")}`);
  console.log(`  Falhas:    ${falhas}`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
