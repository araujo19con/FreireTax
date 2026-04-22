// Helpers compartilhados para regime tributário das empresas.
// O campo `regime_tributario` (text) é manual; quando NULL, derivamos
// de opcao_simples/opcao_mei (RFB) — sem distinguir Real/Presumido.

export type RegimeTributario =
  | "simples"
  | "mei"
  | "lucro_presumido"
  | "lucro_real"
  | "imune_isento";

export const REGIMES_TRIBUTARIOS: Array<{ value: RegimeTributario; label: string; short: string; color: string }> = [
  { value: "simples",          label: "Simples Nacional",  short: "Simples",   color: "bg-info/10 text-info border-info/30" },
  { value: "mei",              label: "MEI",               short: "MEI",       color: "bg-success/10 text-success border-success/30" },
  { value: "lucro_presumido",  label: "Lucro Presumido",   short: "Presumido", color: "bg-warning/10 text-warning border-warning/30" },
  { value: "lucro_real",       label: "Lucro Real",        short: "Real",      color: "bg-primary/10 text-primary border-primary/30" },
  { value: "imune_isento",     label: "Imune / Isento",    short: "Imune",     color: "bg-muted text-muted-foreground border-border" },
];

/** Retorna o regime efetivo da empresa, usando regime_tributario se preenchido,
 *  senão deriva de opcao_simples/opcao_mei (sem distinguir presumido/real). */
export function getRegimeEffective(emp: {
  regime_tributario?: string | null;
  opcao_simples?: boolean | null;
  opcao_mei?: boolean | null;
}): RegimeTributario | null {
  if (emp.regime_tributario && isRegime(emp.regime_tributario)) return emp.regime_tributario;
  if (emp.opcao_mei === true) return "mei";
  if (emp.opcao_simples === true) return "simples";
  // opcao_simples === false não permite escolher entre presumido e real
  return null;
}

function isRegime(v: string): v is RegimeTributario {
  return REGIMES_TRIBUTARIOS.some((r) => r.value === v);
}

/** Texto humano do regime (ou "Não informado" se null). */
export function humanizeRegime(value: RegimeTributario | string | null | undefined): string {
  if (!value) return "Não informado";
  const found = REGIMES_TRIBUTARIOS.find((r) => r.value === value);
  return found?.label ?? value;
}

export function regimeShort(value: RegimeTributario | string | null | undefined): string {
  if (!value) return "—";
  const found = REGIMES_TRIBUTARIOS.find((r) => r.value === value);
  return found?.short ?? value;
}

export function regimeColor(value: RegimeTributario | string | null | undefined): string {
  if (!value) return "bg-muted text-muted-foreground";
  const found = REGIMES_TRIBUTARIOS.find((r) => r.value === value);
  return found?.color ?? "bg-muted text-muted-foreground";
}
