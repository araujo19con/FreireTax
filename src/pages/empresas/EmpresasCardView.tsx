import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Eye, Pencil, RefreshCw, Phone, Mail, MapPin, Building2, Folder, Search,
} from "lucide-react";
import type { DragEvent } from "react";
import type { Empresa } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  prospect: "bg-info/10 text-info border-info/30",
  cliente: "bg-success/10 text-success border-success/30",
  inativo: "bg-muted text-muted-foreground",
};

interface EmpresasCardViewProps {
  rows: Empresa[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  selectedIds: Set<string>;
  pastaNamesByEmpresa: Map<string, string[]>;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (emp: Empresa) => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
  onDragStart: (e: DragEvent, empresaId: string) => void;
  onDragEnd: () => void;
  draggingId: string | null;
}

export function EmpresasCardView({
  rows, loading, total, page, pageSize, selectedIds, pastaNamesByEmpresa,
  onPageChange, onPageSizeChange,
  onToggleSelect, onOpenDetail, onEnrichir, onEdit,
  onDragStart, onDragEnd, draggingId,
}: EmpresasCardViewProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!loading && rows.length === 0) {
    return (
      <Card className="shadow-card p-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Search className="h-8 w-8 opacity-50" aria-hidden />
          <p className="text-sm font-medium">Nenhuma empresa encontrada</p>
          <p className="text-xs">Ajuste os filtros ou o termo de busca.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading && rows.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={`skel-${i}`} className="p-4 shadow-card">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3.5 w-28 mb-3" />
              <Skeleton className="h-3.5 w-20 mb-1" />
              <Skeleton className="h-3.5 w-24" />
            </Card>
          ))}

        {rows.map((e) => {
          const isSelected = selectedIds.has(e.id);
          const pastaNames = pastaNamesByEmpresa.get(e.id) || [];
          const sit = e.situacao_cadastral;
          return (
            <Card
              key={e.id}
              className={cn(
                "p-4 shadow-card hover:shadow-elevated transition-all cursor-pointer group relative",
                isSelected ? "ring-2 ring-primary" : "",
                draggingId === e.id ? "opacity-50" : "",
              )}
              draggable
              onDragStart={(ev) => onDragStart(ev, e.id)}
              onDragEnd={onDragEnd}
              onClick={(ev) => {
                // não abre detail se clicou no checkbox ou ações
                const target = ev.target as HTMLElement;
                if (target.closest("[data-card-action]")) return;
                onOpenDetail(e);
              }}
            >
              <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity" data-card-action>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    // stop propagation handled via data-card-action
                    void checked;
                    onToggleSelect(e.id);
                  }}
                  aria-label={`Selecionar ${e.nome}`}
                />
              </div>

              <div className="flex items-start gap-3 pr-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm truncate">{e.nome}</h3>
                  {e.razao_social && e.razao_social !== e.nome && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{e.razao_social}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{formatCNPJ(e.cnpj)}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline" className={`text-[10px] capitalize ${statusColors[e.status] || ""}`}>
                  {e.status}
                </Badge>
                {sit && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      sit === "ATIVA" ? "bg-success/10 text-success border-success/30" :
                      (sit === "BAIXADA" || sit === "INAPTA" || sit === "NULA") ? "bg-destructive/10 text-destructive border-destructive/30" :
                      "bg-warning/10 text-warning border-warning/30"
                    }`}
                  >
                    {sit}
                  </Badge>
                )}
                {e.porte && e.porte !== "NAO_INFORMADO" && (
                  <Badge variant="outline" className="text-[10px]">{e.porte}</Badge>
                )}
                {e.uf && (
                  <Badge variant="outline" className="text-[10px]">
                    <MapPin className="mr-0.5 h-2.5 w-2.5" />{e.uf}
                  </Badge>
                )}
                {e.opcao_simples && (
                  <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/30">Simples</Badge>
                )}
              </div>

              <div className="mt-3 space-y-1">
                {e.telefone_receita && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    <span className="truncate">{e.telefone_receita}</span>
                  </div>
                )}
                {e.email_receita && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{e.email_receita}</span>
                  </div>
                )}
                {e.valor_potencial_total ? (
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-muted-foreground">Potencial</span>
                    <span className="font-medium tabular-nums">{formatCompactCurrency(e.valor_potencial_total)}</span>
                  </div>
                ) : null}
              </div>

              {pastaNames.length > 0 && (
                <div className="mt-2.5 flex gap-1 flex-wrap">
                  {pastaNames.slice(0, 3).map((name) => (
                    <Badge key={name} variant="outline" className="text-[9px]">
                      <Folder className="mr-0.5 h-2.5 w-2.5" />{name}
                    </Badge>
                  ))}
                  {pastaNames.length > 3 && (
                    <Badge variant="outline" className="text-[9px]">+{pastaNames.length - 3}</Badge>
                  )}
                </div>
              )}

              <div className="mt-3 pt-2 border-t border-border flex items-center justify-end gap-0.5" data-card-action>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); onOpenDetail(e); }}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); onEnrichir(e); }}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(ev) => { ev.stopPropagation(); onEdit(e); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Por página</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="tabular-nums">{total} total</span>
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={(e) => { e.preventDefault(); if (page > 1) onPageChange(page - 1); }}
                  className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink isActive>{page}</PaginationLink>
              </PaginationItem>
              <PaginationItem className="text-xs text-muted-foreground px-2">de {totalPages}</PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={(e) => { e.preventDefault(); if (page < totalPages) onPageChange(page + 1); }}
                  className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
