import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Search, X, LayoutGrid, Table as TableIcon, Kanban,
  Download, FolderPlus, Gavel, Trash2, ChevronDown, FileSpreadsheet, FileText, Sparkles,
} from "lucide-react";
import type { EmpresaFilters, EmpresaSort } from "@/hooks/useEmpresas";
import { EmpresaFilterPopover, EmpresaFilterChips } from "@/components/EmpresaFilterPopover";

export type EmpresasView = "table" | "cards" | "kanban";

interface EmpresasToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  filters: EmpresaFilters;
  onFiltersChange: (f: EmpresaFilters) => void;
  sort: EmpresaSort;
  onSortChange: (s: EmpresaSort) => void;
  view: EmpresasView;
  onViewChange: (v: EmpresasView) => void;
  selectedIds: string[];
  onBulkMovePasta: () => void;
  onBulkVincularAcao: () => void;
  onBulkDelete: () => void;
  onBulkInferir?: () => void;
  inferindo?: boolean;
  onExport: (format: "csv" | "xlsx") => void;
  onClearSelection: () => void;
  totalCount: number;
}

/**
 * Toolbar da aba Empresas. Filtros e chips são fornecidos pelo
 * EmpresaFilterPopover compartilhado (também usado na Matriz de
 * Elegibilidade) — não duplique a lógica aqui.
 */
export function EmpresasToolbar({
  search, onSearchChange,
  filters, onFiltersChange,
  sort, onSortChange,
  view, onViewChange,
  selectedIds,
  onBulkMovePasta, onBulkVincularAcao, onBulkDelete, onBulkInferir, inferindo, onExport, onClearSelection,
  totalCount,
}: EmpresasToolbarProps) {
  const selCount = selectedIds.length;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar nome, CNPJ, razão social..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
          {search && (
            <Button
              variant="ghost" size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => onSearchChange("")}
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Filtros — componente compartilhado */}
        <EmpresaFilterPopover filters={filters} onChange={onFiltersChange} />

        {/* Ordenação */}
        <Select value={sort} onValueChange={(v) => onSortChange(v as EmpresaSort)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Mais recentes</SelectItem>
            <SelectItem value="nome_asc">Nome A → Z</SelectItem>
            <SelectItem value="nome_desc">Nome Z → A</SelectItem>
            <SelectItem value="valor_desc">Valor potencial ↓</SelectItem>
            <SelectItem value="capital_desc">Capital social ↓</SelectItem>
            <SelectItem value="data_abertura_desc">Data abertura ↓</SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle */}
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && onViewChange(v as EmpresasView)}
          className="border border-input rounded-md"
        >
          <ToggleGroupItem value="table" aria-label="Tabela" className="data-[state=on]:bg-muted">
            <TableIcon className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="cards" aria-label="Cards" className="data-[state=on]:bg-muted">
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Kanban" className="data-[state=on]:bg-muted">
            <Kanban className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="default" className="gap-2">
              <Download className="h-4 w-4" />
              Export
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">
              {selCount > 0 ? `${selCount} selecionada(s)` : `${totalCount} total`}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("xlsx")}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("csv")}>
              <FileText className="mr-2 h-4 w-4" />CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Chips de filtros ativos — componente compartilhado */}
      <EmpresaFilterChips filters={filters} onChange={onFiltersChange} />

      {/* Bulk actions bar */}
      {selCount > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 flex-wrap">
          <Badge variant="secondary" className="shrink-0">
            {selCount} selecionada{selCount > 1 ? "s" : ""}
          </Badge>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={onBulkMovePasta} className="h-8">
            <FolderPlus className="mr-1.5 h-3.5 w-3.5" />Mover para pasta
          </Button>
          <Button variant="ghost" size="sm" onClick={onBulkVincularAcao} className="h-8">
            <Gavel className="mr-1.5 h-3.5 w-3.5" />Vincular ação
          </Button>
          {onBulkInferir && (
            <Button variant="ghost" size="sm" onClick={onBulkInferir} className="h-8" disabled={inferindo}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {inferindo ? "Inferindo..." : "Inferir dados"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onExport("xlsx")} className="h-8">
            <Download className="mr-1.5 h-3.5 w-3.5" />Exportar seleção
          </Button>
          <Button
            variant="ghost" size="sm" onClick={onBulkDelete}
            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />Excluir
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-8">
            <X className="mr-1.5 h-3.5 w-3.5" />Limpar
          </Button>
        </div>
      )}
    </div>
  );
}
