import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Search,
  CheckCircle2,
  XCircle,
  Circle,
  AlertCircle,
  Gavel,
  Building2,
  X,
  Play,
  BookOpen,
  Upload,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Acao } from "@/hooks/useAcoes";
import { useEmpresas, type EmpresaFilters } from "@/hooks/useEmpresas";
import { formatCompactCurrency, formatCNPJ } from "@/lib/format";
import { funcionariosDisplay, faturamentoDisplay } from "@/lib/empresaDisplay";
import { cn } from "@/lib/utils";
import { EmpresaFilterPopover, EmpresaFilterChips } from "@/components/EmpresaFilterPopover";
import { BulkQualificationDialog } from "./BulkQualificationDialog";
import { EmpresaQuickSheet } from "@/pages/empresas/EmpresaQuickSheet";

interface EmpresaRow {
  id: string;
  nome: string;
  cnpj: string;
}
interface ElegRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  valor_potencial_estimado: number | null;
  status_qualificacao: string | null;
  justificativa: string | null;
}

type CellState = "eleg" | "not_eleg" | "incomplete" | "none";
interface Cell {
  state: CellState;
  elegibilidade_id?: string;
  valor?: number | null;
  justificativa?: string | null;
}

interface MatrizViewProps {
  acoes: Acao[];
  onOpenWizard: (empresa: EmpresaRow, acao: Acao, elegibilidadeId?: string) => void;
}

