import * as XLSX from "xlsx";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";
import { formatCNPJ } from "./format";
import { humanizeRegime } from "./regimeTributario";

// Stale autogen types (faltam colunas adicionadas em migrations recentes:
// quantidade_funcionarios, faturamento_anual, regime_tributario, metadados).
type EmpresaRow = Database["public"]["Tables"]["empresas"]["Row"] & {
  quantidade_funcionarios?: number | null;
  faturamento_anual?: number | null;
  regime_tributario?: string | null;
  metadados?: Record<string, unknown> | null;
};

export type StatusEmpresaAcao =
  | { tipo: "nao_elegivel" }
  | { tipo: "aguardando" }
  | { tipo: "em_prospeccao"; status: string };

export interface ExportRow {
  empresa: EmpresaRow;
  status: StatusEmpresaAcao;
  elegivel: boolean;
  justificativa: string | null;
  valor_potencial_estimado: number | null;
}

const HEADERS = [
  "Nome",
  "Razão social",
  "Nome fantasia",
  "CNPJ",
  "Status na ação",
  "Elegível",
  "Justificativa",
  "Valor potencial estimado",
  "Situação cadastral",
  "Porte",
  "Regime tributário",
  "Optante Simples",
  "MEI",
  "UF",
  "Município",
  "CNAE principal",
  "CNAE descrição",
  "Natureza jurídica",
  "Capital social",
  "Data de abertura",
  "Funcionários",
  "Faturamento anual",
  "E-mail (RFB)",
  "Telefone (RFB)",
  "Endereço",
  "Receita atualizada em",
] as const;

type Header = (typeof HEADERS)[number];
type SheetRow = Record<Header, string | number>;

const COL_WIDTHS: Record<Header, number> = {
  "Nome": 32,
  "Razão social": 32,
  "Nome fantasia": 28,
  "CNPJ": 18,
  "Status na ação": 18,
  "Elegível": 10,
  "Justificativa": 28,
  "Valor potencial estimado": 18,
  "Situação cadastral": 14,
  "Porte": 10,
  "Regime tributário": 18,
  "Optante Simples": 12,
  "MEI": 8,
  "UF": 6,
  "Município": 18,
  "CNAE principal": 14,
  "CNAE descrição": 28,
  "Natureza jurídica": 22,
  "Capital social": 16,
  "Data de abertura": 14,
  "Funcionários": 12,
  "Faturamento anual": 18,
  "E-mail (RFB)": 28,
  "Telefone (RFB)": 16,
  "Endereço": 36,
  "Receita atualizada em": 18,
};

function statusLabel(s: StatusEmpresaAcao): string {
  switch (s.tipo) {
    case "nao_elegivel": return "Não elegível";
    case "aguardando": return "Aguardando";
    case "em_prospeccao": return s.status;
  }
}

// Versões "blank-friendly" pra Excel — null/inválido vira "" em vez de "—".
function safeCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function safeDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

function safeBool(v: boolean | null | undefined): string {
  if (v == null) return "";
  return v ? "Sim" : "Não";
}

function safeStr(v: string | null | undefined): string {
  return v ?? "";
}

function safeNum(v: number | null | undefined): string | number {
  if (v == null || Number.isNaN(v)) return "";
  return v;
}

function buildEndereco(e: EmpresaRow): string {
  const cidadeUf = [e.municipio, e.uf].filter(Boolean).join("/");
  const parts = [
    e.logradouro,
    e.numero_endereco,
    e.complemento,
    e.bairro,
    cidadeUf || null,
    e.cep,
  ].filter((p): p is string => Boolean(p && String(p).trim()));
  return parts.join(" - ");
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toSheetRow(r: ExportRow): SheetRow {
  const e = r.empresa;
  return {
    "Nome": safeStr(e.nome),
    "Razão social": safeStr(e.razao_social),
    "Nome fantasia": safeStr(e.nome_fantasia),
    "CNPJ": e.cnpj ? formatCNPJ(e.cnpj) : "",
    "Status na ação": statusLabel(r.status),
    "Elegível": r.elegivel ? "Sim" : "Não",
    "Justificativa": safeStr(r.justificativa),
    "Valor potencial estimado": safeCurrency(r.valor_potencial_estimado),
    "Situação cadastral": safeStr(e.situacao_cadastral),
    "Porte": safeStr(e.porte),
    "Regime tributário": e.regime_tributario ? humanizeRegime(e.regime_tributario) : "",
    "Optante Simples": safeBool(e.opcao_simples),
    "MEI": safeBool(e.opcao_mei),
    "UF": safeStr(e.uf),
    "Município": safeStr(e.municipio),
    "CNAE principal": safeStr(e.cnae_principal),
    "CNAE descrição": safeStr(e.cnae_principal_desc),
    "Natureza jurídica": safeStr(e.natureza_juridica),
    "Capital social": safeCurrency(e.capital_social),
    "Data de abertura": safeDate(e.data_abertura),
    "Funcionários": safeNum(e.quantidade_funcionarios),
    "Faturamento anual": safeCurrency(e.faturamento_anual),
    "E-mail (RFB)": safeStr(e.email_receita),
    "Telefone (RFB)": safeStr(e.telefone_receita),
    "Endereço": buildEndereco(e),
    "Receita atualizada em": safeDate(e.receita_atualizada_em),
  };
}

export function exportEmpresasAcaoXlsx(rows: ExportRow[], acaoNome: string): void {
  const data = rows.map(toSheetRow);
  const ws = XLSX.utils.json_to_sheet(data, { header: [...HEADERS] });
  ws["!cols"] = HEADERS.map((h) => ({ wch: COL_WIDTHS[h] }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Empresas");

  const filename = `acao-${slugify(acaoNome) || "sem-nome"}-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
  XLSX.writeFile(wb, filename);
}
