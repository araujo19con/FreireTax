// Helpers para propostas: shape de seções, contexto de variáveis e renderização.

export interface ProposalSection {
  ordem: number;
  titulo: string;
  conteudo: string; // HTML (Tiptap) com {{variaveis}} interpoladas
}

/** Contexto de variáveis disponíveis no template. */
export interface ProposalContext {
  empresa: {
    nome: string;
    cnpj: string;
    razao_social?: string | null;
    nome_fantasia?: string | null;
  };
  contato: {
    nome: string;
    cargo?: string | null;
    email?: string | null;
    telefone?: string | null;
  };
  acao: {
    nome: string;
    descricao?: string | null;
  };
  prospeccao: {
    valor_potencial?: number | null;
  };
  honorarios: {
    entrada?: number | null;
    exito_percentual?: number | null;
  };
  escritorio: {
    nome: string;
    advogado: string;
    endereco: string;
    telefone: string;
    site: string;
  };
}

/** Constantes do escritório. Use como base — sobreponha por config se mudar. */
export const ESCRITORIO_DEFAULT = {
  nome: "Dantas, Freire, Pignataro, Maciel e Costa Advogados",
  advogado: "Rodrigo Dantas do Nascimento – OAB/RN n.º 4.476",
  endereco: "Rua Aluízio Bezerra, 117, Lagoa Nova. Natal-RN",
  telefone: "(84) 2040-0102",
  site: "https://www.freirepignataro.com.br/",
};

function fmtBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Number(n).toFixed(0)}`;
}

/**
 * Substitui {{path.to.var}} por valores do contexto.
 * Numéricos formatados em BRL/percentual quando aplicável.
 */
export function renderVariaveis(html: string, ctx: ProposalContext): string {
  if (!html) return "";
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const parts = String(path).split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in v) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return `{{${path}}}`; // mantém placeholder se não encontrar
      }
    }
    if (v == null) return "—";
    // Formatação especial por chave
    if (path === "honorarios.entrada") return fmtBRL(v as number);
    if (path === "honorarios.exito_percentual") return fmtPct(v as number);
    if (path === "prospeccao.valor_potencial") return fmtBRL(v as number);
    return String(v);
  });
}

/** Aplica renderVariaveis em todas as seções (sem mutar). */
export function renderSecoes(secoes: ProposalSection[], ctx: ProposalContext): ProposalSection[] {
  return secoes.map((s) => ({
    ...s,
    titulo: renderVariaveis(s.titulo, ctx),
    conteudo: renderVariaveis(s.conteudo, ctx),
  }));
}

/** Lista de variáveis disponíveis pra mostrar no editor (ajuda). */
export const VARIAVEIS_DISPONIVEIS: Array<{ key: string; label: string; exemplo: string }> = [
  { key: "{{empresa.nome}}",                label: "Nome da empresa",        exemplo: "Unimed Santa Bárbara" },
  { key: "{{empresa.razao_social}}",        label: "Razão social",           exemplo: "UNIMED COOPERATIVA…" },
  { key: "{{empresa.cnpj}}",                label: "CNPJ",                   exemplo: "12.345.678/0001-90" },
  { key: "{{contato.nome}}",                label: "Nome do contato",        exemplo: "Dr. Roberto" },
  { key: "{{contato.cargo}}",               label: "Cargo do contato",       exemplo: "Diretor Financeiro" },
  { key: "{{contato.email}}",               label: "E-mail do contato",      exemplo: "roberto@unimed.com.br" },
  { key: "{{acao.nome}}",                   label: "Nome da ação/tese",      exemplo: "Lucro Presumido (LC 224)" },
  { key: "{{honorarios.entrada}}",          label: "Honorários de entrada (formatado R$)", exemplo: "R$ 10.000,00" },
  { key: "{{honorarios.exito_percentual}}", label: "% de êxito (sem o símbolo)", exemplo: "20" },
  { key: "{{prospeccao.valor_potencial}}",  label: "Valor potencial estimado", exemplo: "R$ 56.000,00" },
  { key: "{{escritorio.nome}}",             label: "Nome do escritório",     exemplo: ESCRITORIO_DEFAULT.nome },
  { key: "{{escritorio.advogado}}",         label: "Advogado responsável",   exemplo: ESCRITORIO_DEFAULT.advogado },
];
