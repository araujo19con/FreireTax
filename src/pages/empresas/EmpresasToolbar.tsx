import { useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Search, Filter, X, LayoutGrid, Table as TableIcon, Kanban,
  Download, FolderPlus, Gavel, Trash2, ChevronDown, FileSpreadsheet, FileText,
} from "lucide-react";
import type { EmpresaFilters, EmpresaSort, EmpresaStatus, EmpresaPorte, EmpresaSituacao } from "@/hooks/useEmpresas";

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
  onExport: (format: "csv" | "xlsx") => void;
  onClearSelection: () => void;
  totalCount: number;
}

const STATUS_OPTIONS: Array<{ value: EmpresaStatus; label: string }> = [
  { value: "prospect", label: "Prospect" },
  { value: "cliente", label: "Cliente" },
  { value: "inativo", label: "Inativo" },
];

const PORTE_OPTIONS: Array<{ value: EmpresaPorte; label: string }> = [
  { value: "MEI", label: "MEI" },
  { value: "ME", label: "ME" },
  { value: "EPP", label: "EPP" },
  { value: "DEMAIS", label: "Demais" },
  { value: "NAO_INFORMADO", label: "Não informado" },
];

const SITUACAO_OPTIONS: Array<{ value: EmpresaSituacao; label: string }> = [
  { value: "ATIVA", label: "Ativa" },
  { value: "SUSPENSA", label: "Suspensa" },
  { value: "INAPTA", label: "Inapta" },
  { value: "BAIXADA", label: "Baixada" },
  { value: "NULA", label: "Nula" },
];

const UF_OPTIONS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

function activeFiltersCount(f: EmpresaFilters): number {
  let n = 0;
  if (f.status?.length) n += f.status.length;
  if (f.porte?.length) n += f.porte.length;
  if (f.situacao?.length) n += f.situacao.length;
  if (f.uf?.length) n += f.uf.length;
  if (f.opcaoSimples != null) n++;
  if (f.enriquecida) n++;
  if (f.temAcao != null) n++;
  if (f.pastaId) n++;
  if (f.capitalMin != null || f.capitalMax != null) n++;
  if (f.municipio?.trim()) n++;
  if (f.cnae?.trim()) n++;
  return n;
}

function formatBRLCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

