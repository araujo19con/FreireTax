/**
 * Parser da planilha DRIVA → contatos/empresas/web, reutilizável pela UI
 * (ImportarDrivaDialog) e pelo CLI.
 *
 * Robusto a variações de formato: detecta colunas por palavra-chave, então
 * funciona tanto no export "firmográfico" (empresa + sócios) quanto no de
 * "contatos dos decisores" (nome + cargo + email + celular + whatsapp + linkedin
 * na mesma linha).
 *
 * Puro (sem I/O, sem xlsx): recebe as abas já convertidas em linhas (objetos
 * header→valor) e devolve estruturas prontas pra gravar.
 */

import { derivePapel, type PapelContato, type TipoTelefone } from "@/lib/contatos";

export interface ContatoDraft {
  nome: string | null;
  cargo: string | null;
  papel: PapelContato;
  email: string | null;
  telefone: string | null;
  tipo_telefone: TipoTelefone;
  whatsapp: boolean;
  linkedin: string | null;
  is_contador: boolean;
  cpf_mascarado: string | null;
  faixa_etaria: string | null;
  origem: "driva";
  dedup_key: string;
  principal?: boolean;
}

export interface DrivaEmpresa {
  cnpj: string; // 14 dígitos
  razao_social: string | null;
  nome_fantasia: string | null;
  uf: string | null;
  municipio: string | null;
}

export interface DrivaParsed {
  empresas: Map<string, DrivaEmpresa>; // key = cnpj (14 dígitos)
  contatos: Map<string, ContatoDraft[]>; // key = cnpj
  web: Map<string, Record<string, string>>; // key = cnpj
  stats: {
    empresasNaPlanilha: number;
    contatos: number;
    nomeados: number;
    comEmail: number;
    comTelefone: number;
    comWhatsapp: number;
    comLinkedin: number;
  };
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const str = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  return ""; // null/undefined/objetos (células XLSX vêm como string|number)
};
const onlyDigits = (v: unknown): string => str(v).replace(/\D/g, "");
const cleanCNPJ = (v: unknown): string | null => {
  const d = onlyDigits(v);
  return d.length === 14 ? d : null;
};
const nullify = (v: unknown): string | null => {
  const s = str(v);
  return s === "" ? null : s;
};
const isSim = (v: unknown): boolean => /^(sim|s|yes|y|true|1|x)$/i.test(str(v));

/** Normalização igual à do banco (normaliza_nome_contato) p/ dedup bater. */
export function normNome(v: unknown): string {
  return str(v).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").toUpperCase();
}

function tipoTelefone(v: unknown): TipoTelefone {
  const s = str(v).toLowerCase();
  if (/m[oó]vel|celular|cel\b/.test(s)) return "movel";
  if (/fixo/.test(s)) return "fixo";
  return "desconhecido";
}

const firstUrl = (v: unknown): string | null => {
  const s = str(v).split(/[,;]/)[0].trim();
  return s || null;
};

/** Acha o valor da 1ª coluna cujo header casa `include` e não casa `exclude`. */
function findVal(row: Row, include: RegExp, exclude?: RegExp): string {
  for (const [k, val] of Object.entries(row)) {
    const h = k.toLowerCase();
    if (include.test(h) && (!exclude || !exclude.test(h))) {
      const s = str(val);
      if (s) return s;
    }
  }
  return "";
}

