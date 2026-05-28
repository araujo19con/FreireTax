// Types e helpers compartilhados para regras de exclusão de critérios.
// Centraliza shape do JSON, defaults sensatos por tipo, avaliação e humanização.

import type { TipoResposta } from "@/hooks/useCriterios";
import { Parser } from "expr-eval";

// ============================================================
// Tipos
// ============================================================

export type NumberOp = "lt" | "lte" | "eq" | "gte" | "gt" | "between" | "outside";
export type DateOp = "before" | "after" | "between" | "outside" | "empty" | "non_empty";
export type TextOp = "empty" | "non_empty" | "contains" | "not_contains";

export type RegraExcludente =
  | { tipo: "boolean"; excludeWhen: boolean }
  | { tipo: "number"; operator: NumberOp; value: number; value2?: number }
  | { tipo: "date"; operator: DateOp; value?: string; value2?: string } // ISO yyyy-mm-dd
  | { tipo: "select"; excludeOptions: string[] }
  | { tipo: "text"; operator: TextOp; value?: string };

export interface RespostaValor {
  bool?: boolean;
  date?: string;
  number?: number;
  text?: string;
  select?: string;
}

// ============================================================
// Defaults
// ============================================================

/** Regra default para um tipo, equivalente ao comportamento legacy de answerIsPositive(). */
export function defaultRegraFor(tipo: TipoResposta): RegraExcludente {
  switch (tipo) {
    case "boolean":
      return { tipo: "boolean", excludeWhen: false };
    case "number":
      return { tipo: "number", operator: "lte", value: 0 };
    case "date":
      return { tipo: "date", operator: "empty" };
    case "text":
      return { tipo: "text", operator: "empty" };
    case "select":
      return { tipo: "select", excludeOptions: [] };
  }
}

// ============================================================
// Avaliação — uma resposta dispara exclusão?
// ============================================================

/** Retorna true se a resposta atende à regra de exclusão (i.e., desqualifica). */
export function respostaDisparaExclusao(regra: RegraExcludente, resp: RespostaValor): boolean {
  switch (regra.tipo) {
    case "boolean":
      return resp.bool === regra.excludeWhen;

    case "number": {
      const v = resp.number;
      if (v == null || !Number.isFinite(v)) return false;
      switch (regra.operator) {
        case "lt":
          return v < regra.value;
        case "lte":
          return v <= regra.value;
        case "eq":
          return v === regra.value;
        case "gte":
          return v >= regra.value;
        case "gt":
          return v > regra.value;
        case "between":
          return regra.value2 != null && v >= regra.value && v <= regra.value2;
        case "outside":
          return regra.value2 != null && (v < regra.value || v > regra.value2);
      }
      return false;
    }

    case "date": {
      const d = resp.date;
      switch (regra.operator) {
        case "empty":
          return !d;
        case "non_empty":
          return !!d;
        case "before":
          return !!d && !!regra.value && d < regra.value;
        case "after":
          return !!d && !!regra.value && d > regra.value;
        case "between":
          return !!d && !!regra.value && !!regra.value2 && d >= regra.value && d <= regra.value2;
        case "outside":
          return !!d && !!regra.value && !!regra.value2 && (d < regra.value || d > regra.value2);
      }
      return false;
    }

    case "select":
      return !!resp.select && regra.excludeOptions.includes(resp.select);

    case "text": {
      const t = (resp.text ?? "").trim();
      const term = (regra.value ?? "").trim().toLowerCase();
      switch (regra.operator) {
        case "empty":
          return t.length === 0;
        case "non_empty":
          return t.length > 0;
        case "contains":
          return !!term && t.toLowerCase().includes(term);
        case "not_contains":
          return !!term && !t.toLowerCase().includes(term);
      }
      return false;
    }
  }
}

// ============================================================
// Humanização — texto pra UI e justificativa
// ============================================================

const NUMBER_OP_LABELS: Record<NumberOp, string> = {
  lt: "< (menor que)",
  lte: "≤ (menor ou igual a)",
  eq: "= (igual a)",
  gte: "≥ (maior ou igual a)",
  gt: "> (maior que)",
  between: "entre",
  outside: "fora de",
};

