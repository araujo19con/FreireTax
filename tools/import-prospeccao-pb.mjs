#!/usr/bin/env node
/**
 * tools/import-prospeccao-pb.mjs
 *
 * Importa a aba PB de "PROSPECÇÃO 1_3 .xlsx" pra dentro do sistema:
 * cria/casa empresas, cria elegibilidade (com desqualificação correta a
 * partir da coluna SITUAÇÃO), cria prospecções e processos.
 *
 * Não chama a edge function enriquecer-cnpj (ela exige JWT de usuário real,
 * service role sozinha não passa em auth.getUser()). Depois de importar,
 * rode o "Enriquecer em lote" na UI logado — isso popula RFB + sócios (QSA)
 * via trigger derive_contatos_from_rfb.
 *
 * Uso:
 *   export SUPABASE_URL="https://<ref>.supabase.co"        # ou VITE_SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role>"
 *
 *   # 1) Lookup (read-only) — acha acao_id e lista usuários
 *   node tools/import-prospeccao-pb.mjs --mode lookup
 *
 *   # 2) Dry-run (padrão — não grava nada)
 *   node tools/import-prospeccao-pb.mjs --mode import --acao-id <uuid> --user-id <uuid>
 *
 *   # 3) Grava de verdade
 *   node tools/import-prospeccao-pb.mjs --mode import --acao-id <uuid> --user-id <uuid> --commit
 */

import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const flag = (n, def = null) => {
  const i = argv.indexOf(n);
  return i < 0 ? def : argv[i + 1];
};

const MODE = flag("--mode", "lookup");
const FILE = flag(
  "--file",
  "C:/Users/Gabriel/OneDrive/Área de Trabalho/FREIRETAX/PROSPECCAO_PB_pronto_importar.xlsx"
);
const SHEET = flag("--sheet", "PB");
const ACAO_ID = flag("--acao-id", null);
const USER_ID = flag("--user-id", null);
const COMMIT = has("--commit");
const LIMIT = Number(flag("--limit", "0")) || 0;

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers (espelham src/pages/acoes/ImportacaoProspeccaoDialog.tsx)
// ---------------------------------------------------------------------------

