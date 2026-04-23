import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Filter, Search, X } from "lucide-react";
import type {
  EmpresaFilters, EmpresaStatus, EmpresaPorte, EmpresaSituacao,
} from "@/hooks/useEmpresas";
import { REGIMES_TRIBUTARIOS } from "@/lib/regimeTributario";

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

function formatBRLCompact(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

export function activeFiltersCount(f: EmpresaFilters): number {
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
  if (f.funcionariosMin != null || f.funcionariosMax != null) n++;
  if (f.faturamentoMin != null || f.faturamentoMax != null) n++;
  if (f.regimeTributario?.length) n += f.regimeTributario.length;
  if (f.municipio?.trim()) n++;
  if (f.cnae?.trim()) n++;
  return n;
}

export function EmpresaFilterChips({
  filters, onChange,
}: { filters: EmpresaFilters; onChange: (f: EmpresaFilters) => void }) {
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
  filters.regimeTributario?.forEach((v) => {
    const found = REGIMES_TRIBUTARIOS.find((r) => r.value === v);
    chips.push({
      label: `Regime: ${found?.short ?? v}`,
      color: found?.color,
      onRemove: () => onChange({ ...filters, regimeTributario: (filters.regimeTributario || []).filter((x) => x !== v) }),
    });
  });
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
  if (filters.capitalMin != null || filters.capitalMax != null) {
    const min = filters.capitalMin;
    const max = filters.capitalMax;
    const label =
      min != null && max != null ? `Capital: ${formatBRLCompact(min)} – ${formatBRLCompact(max)}`
      : min != null ? `Capital ≥ ${formatBRLCompact(min)}`
      : `Capital ≤ ${formatBRLCompact(max)}`;
    chips.push({ label, onRemove: () => onChange({ ...filters, capitalMin: null, capitalMax: null }) });
  }
  if (filters.funcionariosMin != null || filters.funcionariosMax != null) {
    const min = filters.funcionariosMin;
    const max = filters.funcionariosMax;
    const label =
      min != null && max != null ? `Funcionários: ${min}–${max}`
      : min != null ? `Funcionários ≥ ${min}`
      : `Funcionários ≤ ${max}`;
    chips.push({ label, onRemove: () => onChange({ ...filters, funcionariosMin: null, funcionariosMax: null }) });
  }
  if (filters.faturamentoMin != null || filters.faturamentoMax != null) {
    const min = filters.faturamentoMin;
    const max = filters.faturamentoMax;
    const label =
      min != null && max != null ? `Faturamento: ${formatBRLCompact(min)} – ${formatBRLCompact(max)}`
      : min != null ? `Faturamento ≥ ${formatBRLCompact(min)}`
      : `Faturamento ≤ ${formatBRLCompact(max)}`;
    chips.push({ label, onRemove: () => onChange({ ...filters, faturamentoMin: null, faturamentoMax: null }) });
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mr-1">
        Filtros ativos:
      </span>
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
        onClick={() => onChange({})}
      >
        Limpar todos
      </Button>
    </div>
  );
}

interface EmpresaFilterPopoverProps {
  filters: EmpresaFilters;
  onChange: (f: EmpresaFilters) => void;
}

export function EmpresaFilterPopover({ filters, onChange }: EmpresaFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const nActive = activeFiltersCount(filters);

  const toggleArrayValue = <T,>(arr: T[] | undefined, value: T): T[] | undefined => {
    const cur = arr ?? [];
    const has = cur.includes(value);
    const next = has ? cur.filter((v) => v !== value) : [...cur, value];
    return next.length ? next : undefined;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="default" className="gap-2">
          <Filter className="h-4 w-4" />
          <span>Filtros</span>
          {nActive > 0 && <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">{nActive}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        className="w-[min(360px,calc(100vw-24px))] p-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5" />
            <span className="text-sm font-medium">Filtros avançados</span>
            {nActive > 0 && <Badge variant="secondary" className="h-5 px-1.5">{nActive}</Badge>}
          </div>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => onChange({})}
            disabled={nActive === 0}
          >
            Limpar
          </Button>
        </div>

        <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "min(60vh, 520px)" }}>
          <div className="p-4 space-y-4">
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
                        onChange({ ...filters, status: toggleArrayValue(filters.status, opt.value) })
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

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Porte</Label>
              <div className="mt-2 space-y-1.5">
                {PORTE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-1">
                    <Checkbox
                      checked={filters.porte?.includes(opt.value) ?? false}
                      onCheckedChange={() =>
                        onChange({ ...filters, porte: toggleArrayValue(filters.porte, opt.value) })
                      }
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </section>

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
                        onChange({ ...filters, situacao: toggleArrayValue(filters.situacao, opt.value) })
                      }
                      className={`h-7 rounded-md text-xs transition-colors border ${active ? color + " ring-1 ring-current" : "bg-background hover:bg-muted border-border"}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </section>

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
                        onChange({ ...filters, uf: toggleArrayValue(filters.uf, uf) })
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

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Regime tributário</Label>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {REGIMES_TRIBUTARIOS.map((r) => {
                  const active = filters.regimeTributario?.includes(r.value) ?? false;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => {
                        const cur = filters.regimeTributario ?? [];
                        const next = active ? cur.filter((x) => x !== r.value) : [...cur, r.value];
                        onChange({ ...filters, regimeTributario: next.length ? next : undefined });
                      }}
                      className={`h-8 rounded-md text-xs transition-colors border ${
                        active ? r.color + " ring-1 ring-current" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {r.short}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Empresas sem regime definido aparecem só quando filtro está vazio.
              </p>
            </section>

            <section className="space-y-3">
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Simples Nacional (RFB)</Label>
                <Select
                  value={filters.opcaoSimples == null ? "any" : filters.opcaoSimples ? "yes" : "no"}
                  onValueChange={(v) =>
                    onChange({ ...filters, opcaoSimples: v === "any" ? null : v === "yes" })
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
                    onChange({ ...filters, enriquecida: v === "any" ? null : (v as "yes" | "no" | "error") })
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
                    onChange({ ...filters, temAcao: v === "any" ? null : v === "yes" })
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
                      onChange({ ...filters, capitalMin: e.target.value === "" ? null : Number(e.target.value) })
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
                      onChange({ ...filters, capitalMax: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
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
                        onChange({
                          ...filters,
                          capitalMin: active ? null : preset.min,
                          capitalMax: active ? null : preset.max,
                        })
                      }
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Funcionários</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                  <Input
                    type="number" inputMode="numeric" min={0} placeholder="0"
                    value={filters.funcionariosMin ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, funcionariosMin: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                  <Input
                    type="number" inputMode="numeric" min={0} placeholder="sem limite"
                    value={filters.funcionariosMax ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, funcionariosMax: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-1 flex-wrap">
                {[
                  { label: "Até 10", min: null, max: 10 },
                  { label: "11–50", min: 11, max: 50 },
                  { label: "51–200", min: 51, max: 200 },
                  { label: "201–1000", min: 201, max: 1000 },
                  { label: "Acima de 1000", min: 1001, max: null },
                ].map((preset) => {
                  const active = filters.funcionariosMin === preset.min && filters.funcionariosMax === preset.max;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...filters,
                          funcionariosMin: active ? null : preset.min,
                          funcionariosMax: active ? null : preset.max,
                        })
                      }
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Casa empresas com valor exato OU porte RFB compatível (MEI/ME/EPP/DEMAIS). Clique no preset ativo pra desmarcar.
              </p>
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Faturamento anual (R$)</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                  <Input
                    type="number" inputMode="numeric" min={0} placeholder="0"
                    value={filters.faturamentoMin ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, faturamentoMin: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Máximo</Label>
                  <Input
                    type="number" inputMode="numeric" min={0} placeholder="sem limite"
                    value={filters.faturamentoMax ?? ""}
                    onChange={(e) =>
                      onChange({ ...filters, faturamentoMax: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-1 flex-wrap">
                {[
                  { label: "Até R$ 360k", min: null, max: 360_000 },
                  { label: "R$ 360k–4,8M", min: 360_000, max: 4_800_000 },
                  { label: "R$ 4,8M–78M", min: 4_800_000, max: 78_000_000 },
                  { label: "Acima de R$ 78M", min: 78_000_000, max: null },
                ].map((preset) => {
                  const active = filters.faturamentoMin === preset.min && filters.faturamentoMax === preset.max;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...filters,
                          faturamentoMin: active ? null : preset.min,
                          faturamentoMax: active ? null : preset.max,
                        })
                      }
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Presets seguem faixas do Simples Nacional e LP. Filtro numérico; faixas importadas como texto viram campos personalizados.
              </p>
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Cidade (município)</Label>
              <div className="relative mt-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Ex: São Paulo"
                  value={filters.municipio ?? ""}
                  onChange={(e) => onChange({ ...filters, municipio: e.target.value || null })}
                  className="h-8 text-xs pl-7"
                />
              </div>
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">CNAE principal</Label>
              <div className="relative mt-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Código ou descrição (ex: 6920, advocacia)"
                  value={filters.cnae ?? ""}
                  onChange={(e) => onChange({ ...filters, cnae: e.target.value || null })}
                  className="h-8 text-xs pl-7"
                />
              </div>
            </section>
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-border bg-muted/30 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {nActive === 0 ? "Nenhum filtro" : `${nActive} ${nActive === 1 ? "filtro" : "filtros"}`}
          </span>
          <Button size="sm" onClick={() => setOpen(false)}>Aplicar</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
