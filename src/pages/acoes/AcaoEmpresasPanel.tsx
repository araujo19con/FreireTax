import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Handshake, FileText, ArrowUpRight, ArrowUpDown, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { regimeShort, regimeColor } from "@/lib/regimeTributario";
import { prospStatusColor } from "@/lib/prospeccaoStatus";
import type { StatusEmpresaAcao } from "@/lib/exportEmpresasAcao";
import {
  AcaoEmpresasFilterPopover,
  AcaoEmpresasFilterChips,
} from "./AcaoEmpresasFilterPopover";
import {
  applyAcaoFilters,
  applyAcaoSort,
  type AcaoEmpresaFilters,
  type AcaoEmpresaSort,
  type StatusCombinadoKey,
} from "./applyAcaoEmpresaFilters";

export interface EmpresaAcao {
  id: string;
  nome: string;
  cnpj: string;
  porte: string | null;
  uf: string | null;
  situacao_cadastral: string | null;
  regime_tributario: string | null;
  municipio: string | null;
  capital_social: number | null;
  opcao_simples: boolean | null;
  cnae_principal: string | null;
  cnae_principal_desc: string | null;
  quantidade_funcionarios: number | null;
  faturamento_anual: number | null;
  metadados: Record<string, string> | null;
}

export interface ElegAcao {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
  created_at: string;
  valor_potencial_estimado: number | null;
}

export interface ProspMin {
  id: string;
  elegibilidade_id: string | null;
  empresa_id: string;
  acao_id: string;
  status_prospeccao: string;
}

export interface AcaoEmpresasExportPayload {
  acaoNome: string;
  empresaIds: string[];
  statusByEmpresaId: Map<string, StatusEmpresaAcao>;
  elegInfoByEmpresaId: Map<string, {
    elegivel: boolean;
    justificativa: string | null;
    valor_potencial_estimado: number | null;
  }>;
}

interface Props {
  acaoId: string;
  acaoNome: string;
  empresasMap: Map<string, EmpresaAcao>;
  elegs: ElegAcao[];
  prospeccoes: ProspMin[];
  onProspectar: (elegId: string, empresaId: string) => void;
  onOpenProcesso: (elegId: string) => void;
  onDeleteEleg?: (elegId: string) => void;
  onExport: (payload: AcaoEmpresasExportPayload) => Promise<void>;
  onViewEmpresaId?: (id: string) => void;
}

// Presets dos chips do topo. Cada um define um conjunto de StatusCombinadoKey
// que vai pra filters.statusCombinado (ou undefined p/ "Total").
type PresetKey = "todas" | "elegiveis" | "aguardando" | "em_prospeccao";

const PRESETS: Record<PresetKey, StatusCombinadoKey[] | undefined> = {
  todas: undefined,
  elegiveis: [
    "aguardando", "Não iniciado", "Contato feito", "Proposta enviada",
    "Em negociação", "Contrato assinado", "Serviço iniciado", "Perdido",
  ],
  aguardando: ["aguardando"],
  em_prospeccao: [
    "Não iniciado", "Contato feito", "Proposta enviada",
    "Em negociação", "Contrato assinado", "Serviço iniciado",
  ],
};

function arraysEqUnordered<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

const SORT_OPTIONS: Array<{ value: AcaoEmpresaSort; label: string }> = [
  { value: "elegibilidade_recente", label: "Mais recentes" },
  { value: "nome_asc",              label: "Nome A→Z" },
  { value: "nome_desc",             label: "Nome Z→A" },
  { value: "status_funil",          label: "Status do funil" },
  { value: "valor_desc",            label: "Maior valor potencial" },
];

