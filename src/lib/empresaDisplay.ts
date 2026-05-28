/**
 * Helpers compartilhados pra exibição de funcionários e faturamento de
 * empresas em qualquer card/row do sistema.
 *
 * Por que existe: empresas vem de fontes diferentes (RFB/BrasilAPI cadastra
 * o número exato; importação por planilha — DRIVA, etc. — traz só faixa
 * textual em `metadados`). Cada card precisa decidir o mesmo: prefere a
 * faixa-texto quando existe; senão, formata o número. Esse helper centraliza.
 *
 * Reuse: EmpresaDetailSheet, AcaoEmpresasPanel, EmpresasMapView (panel),
 * EmpresasCardView, EmpresasTableView, EmpresasKanbanView, MatrizView.
 */

import { formatCompactCurrency } from "./format";

interface EmpresaLike {
  quantidade_funcionarios?: number | null;
  faturamento_anual?: number | null;
  metadados?: Record<string, string> | null;
}

/** "1500 func." (numérico) ou "1000 A 1999" (faixa DRIVA) ou null se nada. */
export function funcionariosDisplay(emp: EmpresaLike | undefined | null): string | null {
  if (!emp) return null;
  const txt = emp.metadados?.["Faixa de Funcionários"];
  if (txt) return txt;
  if (emp.quantidade_funcionarios != null && emp.quantidade_funcionarios > 0) {
    return `${emp.quantidade_funcionarios} func.`;
  }
  return null;
}

/** "R$ 1.5M" (numérico) ou "500M A 700M" (faixa DRIVA) ou null se nada. */
export function faturamentoDisplay(emp: EmpresaLike | undefined | null): string | null {
  if (!emp) return null;
  const txt = emp.metadados?.["Faixa de Faturamento"];
  if (txt) return txt;
  if (emp.faturamento_anual != null && emp.faturamento_anual > 0) {
    return formatCompactCurrency(emp.faturamento_anual);
  }
  return null;
}

/** Conveniência: ambos em uma chamada. Útil pra checar se há algo a mostrar. */
export function funcFatDisplay(emp: EmpresaLike | undefined | null): {
  funcionarios: string | null;
  faturamento: string | null;
  hasAny: boolean;
} {
  const funcionarios = funcionariosDisplay(emp);
  const faturamento = faturamentoDisplay(emp);
  return { funcionarios, faturamento, hasAny: !!(funcionarios || faturamento) };
}
