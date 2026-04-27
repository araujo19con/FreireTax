import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious, PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Pencil, Trash2, RefreshCw, GripVertical, Folder, Search, Building2, Upload, X } from "lucide-react";
import type { DragEvent } from "react";
import type { Empresa } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

const statusColors: Record<string, string> = {
  prospect: "bg-info/10 text-info",
  cliente: "bg-success/10 text-success",
  inativo: "bg-muted text-muted-foreground",
};

interface EmpresasTableViewProps {
  rows: Empresa[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  selectedIds: Set<string>;
  pastaNamesByEmpresa: Map<string, string[]>;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onOpenDetail: (emp: Empresa) => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
  onDelete: (emp: Empresa) => void;
  onDragStart: (e: DragEvent, empresaId: string) => void;
  onDragEnd: () => void;
  draggingId: string | null;
}

function renderReceitaBadges(e: Empresa) {
  if (!e.receita_atualizada_em) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground" title="Sem dados da Receita">
        não enriquecida
      </Badge>
    );
  }
  if (e.receita_erro) {
    return (
      <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30" title={e.receita_erro}>
        erro RFB
      </Badge>
    );
  }
  const sit = e.situacao_cadastral;
  const sitColor =
    sit === "ATIVA" ? "bg-success/10 text-success" :
    sit === "BAIXADA" || sit === "INAPTA" || sit === "NULA" ? "bg-destructive/10 text-destructive" :
    "bg-warning/10 text-warning";
  return (
    <div className="flex flex-wrap gap-1">
      {sit && <Badge variant="secondary" className={`text-[10px] ${sitColor}`}>{sit}</Badge>}
      {e.porte && e.porte !== "NAO_INFORMADO" && (
        <Badge variant="outline" className="text-[10px]">{e.porte}</Badge>
      )}
      {e.uf && <Badge variant="outline" className="text-[10px]">{e.uf}</Badge>}
      {e.opcao_simples && (
        <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/30">Simples</Badge>
      )}
    </div>
  );
}

function TablePagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;

  const pagesToShow: Array<number | "ellipsis"> = [];
  const pushRange = (start: number, end: number) => {
    for (let i = start; i <= end; i++) pagesToShow.push(i);
  };
  if (totalPages <= 7) {
    pushRange(1, totalPages);
  } else if (page <= 4) {
    pushRange(1, 5);
    pagesToShow.push("ellipsis", totalPages);
  } else if (page >= totalPages - 3) {
    pagesToShow.push(1, "ellipsis");
    pushRange(totalPages - 4, totalPages);
  } else {
    pagesToShow.push(1, "ellipsis");
    pushRange(page - 1, page + 1);
    pagesToShow.push("ellipsis", totalPages);
  }

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={(e) => { e.preventDefault(); if (page > 1) onChange(page - 1); }}
            className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
          />
        </PaginationItem>
        {pagesToShow.map((p, i) =>
          p === "ellipsis" ? (
            <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={(e) => { e.preventDefault(); onChange(p); }}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext
            onClick={(e) => { e.preventDefault(); if (page < totalPages) onChange(page + 1); }}
            className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

export function EmpresasTableView({
  rows, loading, total, page, pageSize, selectedIds, pastaNamesByEmpresa,
  hasActiveFilters, onClearFilters,
  onPageChange, onPageSizeChange,
  onToggleSelect, onToggleSelectAll, onOpenDetail, onEnrichir, onEdit, onDelete,
  onDragStart, onDragEnd, draggingId,
}: EmpresasTableViewProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id));

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
    <Card className="shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 pl-2 py-2.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleSelectAll}
                  className={cn(someSelected && !allSelected && "data-[state=unchecked]:bg-primary/20")}
                  aria-label="Selecionar todas"
                />
              </th>
              <th className="w-8" />
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Empresa</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">CNPJ</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Receita</th>
              <th className="text-right py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">V. potencial</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Pastas</th>
              <th className="text-right py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`skel-${i}`} className="border-b border-border">
                  <td colSpan={9} className="p-3">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))
            )}

            {rows.map((e, idx) => {
              const isSelected = selectedIds.has(e.id);
              const pastaNames = pastaNamesByEmpresa.get(e.id) || [];
              return (
                <tr
                  key={e.id}
                  className={cn(
                    "border-b border-border last:border-0 transition-colors",
                    idx % 2 === 1 ? "bg-muted/[0.15]" : "",
                    isSelected ? "bg-primary/5" : "hover:bg-muted/40",
                    draggingId === e.id ? "opacity-50" : "",
                  )}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, e.id)}
                  onDragEnd={onDragEnd}
                >
                  <td className="pl-2 py-2.5">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelect(e.id)}
                      aria-label={`Selecionar ${e.nome}`}
                    />
                  </td>
                  <td className="py-2.5 pl-1 pr-0">
                    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
                  </td>
                  <td className="py-2.5 px-3 font-medium">
                    <button
                      onClick={() => onOpenDetail(e)}
                      className="text-left hover:text-primary hover:underline focus:outline-none focus:underline"
                    >
                      <div className="flex flex-col">
                        <span>{e.nome}</span>
                        {e.razao_social && e.razao_social !== e.nome && (
                          <span className="text-[10px] text-muted-foreground font-normal line-clamp-1">{e.razao_social}</span>
                        )}
                      </div>
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs">{formatCNPJ(e.cnpj)}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[e.status] || ""}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">{renderReceitaBadges(e)}</td>
                  <td className="py-2.5 px-3 text-right text-xs tabular-nums">
                    {e.valor_potencial_total ? formatCompactCurrency(e.valor_potencial_total) : "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex gap-1 flex-wrap">
                      {pastaNames.map((name) => (
                        <Badge key={name} variant="outline" className="text-[10px]">
                          <Folder className="mr-1 h-2.5 w-2.5" />{name}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenDetail(e)} aria-label={`Detalhes de ${e.nome}`} title="Ver detalhes">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEnrichir(e)} aria-label={`Atualizar RFB de ${e.nome}`} title="Atualizar RFB">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(e)} aria-label={`Editar ${e.nome}`} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => onDelete(e)} aria-label={`Excluir ${e.nome}`} title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — pagination + page size */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Mostrando</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span>
            de <span className="font-medium text-foreground tabular-nums">{total}</span> empresa{total === 1 ? "" : "s"}
          </span>
        </div>
        <TablePagination page={page} totalPages={totalPages} onChange={onPageChange} />
      </div>
    </Card>
  );
}
