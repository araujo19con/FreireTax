import { useMemo, useState, DragEvent } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye,
  Pencil,
  RefreshCw,
  Building2,
  MapPin,
  Search,
  GripVertical,
  Upload,
  X,
  Users,
  DollarSign,
} from "lucide-react";
import type { Empresa, EmpresaStatus } from "@/hooks/useEmpresas";
import { useUpdateEmpresaStatus } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCompactCurrency } from "@/lib/format";
import { funcFatDisplay } from "@/lib/empresaDisplay";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

const COLUMNS: Array<{ id: EmpresaStatus; label: string; accent: string }> = [
  { id: "prospect", label: "Prospect", accent: "border-l-info" },
  { id: "cliente", label: "Cliente", accent: "border-l-success" },
  { id: "inativo", label: "Inativo", accent: "border-l-muted-foreground" },
];

interface EmpresasKanbanViewProps {
  rows: Empresa[];
  loading: boolean;
  selectedIds: Set<string>;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (emp: Empresa) => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
}

export function EmpresasKanbanView({
  rows,
  loading,
  selectedIds,
  hasActiveFilters,
  onClearFilters,
  onToggleSelect,
  onOpenDetail,
  onEnrichir,
  onEdit,
}: EmpresasKanbanViewProps) {
  const updateStatus = useUpdateEmpresaStatus();
  const [dragOver, setDragOver] = useState<EmpresaStatus | null>(null);

  const grouped = useMemo(() => {
    const map: Record<EmpresaStatus, Empresa[]> = {
      prospect: [],
      cliente: [],
      inativo: [],
    };
    for (const e of rows) {
      const key = map[e.status as EmpresaStatus] ? (e.status as EmpresaStatus) : "prospect";
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
    return hasActiveFilters ? (
      <EmptyState
        icon={Search}
        title="Nenhuma empresa encontrada"
        description="Os filtros aplicados não encontraram resultados. Ajuste a busca ou comece do zero."
        action={{ label: "Limpar filtros", icon: X, onClick: onClearFilters }}
      />
    ) : (
      <EmptyState
        icon={Building2}
        title="Nenhuma empresa cadastrada ainda"
        description="Comece importando uma planilha — o sistema identifica CNPJ, faixa de funcionários e regime tributário automaticamente."
        action={{ label: "Importar planilha", icon: Upload, to: "/importacao" }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
              "min-h-[200px] space-y-2 rounded-lg bg-muted/30 p-3 transition-colors",
              isOver ? "bg-primary/10 ring-2 ring-primary" : ""
            )}
          >
            <div
              className={cn("flex items-center justify-between border-l-4 py-1 pl-2", col.accent)}
            >
              <h3 className="text-sm font-medium capitalize">{col.label}</h3>
              <Badge variant="secondary" className="h-5 text-[10px]">
                {items.length}
              </Badge>
            </div>

            <div className="space-y-2">
              {items.map((e) => {
                const isSelected = selectedIds.has(e.id);
                return (
                  <Card
                    key={e.id}
                    className={cn(
                      "group relative cursor-pointer p-3 shadow-sm transition-all hover:shadow-card",
                      isSelected ? "ring-1 ring-primary" : ""
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
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 active:cursor-grabbing" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-xs font-medium">{e.nome}</h4>
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                              {formatCNPJ(e.cnpj)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {e.porte && e.porte !== "NAO_INFORMADO" && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {e.porte}
                            </Badge>
                          )}
                          {e.uf && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              <MapPin className="mr-0.5 h-2 w-2" />
                              {e.uf}
                            </Badge>
                          )}
                          {e.opcao_simples && (
                            <Badge
                              variant="outline"
                              className="h-4 bg-info/10 px-1 text-[9px] text-info"
                            >
                              Simples
                            </Badge>
                          )}
                        </div>

                        {(() => {
                          const ff = funcFatDisplay(e);
                          if (!ff.hasAny) return null;
                          return (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                              {ff.funcionarios && (
                                <span className="flex items-center gap-0.5">
                                  <Users className="h-2.5 w-2.5 shrink-0" />
                                  {ff.funcionarios}
                                </span>
                              )}
                              {ff.faturamento && (
                                <span className="flex items-center gap-0.5">
                                  <DollarSign className="h-2.5 w-2.5 shrink-0" />
                                  {ff.faturamento}
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {e.valor_potencial_total ? (
                          <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground">
                            Potencial:{" "}
                            <span className="font-medium text-foreground">
                              {formatCompactCurrency(e.valor_potencial_total)}
                            </span>
                          </p>
                        ) : null}
                      </div>

                      <div
                        className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        data-card-action
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(e.id)}
                          aria-label={`Selecionar ${e.nome}`}
                          className="mb-1"
                        />
                      </div>
                    </div>

                    <div
                      className="mt-2 flex items-center justify-end gap-0.5 border-t border-border pt-2 opacity-60 transition-opacity group-hover:opacity-100"
                      data-card-action
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpenDetail(e);
                        }}
                        aria-label={`Detalhes de ${e.nome}`}
                        title="Ver detalhes"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onEnrichir(e);
                        }}
                        aria-label={`Atualizar RFB de ${e.nome}`}
                        title="Atualizar RFB"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onEdit(e);
                        }}
                        aria-label={`Editar ${e.nome}`}
                        title="Editar"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                );
              })}

              {items.length === 0 && (
                <p className="py-6 text-center text-[11px] text-muted-foreground">
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
