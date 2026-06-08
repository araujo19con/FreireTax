import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  Pencil,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  Building2,
  Folder,
  Search,
  Upload,
  X,
  Users,
  DollarSign,
  MessageCircle,
  UserRound,
  Contact,
} from "lucide-react";
import type { DragEvent } from "react";
import type { Empresa } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCompactCurrency } from "@/lib/format";
import { waLink, telLink, mailtoLink, mensagemWhatsappPadrao } from "@/lib/contatos";
import { funcFatDisplay } from "@/lib/empresaDisplay";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";

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
  hasActiveFilters: boolean;
  onClearFilters: () => void;
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
  rows,
  loading,
  total,
  page,
  pageSize,
  selectedIds,
  pastaNamesByEmpresa,
  hasActiveFilters,
  onClearFilters,
  onPageChange,
  onPageSizeChange,
  onToggleSelect,
  onOpenDetail,
  onEnrichir,
  onEdit,
  onDragStart,
  onDragEnd,
  draggingId,
}: EmpresasCardViewProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loading &&
          rows.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={`skel-${i}`} className="p-4 shadow-card">
              <Skeleton className="mb-2 h-5 w-32" />
              <Skeleton className="mb-3 h-3.5 w-28" />
              <Skeleton className="mb-1 h-3.5 w-20" />
              <Skeleton className="h-3.5 w-24" />
            </Card>
          ))}

        {rows.map((e) => {
          const isSelected = selectedIds.has(e.id);
          const pastaNames = pastaNamesByEmpresa.get(e.id) || [];
          const sit = e.situacao_cadastral;
          const cTel = e.contato_principal_telefone;
          const waHref = e.contato_principal_whatsapp
            ? waLink(cTel, mensagemWhatsappPadrao(e.nome, e.contato_principal_nome))
            : null;
          const telHref = telLink(cTel);
          const mailHref = mailtoLink(e.contato_principal_email);
          return (
            <Card
              key={e.id}
              className={cn(
                "group relative cursor-pointer p-4 shadow-card transition-all hover:shadow-elevated",
                isSelected ? "ring-2 ring-primary" : "",
                draggingId === e.id ? "opacity-50" : ""
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
              <div
                className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100"
                data-card-action
              >
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
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">{e.nome}</h3>
                  {e.razao_social && e.razao_social !== e.nome && (
                    <p className="line-clamp-1 text-[11px] text-muted-foreground">
                      {e.razao_social}
                    </p>
                  )}
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {formatCNPJ(e.cnpj)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  className={`text-[10px] capitalize ${statusColors[e.status] || ""}`}
                >
                  {e.status}
                </Badge>
                {sit && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      sit === "ATIVA"
                        ? "border-success/30 bg-success/10 text-success"
                        : sit === "BAIXADA" || sit === "INAPTA" || sit === "NULA"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-warning/30 bg-warning/10 text-warning"
                    }`}
                  >
                    {sit}
                  </Badge>
                )}
                {e.porte && e.porte !== "NAO_INFORMADO" && (
                  <Badge variant="outline" className="text-[10px]">
                    {e.porte}
                  </Badge>
                )}
                {e.uf && (
                  <Badge variant="outline" className="text-[10px]">
                    <MapPin className="mr-0.5 h-2.5 w-2.5" />
                    {e.uf}
                  </Badge>
                )}
                {e.opcao_simples && (
                  <Badge
                    variant="outline"
                    className="border-info/30 bg-info/10 text-[10px] text-info"
                  >
                    Simples
                  </Badge>
                )}
                {e.contatos_count ? (
                  <Badge
                    variant="outline"
                    className="border-primary/30 bg-primary/5 text-[10px] text-primary"
                  >
                    <Contact className="mr-0.5 h-2.5 w-2.5" />
                    {e.contatos_count} contato{e.contatos_count > 1 ? "s" : ""}
                  </Badge>
                ) : null}
              </div>

              {(() => {
                const ff = funcFatDisplay(e);
                if (!ff.hasAny) return null;
                return (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {ff.funcionarios && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3 shrink-0" />
                        {ff.funcionarios}
                      </span>
                    )}
                    {ff.faturamento && (
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3 shrink-0" />
                        {ff.faturamento}
                      </span>
                    )}
                  </div>
                );
              })()}

              <div className="mt-3 space-y-1">
                {e.contato_principal_nome ? (
                  <div
                    className="rounded-md border border-primary/20 bg-primary/5 p-2"
                    data-card-action
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate text-[11px] font-medium">
                          <UserRound className="h-3 w-3 shrink-0 text-primary" />
                          <span className="truncate">{e.contato_principal_nome}</span>
                        </p>
                        {e.contato_principal_cargo && (
                          <p className="truncate pl-4 text-[10px] text-muted-foreground">
                            {e.contato_principal_cargo}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {waHref && (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            className="text-green-600 hover:opacity-70"
                            aria-label="WhatsApp"
                            title="WhatsApp"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {telHref && (
                          <a
                            href={telHref}
                            onClick={(ev) => ev.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Ligar"
                            title="Ligar"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {mailHref && (
                          <a
                            href={mailHref}
                            onClick={(ev) => ev.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Email"
                            title="Email"
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
                {e.valor_potencial_total ? (
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-muted-foreground">Potencial</span>
                    <span className="font-medium tabular-nums">
                      {formatCompactCurrency(e.valor_potencial_total)}
                    </span>
                  </div>
                ) : null}
              </div>

              {pastaNames.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {pastaNames.slice(0, 3).map((name) => (
                    <Badge key={name} variant="outline" className="text-[9px]">
                      <Folder className="mr-0.5 h-2.5 w-2.5" />
                      {name}
                    </Badge>
                  ))}
                  {pastaNames.length > 3 && (
                    <Badge variant="outline" className="text-[9px]">
                      +{pastaNames.length - 3}
                    </Badge>
                  )}
                </div>
              )}

              <div
                className="mt-3 flex items-center justify-end gap-0.5 border-t border-border pt-2"
                data-card-action
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpenDetail(e);
                  }}
                  aria-label={`Detalhes de ${e.nome}`}
                  title="Ver detalhes"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEnrichir(e);
                  }}
                  aria-label={`Atualizar RFB de ${e.nome}`}
                  title="Atualizar RFB"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEdit(e);
                  }}
                  aria-label={`Editar ${e.nome}`}
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Por página</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-7 w-[70px] text-xs">
                <SelectValue />
              </SelectTrigger>
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
                  onClick={(e) => {
                    e.preventDefault();
                    if (page > 1) onPageChange(page - 1);
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
                    if (page < totalPages) onPageChange(page + 1);
                  }}
                  className={
                    page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