export function AcaoEmpresasPanel({ acaoId, acaoNome, empresasMap, elegs, prospeccoes, onProspectar, onOpenProcesso, onDeleteEleg, onExport, onViewEmpresaId }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<AcaoEmpresaFilters>({});
  const [sort, setSort] = useState<AcaoEmpresaSort>("elegibilidade_recente");
  const [exporting, setExporting] = useState(false);

  const items = useMemo(() => elegs.map(el => ({
    el,
    empresa: empresasMap.get(el.empresa_id),
    prosp: prospeccoes.find(p =>
      p.elegibilidade_id === el.id ||
      (p.empresa_id === el.empresa_id && p.acao_id === acaoId)
    ),
  })), [elegs, empresasMap, prospeccoes, acaoId]);

  // Counts dos chips de topo são sempre contra `items`, não `filtered`,
  // pra que o usuário sempre veja o "tamanho real" de cada bucket.
  const stats = useMemo(() => ({
    total:         items.length,
    elegiveis:     items.filter(i => i.el.elegivel).length,
    aguardando:    items.filter(i => i.el.elegivel && !i.prosp).length,
    emProspeccao:  items.filter(i => !!i.prosp && i.prosp.status_prospeccao !== "Perdido").length,
  }), [items]);

  const filtered = useMemo(
    () => applyAcaoSort(applyAcaoFilters(items, filters, q), sort),
    [items, filters, q, sort],
  );

  const applyPreset = (key: PresetKey) => {
    setFilters((prev) => ({ ...prev, statusCombinado: PRESETS[key] }));
  };

  const isPresetActive = (key: PresetKey): boolean =>
    arraysEqUnordered(filters.statusCombinado, PRESETS[key]);

  const handleExport = async () => {
    if (filtered.length === 0) {
      toast.info("Nenhuma empresa para exportar com os filtros atuais.");
      return;
    }
    setExporting(true);
    try {
      const empresaIds: string[] = [];
      const statusByEmpresaId = new Map<string, StatusEmpresaAcao>();
      const elegInfoByEmpresaId = new Map<string, { elegivel: boolean; justificativa: string | null; valor_potencial_estimado: number | null }>();
      for (const { el, prosp } of filtered) {
        if (!el.empresa_id) continue;
        empresaIds.push(el.empresa_id);
        const st: StatusEmpresaAcao = !el.elegivel
          ? { tipo: "nao_elegivel" }
          : prosp
            ? { tipo: "em_prospeccao", status: prosp.status_prospeccao }
            : { tipo: "aguardando" };
        statusByEmpresaId.set(el.empresa_id, st);
        elegInfoByEmpresaId.set(el.empresa_id, {
          elegivel: el.elegivel,
          justificativa: el.justificativa,
          valor_potencial_estimado: el.valor_potencial_estimado,
        });
      }
      await onExport({ acaoNome, empresaIds, statusByEmpresaId, elegInfoByEmpresaId });
    } finally {
      setExporting(false);
    }
  };

  type StatChip = { key: PresetKey; label: string; count: number; base: string; active: string };
  const presetChips: StatChip[] = [
    { key: "todas",         label: "Total",         count: stats.total,        base: "bg-muted/60 text-foreground hover:bg-muted",     active: "bg-muted ring-2 ring-foreground/20" },
    { key: "elegiveis",     label: "Elegíveis",     count: stats.elegiveis,    base: "bg-success/10 text-success hover:bg-success/20", active: "bg-success/20 ring-2 ring-success/30" },
    { key: "aguardando",    label: "Aguardando",    count: stats.aguardando,   base: "bg-warning/10 text-warning hover:bg-warning/20", active: "bg-warning/20 ring-2 ring-warning/30" },
    { key: "em_prospeccao", label: "Em prospecção", count: stats.emProspeccao, base: "bg-primary/10 text-primary hover:bg-primary/20", active: "bg-primary/20 ring-2 ring-primary/30" },
  ];

  return (
    <div className="space-y-3">
      {/* Presets — escrevem em filters.statusCombinado */}
      <div className="flex flex-wrap gap-2">
        {presetChips.map(chip => (
          <button
            key={chip.key}
            onClick={() => applyPreset(chip.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${isPresetActive(chip.key) ? chip.active : chip.base}`}
          >
            {chip.label}
            <span className="font-bold tabular-nums">{chip.count}</span>
          </button>
        ))}
      </div>

      {/* Linha de controles: busca + filtros + ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar nome ou CNPJ..."
            value={q}
            onChange={e => setQ(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <AcaoEmpresasFilterPopover filters={filters} onChange={setFilters} />
        <Select value={sort} onValueChange={(v) => setSort(v as AcaoEmpresaSort)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          title="Exportar empresas filtradas para XLSX"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exportar ({filtered.length})
        </Button>
      </div>

      <AcaoEmpresasFilterChips filters={filters} onChange={setFilters} />

      {/* Tabela */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma empresa neste filtro.</p>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="overflow-y-auto max-h-[460px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden sm:table-cell">Porte · UF</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden md:table-cell">Regime</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Status</th>
                  <th className="py-2 px-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const { el, empresa, prosp } = item;
                  return (
                    <tr
                      key={el.id}
                      className={`border-t border-border transition-colors hover:bg-muted/20 ${idx % 2 !== 0 ? "bg-muted/5" : ""}`}
                    >
                      <td className="py-2 px-3">
                        {empresa ? (
                          <>
                            <button
                              type="button"
                              className="font-medium truncate max-w-[180px] leading-tight text-left hover:underline focus-visible:underline"
                              onClick={(e) => { e.stopPropagation(); onViewEmpresaId?.(el.empresa_id); }}
                            >
                              {empresa.nome}
                            </button>
                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{empresa.cnpj}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-destructive truncate max-w-[180px] leading-tight">Empresa removida</div>
                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{el.empresa_id.slice(0, 8)}…</div>
                          </>
                        )}
                      </td>

                      <td className="py-2 px-2 hidden sm:table-cell whitespace-nowrap">
                        <span className="text-muted-foreground">{empresa?.porte ?? "—"}</span>
                        {empresa?.uf && <span className="ml-1 font-medium">{empresa.uf}</span>}
                      </td>

                      <td className="py-2 px-2 hidden md:table-cell">
                        {empresa?.regime_tributario ? (
                          <Badge variant="outline" className={`text-[10px] border ${regimeColor(empresa.regime_tributario)}`}>
                            {regimeShort(empresa.regime_tributario)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="py-2 px-2">
                        {!el.elegivel ? (
                          <Badge variant="outline" className="text-[10px] border-0 bg-destructive/10 text-destructive">Não elegível</Badge>
                        ) : prosp ? (
                          <Badge variant="outline" className={`text-[10px] border-0 ${prospStatusColor(prosp.status_prospeccao)}`}>
                            {prosp.status_prospeccao}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-0 bg-warning/10 text-warning">Aguardando</Badge>
                        )}
                      </td>

                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!empresa && onDeleteEleg ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              title="Remover elegibilidade órfã"
                              onClick={() => onDeleteEleg(el.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                title="Processo"
                                onClick={() => onOpenProcesso(el.id)}
                              >
                                <FileText className="h-3 w-3" />
                              </Button>
                              {el.elegivel && !prosp && (
                                <Button
                                  size="sm"
                                  className="h-6 text-[10px] px-2 gap-1"
                                  onClick={() => onProspectar(el.id, el.empresa_id)}
                                >
                                  <Handshake className="h-3 w-3" />Prospectar
                                </Button>
                              )}
                              {el.elegivel && prosp && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[10px] px-2 gap-1"
                                  onClick={() => navigate("/prospeccao")}
                                >
                                  <ArrowUpRight className="h-3 w-3" />Ver
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
