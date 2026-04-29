// Fonte única dos status de prospecção. Antes existiam duas cópias divergentes:
// Prospeccao.tsx:109 e AcaoEmpresasPanel.tsx:53. Centralizar evita drift de cores e ordem.

export interface ProspeccaoStatusDef {
  key: string;
  label: string;
  color: string;     // bg + text classes (usado em badges/colunas kanban)
  dotColor: string;  // bg-only (usado no ponto da coluna kanban)
  order: number;     // 0..6 — usado pela ordenação "status do funil"
}

export const PROSPECCAO_STATUSES: ProspeccaoStatusDef[] = [
  { key: "Não iniciado",      label: "Não Iniciado",      color: "bg-muted text-muted-foreground",      dotColor: "bg-muted-foreground", order: 0 },
  { key: "Contato feito",     label: "Contato Feito",     color: "bg-info/10 text-info",                dotColor: "bg-info",             order: 1 },
  { key: "Proposta enviada",  label: "Proposta Enviada",  color: "bg-warning/10 text-warning",          dotColor: "bg-warning",          order: 2 },
  { key: "Em negociação",     label: "Em Negociação",     color: "bg-primary/10 text-primary",          dotColor: "bg-primary",          order: 3 },
  { key: "Contrato assinado", label: "Contrato Assinado", color: "bg-success/10 text-success",          dotColor: "bg-success",          order: 4 },
  { key: "Serviço iniciado",  label: "Serviço Iniciado",  color: "bg-accent/15 text-accent-foreground", dotColor: "bg-accent",           order: 5 },
  { key: "Perdido",           label: "Perdido",           color: "bg-destructive/10 text-destructive",  dotColor: "bg-destructive",      order: 6 },
];

const BY_KEY = new Map(PROSPECCAO_STATUSES.map((s) => [s.key, s]));

export function prospStatusDef(key: string | null | undefined): ProspeccaoStatusDef | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function prospStatusColor(key: string | null | undefined): string {
  return prospStatusDef(key)?.color ?? "bg-muted text-muted-foreground";
}

export function prospStatusOrder(key: string | null | undefined): number {
  return prospStatusDef(key)?.order ?? 99;
}
