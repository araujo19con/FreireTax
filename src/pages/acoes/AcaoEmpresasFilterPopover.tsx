// Popover de filtros + chips ativos + helper de contagem, escopados ao painel
// AcaoEmpresasPanel. Difere do EmpresaFilterPopover canônico em três pontos:
//   1. roda 100% client-side (não monta query Supabase);
//   2. carrega seção "Status combinado" (elegibilidade × prospecção);
//   3. corta filtros sem sentido aqui (pastaId, acaoId, temAcao, enriquecida, status CRM).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Filter, Search, X } from "lucide-react";
import { useFaixasDistintas, faixaSobrepoe } from "@/hooks/useEmpresas";
import type { EmpresaPorte, EmpresaSituacao } from "@/hooks/useEmpresas";
import { REGIMES_TRIBUTARIOS } from "@/lib/regimeTributario";
import { MunicipioMultiSelect } from "@/components/MunicipioMultiSelect";
import {
  STATUS_COMBINADO_OPTIONS,
  activeFiltersCount,
  type AcaoEmpresaFilters,
  type StatusCombinadoKey,
} from "./applyAcaoEmpresaFilters";

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

interface ChipsProps {
  filters: AcaoEmpresaFilters;
  onChange: (f: AcaoEmpresaFilters) => void;
}

