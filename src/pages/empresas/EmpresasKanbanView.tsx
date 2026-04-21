import { useMemo, useState, DragEvent } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye, Pencil, RefreshCw, Building2, MapPin, Search, GripVertical,
} from "lucide-react";
import type { Empresa, EmpresaStatus } from "@/hooks/useEmpresas";
import { useUpdateEmpresaStatus } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS: Array<{ id: EmpresaStatus; label: string; accent: string }> = [
  { id: "prospect", label: "Prospect", accent: "border-l-info" },
  { id: "cliente",  label: "Cliente",  accent: "border-l-success" },
  { id: "inativo",  label: "Inativo",  accent: "border-l-muted-foreground" },
];

interface EmpresasKanbanViewProps {
  rows: Empresa[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (emp: Empresa) => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
}

export function EmpresasKanbanView({
  rows, loading, selectedIds, onToggleSelect, onOpenDetail, onEnrichir, onEdit,
}: EmpresasKanbanViewProps) {
  const updateStatus = useUpdateEmpresaStatus();
  const [dragOver, setDragOver] = useState<EmpresaStatus | null>(null);

  const grouped = useMemo(() => {
    const map: Record<EmpresaStatus, Empresa[]> = {
      prospect: [], cliente: [], inativo: [],
    };
    for (const e of rows) {
      const key = (map[e.status as EmpresaStatus] ? (e.status as EmpresaStatus) : "prospect");
      map[key].push(e);
    }
    return map;
  }, [rows]);

  const handleDragStart = (ev: DragEvent, id: string) => {
    ev.dataTransfer.setData("empresaId", id);
    ev.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (ev: DragEvent, col: EmpresaStatus) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    setDragOver(col);
  };

  const handleDrop = (ev: DragEvent, col: EmpresaStatus) => {
    ev.preventDefault();
    setDragOver(null);
    const id = ev.dataTransfer.getData("empresaId");
    if (!id) return;
    const emp = rows.find((r) => r.id === id);
    if (!emp || emp.status === col) return;
    updateStatus.mutate({ id, status: col });
  };

  if (!loading && rows.length === 0) {
    return (
      <Card className="shadow-card p-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Search className="h-8 w-8 opacity-50" aria-hidden />
          <p className="text-sm font-medium">Nenhuma empresa encontrada</p>
          <p className="text-xs">Ajuste filtros ou busque outra coisa.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {COLUMNS.map((col) => {
        const items = grouped[col.id];
        const isOver = dragOver === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(ev) => handleDragOver(ev, col.id)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(ev) => handleDrop(ev, col.id)}
            className={cn(
              "space-y-2 bg-muted/30 rounded-lg p-3 transition-colors min-h-[200px]",
              isOver ? "bg-primary/10 ring-2 ring-primary" : "",
            )}
          >
            <div className={cn("flex items-center justify-between border-l-4 pl-2 py-1", col.accent)}>
              <h3 className="font-medium text-sm capitalize">{col.label}</h3>
              <Badge variant="secondary" className="h-5 text-[10px]">{items.length}</Badge>
            </div>

            <div className="space-y-2">
              {items.map((e) => {
                const isSelected = selectedIds.has(e.id);
                return (
                  <Card
                    key={e.id}
                    className={cn(
                      "p-3 shadow-sm hover:shadow-card transition-all cursor-pointer group relative",
                      isSelected ? "ring-1 ring-primary" : "",
                    )}
                    draggable
                    onDragStart={(ev) => handleDragStart(ev, e.id)}
                    onClick={(ev) => {
                      const t = ev.target as HTMLElement;
                      if (t.closest("[data-card-action]")) return;
                      onOpenDetail(e);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 cursor-grab active:cursor-grabbing shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-medium truncate">{e.nome}</h4>
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{formatCNPJ(e.cnpj)}</p>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.porte && e.porte !== "NAO_INFORMADO" && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{e.porte}</Badge>
                          )}
                          {e.uf && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                              <MapPin className="mr-0.5 h-2 w-2" />{e.uf}
                            </Badge>
                          )}
                          {e.opcao_simples && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-info/10 text-info">Simples</Badge>
                          )}
                        </div>

                        {e.valor_potencial_total ? (
                          <p className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
                            Potencial: <span className="font-medium text-foreground">{formatCompactCurrency(e.valor_potencial_total)}</span>
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" data-card-action>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(e.id)}
                          aria-label={`Selecionar ${e.nome}`}
                          className="mb-1"
                        />
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity" data-card-action>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); onOpenDetail(e); }}>
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); onEnrichir(e); }}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(ev) => { ev.stopPropagation(); onEdit(e); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                );
              })}

              {items.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-6">
                  Arraste uma empresa para cá
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
