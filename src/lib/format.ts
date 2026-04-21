/**
 * Helpers de formatação pt-BR reutilizáveis em todas as páginas.
 */

/** R$ 1.234,56 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** R$ 1.5M, R$ 500k, R$ 1,23 */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return formatCurrency(value);
}

/** 00.000.000/0000-00 — apenas formatação visual (não valida) */
export function formatCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return "";
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return cnpj; // retorna sem format se inválido
  return digits.replace(
    /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
    "$1.$2.$3/$4-$5",
  );
}

/** dd/MM/yyyy a partir de string ISO ou Date */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}

/** dd/MM/yyyy HH:mm */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

/** "há 3 dias", "em 2 dias", "hoje" */
export function formatRelativeDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (Math.abs(diffDays) >= 30) return rtf.format(Math.round(diffDays / 30), "month");
  if (Math.abs(diffDays) >= 7) return rtf.format(Math.round(diffDays / 7), "week");
  return rtf.format(diffDays, "day");
}

/** 1.234.567,89 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