const DATE_OP_LABELS: Record<DateOp, string> = {
  before: "antes de",
  after: "depois de",
  between: "entre",
  outside: "fora de",
  empty: "vazia",
  non_empty: "preenchida",
};

const TEXT_OP_LABELS: Record<TextOp, string> = {
  empty: "vazio",
  non_empty: "preenchido",
  contains: "contém",
  not_contains: "não contém",
};

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
}

/** Converte regra em texto humano. Ex: "Excluir se: < 1000" */
export function humanizeRegra(regra: RegraExcludente | null | undefined): string {
  if (!regra) return "Excludente legado (resposta negativa)";
  switch (regra.tipo) {
    case "boolean":
      return `Excluir se a resposta for ${regra.excludeWhen ? "Sim" : "Não"}`;
    case "number":
      if (regra.operator === "between" && regra.value2 != null)
        return `Excluir se ${fmtNumber(regra.value)} ≤ valor ≤ ${fmtNumber(regra.value2)}`;
      if (regra.operator === "outside" && regra.value2 != null)
        return `Excluir se valor < ${fmtNumber(regra.value)} ou > ${fmtNumber(regra.value2)}`;
      return `Excluir se valor ${NUMBER_OP_LABELS[regra.operator]} ${fmtNumber(regra.value)}`;
    case "date":
      if (regra.operator === "between" && regra.value && regra.value2)
        return `Excluir se data entre ${regra.value} e ${regra.value2}`;
      if (regra.operator === "outside" && regra.value && regra.value2)
        return `Excluir se data fora de ${regra.value} a ${regra.value2}`;
      if (regra.operator === "empty") return "Excluir se data vazia";
      if (regra.operator === "non_empty") return "Excluir se data preenchida";
      if (regra.value) return `Excluir se data ${DATE_OP_LABELS[regra.operator]} ${regra.value}`;
      return "Excluir (regra de data incompleta)";
    case "select":
      if (regra.excludeOptions.length === 0) return "Excluir (nenhuma opção marcada)";
      return `Excluir se resposta for: ${regra.excludeOptions.join(", ")}`;
    case "text":
      if (regra.operator === "empty") return "Excluir se texto vazio";
      if (regra.operator === "non_empty") return "Excluir se texto preenchido";
      return `Excluir se texto ${TEXT_OP_LABELS[regra.operator]} "${regra.value ?? ""}"`;
  }
}

/** Validação básica antes de salvar. Retorna mensagem de erro ou null. */
export function validateRegra(regra: RegraExcludente): string | null {
  switch (regra.tipo) {
    case "number":
      if (!Number.isFinite(regra.value)) return "Informe o valor de referência";
      if (
        (regra.operator === "between" || regra.operator === "outside") &&
        (regra.value2 == null || !Number.isFinite(regra.value2))
      )
        return "Informe o segundo valor para o intervalo";
      if (
        (regra.operator === "between" || regra.operator === "outside") &&
        regra.value2 != null &&
        regra.value > regra.value2
      )
        return "O primeiro valor deve ser menor que o segundo";
      return null;
    case "date":
      if (regra.operator === "empty" || regra.operator === "non_empty") return null;
      if (!regra.value) return "Informe a data de referência";
      if ((regra.operator === "between" || regra.operator === "outside") && !regra.value2)
        return "Informe a segunda data do intervalo";
      return null;
    case "select":
      if (regra.excludeOptions.length === 0)
        return "Selecione ao menos uma opção que dispara exclusão";
      return null;
    case "text":
      if (
        (regra.operator === "contains" || regra.operator === "not_contains") &&
        !regra.value?.trim()
      )
        return "Informe o termo a buscar";
      return null;
    case "boolean":
      return null;
  }
}

/** Valida sintaxe de fórmula. Retorna mensagem de erro ou null se válida. */
export function validateFormula(formula: string): string | null {
  if (!formula.trim()) return null;
  try {
    new Parser().parse(formula);
    return null;
  } catch (e) {
    return "Sintaxe inválida: " + (e instanceof Error ? e.message : "erro");
  }
}
