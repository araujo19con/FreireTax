import { useState, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Handshake,
  FileText,
  ArrowUpRight,
  ArrowUpDown,
  Trash2,
  Download,
  Loader2,
  XCircle,
  Star,
  Phone,
  Smartphone,
  Mail,
  Map as MapIcon,
  Table as TableIcon,
} from "lucide-react";
import { toast } from "sonner";
import { regimeShort, regimeColor } from "@/lib/regimeTributario";
import { prospStatusColor } from "@/lib/prospeccaoStatus";
import { faturamentoDisplay, funcionariosDisplay } from "@/lib/empresaDisplay";
import type { StatusEmpresaAcao } from "@/lib/exportEmpresasAcao";
import type { Empresa } from "@/hooks/useEmpresas";
import { AcaoEmpresasFilterPopover, AcaoEmpresasFilterChips } from "./AcaoEmpresasFilterPopover";
import {
  applyAcaoFilters,
  applyAcaoSort,
  type AcaoEmpresaFilters,
  type AcaoEmpresaSort,
  type StatusCombinadoKey,
} from "./applyAcaoEmpresaFilters";

// Mapa é pesado (~80kb gz com react-simple-maps). Lazy: só carrega quando o
// usuário troca pra view "mapa".
const EmpresasMapView = lazy(() =>
  import("../empresas/EmpresasMapView").then((m) => ({ default: m.EmpresasMapView }))
);

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
  destaque: boolean;
  notas_contexto: string | null;
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
  elegInfoByEmpresaId: Map<
    string,
    {
      elegivel: boolean;
      justificativa: string | null;
      valor_potencial_estimado: number | null;
    }
  >;
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
  onDesqualificar?: (elegId: string, motivo: string) => Promise<void>;
  onUpdateContexto?: (elegId: string, destaque: boolean, notas: string | null) => Promise<void>;
  onExport: (payload: AcaoEmpresasExportPayload) => Promise<void>;
  onViewEmpresaId?: (id: string) => void;
  /** Quando setado, o painel mostra só a empresa com esse id (e um chip
   *  "Filtrando: <nome> ×" no topo). Usado pelo deep-link vindo do
   *  EmpresaDetailSheet (/acoes?empresa=<id>). */
  pinnedEmpresaId?: string | null;
  /** Limpa o pin (some o chip). */
  onClearPinnedEmpresa?: () => void;
}

// Presets dos chips do topo. Cada um define um conjunto de StatusCombinadoKey
// que vai pra filters.statusCombinado (ou undefined p/ "Total").
type PresetKey = "todas" | "elegiveis" | "aguardando" | "em_prospeccao";

const PRESETS: Record<PresetKey, StatusCombinadoKey[] | undefined> = {
  todas: undefined,
  elegiveis: [
    "aguardando",
    "Contato feito",
    "Proposta enviada",
    "Em negociação",
    "Contrato assinado",
    "Serviço iniciado",
    "Perdido",
  ],
  aguardando: ["aguardando"],
  em_prospeccao: [
    "Contato feito",
    "Proposta enviada",
    "Em negociação",
    "Contrato assinado",
    "Serviço iniciado",
  ],
};

// faturamentoDisplay / funcionariosDisplay agora vem de @/lib/empresaDisplay
// (compartilhado com EmpresaDetailSheet, EmpresasMapView, EmpresasCardView etc.)

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
  { value: "nome_asc", label: "Nome A→Z" },
  { value: "nome_desc", label: "Nome Z→A" },
  { value: "status_funil", label: "Status do funil" },
  { value: "valor_desc", label: "Maior valor potencial" },
  { value: "funcionarios_desc", label: "Mais funcionários" },
  { value: "faturamento_desc", label: "Maior faturamento" },
];