// Chips visuais dos filtros ativos — cada um com X pra remover individualmente
function FilterChips({ filters, onChange }: { filters: EmpresaFilters; onChange: (f: EmpresaFilters) => void }) {
  const chips: Array<{ label: string; onRemove: () => void; color?: string }> = [];

  filters.status?.forEach((v) =>
    chips.push({
      label: `Status: ${STATUS_OPTIONS.find((o) => o.value === v)?.label}`,
      color: "bg-info/10 text-info border-info/30",
      onRemove: () => onChange({ ...filters, status: (filters.status || []).filter((x) => x !== v) }),
    }));
  filters.porte?.forEach((v) =>
    chips.push({
      label: `Porte: ${PORTE_OPTIONS.find((o) => o.value === v)?.label}`,
      onRemove: () => onChange({ ...filters, porte: (filters.porte || []).filter((x) => x !== v) }),
    }));
  filters.situacao?.forEach((v) =>
    chips.push({
      label: `Situação: ${SITUACAO_OPTIONS.find((o) => o.value === v)?.label}`,
      color: v === "ATIVA" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30",
      onRemove: () => onChange({ ...filters, situacao: (filters.situacao || []).filter((x) => x !== v) }),
    }));
  filters.uf?.forEach((v) =>
    chips.push({
      label: `UF: ${v}`,
      onRemove: () => onChange({ ...filters, uf: (filters.uf || []).filter((x) => x !== v) }),
    }));
  if (filters.opcaoSimples != null) {
    chips.push({
      label: `Simples: ${filters.opcaoSimples ? "Sim" : "Não"}`,
      onRemove: () => onChange({ ...filters, opcaoSimples: null }),
    });
  }
  if (filters.enriquecida) {
    const labelMap = { yes: "Enriquecida", no: "Sem enrichment", error: "Com erro RFB" };
    chips.push({
      label: `RFB: ${labelMap[filters.enriquecida]}`,
      color: filters.enriquecida === "error" ? "bg-destructive/10 text-destructive border-destructive/30" : undefined,
      onRemove: () => onChange({ ...filters, enriquecida: null }),
    });
  }
  if (filters.temAcao != null) {
    chips.push({
      label: `Tem ação: ${filters.temAcao ? "Sim" : "Não"}`,
      onRemove: () => onChange({ ...filters, temAcao: null }),
    });
  }
  if (filters.pastaId) {
    chips.push({
      label: `Pasta: (selecionada)`,
      onRemove: () => onChange({ ...filters, pastaId: null }),
    });
  }
  if (filters.capitalMin != null || filters.capitalMax != null) {
    const min = filters.capitalMin;
    const max = filters.capitalMax;
    const label =
      min != null && max != null
        ? `Capital: ${formatBRLCompact(min)} – ${formatBRLCompact(max)}`
        : min != null
        ? `Capital ≥ ${formatBRLCompact(min)}`
        : `Capital ≤ ${formatBRLCompact(max)}`;
    chips.push({
      label,
      onRemove: () => onChange({ ...filters, capitalMin: null, capitalMax: null }),
    });
  }
  if (filters.municipio?.trim()) {
    chips.push({
      label: `Cidade: "${filters.municipio.trim()}"`,
      onRemove: () => onChange({ ...filters, municipio: null }),
    });
  }
  if (filters.cnae?.trim()) {
    chips.push({
      label: `CNAE: "${filters.cnae.trim()}"`,
      onRemove: () => onChange({ ...filters, cnae: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mr-1">Filtros ativos:</span>
      {chips.map((chip, i) => (
        <Badge
          key={i}
          variant="outline"
          className={`gap-1 pl-2 pr-1 py-0.5 text-[11px] ${chip.color || "bg-primary/10 text-primary border-primary/30"}`}
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="hover:bg-foreground/10 rounded p-0.5"
            aria-label={`Remover filtro ${chip.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => onChange({
          ...filters,
          status: undefined, porte: undefined, situacao: undefined, uf: undefined,
          opcaoSimples: null, enriquecida: null, temAcao: null,
          capitalMin: null, capitalMax: null,
          municipio: null, cnae: null,
        })}
      >
        Limpar todos
      </Button>
    </div>
  );
}

export function EmpresasToolbar({
  search, onSearchChange,
  filters, onFiltersChange,
  sort, onSortChange,
  view, onViewChange,
  selectedIds,
  onBulkMovePasta, onBulkVincularAcao, onBulkDelete, onExport, onClearSelection,
  totalCount,
}: EmpresasToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const nActive = activeFiltersCount(filters);
  const selCount = selectedIds.length;

  const toggleArrayValue = <T,>(arr: T[] | undefined, value: T): T[] | undefined => {
    const cur = arr ?? [];
    const has = cur.includes(value);
    const next = has ? cur.filter((v) => v !== value) : [...cur, value];
    return next.length ? next : undefined;
  };

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

        {/* Filtros (Popover com scroll nativo + seções claras) */}
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="default" className="gap-2">
              <Filter className="h-4 w-4" />
              <span>Filtros</span>
              {nActive > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">{nActive}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={4}
            collisionPadding={12}
            className="w-[min(360px,calc(100vw-24px))] p-0 overflow-hidden"
          >
            {/* Header fixo */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5" />
                <span className="text-sm font-medium">Filtros avançados</span>
                {nActive > 0 && <Badge variant="secondary" className="h-5 px-1.5">{nActive}</Badge>}
              </div>
              <Button
                variant="ghost" size="sm" className="h-7 text-xs"
                onClick={() => onFiltersChange({})}
                disabled={nActive === 0}
              >
                Limpar
              </Button>
            </div>

            {/* Scroll nativo — funciona dentro de Popover sem bugs */}
            <div
              className="overflow-y-auto overscroll-contain"
              style={{ maxHeight: "min(60vh, 520px)" }}
            >
              <div className="p-4 space-y-4">
                {/* Status */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Status</Label>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {STATUS_OPTIONS.map((opt) => {
                      const active = filters.status?.includes(opt.value) ?? false;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onFiltersChange({ ...filters, status: toggleArrayValue(filters.status, opt.value) })
                          }
                          className={`h-8 rounded-md text-xs transition-colors border ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-border"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Porte */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Porte</Label>
                  <div className="mt-2 space-y-1.5">
                    {PORTE_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-1">
                        <Checkbox
                          checked={filters.porte?.includes(opt.value) ?? false}
                          onCheckedChange={() =>
                            onFiltersChange({ ...filters, porte: toggleArrayValue(filters.porte, opt.value) })
                          }
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </section>

                {/* Situação cadastral */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Situação cadastral (RFB)</Label>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {SITUACAO_OPTIONS.map((opt) => {
                      const active = filters.situacao?.includes(opt.value) ?? false;
                      const color =
                        opt.value === "ATIVA" ? "bg-success/10 text-success border-success/30" :
                        (opt.value === "BAIXADA" || opt.value === "INAPTA" || opt.value === "NULA") ? "bg-destructive/10 text-destructive border-destructive/30" :
                        "bg-warning/10 text-warning border-warning/30";
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            onFiltersChange({ ...filters, situacao: toggleArrayValue(filters.situacao, opt.value) })
                          }
                          className={`h-7 rounded-md text-xs transition-colors border ${active ? color + " ring-1 ring-current" : "bg-background hover:bg-muted border-border"}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* UF */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">UF</Label>
                  <div className="mt-2 grid grid-cols-7 gap-1">
                    {UF_OPTIONS.map((uf) => {
                      const active = filters.uf?.includes(uf) ?? false;
                      return (
                        <button
                          key={uf}
                          type="button"
                          onClick={() =>
                            onFiltersChange({ ...filters, uf: toggleArrayValue(filters.uf, uf) })
                          }
                          className={`h-7 rounded text-[10px] font-mono transition-colors border ${
                            active ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-muted/80 border-transparent"
                          }`}
                        >
                          {uf}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Selects */}
                <section className="space-y-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Simples Nacional</Label>
                    <Select
                      value={filters.opcaoSimples == null ? "any" : filters.opcaoSimples ? "yes" : "no"}
                      onValueChange={(v) =>
                        onFiltersChange({ ...filters, opcaoSimples: v === "any" ? null : v === "yes" })
                      }
                    >
                      <SelectTrigger className="h-8 mt-1.5 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Qualquer</SelectItem>
                        <SelectItem value="yes">Sim — é Simples</SelectItem>
                        <SelectItem value="no">Não — não é Simples</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Enriquecimento RFB</Label>
                    <Select
                      value={filters.enriquecida ?? "any"}
                      onValueChange={(v) =>
                        onFiltersChange({ ...filters, enriquecida: v === "any" ? null : (v as "yes" | "no" | "error") })
                      }
                    >
                      <SelectTrigger className="h-8 mt-1.5 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Qualquer</SelectItem>
                        <SelectItem value="yes">Enriquecida</SelectItem>
                        <SelectItem value="no">Não enriquecida</SelectItem>
                        <SelectItem value="error">Com erro RFB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Tem ação vinculada</Label>
                    <Select
                      value={filters.temAcao == null ? "any" : filters.temAcao ? "yes" : "no"}
                      onValueChange={(v) =>
                        onFiltersChange({ ...filters, temAcao: v === "any" ? null : v === "yes" })
                      }
                    >
                      <SelectTrigger className="h-8 mt-1.5 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Qualquer</SelectItem>
                        <SelectItem value="yes">Sim</SelectItem>
                        <SelectItem value="no">Não</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                {/* Capital social — range min/max */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Capital social (R$)</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder="0"
                        value={filters.capitalMin ?? ""}
                        onChange={(e) =>
                          onFiltersChange({
                            ...filters,
                            capitalMin: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder="sem limite"
                        value={filters.capitalMax ?? ""}
                        onChange={(e) =>
                          onFiltersChange({
                            ...filters,
                            capitalMax: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                  </div>
                  {/* Presets rápidos */}
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {[
                      { label: "Até R$ 50k", min: null, max: 50_000 },
                      { label: "R$ 50k–500k", min: 50_000, max: 500_000 },
                      { label: "R$ 500k–5M", min: 500_000, max: 5_000_000 },
                      { label: "Acima de R$ 5M", min: 5_000_000, max: null },
                    ].map((preset) => {
                      const active = filters.capitalMin === preset.min && filters.capitalMax === preset.max;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            onFiltersChange({
                              ...filters,
                              capitalMin: preset.min,
                              capitalMax: preset.max,
                            })
                          }
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-muted border-border"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Cidade */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Cidade (município)</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Ex: São Paulo"
                      value={filters.municipio ?? ""}
                      onChange={(e) =>
                        onFiltersChange({ ...filters, municipio: e.target.value || null })
                      }
                      className="h-8 text-xs pl-7"
                    />
                    {filters.municipio && (
                      <button
                        type="button"
                        onClick={() => onFiltersChange({ ...filters, municipio: null })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 hover:bg-muted rounded p-0.5"
                        aria-label="Limpar cidade"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Busca parcial (ex: "são" encontra São Paulo, São Bernardo, etc.)
                  </p>
                </section>

                {/* CNAE */}
                <section>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">CNAE principal</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Código ou descrição (ex: 6920, advocacia, consultoria)"
                      value={filters.cnae ?? ""}
                      onChange={(e) =>
                        onFiltersChange({ ...filters, cnae: e.target.value || null })
                      }
                      className="h-8 text-xs pl-7"
                    />
                    {filters.cnae && (
                      <button
                        type="button"
                        onClick={() => onFiltersChange({ ...filters, cnae: null })}
                        className="absolute right-2 top-1/2 -translate-y-1/2 hover:bg-muted rounded p-0.5"
                        aria-label="Limpar CNAE"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Busca em código e descrição (ex: "advocacia", "6920", "consultoria jurídica").
                  </p>
                </section>
              </div>
            </div>

            {/* Footer fixo */}
            <div className="px-4 py-2.5 border-t border-border bg-muted/30 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {nActive === 0 ? "Nenhum filtro" : `${nActive} ${nActive === 1 ? "filtro" : "filtros"}`}
              </span>
              <Button size="sm" onClick={() => setFilterOpen(false)}>
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

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

      {/* Chips de filtros ativos */}
      <FilterChips filters={filters} onChange={onFiltersChange} />

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