/** Localiza uma aba por nome (case/acentos-insensível, contém). */
function getSheet(sheets: Record<string, Row[]>, ...names: string[]): Row[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [name, rows] of Object.entries(sheets)) {
    const n = norm(name);
    if (names.some((target) => n === norm(target) || n.includes(norm(target)))) return rows;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Extração de UM contato genérico (linha de aba "Emails"/"Contatos"/"Decisores")
// ---------------------------------------------------------------------------
const RE_NOME = /\b(nome|contato|respons[aá]vel|decisor|s[oó]cio)\b/;
const RE_NOME_EXCL = /raz[aã]o|fantasia|empresa|coordenador/;
const RE_CARGO = /cargo|qualifica|fun[cç][aã]o|t[ií]tulo/;
const RE_EMAIL = /e-?mail/;
const RE_PHONE = /telefone|celular|\bfone\b|m[oó]vel|whatsapp|\bzap\b|\bn[uú]mero\b/;
const RE_PHONE_EXCL = /fixo ou|tipo/;
const RE_WHATSAPP = /whatsapp|\bzap\b/;
const RE_LINKEDIN = /linkedin/;
const RE_CONTADOR = /contador/;
const RE_TIPO = /fixo ou|tipo.*(tel|fone)|m[oó]vel/;

function contatoFromRow(row: Row, razaoSocial: string): ContatoDraft | null {
  let nome = findVal(row, RE_NOME, RE_NOME_EXCL);
  // DRIVA às vezes repete a razão social no campo "Nome" → ignora (não é pessoa)
  if (nome && normNome(nome) === normNome(razaoSocial)) nome = "";

  const email = findVal(row, RE_EMAIL).toLowerCase();
  const tel = findVal(row, RE_PHONE, RE_PHONE_EXCL);
  const linkedin = findVal(row, RE_LINKEDIN);
  const cargo = findVal(row, RE_CARGO);
  const isContador = isSim(findVal(row, RE_CONTADOR));
  const whatsappCol = findVal(row, RE_WHATSAPP);
  const tipoCol = findVal(row, RE_TIPO);

  if (!nome && !email && !tel && !linkedin) return null;

  const tel_digits = onlyDigits(tel);
  const tt = tel ? tipoTelefone(tipoCol || tel) : "desconhecido";
  const whatsapp =
    !!whatsappCol && !/^(n[aã]o|no|false|0)$/i.test(whatsappCol) ? true : tt === "movel";

  // dedup_key: email > telefone > nome (estável entre fontes/re-imports)
  const dedup_key = email
    ? `email:${email}`
    : tel_digits
      ? `tel:${tel_digits}`
      : `socio:${normNome(nome)}`;

  return {
    nome: nullify(nome),
    cargo: nullify(cargo),
    papel: derivePapel(cargo, isContador, !!nome),
    email: email || null,
    telefone: nullify(tel),
    tipo_telefone: tt,
    whatsapp,
    linkedin: nullify(linkedin),
    is_contador: isContador,
    cpf_mascarado: null,
    faixa_etaria: null,
    origem: "driva",
    dedup_key,
  };
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------
export function parseDrivaSheets(sheets: Record<string, Row[]>): DrivaParsed {
  const empresas = new Map<string, DrivaEmpresa>();
  const contatos = new Map<string, ContatoDraft[]>();
  const web = new Map<string, Record<string, string>>();

  const push = (cnpj: string, c: ContatoDraft) => {
    const arr = contatos.get(cnpj) ?? [];
    // dedup dentro da própria planilha
    if (!arr.some((x) => x.dedup_key === c.dedup_key)) arr.push(c);
    contatos.set(cnpj, arr);
  };

  // --- RFB: empresas + web ---
  const rfb = getSheet(sheets, "RFB");
  for (const r of rfb) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    if (!cnpj) continue;
    empresas.set(cnpj, {
      cnpj,
      razao_social: nullify(r["Razão Social"] ?? r["Razao Social"]),
      nome_fantasia: nullify(r["Nome Fantasia"]),
      uf: nullify(r["UF"]),
      municipio: nullify(r["Municipio"] ?? r["Município"]),
    });
    const w: Record<string, string> = {};
    const site = firstUrl(r["Sites Concatenados"] ?? r["Site"]);
    const lkd = firstUrl(r["Linkedin Concatenado"] ?? r["LinkedIn"]);
    const fb = firstUrl(r["Facebook Concatenado"] ?? r["Facebook"]);
    const ig = firstUrl(r["Instagram Concatenado"] ?? r["Instagram"]);
    if (site) w["Site"] = site;
    if (lkd) w["LinkedIn"] = lkd;
    if (fb) w["Facebook"] = fb;
    if (ig) w["Instagram"] = ig;
    if (Object.keys(w).length) web.set(cnpj, w);
  }

  // --- Sócios → pessoas decisoras ---
  for (const r of getSheet(sheets, "Sócios", "Socios")) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    const nome = nullify(r["Nome"]);
    if (!cnpj || !nome) continue;
    const cargo = nullify(r["Qualificação"] ?? r["Qualificacao"]);
    push(cnpj, {
      nome,
      cargo,
      papel: "socio",
      email: null,
      telefone: null,
      tipo_telefone: "desconhecido",
      whatsapp: false,
      linkedin: null,
      is_contador: false,
      cpf_mascarado: nullify(r["CNPJ/CPF Sócio"] ?? r["CNPJ/CPF Socio"]),
      faixa_etaria: nullify(r["Faixa Etária"] ?? r["Faixa Etaria"]),
      origem: "driva",
      dedup_key: `socio:${normNome(nome)}`,
    });
  }

  // --- Abas de contato genéricas (Emails, Contatos, Decisores, Leads) ---
  for (const sheetName of ["Emails", "Contatos", "Decisores", "Leads", "Contatos Decisores"]) {
    for (const r of getSheet(sheets, sheetName)) {
      const cnpj = cleanCNPJ(r["CNPJ"]);
      if (!cnpj) continue;
      const razao = str(r["Razão Social"] ?? r["Razao Social"]);
      const c = contatoFromRow(r, razao);
      if (c) push(cnpj, c);
    }
  }

  // --- Telefones (canais avulsos) ---
  for (const r of getSheet(sheets, "Telefones")) {
    const cnpj = cleanCNPJ(r["CNPJ"]);
    const tel = nullify(r["Telefone Completo"] ?? r["Telefone"]);
    if (!cnpj || !tel) continue;
    const tt = tipoTelefone(r["Fixo Ou Móvel"] ?? r["Fixo Ou Movel"]);
    const isContador = isSim(r["Pertence a Contador"] ?? r["Pertence ao Contador"]);
    const waCol = str(r["WhatsApp"]);
    push(cnpj, {
      nome: null,
      cargo: null,
      papel: "geral",
      email: null,
      telefone: tel,
      tipo_telefone: tt,
      whatsapp: (!!waCol && !/^(n[aã]o|no|false|0)$/i.test(waCol)) || tt === "movel",
      linkedin: null,
      is_contador: isContador,
      cpf_mascarado: null,
      faixa_etaria: null,
      origem: "driva",
      dedup_key: `tel:${onlyDigits(tel)}`,
    });
  }

  // --- principal: 1º sócio-administrador, senão 1º nomeado não-contador ---
  for (const [, arr] of contatos) {
    const principal =
      arr.find((c) => /administrador/i.test(c.cargo ?? "")) ||
      arr.find((c) => c.papel === "socio") ||
      arr.find((c) => c.nome && !c.is_contador) ||
      arr[0];
    if (principal) principal.principal = true;
  }

  // stats
  let nomeados = 0,
    comEmail = 0,
    comTelefone = 0,
    comWhatsapp = 0,
    comLinkedin = 0,
    total = 0;
  for (const arr of contatos.values()) {
    for (const c of arr) {
      total++;
      if (c.nome) nomeados++;
      if (c.email) comEmail++;
      if (c.telefone) comTelefone++;
      if (c.whatsapp) comWhatsapp++;
      if (c.linkedin) comLinkedin++;
    }
  }

  return {
    empresas,
    contatos,
    web,
    stats: {
      empresasNaPlanilha: empresas.size,
      contatos: total,
      nomeados,
      comEmail,
      comTelefone,
      comWhatsapp,
      comLinkedin,
    },
  };
}