export function AcaoEmpresasPanel({
  acaoId,
  acaoNome,
  empresasMap,
  elegs,
  prospeccoes,
  onProspectar,
  onOpenProcesso,
  onDeleteEleg,
  onDesqualificar,
  onUpdateContexto,
  onExport,
  onViewEmpresaId,
  pinnedEmpresaId,
  onClearPinnedEmpresa,
}: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"tabela" | "mapa">("tabela");

  // Nome da empresa pinada — sai do empresasMap ou cai pro id (parcial) se a
  // empresa não estiver carregada (caso raro: RLS / paginação).
  const pinnedEmpresaNome = pinnedEmpresaId
    ? (empresasMap.get(pinnedEmpresaId)?.nome ?? `Empresa ${pinnedEmpresaId.slice(0, 8)}…`)
    : null;
  const [filters, setFilters] = useState<AcaoEmpresaFilters>({});
  const [sort, setSort] = useState<AcaoEmpresaSort>("elegibilidade_recente");
  const [exporting, setExporting] = useState(false);
  const [desqOpen, setDesqOpen] = useState<string | null>(null);
  const [desqMotivo, setDesqMotivo] = useState("");
  const [desqLoading, setDesqLoading] = useState(false);
  const [ctxOpen, setCtxOpen] = useState<string | null>(null);
  const [ctxNotas, setCtxNotas] = useState("");
  const [ctxDestaque, setCtxDestaque] = useState(false);
  const [ctxLoading, setCtxLoading] = useState(false);

  const openCtx = (el: ElegAcao) => {
    setCtxNotas(el.notas_contexto ?? "");
    setCtxDestaque(el.destaque ?? false);
    setCtxOpen(el.id);
  };

  const items = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ el: ElegAcao; empresa: EmpresaAcao; prosp: ProspMin | undefined }> = [];
    for (const el of elegs) {
      const empresa = empresasMap.get(el.empresa_id);
      if (!empresa) continue; // oculta registros órfãos (empresa removida)
      if (seen.has(el.empresa_id)) continue; // deduplica por empresa
      seen.add(el.empresa_id);
      result.push({
        el,
        empresa,
        prosp: prospeccoes.find(
          (p) =>
            p.elegibilidade_id === el.id || (p.empresa_id === el.empresa_id && p.acao_id === acaoId)
        ),
      });
    }
    return result;
  }, [elegs, empresasMap, prospeccoes, acaoId]);

  // Counts dos chips de topo são sempre contra `items`, não `filtered`,
  // pra que o usuário sempre veja o "tamanho real" de cada bucket.
  // emProspeccao só conta elegíveis — match com o filtro do chip
  // (statusOf devolve "nao_elegivel" antes de checar prosp em
  // applyAcaoEmpresaFilters.ts:73, então contar prosp de inelegível
  // virava número que sumia ao clicar no chip).
  const stats = useMemo(
    () => ({
      total: items.length,
      elegiveis: items.filter((i) => i.el.elegivel).length,
      aguardando: items.filter((i) => i.el.elegivel && !i.prosp).length,
      emProspeccao: items.filter(
        (i) => i.el.elegivel && !!i.prosp && i.prosp.status_prospeccao !== "Perdido"
      ).length,
    }),
    [items]
  );

  const filtered = useMemo(() => {
    const base = pinnedEmpresaId ? items.filter((i) => i.el.empresa_id === pinnedEmpresaId) : items;
    return applyAcaoSort(applyAcaoFilters(base, filters, q), sort);
  }, [items, filters, q, sort, pinnedEmpresaId]);

  // IDs das empresas elegíveis (elegivel=true) desta ação. Usado pelo mapa
  // para mostrar só o pool elegível.
  const elegiveisIds = useMemo(
    () => items.filter((i) => i.el.elegivel).map((i) => i.el.empresa_id),
    [items]
  );

  // IDs das empresas com elegibilidade marcada como destaque (estrela). O mapa
  // pinta a estrela amarela no card e destaca o fundo.
  const destaqueIds = useMemo(
    () => new Set(items.filter((i) => i.el.destaque).map((i) => i.el.empresa_id)),
    [items]
  );

  // Fetch lazy de empresas full (todos os campos) para alimentar o mapa.
  // Só dispara quando view === "mapa" e há elegíveis. Cacheado por (acaoId, set de IDs).
  const idsKey = useMemo(() => [...elegiveisIds].sort().join(","), [elegiveisIds]);
  const { data: mapaEmpresas = [], isLoading: loadingMapaEmpresas } = useQuery({
    queryKey: ["acao-map-empresas", acaoId, idsKey],
    queryFn: async () => {
      if (elegiveisIds.length === 0) return [] as Empresa[];
      // Chunk em 1000 (limite seguro de .in())
      const chunks: string[][] = [];
      for (let i = 0; i < elegiveisIds.length; i += 1000) {
        chunks.push(elegiveisIds.slice(i, i + 1000));
      }
      const results = await Promise.all(
        chunks.map((c) => supabase.from("empresas").select("*").in("id", c))
      );
      if (results.some((r) => r.error)) throw new Error("Erro ao carregar empresas do mapa");
      return results.flatMap((r) => (r.data ?? []) as Empresa[]);
    },
    enabled: view === "mapa" && elegiveisIds.length > 0,
    staleTime: 60 * 1000,
  });

  // Contatos de SÓCIO por empresa — pra mostrar na linha se dá pra falar com o
  // dono (e se há telefone/celular). Lightweight (só papel=socio, 3 colunas);
  // pagina por range dentro de cada chunk pra não truncar no teto de 1000.
  const allEmpresaIds = useMemo(() => items.map((i) => i.empresa.id), [items]);
  const sociosIdsKey = useMemo(() => [...allEmpresaIds].sort().join(","), [allEmpresaIds]);
  const { data: sociosByEmpresa } = useQuery({
    queryKey: ["acao-socios-contato", acaoId, sociosIdsKey],
    queryFn: async () => {
      const map = new Map<
        string,
        { socios: number; comTel: number; comCel: number; comEmail: number }
      >();
      for (let i = 0; i < allEmpresaIds.length; i += 500) {
        const chunk = allEmpresaIds.slice(i, i + 500);
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from("empresa_contatos")
            .select("empresa_id, telefone, tipo_telefone, email")
            .eq("papel", "socio")
            .in("empresa_id", chunk)
            .order("empresa_id")
            .range(offset, offset + 999);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as {
            empresa_id: string;
            telefone: string | null;
            tipo_telefone: string | null;
            email: string | null;
          }[];
          for (const row of rows) {
            const cur = map.get(row.empresa_id) ?? {
              socios: 0,
              comTel: 0,
              comCel: 0,
              comEmail: 0,
            };
            cur.socios += 1;
            if (row.telefone) cur.comTel += 1;
            if (row.tipo_telefone === "movel") cur.comCel += 1;
            if (row.email) cur.comEmail += 1;
            map.set(row.empresa_id, cur);
          }
          if (rows.length < 1000) break;
        }
      }
      return map;
    },
    enabled: allEmpresaIds.length > 0,
    staleTime: 60 * 1000,
  });

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
      const elegInfoByEmpresaId = new Map<
        string,
        { elegivel: boolean; justificativa: string | null; valor_potencial_estimado: number | null }
      >();
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
    {
      key: "todas",
      label: "Total",
      count: stats.total,
      base: "bg-muted/60 text-foreground hover:bg-muted",
      active: "bg-muted ring-2 ring-foreground/20",
    },
    {
      key: "elegiveis",
      label: "Elegíveis",
      count: stats.elegiveis,
      base: "bg-success/10 text-success hover:bg-success/20",
      active: "bg-success/20 ring-2 ring-success/30",
    },
    {
      key: "aguardando",
      label: "Aguardando",
      count: stats.aguardando,
      base: "bg-warning/10 text-warning hover:bg-warning/20",
      active: "bg-warning/20 ring-2 ring-warning/30",
    },
    {
      key: "em_prospeccao",
      label: "Em prospecção",
      count: stats.emProspeccao,
      base: "bg-primary/10 text-primary hover:bg-primary/20",
      active: "bg-primary/20 ring-2 ring-primary/30",
    },
  ];

  return (
    <div className="space-y-3">
      {pinnedEmpresaId && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Filtrando empresa:</span>
          <span className="truncate font-medium text-foreground">{pinnedEmpresaNome}</span>
          {onClearPinnedEmpresa && (
            <button
              type="button"
              onClick={onClearPinnedEmpresa}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              aria-label="Limpar filtro de empresa"
            >
              <XCircle className="h-3.5 w-3.5" /> limpar
            </button>
          )}
        </div>
      )}

      {/* Presets + toggle Tabela/Mapa */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {presetChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => applyPreset(chip.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${isPresetActive(chip.key) ? chip.active : chip.base}`}
            >
              {chip.label}
              <span className="font-bold tabular-nums">{chip.count}</span>
            </button>
          ))}
        </div>
        {/* Toggle de visualização. O mapa mostra somente os elegíveis. */}
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("tabela")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              view === "tabela"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Visualização em tabela"
          >
            <TableIcon className="h-3 w-3" />
            Tabela
          </button>
          <button
            type="button"
            onClick={() => setView("mapa")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              view === "mapa"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Mapa — apenas empresas elegíveis"
            disabled={elegiveisIds.length === 0}
          >
            <MapIcon className="h-3 w-3" />
            Mapa
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
              {elegiveisIds.length}
            </Badge>
          </button>
        </div>
      </div>

      {/* Controles de tabela (busca/filtros/ordenação/export) só aparecem no modo tabela */}
      {view === "tabela" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar nome ou CNPJ..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <AcaoEmpresasFilterPopover filters={filters} onChange={setFilters} />
            <Select value={sort} onValueChange={(v) => setSort(v as AcaoEmpresaSort)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                void handleExport();
              }}
              disabled={exporting || filtered.length === 0}
              title="Exportar empresas filtradas para XLSX"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Exportar ({filtered.length})
            </Button>
          </div>

          <AcaoEmpresasFilterChips filters={filters} onChange={setFilters} />
        </>
      )}

      {/* Mapa — só com elegíveis. O painel lateral do mapa traz seus próprios
          filtros (porte/situação/regime/etc.) e busca por nome/CNPJ. */}
      {view === "mapa" && (
        <>
          {elegiveisIds.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Esta ação ainda não tem empresas elegíveis para mostrar no mapa.
            </p>
          ) : loadingMapaEmpresas ? (
            <div className="flex h-[460px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando empresas do mapa…
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-[460px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
                  Carregando mapa…
                </div>
              }
            >
              <EmpresasMapView
                presetEmpresas={mapaEmpresas}
                destaqueIds={destaqueIds}
                onOpenDetail={(emp) => onViewEmpresaId?.(emp.id)}
              />
            </Suspense>
          )}
        </>
      )}

      {/* Tabela */}
      {view === "tabela" &&
        (filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma empresa neste filtro.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="max-h-[460px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Empresa
                    </th>
                    <th className="hidden px-2 py-2 text-left font-medium text-muted-foreground sm:table-cell">
                      Porte · UF
                    </th>
                    <th className="hidden px-2 py-2 text-left font-medium text-muted-foreground md:table-cell">
                      Regime
                    </th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                      Faturamento · Func.
                    </th>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => {
                    const { el, empresa, prosp } = item;
                    return (
                      <tr
                        key={el.id}
                        className={`border-t border-border transition-colors hover:bg-muted/20 ${el.destaque ? "bg-amber-50/50 dark:bg-amber-950/10" : idx % 2 !== 0 ? "bg-muted/5" : ""}`}
                      >
                        <td className="px-3 py-2">
                          {empresa ? (
                            <>
                              <button
                                type="button"
                                className="max-w-[180px] truncate text-left font-medium leading-tight hover:underline focus-visible:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewEmpresaId?.(el.empresa_id);
                                }}
                              >
                                {empresa.nome}
                              </button>
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {empresa.cnpj}
                              </div>
                              {(() => {
                                const ci = sociosByEmpresa?.get(empresa.id);
                                // Só sinaliza quando há um CANAL do sócio (tel/cel/email).
                                // Sócio só-nome (QSA) existe em quase toda empresa = ruído.
                                if (!ci || (ci.comTel === 0 && ci.comEmail === 0)) return null;
                                const Icon =
                                  ci.comCel > 0 ? Smartphone : ci.comTel > 0 ? Phone : Mail;
                                const cls =
                                  ci.comCel > 0
                                    ? "bg-success/10 text-success"
                                    : "bg-info/10 text-info";
                                const txt =
                                  ci.comCel > 0
                                    ? "Sócio c/ celular"
                                    : ci.comTel > 0
                                      ? "Sócio c/ telefone"
                                      : "Sócio c/ email";
                                const tip =
                                  `${ci.socios} sócio${ci.socios > 1 ? "s" : ""} cadastrado${ci.socios > 1 ? "s" : ""}` +
                                  (ci.comTel ? ` · ${ci.comTel} c/ telefone` : "") +
                                  (ci.comEmail ? ` · ${ci.comEmail} c/ email` : "");
                                return (
                                  <Badge
                                    variant="outline"
                                    className={`mt-1 inline-flex w-fit items-center gap-1 border-0 px-1.5 py-0 text-[9px] font-medium ${cls}`}
                                    title={tip}
                                  >
                                    <Icon className="h-2.5 w-2.5 shrink-0" />
                                    {txt}
                                  </Badge>
                                );
                              })()}
                            </>
                          ) : (
                            <>
                              <div className="max-w-[180px] truncate font-medium leading-tight text-destructive">
                                Empresa removida
                              </div>
                              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {el.empresa_id.slice(0, 8)}…
                              </div>
                            </>
                          )}
                        </td>

                        <td className="hidden whitespace-nowrap px-2 py-2 sm:table-cell">
                          <span className="text-muted-foreground">{empresa?.porte ?? "—"}</span>
                          {empresa?.uf && <span className="ml-1 font-medium">{empresa.uf}</span>}
                        </td>

                        <td className="hidden px-2 py-2 md:table-cell">
                          {empresa?.regime_tributario ? (
                            <Badge
                              variant="outline"
                              className={`border text-[10px] ${regimeColor(empresa.regime_tributario)}`}
                            >
                              {regimeShort(empresa.regime_tributario)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {(() => {
                          const fat = faturamentoDisplay(empresa);
                          const func = funcionariosDisplay(empresa);
                          return (
                            <td className="whitespace-nowrap px-2 py-2">
                              {fat || func ? (
                                <div className="flex flex-col gap-0.5 text-[11px] leading-tight">
                                  <span className="text-foreground">{fat ?? "—"}</span>
                                  <span className="text-muted-foreground">{func ?? "—"}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })()}

                        <td className="px-2 py-2">
                          {!el.elegivel ? (
                            <Badge
                              variant="outline"
                              className="border-0 bg-destructive/10 text-[10px] text-destructive"
                            >
                              Não elegível
                            </Badge>
                          ) : prosp ? (
                            <Badge
                              variant="outline"
                              className={`border-0 text-[10px] ${prospStatusColor(prosp.status_prospeccao)}`}
                            >
                              {prosp.status_prospeccao}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-0 bg-warning/10 text-[10px] text-warning"
                            >
                              Aguardando
                            </Badge>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {onUpdateContexto && (
                              <Popover
                                open={ctxOpen === el.id}
                                onOpenChange={(open) => {
                                  if (open) openCtx(el);
                                  else setCtxOpen(null);
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    title="Contexto e contatos"
                                  >
                                    <Star
                                      className={`h-3 w-3 transition-colors ${(el.destaque ?? false) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                                    />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 space-y-2.5 p-3" align="end">
                                  <p className="text-xs font-semibold">Contexto e contatos</p>
                                  <button
                                    type="button"
                                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${ctxDestaque ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400" : "text-muted-foreground hover:bg-muted"}`}
                                    onClick={() => setCtxDestaque((d) => !d)}
                                  >
                                    <Star
                                      className={`h-3.5 w-3.5 shrink-0 ${ctxDestaque ? "fill-amber-400 text-amber-400" : ""}`}
                                    />
                                    {ctxDestaque
                                      ? "Destaque ativo — visível para todos"
                                      : "Marcar como destaque"}
                                  </button>
                                  <Textarea
                                    placeholder="Contatos, contexto, observações..."
                                    className="min-h-[72px] resize-none text-xs"
                                    value={ctxNotas}
                                    onChange={(e) => setCtxNotas(e.target.value)}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 flex-1 text-xs"
                                      onClick={() => setCtxOpen(null)}
                                    >
                                      Cancelar
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 flex-1 gap-1 text-xs"
                                      disabled={ctxLoading}
                                      onClick={() => {
                                        void (async () => {
                                          setCtxLoading(true);
                                          await onUpdateContexto(
                                            el.id,
                                            ctxDestaque,
                                            ctxNotas.trim() || null
                                          );
                                          setCtxLoading(false);
                                          setCtxOpen(null);
                                        })();
                                      }}
                                    >
                                      {ctxLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                                      Salvar
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            {!empresa && onDeleteEleg ? (
                              <Button
                                type="button"
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
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  title="Processo"
                                  onClick={() => onOpenProcesso(el.id)}
                                >
                                  <FileText className="h-3 w-3" />
                                </Button>

                                {el.elegivel && onDesqualificar && (
                                  <Popover
                                    open={desqOpen === el.id}
                                    onOpenChange={(open) => {
                                      setDesqOpen(open ? el.id : null);
                                      if (!open) setDesqMotivo("");
                                    }}
                                  >
                                    <PopoverTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                        title="Marcar como inelegível"
                                      >
                                        <XCircle className="h-3 w-3" />
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 space-y-2 p-3" align="end">
                                      <p className="text-xs font-semibold">
                                        Marcar como inelegível
                                      </p>
                                      <p className="text-[11px] text-muted-foreground">
                                        {empresa?.nome ?? "Esta empresa"} será removida do pool
                                        elegível desta ação.
                                      </p>
                                      <Textarea
                                        placeholder="Motivo (opcional)..."
                                        className="min-h-[60px] resize-none text-xs"
                                        value={desqMotivo}
                                        onChange={(e) => setDesqMotivo(e.target.value)}
                                      />
                                      <div className="flex gap-2">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-7 flex-1 text-xs"
                                          onClick={() => {
                                            setDesqOpen(null);
                                            setDesqMotivo("");
                                          }}
                                        >
                                          Cancelar
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="destructive"
                                          size="sm"
                                          className="h-7 flex-1 gap-1 text-xs"
                                          disabled={desqLoading}
                                          onClick={() => {
                                            void (async () => {
                                              setDesqLoading(true);
                                              await onDesqualificar(el.id, desqMotivo);
                                              setDesqLoading(false);
                                              setDesqOpen(null);
                                              setDesqMotivo("");
                                            })();
                                          }}
                                        >
                                          {desqLoading ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <XCircle className="h-3 w-3" />
                                          )}
                                          Confirmar
                                        </Button>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                )}

                                {el.elegivel && !prosp && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-[10px]"
                                    onClick={() => onProspectar(el.id, el.empresa_id)}
                                  >
                                    <Handshake className="h-3 w-3" />
                                    Prospectar
                                  </Button>
                                )}
                                {el.elegivel && prosp && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-[10px]"
                                    onClick={() => navigate("/prospeccao")}
                                  >
                                    <ArrowUpRight className="h-3 w-3" />
                                    Ver
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
        ))}
    </div>
  );
}
