#!/usr/bin/env node
/**
 * tools/import-driva-contatos.mjs
 *
 * Importa CONTATOS de uma planilha DRIVA (.xlsx) para public.empresa_contatos,
 * casando cada empresa por CNPJ. Estrutura as abas:
 *
 *   - "Sócios"    → contatos pessoa (nome, qualificação→cargo, cpf mascarado, faixa etária)
 *   - "Emails"    → contatos com email (nome, cargo, linkedin, flag contador)
 *   - "Telefones" → canais de telefone (fixo/móvel, whatsapp, flag contador)
 *
 * Idempotente: cada contato tem uma dedup_key estável; re-rodar não duplica.
 *
 * ============================================================================
 * Uso
 * ============================================================================
 *
 *   # variáveis (NÃO use a anon key — precisa do service role pra contornar RLS)
 *   export SUPABASE_URL="https://<projeto>.supabase.co"          # ou VITE_SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
 *
 *   node tools/import-driva-contatos.mjs --file "../(DRIVA) empresas PB.xlsx"
 *
 * Flags:
 *   --file <path>      Caminho do .xlsx DRIVA (default: "../(DRIVA) empresas PB.xlsx")
 *   --dry-run          Só mostra o que faria, sem gravar
 *   --create-missing   Cria empresas que não existem no CRM (exige --owner)
 *   --owner <uuid>     profiles.id usado como user_id das empresas criadas
 *   --batch <N>        Tamanho do batch de insert (default: 500)
 *
 * ============================================================================
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i < 0 ? null : (argv[i + 1] ?? true);
};
const has = (n) => argv.includes(n);

const FILE = (flag("--file") || "../(DRIVA) empresas PB.xlsx").toString();
const DRY_RUN = has("--dry-run");
const CREATE_MISSING = has("--create-missing");
const OWNER = flag("--owner");
const BATCH = Number(flag("--batch") || 500);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "ERRO: defina SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY no ambiente.",
  );
  process.exit(1);
}
if (CREATE_MISSING && !OWNER) {
  console.error("ERRO: --create-missing exige --owner <uuid de profiles.id>.");
  process.exit(1);
}

const filePath = isAbsolute(FILE) ? FILE : join(__dirname, "..", FILE);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
const cleanCNPJ = (s) => {
  const d = onlyDigits(s);
  return d.length === 14 ? d : null;
};
// A base do CRM guarda CNPJ FORMATADO (00.000.000/0001-00). Inserir no mesmo
// formato evita duplicar e respeita o unique constraint.
const maskCNPJ = (s) => {
  const d = onlyDigits(s);
  if (d.length !== 14) return s;
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
};
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
const blank = (s) => !s || String(s).trim() === "";
const trimOrNull = (s) => (blank(s) ? null : String(s).trim());
const isSim = (s) => /^(sim|s|yes|y|true|1)$/i.test(String(s ?? "").trim());

function derivePapel(cargo, isContador = false, temNome = true) {
  if (isContador) return "contador";
  const c = String(cargo ?? "").toLowerCase();
  if (!c) return temNome ? "outro" : "geral";
  if (/cont(a|á)bil|contador/.test(c)) return "contador";
  if (/administrador|s[oó]cio|titular|propriet/.test(c)) return "socio";
  if (/financ|cfo|controll|controlad|tesour/.test(c)) return "financeiro";
  if (/jur[ií]d|advog|legal/.test(c)) return "juridico";
  if (/comerc|vend|marketing|coml/.test(c)) return "comercial";
  if (/diretor|presid|ceo|fundador|owner|gerente geral/.test(c)) return "decisor";
  if (/gerente|coorden|supervis|analist|assist|auxiliar|oper/.test(c)) return "operacional";
  return "outro";
}

function tipoTelefoneFrom(raw) {
  const v = String(raw ?? "").toLowerCase();
  if (/m[oó]vel|celular|cel\b/.test(v)) return "movel";
  if (/fixo/.test(v)) return "fixo";
  return "desconhecido";
}

// PostgREST faz insert em lote pela UNIÃO das chaves: linha sem uma chave vai
// como NULL (ignora o DEFAULT do Postgres). Por isso normalizamos toda linha
// com defaults explícitos nas colunas NOT NULL.
function withDefaults(c) {
  return {
    nome: null, cargo: null, email: null, telefone: null, linkedin: null,
    cpf_mascarado: null, faixa_etaria: null, observacoes: null,
    papel: "outro", origem: "manual",
    tipo_telefone: "desconhecido", whatsapp: false, is_contador: false,
    principal: false,
    ...c,
  };
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`> Lendo planilha: ${filePath}`);
  const buf = await readFile(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });

  const rfbRows = sheetRows(wb, "RFB");
  const emailRows = sheetRows(wb, "Emails");
  const phoneRows = sheetRows(wb, "Telefones");
  const socioRows = sheetRows(wb, "Sócios").length
    ? sheetRows(wb, "Sócios")
    : sheetRows(wb, "Socios");

  // Diagnóstico: se NENHUMA aba esperada tem dados, o export DRIVA veio noutro
  // formato (aba única / CSV). Falha com mensagem clara em vez de importar 0
  // silenciosamente e o usuário achar que "não tinha contato".
  if (!rfbRows.length && !emailRows.length && !phoneRows.length && !socioRows.length) {
    console.error(
      "ERRO: nenhuma das abas esperadas (RFB, Emails, Telefones, Sócios) tem dados.\n" +
        `Abas encontradas: ${wb.SheetNames.map((s) => `"${s}"`).join(", ") || "(nenhuma)"}\n` +
        "Este importador espera o export DRIVA multi-aba de Contatos. Se o seu export veio\n" +
        "em outro formato (aba única/CSV), me mande uma amostra pra adaptar o mapeamento.",
    );
    process.exit(1);
  }

  // Índice mestre de empresas da planilha (CNPJ → metadados RFB)
  const empresasPlanilha = new Map();
  for (const r of rfbRows) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    if (!cnpj) continue;
    empresasPlanilha.set(cnpj, {
      cnpj,
      razao_social: trimOrNull(r["Razão Social"]),
      nome_fantasia: trimOrNull(r["Nome Fantasia"]),
      uf: trimOrNull(r["UF"]),
      municipio: trimOrNull(r["Municipio"] || r["Município"]),
    });
  }
  console.log(`> ${empresasPlanilha.size} empresas na planilha (aba RFB).`);

  // Constrói contatos por CNPJ ----------------------------------------------
  /** @type {Map<string, any[]>} */
  const contatosPorCnpj = new Map();
  const push = (cnpj, c) => {
    if (!contatosPorCnpj.has(cnpj)) contatosPorCnpj.set(cnpj, []);
    contatosPorCnpj.get(cnpj).push(c);
  };

  // Sócios → pessoas decisoras
  for (const r of socioRows) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    const nome = trimOrNull(
      r["Nome"] || r["Nome do Sócio"] || r["Nome do Socio"] || r["Sócio"] || r["Socio"],
    );
    if (!cnpj || !nome) continue;
    const cargo = trimOrNull(
      r["Qualificação"] || r["Qualificacao"] || r["Qualificação do Sócio"] || r["Qualificacao do Socio"],
    );
    push(cnpj, {
      nome,
      cargo,
      papel: derivePapel(cargo, false, true),
      cpf_mascarado: trimOrNull(r["CNPJ/CPF Sócio"] || r["CNPJ/CPF Socio"]),
      faixa_etaria: trimOrNull(r["Faixa Etária"] || r["Faixa Etaria"]),
      origem: "driva",
      dedup_key: `socio:${norm(nome)}`,
    });
  }

  // Emails → contatos com email (alguns nomeados, com cargo + linkedin)
  for (const r of emailRows) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    const email = trimOrNull(r["Email"] || r["E-mail"] || r["E-Mail"]);
    if (!cnpj || !email) continue;
    const nome = trimOrNull(r["Nome"] || r["Nome Contato"] || r["Nome do Contato"]);
    const cargo = trimOrNull(r["Cargo"] || r["Função"] || r["Funcao"] || r["Cargo/Função"]);
    const isContador = isSim(r["Pertence ao Contador"] || r["Pertence a Contador"]);
    push(cnpj, {
      nome,
      cargo,
      email: email.toLowerCase(),
      linkedin: trimOrNull(
        r["Linkedin"] || r["LinkedIn"] || r["URL Linkedin"] || r["Linkedin URL"] || r["Perfil Linkedin"],
      ),
      is_contador: isContador,
      papel: derivePapel(cargo, isContador, !!nome),
      origem: "driva",
      dedup_key: `email:${email.toLowerCase()}`,
    });
  }

  // Telefones → canais (fixo/móvel/whatsapp)
  for (const r of phoneRows) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    const tel = trimOrNull(r["Telefone Completo"] || r["Telefone"]);
    if (!cnpj || !tel) continue;
    const tipo = tipoTelefoneFrom(r["Fixo Ou Móvel"] || r["Fixo Ou Movel"]);
    const isContador = isSim(r["Pertence a Contador"] || r["Pertence ao Contador"]);
    // Coluna WhatsApp pode vir como flag (Sim/Não) OU como o próprio número.
    // Marca true por número/movel, mas NUNCA para negativo explícito ("Não").
    const waCol = r["WhatsApp"] ?? r["Whatsapp"] ?? r["WHATSAPP"];
    const waNeg = /^(n[aã]o|no|false|0)$/i.test(String(waCol ?? "").trim());
    const whatsapp = !waNeg && (isSim(waCol) || !blank(waCol) || tipo === "movel");
    const digits = onlyDigits(tel);
    push(cnpj, {
      telefone: tel,
      tipo_telefone: tipo,
      whatsapp,
      is_contador: isContador,
      papel: "geral",
      origem: "driva",
      dedup_key: `tel:${digits}`,
    });
  }

  // Casa empresas no CRM por CNPJ NORMALIZADO (dígitos). A base guarda CNPJ
  // formatado e às vezes cru — comparar por dígitos resolve ambos. Paginamos
  // todas as empresas com CNPJ (mais robusto que filtrar por formato exato).
  const cnpjs = [...empresasPlanilha.keys()];
  const cnpjToEmpresaId = new Map();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, cnpj")
        .not("cnpj", "is", null)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Falha ao buscar empresas: " + error.message);
      for (const e of data ?? []) {
        const c = cleanCNPJ(e.cnpj);
        if (c) cnpjToEmpresaId.set(c, e.id);
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  let matched = cnpjs.filter((c) => cnpjToEmpresaId.has(c)).length;
  const missing = cnpjs.filter((c) => !cnpjToEmpresaId.has(c));
  console.log(`> ${cnpjToEmpresaId.size} empresas no CRM. Casadas com a DRIVA por CNPJ: ${matched}/${cnpjs.length}.`);
  if (missing.length) console.log(`> ${missing.length} sem cadastro no CRM.`);

  // Cria empresas faltantes (opcional) --------------------------------------
  if (CREATE_MISSING && missing.length) {
    const novos = missing.map((cnpj) => {
      const m = empresasPlanilha.get(cnpj);
      return {
        nome: m.razao_social || m.nome_fantasia || cnpj,
        razao_social: m.razao_social,
        nome_fantasia: m.nome_fantasia,
        cnpj: maskCNPJ(cnpj),
        uf: m.uf,
        municipio: m.municipio,
        status: "prospect",
        user_id: OWNER,
        responsavel_id: OWNER,
        metadados: { origem_cadastro: "driva-import" },
      };
    });
    if (DRY_RUN) {
      console.log(`> [dry-run] criaria ${novos.length} empresas.`);
    } else {
      for (let i = 0; i < novos.length; i += BATCH) {
        const chunk = novos.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("empresas")
          .insert(chunk)
          .select("id, cnpj");
        if (error) throw new Error("Falha ao criar empresas: " + error.message);
        for (const e of data ?? []) {
          const c = cleanCNPJ(e.cnpj);
          if (c) cnpjToEmpresaId.set(c, e.id);
        }
      }
      matched = cnpjs.filter((c) => cnpjToEmpresaId.has(c)).length;
      console.log(`> Empresas criadas: ${novos.length}. Casadas com a DRIVA agora: ${matched}/${cnpjs.length}.`);
    }
  }

  // Monta linhas de empresa_contatos ----------------------------------------
  // Só as empresas que os contatos da DRIVA tocam (não o CRM inteiro).
  const empresaIds = [
    ...new Set(
      [...contatosPorCnpj.keys()]
        .map((cnpj) => cnpjToEmpresaId.get(cnpj))
        .filter(Boolean),
    ),
  ];

  // dedup_keys já existentes (pra não reinserir) + empresas que já têm contato
  const existentes = new Set(); // `${empresa_id}|${dedup_key}`
  const empresasComContato = new Set();
  for (let i = 0; i < empresaIds.length; i += 500) {
    const chunk = empresaIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("empresa_contatos")
      .select("empresa_id, dedup_key")
      .in("empresa_id", chunk);
    if (error) throw new Error("Falha ao ler contatos existentes: " + error.message);
    for (const c of data ?? []) {
      empresasComContato.add(c.empresa_id);
      if (c.dedup_key) existentes.add(`${c.empresa_id}|${c.dedup_key}`);
    }
  }

  const linhas = [];
  let semCasamento = 0;
  for (const [cnpj, lista] of contatosPorCnpj) {
    const empresaId = cnpjToEmpresaId.get(cnpj);
    if (!empresaId) {
      semCasamento += lista.length;
      continue;
    }
    // dedup dentro do próprio lote (planilha pode repetir)
    const vistos = new Set();
    const novos = [];
    for (const c of lista) {
      const k = `${empresaId}|${c.dedup_key}`;
      if (existentes.has(k) || vistos.has(k)) continue;
      vistos.add(k);
      novos.push({ empresa_id: empresaId, ...c });
    }
    if (!novos.length) continue;

    // Define principal só se a empresa ainda não tem NENHUM contato (não
    // sobrescreve escolha manual feita no CRM).
    if (!empresasComContato.has(empresaId)) {
      const principal =
        novos.find((c) => /administrador/i.test(c.cargo ?? "")) ||
        novos.find((c) => c.papel === "socio") ||
        novos.find((c) => c.nome && !c.is_contador) ||
        novos[0];
      if (principal) principal.principal = true;
    }
    linhas.push(...novos);
  }

  console.log(`> Contatos novos a inserir: ${linhas.length}.`);
  if (semCasamento) console.log(`> ${semCasamento} contatos ignorados (empresa não casada).`);

  if (DRY_RUN) {
    const amostra = linhas.slice(0, 8).map((l) => ({
      empresa_id: l.empresa_id.slice(0, 8),
      nome: l.nome ?? "(canal)",
      papel: l.papel,
      email: l.email ?? "",
      telefone: l.telefone ?? "",
      principal: !!l.principal,
    }));
    console.table(amostra);
    console.log("> [dry-run] nada gravado.");
    return;
  }

  // Insere em batches
  let inseridos = 0;
  for (let i = 0; i < linhas.length; i += BATCH) {
    const chunk = linhas.slice(i, i + BATCH).map(withDefaults);
    const { error } = await supabase.from("empresa_contatos").insert(chunk);
    if (error) throw new Error("Falha ao inserir contatos: " + error.message);
    inseridos += chunk.length;
    process.stdout.write(`\r> Inseridos ${inseridos}/${linhas.length}...`);
  }
  process.stdout.write("\n");
  console.log(`> Pronto. ${inseridos} contatos importados.`);
}

main().catch((e) => {
  console.error("\nFALHA:", e.message);
  process.exit(1);
});