function normKey(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeNameKey(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(ltda|s\/?a|s\.?a\.?|eireli|me|epp|mei)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCNPJ(raw) {
  if (raw == null || String(raw).trim() === "") return { cnpj: null, erro: null };
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 13) digits = "0" + digits;
  if (digits.length === 12) digits = "00" + digits;
  if (digits.length === 11) digits = "000" + digits;
  if (digits.length !== 14) return { cnpj: null, erro: `${digits.length} dígitos` };
  return { cnpj: digits, erro: null };
}

// A tabela empresas tem trigger (mig 20260512) que normaliza TODO cnpj gravado
// para o formato mascarado XX.XXX.XXX/XXXX-XX — inclusive registros antigos
// (backfill em massa). Buscar só por dígitos não acha nada. Precisa mascarar.
function maskCNPJ(digits) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

async function findEmpresaByCnpj(cnpjDigits) {
  const masked = maskCNPJ(cnpjDigits);
  const { data, error } = await supabase
    .from("empresas")
    .select("id")
    .or(`cnpj.eq.${masked},cnpj.eq.${cnpjDigits}`)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

function parseValor(raw) {
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function parseProcesso(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /^x$/i.test(s) || s === "-") return null;
  return s;
}

// Situações que indicam prospecção ativa (mesmas chaves de PROSPECCAO_STATUSES)
const SITUACAO_PROSP_MAP = {
  PROTOCOLADO: "Contato feito",
  "CONTRATO ENVIADO": "Proposta enviada",
  "PROPOSTA ENVIADA": "Proposta enviada",
  NEGOCIACAO: "Em negociação",
  "CONTRATO ASSINADO": "Contrato assinado",
  "SERVICO INICIADO": "Serviço iniciado",
  PERDIDO: "Perdido",
};

// Situações que indicam que a empresa NÃO deve ficar elegível.
const SITUACAO_DESQUALIFICA = [
  "NAO QUER FAZER",
  "NAO VALE A PENA",
  "EMPRESA PEQUENA",
  "FALIU",
  "QUEBROU",
  "MUITO PEQUENA",
  "FECHOU",
  "PEQUENA",
  "APARENTA SER PEQUENA",
  "JA FEZ",
  "INCORPORADA",
];

function classifySituacao(situacaoRaw) {
  const s = normKey(situacaoRaw);
  if (!s) return { kind: "none" };
  for (const k of SITUACAO_DESQUALIFICA) {
    if (s === k || s.includes(k)) return { kind: "desqualifica", motivo: situacaoRaw.trim() };
  }
  if (s in SITUACAO_PROSP_MAP) return { kind: "prosp", status: SITUACAO_PROSP_MAP[s] };
  for (const [k, v] of Object.entries(SITUACAO_PROSP_MAP)) {
    if (s.includes(k)) return { kind: "prosp", status: v };
  }
  // Texto livre não mapeado (ex: "CONTATO RD", observação solta) — não desqualifica,
  // não cria prospecção. Fica só registrado.
  return { kind: "none" };
}

function parsePBSheet() {
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Aba "${SHEET}" não encontrada em ${FILE}`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const headers = raw[0].map(String);
  const idx = (cands) => {
    for (const c of cands) {
      const i = headers.findIndex((h) => normKey(h).includes(normKey(c)));
      if (i !== -1) return i;
    }
    return -1;
  };
  const iSituacao = idx(["situacao", "situação", "status"]);
  const iNome = idx(["empresas em", "empresa", "nome"]);
  const iCnpj = idx(["cnpj"]);
  const iProcesso = idx(["numero processo", "número processo", "processo"]);
  const iValor = idx(["valor causa", "valor"]);
  const iUF = idx(["estado", "uf"]);
  const iObs = idx(["observ"]);

  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    const nomeRaw = String(row[iNome] ?? "").trim();
    if (!nomeRaw) continue;
    const cnpjCell = iCnpj !== -1 ? String(row[iCnpj] ?? "").split(/[\n\r]/)[0] : "";
    const { cnpj, erro: cnpjErro } = resolveCNPJ(cnpjCell);
    const situacaoRaw = String(row[iSituacao] ?? "").trim();
    const classe = classifySituacao(situacaoRaw);
    rows.push({
      nomeRaw,
      cnpj,
      cnpjErro,
      situacaoRaw,
      classe,
      numeroProcesso: parseProcesso(String(row[iProcesso] ?? "")),
      valorCausa: parseValor(row[iValor]),
      uf: (String(row[iUF] ?? "").trim() || "PB").toUpperCase().slice(0, 2),
      obs: String(row[iObs] ?? "").trim() || null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Modo lookup
// ---------------------------------------------------------------------------

async function runLookup() {
  console.log("=== Ações tributárias (procure a tese certa) ===");
  const { data: acoes, error: e1 } = await supabase
    .from("acoes_tributarias")
    .select("id, nome, status, tipo")
    .order("nome");
  if (e1) throw e1;
  for (const a of acoes ?? []) {
    const nk = normKey(a.nome);
    const hit = nk.includes("TERCO") || nk.includes("CONSTITUCIONAL") || nk.includes("985") || nk.includes("FERIAS");
    console.log(`${hit ? ">> " : "   "}${a.id}  [${a.status} / ${a.tipo}]  ${a.nome}`);
  }

  console.log("\n=== Usuários (profiles) — escolha quem vai constar como responsável ===");
  const { data: profiles, error: e2 } = await supabase
    .from("profiles")
    .select("id, nome, email, ativo")
    .order("nome");
  if (e2) throw e2;
  for (const p of profiles ?? []) {
    console.log(`   ${p.id}  ${p.nome} <${p.email}>  ${p.ativo ? "" : "(inativo)"}`);
  }
}

// ---------------------------------------------------------------------------
// Modo import
// ---------------------------------------------------------------------------

async function runImport() {
  if (!ACAO_ID) throw new Error("--acao-id é obrigatório no modo import");
  if (!USER_ID) throw new Error("--user-id é obrigatório no modo import");

  const { data: acao, error: eAcao } = await supabase
    .from("acoes_tributarias")
    .select("id, nome")
    .eq("id", ACAO_ID)
    .maybeSingle();
  if (eAcao) throw eAcao;
  if (!acao) throw new Error(`acao_id ${ACAO_ID} não encontrada`);

  let rows = parsePBSheet();
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);

  console.log(`Ação: ${acao.nome}`);
  console.log(`Linhas na planilha (com nome preenchido): ${rows.length}`);
  console.log(`Modo: ${COMMIT ? "COMMIT (vai gravar)" : "DRY-RUN (simulação, nada gravado)"}\n`);

  const stats = {
    empresaCriada: 0,
    empresaExistente: 0,
    elegCriada: 0,
    elegExistente: 0,
    desqualificadas: 0,
    prospCriada: 0,
    prospAtualizada: 0,
    processoCriado: 0,
    erros: 0,
  };
  const amostraDesqualif = [];
  const erros = [];

  for (const row of rows) {
    try {
      // 1) Resolver empresa: por CNPJ, depois por nome
      let empresaId = null;
      if (row.cnpj) {
        empresaId = await findEmpresaByCnpj(row.cnpj);
      }
      if (!empresaId) {
        const { data } = await supabase.from("empresas").select("id").ilike("nome", row.nomeRaw).limit(1);
        empresaId = data?.[0]?.id ?? null;
      }

      if (empresaId) {
        stats.empresaExistente++;
      } else {
        stats.empresaCriada++;
        if (COMMIT) {
          const insertEmp = { nome: row.nomeRaw, status: "prospect", user_id: USER_ID, uf: row.uf };
          if (row.cnpj) insertEmp.cnpj = row.cnpj;
          const { data: empData, error: empErr } = await supabase
            .from("empresas")
            .insert(insertEmp)
            .select("id")
            .single();
          if (empErr) throw empErr;
          empresaId = empData.id;
        }
      }

      // No dry-run sem empresa real, usa um placeholder só pra não quebrar o resto da simulação
      const effectiveEmpresaId = empresaId ?? "(nova, dry-run)";

      // 2) Elegibilidade
      const isDesqualif = row.classe.kind === "desqualifica";
      if (isDesqualif) {
        stats.desqualificadas++;
        if (amostraDesqualif.length < 10) {
          amostraDesqualif.push(`${row.nomeRaw} — motivo: "${row.classe.motivo}"`);
        }
      }

      if (COMMIT && empresaId) {
        const { data: existingEleg } = await supabase
          .from("elegibilidade")
          .select("id")
          .eq("empresa_id", empresaId)
          .eq("acao_id", ACAO_ID)
          .maybeSingle();

        if (existingEleg) {
          stats.elegExistente++;
        } else {
          const insertEleg = {
            empresa_id: empresaId,
            acao_id: ACAO_ID,
            user_id: USER_ID,
            elegivel: !isDesqualif,
          };
          if (isDesqualif) insertEleg.motivo_desqualificacao = row.classe.motivo;
          const { error: elegErr } = await supabase.from("elegibilidade").insert(insertEleg);
          if (elegErr) throw elegErr;
          stats.elegCriada++;
        }

        // 3) Prospecção (só quando situação indica engajamento ativo)
        if (row.classe.kind === "prosp") {
          const { data: existingProsp } = await supabase
            .from("prospeccoes")
            .select("id")
            .eq("empresa_id", empresaId)
            .eq("acao_id", ACAO_ID)
            .maybeSingle();

          if (!existingProsp) {
            const { error: prospErr } = await supabase.from("prospeccoes").insert({
              empresa_id: empresaId,
              acao_id: ACAO_ID,
              user_id: USER_ID,
              status_prospeccao: row.classe.status,
              notas_prospeccao: row.obs,
              valor_contrato: row.valorCausa,
            });
            if (prospErr) throw prospErr;
            stats.prospCriada++;
          } else {
            await supabase
              .from("prospeccoes")
              .update({ status_prospeccao: row.classe.status })
              .eq("id", existingProsp.id);
            stats.prospAtualizada++;
          }
        }

        // 4) Processo (se tiver número de processo referente)
        if (row.numeroProcesso) {
          const { data: existingProc } = await supabase
            .from("processos")
            .select("id")
            .eq("empresa_id", empresaId)
            .eq("acao_id", ACAO_ID)
            .maybeSingle();
          if (!existingProc) {
            const { error: procErr } = await supabase.from("processos").insert({
              empresa_id: empresaId,
              acao_id: ACAO_ID,
              user_id: USER_ID,
              numero_processo: row.numeroProcesso,
              fase: "Inicial",
              status: "Em andamento",
              valor_estimado: row.valorCausa ?? 0,
              observacoes: row.obs ?? "",
            });
            if (procErr) throw procErr;
            stats.processoCriado++;
          }
        }
      } else if (!COMMIT) {
        // dry-run: só contabiliza o que seria feito
        if (row.classe.kind === "prosp") stats.prospCriada++;
        if (row.numeroProcesso) stats.processoCriado++;
        stats.elegCriada++;
      }
    } catch (err) {
      stats.erros++;
      erros.push(`${row.nomeRaw}: ${err.message}`);
    }
  }

  console.log("=== Resultado ===");
  console.table(stats);
  console.log("\nAmostra de empresas que seriam marcadas como DESQUALIFICADA:");
  amostraDesqualif.forEach((l) => console.log("  - " + l));
  if (erros.length) {
    console.log(`\n${erros.length} erro(s):`);
    erros.slice(0, 20).forEach((e) => console.log("  ! " + e));
  }
  if (!COMMIT) {
    console.log("\n[DRY-RUN] Nada foi gravado. Rode novamente com --commit para gravar de verdade.");
  }
}

// ---------------------------------------------------------------------------

(async () => {
  try {
    if (MODE === "lookup") await runLookup();
    else if (MODE === "import") await runImport();
    else throw new Error(`--mode inválido: ${MODE} (use lookup ou import)`);
  } catch (err) {
    console.error("\nFALHA:", err.message);
    process.exit(1);
  }
})();