export function MatrizView({ acoes, onOpenWizard }: MatrizViewProps) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EmpresaFilters>({});
  const [page, setPage] = useState(1);
  const [detailEmpresaId, setDetailEmpresaId] = useState<string | null>(null);
  const pageSize = 20;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  // Reusa o hook canônico — mesmos filtros server-side da aba Empresas
  const empresasQ = useEmpresas({ search, filters, sort: "nome_asc", page, pageSize });
  const rows = (empresasQ.data?.rows ?? []) as EmpresaRow[];
  const total = empresasQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const empresaIds = useMemo(() => rows.map((e) => e.id), [rows]);

  const elegsQ = useQuery({
    queryKey: ["matriz-elegs", empresaIds.join(",")],
    enabled: empresaIds.length > 0,
    queryFn: async () => {
      if (empresaIds.length === 0) return [] as ElegRow[];
      const { data, error } = await supabase
        .from("elegibilidade")
        .select(
          "id, empresa_id, acao_id, elegivel, valor_potencial_estimado, status_qualificacao, justificativa"
        )
        .in("empresa_id", empresaIds);
      if (error) throw error;
      return (data || []) as ElegRow[];
    },
  });

  const cellMap = useMemo(() => {
    const map = new Map<string, Cell>();
    for (const el of elegsQ.data ?? []) {
      const key = `${el.empresa_id}|${el.acao_id}`;
      const status = (el.status_qualificacao || "").toLowerCase();
      let state: CellState = "eleg";
      if (!el.elegivel) state = "not_eleg";
      else if (status === "incompleta") state = "incomplete";
      map.set(key, {
        state,
        elegibilidade_id: el.id,
        valor: el.valor_potencial_estimado,
        justificativa: el.justificativa,
      });
    }
    return map;
  }, [elegsQ.data]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar nome, CNPJ, razão social..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>

          <EmpresaFilterPopover
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setPage(1);
            }}
          />

          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border border-success/40 bg-success/20" />
              Elegível
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border border-destructive/40 bg-destructive/20" />
              Não
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border border-warning/40 bg-warning/20" />
              Incompleta
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border border-border bg-muted" />
              Sem qualificação
            </span>
          </div>
        </div>

        <EmpresaFilterChips
          filters={filters}
          onChange={(f) => {
            setFilters(f);
            setPage(1);
          }}
        />

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <Badge variant="secondary" className="shrink-0">
              {selected.size} selecionada{selected.size > 1 ? "s" : ""}
            </Badge>
            <div className="h-4 w-px bg-border" />
            <Button
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="h-8"
              disabled={acoes.length === 0}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Qualificar em lote
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8">
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpar seleção
            </Button>
          </div>
        )}

        {acoes.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="Nenhuma ação tributária cadastrada"
            description="A Elegibilidade qualifica empresas contra ações (teses). Cadastre pelo menos uma ação primeiro — assim a matriz tem colunas pra preencher."
            action={{ label: "Ir para Ações Tributárias", to: "/acoes", icon: Gavel }}
            secondaryAction={{ label: "Ver tutorial", to: "/tutorial?tab=fluxo", icon: BookOpen }}
          />
        ) : rows.length === 0 && !empresasQ.isLoading ? (
          <EmptyState
            icon={Building2}
            title="Nenhuma empresa cadastrada"
            description="A matriz precisa de empresas nas linhas. Cadastre manualmente ou importe uma planilha pra popular a base."
            action={{ label: "Ir para Empresas", to: "/empresas", icon: Building2 }}
            secondaryAction={{ label: "Importar planilha", to: "/importacao", icon: Upload }}
          />
        ) : (
          <Card className="overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="sticky left-0 z-10 w-8 bg-muted/30 px-2">
                      <Checkbox
                        checked={allChecked ? true : someChecked ? "indeterminate" : false}
                        onCheckedChange={toggleAll}
                        aria-label="Selecionar todas as empresas da página"
                      />
                    </th>
                    <th className="sticky left-8 z-10 min-w-[280px] max-w-[320px] bg-muted/30 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Empresa
                    </th>
                    {acoes.map((a) => (
                      <th
                        key={a.id}
                        className="min-w-[120px] max-w-[160px] px-2 py-2 text-center align-bottom font-medium"
                        title={a.nome}
                      >
                        <div className="line-clamp-3 break-words text-[10px] uppercase leading-tight tracking-wider text-muted-foreground">
                          {a.nome}
                        </div>
                        {a.tipo && (
                          <div className="mt-0.5 text-[9px] font-normal normal-case text-muted-foreground/70">
                            {a.tipo}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empresasQ.isLoading &&
                    rows.length === 0 &&
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="border-t border-border">
                        <td colSpan={acoes.length + 2} className="p-2">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))}

                  {rows.map((emp) => {
                    const isSel = selected.has(emp.id);
                    return (
                      <tr
                        key={emp.id}
                        className={cn(
                          "border-t border-border transition-colors hover:bg-muted/20",
                          isSel && "bg-primary/5"
                        )}
                      >
                        <td className="sticky left-0 z-10 w-8 bg-background px-2 align-middle">
                          <Checkbox
                            checked={isSel}
                            onCheckedChange={() => toggleOne(emp.id)}
                            aria-label={`Selecionar ${emp.nome}`}
                          />
                        </td>
                        <td className="sticky left-8 z-10 max-w-[320px] bg-background px-3 py-2">
                          <div className="flex min-w-0 flex-col" title={emp.nome}>
                            <button
                              type="button"
                              className="break-words text-left text-sm font-medium leading-tight hover:underline focus-visible:underline"
                              onClick={() => setDetailEmpresaId(emp.id)}
                            >
                              {emp.nome}
                            </button>
                            <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                              {formatCNPJ(emp.cnpj)}
                            </span>
                            {(() => {
                              const fat = faturamentoDisplay(emp);
                              const func = funcionariosDisplay(emp);
                              if (!fat && !func) return null;
                              return (
                                <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                                  {[fat, func].filter(Boolean).join(" · ")}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        {acoes.map((a) => {
                          const cell = cellMap.get(`${emp.id}|${a.id}`) ?? {
                            state: "none" as CellState,
                          };
                          return (
                            <td key={a.id} className="p-1 text-center">
                              <CellButton
                                cell={cell}
                                onClick={() => onOpenWizard(emp, a, cell.elegibilidade_id)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <span className="text-xs text-muted-foreground">
                <strong className="tabular-nums text-foreground">{total}</strong> empresa
                {total === 1 ? "" : "s"} ×{" "}
                <strong className="tabular-nums text-foreground">{acoes.length}</strong> aç
                {acoes.length === 1 ? "ão" : "ões"}
                {selected.size > 0 && (
                  <span className="ml-2">
                    · <strong className="text-primary">{selected.size}</strong> selecionada
                    {selected.size > 1 ? "s" : ""}
                  </span>
                )}
              </span>
              {totalPages > 1 && (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={(e) => {
                          e.preventDefault();
                          if (page > 1) setPage(page - 1);
                        }}
                        className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink isActive>{page}</PaginationLink>
                    </PaginationItem>
                    <PaginationItem className="px-2 text-xs text-muted-foreground">
                      de {totalPages}
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        onClick={(e) => {
                          e.preventDefault();
                          if (page < totalPages) setPage(page + 1);
                        }}
                        className={
                          page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          </Card>
        )}

        {bulkOpen && (
          <BulkQualificationDialog
            open={bulkOpen}
            onClose={() => {
              setBulkOpen(false);
              clearSelection();
            }}
            empresaIds={Array.from(selected)}
          />
        )}

        <EmpresaQuickSheet empresaId={detailEmpresaId} onClose={() => setDetailEmpresaId(null)} />
      </div>
    </TooltipProvider>
  );
}

function CellButton({ cell, onClick }: { cell: Cell; onClick: () => void }) {
  const configs: Record<CellState, { bg: string; icon: React.ReactNode; label: string }> = {
    eleg: {
      bg: "bg-success/20 hover:bg-success/30 border-success/40",
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
      label: "Elegível",
    },
    not_eleg: {
      bg: "bg-destructive/20 hover:bg-destructive/30 border-destructive/40",
      icon: <XCircle className="h-3.5 w-3.5 text-destructive" />,
      label: "Não elegível",
    },
    incomplete: {
      bg: "bg-warning/20 hover:bg-warning/30 border-warning/40",
      icon: <AlertCircle className="h-3.5 w-3.5 text-warning" />,
      label: "Qualificação incompleta",
    },
    none: {
      bg: "bg-muted/50 hover:bg-muted border-border",
      icon: <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />,
      label: "Clique para qualificar",
    },
  };
  const cfg = configs[cell.state];

  const tooltipContent = (
    <div className="space-y-0.5 text-xs">
      <div className="font-medium">{cfg.label}</div>
      {cell.valor && <div>Valor estimado: {formatCompactCurrency(cell.valor)}</div>}
      {cell.justificativa && (
        <div className="mt-1 line-clamp-3 max-w-xs text-muted-foreground">{cell.justificativa}</div>
      )}
      {cell.state === "none" && (
        <div className="text-muted-foreground">Clique pra abrir wizard</div>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex h-10 w-full items-center justify-center gap-1 rounded border transition-colors",
            cfg.bg
          )}
          aria-label={cfg.label}
        >
          {cfg.icon}
          {cell.valor && cell.state === "eleg" && (
            <span className="text-[9px] font-medium tabular-nums">
              {formatCompactCurrency(cell.valor)}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}

void Badge;