export function AcaoEmpresasFilterChips({ filters, onChange }: ChipsProps) {
  const chips: Array<{ label: string; onRemove: () => void; color?: string }> = [];

  filters.statusCombinado?.forEach((v) => {
    const found = STATUS_COMBINADO_OPTIONS.find((o) => o.key === v);
    chips.push({
      label: `Status: ${found?.label ?? v}`,
      color: found?.color,
      onRemove: () => onChange({ ...filters, statusCombinado: (filters.statusCombinado || []).filter((x) => x !== v) }),
    });
  });
  filters.porte?.forEach((v) =>
    chips.push({
      label: `Porte: ${PORTE_OPTIONS.find((o) => o.value === v)?.label ?? v}`,
      onRemove: () => onChange({ ...filters, porte: (filters.porte || []).filter((x) => x !== v) }),
    }));
  filters.uf?.forEach((v) =>
    chips.push({
      label: `UF: ${v}`,
      onRemove: () => onChange({ ...filters, uf: (filters.uf || []).filter((x) => x !== v) }),
    }));
  filters.situacao?.forEach((v) =>
    chips.push({
      label: `Situação: ${SITUACAO_OPTIONS.find((o) => o.value === v)?.label ?? v}`,
      color: v === "ATIVA" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30",
      onRemove: () => onChange({ ...filters, situacao: (filters.situacao || []).filter((x) => x !== v) }),
    }));
  filters.regimeTributario?.forEach((v) => {
    const found = REGIMES_TRIBUTARIOS.find((r) => r.value === v);
    chips.push({
      label: `Regime: ${found?.short ?? v}`,
      color: found?.color,
      onRemove: () => onChange({ ...filters, regimeTributario: (filters.regimeTributario || []).filter((x) => x !== v) }),
    });
  });
  if (filters.opcaoSimples != null) {
    chips.push({
      label: `Simples: ${filters.opcaoSimples ? "Sim" : "Não"}`,
      onRemove: () => onChange({ ...filters, opcaoSimples: null }),
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
  filters.faixaFuncionarios?.forEach((v) =>
    chips.push({
      label: `Faixa func.: ${v}`,
      onRemove: () => onChange({ ...filters, faixaFuncionarios: (filters.faixaFuncionarios || []).filter((x) => x !== v) }),
    }));
  filters.faixaFaturamento?.forEach((v) =>
    chips.push({
      label: `Faixa fat.: ${v}`,
      onRemove: () => onChange({ ...filters, faixaFaturamento: (filters.faixaFaturamento || []).filter((x) => x !== v) }),
    }));
  filters.municipios?.forEach((v) =>
    chips.push({
      label: `Cidade: ${v}`,
      onRemove: () => onChange({ ...filters, municipios: (filters.municipios || []).filter((x) => x !== v) }),
    }));
  if (filters.interior) {
    chips.push({
      label: "Interior (sem capital)",
      onRemove: () => onChange({ ...filters, interior: false }),
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

interface PopoverProps {
  filters: AcaoEmpresaFilters;
  onChange: (f: AcaoEmpresaFilters) => void;
}

export function AcaoEmpresasFilterPopover({ filters, onChange }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const nActive = activeFiltersCount(filters);
  const faixasQ = useFaixasDistintas();
  const faixasFunc = faixasQ.data?.funcionarios ?? [];
  const faixasFat = faixasQ.data?.faturamento ?? [];

  const toggleArrayValue = <T,>(arr: T[] | undefined, value: T): T[] | undefined => {
    const cur = arr ?? [];
    const has = cur.includes(value);
    const next = has ? cur.filter((v) => v !== value) : [...cur, value];
    return next.length ? next : undefined;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2">
          <Filter className="h-3.5 w-3.5" />
          <span className="text-xs">Filtros</span>
          {nActive > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{nActive}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        className="w-[min(380px,calc(100vw-24px))] p-0 overflow-hidden"
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

        <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "min(60vh, 540px)" }}>
          <div className="p-4 space-y-4">
            {/* Status combinado — específico do contexto da Ação */}
            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Status combinado</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">
                Elegibilidade × prospecção. Um item sempre cai em exatamente um.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {STATUS_COMBINADO_OPTIONS.map((opt) => {
                  const active = filters.statusCombinado?.includes(opt.key) ?? false;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onChange({
                        ...filters,
                        statusCombinado: toggleArrayValue<StatusCombinadoKey>(filters.statusCombinado, opt.key),
                      })}
                      className={`h-7 rounded-md text-[11px] transition-colors border px-2 truncate ${
                        active ? `${opt.color} ring-1 ring-current` : "bg-background hover:bg-muted border-border"
                      }`}
                      title={opt.label}
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

            <section>
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
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Capital social (R$)</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Mínimo</Label>
                  <Input
                    type="number" inputMode="numeric" placeholder="0"
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
                    type="number" inputMode="numeric" placeholder="sem limite"
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
                      onClick={() => {
                        if (active) {
                          onChange({ ...filters, funcionariosMin: null, funcionariosMax: null, faixaFuncionarios: undefined });
                        } else {
                          const overlapping = faixasFunc.filter((v) => faixaSobrepoe(v, preset.min, preset.max));
                          onChange({
                            ...filters,
                            funcionariosMin: preset.min,
                            funcionariosMax: preset.max,
                            faixaFuncionarios: overlapping.length ? overlapping : undefined,
                          });
                        }
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {faixasFunc.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Faixas importadas da planilha
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {faixasFunc.map((v) => {
                      const active = filters.faixaFuncionarios?.includes(v) ?? false;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            onChange({ ...filters, faixaFuncionarios: toggleArrayValue(filters.faixaFuncionarios, v) })
                          }
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                          }`}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                Presets numéricos auto-incluem faixas da planilha que se sobrepõem. Clique no ativo pra desmarcar.
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
                      onClick={() => {
                        if (active) {
                          onChange({ ...filters, faturamentoMin: null, faturamentoMax: null, faixaFaturamento: undefined });
                        } else {
                          const overlapping = faixasFat.filter((v) => faixaSobrepoe(v, preset.min, preset.max));
                          onChange({
                            ...filters,
                            faturamentoMin: preset.min,
                            faturamentoMax: preset.max,
                            faixaFaturamento: overlapping.length ? overlapping : undefined,
                          });
                        }
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {faixasFat.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Faixas importadas da planilha
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {faixasFat.map((v) => {
                      const active = filters.faixaFaturamento?.includes(v) ?? false;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            onChange({ ...filters, faixaFaturamento: toggleArrayValue(filters.faixaFaturamento, v) })
                          }
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                          }`}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Cidade (município)</Label>
              <div className="mt-2">
                <MunicipioMultiSelect
                  selectedUFs={filters.uf ?? []}
                  value={filters.municipios ?? []}
                  onChange={(v) => onChange({ ...filters, municipios: v.length ? v : undefined, interior: undefined })}
                />
                {(filters.uf?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, interior: !filters.interior, municipios: undefined })}
                    className={`mt-2 h-7 w-full rounded border text-xs transition-colors ${
                      filters.interior
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted hover:bg-muted/80 border-transparent"
                    }`}
                  >
                    Interior (excluir capital{(filters.uf?.length ?? 0) > 1 ? "is" : ""})
                  </button>
                )}
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
