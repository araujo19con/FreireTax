import { useState, useMemo, useRef, useEffect } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  UF_IBGE_CODE, UF_NOME, UF_LABEL_COORDS,
  STATE_MAP_PROJECTIONS, fetchBrazilStatesGeoJSON, fetchStateMunicipiosGeoJSON,
  REGION_PALETTE,
} from "@/lib/ibgeGeo";
import { normalizeMunicipio } from "@/lib/municipiosBrasil";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ChevronRight, MapPin, Building2, X, Search, Loader2,
  ZoomIn, ZoomOut, Layers, ArrowUpRight,
} from "lucide-react";
import { formatCNPJ } from "@/lib/format";
import type { Empresa, EmpresaFilters } from "@/hooks/useEmpresas";
import { EmpresaFilterPopover, EmpresaFilterChips } from "@/components/EmpresaFilterPopover";
import { applyEmpresaFiltersInMemory } from "@/lib/empresaFiltersInMemory";

interface EmpresasMapViewProps {
  onOpenDetail: (empresa: Empresa) => void;
}

interface PanelState {
  search: string;
  advanced: EmpresaFilters;
}

const BRAZIL_PROJECTION = { center: [-55, -15] as [number, number], scale: 750 };

// Estado de seleção por UF: "all" = estado inteiro; Set<key> = subconjunto de
// municípios (chave = normalizeMunicipio(nome)).
type UFSel = "all" | Set<string>;

function cloneSel(map: Map<string, UFSel>): Map<string, UFSel> {
  const next = new Map<string, UFSel>();
  for (const [k, v] of map) next.set(k, v === "all" ? "all" : new Set(v));
  return next;
}

function isMunSelected(sel: UFSel | undefined, munKey: string): boolean {
  if (!sel) return false;
  if (sel === "all") return true;
  return sel.has(munKey);
}

function ufSelectionStatus(sel: UFSel | undefined): "none" | "all" | "partial" {
  if (!sel) return "none";
  return sel === "all" ? "all" : "partial";
}

// Aplica fill base com modificadores de seleção/hover sobre um heatmap
function getStateFill(opts: {
  ratio: number;
  hovered: boolean;
  status: "none" | "all" | "partial";
}): string {
  const { ratio, hovered, status } = opts;
  if (status === "all") return "hsl(215 80% 38%)";
  if (status === "partial") return "hsl(215 70% 55%)";
  if (hovered) return "hsl(215 65% 62%)";
  if (ratio === 0) return "hsl(215 10% 80%)";
  const l = Math.round(82 - ratio * 50);
  return `hsl(215 55% ${l}%)`;
}

// Fill municipal (drill-down). Quando regiões ON, usa paleta categórica.
function getMunicipalFill(opts: {
  ratio: number;
  hovered: boolean;
  selected: boolean;
  showRegions: boolean;
  regionIdx: number;
}): string {
  const { ratio, hovered, selected, showRegions, regionIdx } = opts;
  if (showRegions) {
    const base = REGION_PALETTE[regionIdx % REGION_PALETTE.length];
    if (selected) return "hsl(215 80% 42%)";
    if (hovered) {
      // Escurece a cor base no hover (reduz luminosidade ~12%)
      return base.replace(/(\d+)%\)$/, (_m, l) => `${Math.max(parseInt(l, 10) - 12, 28)}%)`);
    }
    return base;
  }
  if (selected) return "hsl(215 80% 42%)";
  if (hovered) return "hsl(215 65% 62%)";
  if (ratio === 0) return "hsl(215 10% 80%)";
  const l = Math.round(82 - ratio * 50);
  return `hsl(215 55% ${l}%)`;
}

export function EmpresasMapView({ onOpenDetail }: EmpresasMapViewProps) {
  // Multi-seleção: UF → "all" ou Set de chaves de município normalizadas
  const [ufSelection, setUfSelection]  = useState<Map<string, UFSel>>(new Map());
  // Drill-down independente da seleção: qual UF está sendo "explorada" no mapa
  const [viewUF, setViewUF]            = useState<string | null>(null);
  // Modo regiões dentro do drill-down (microrregiões IBGE)
  const [showRegions, setShowRegions]  = useState(false);

  const [hoveredCode, setHoveredCode]  = useState<string | null>(null);
  const [panelFilters, setPanelFilters] = useState<PanelState>({ search: "", advanced: {} });
  const [tooltip, setTooltip]          = useState<{ name: string; count: number; x: number; y: number } | null>(null);
  const [mapPosition, setMapPosition]  = useState<{ zoom: number; center: [number, number] }>({
    zoom: 1, center: BRAZIL_PROJECTION.center,
  });
  const mapRef = useRef<HTMLDivElement>(null);

  // Reseta zoom ao trocar entre Brasil ↔ drill-down
  useEffect(() => {
    const c: [number, number] = (viewUF && STATE_MAP_PROJECTIONS[viewUF])
      ? STATE_MAP_PROJECTIONS[viewUF].center
      : BRAZIL_PROJECTION.center;
    setMapPosition({ zoom: 1, center: c });
    // Sai do modo regiões ao voltar para Brasil
    if (!viewUF) setShowRegions(false);
  }, [viewUF]);

  // ── Contagem global de empresas por UF (heatmap base, sempre exibido) ──────
  // Paginado para superar o cap de 1000 linhas do PostgREST.
  const { data: ufCounts = {} } = useQuery({
    queryKey: ["empresas-uf-counts"],
    queryFn: async () => {
      const PAGE = 1000;
      const counts: Record<string, number> = {};
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("empresas")
          .select("uf")
          .not("uf", "is", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data ?? [];
        for (const { uf } of batch) {
          if (uf) counts[uf] = (counts[uf] || 0) + 1;
        }
        if (batch.length < PAGE) break;
        from += PAGE;
        if (from > 50_000) break;
      }
      return counts;
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── GeoJSON estados Brasil ─────────────────────────────────────────────────
  const { data: statesGeo, isLoading: loadingStates } = useQuery({
    queryKey: ["ibge-states-geo-v2"],
    queryFn: fetchBrazilStatesGeoJSON,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  // ── GeoJSON municípios da UF em drill-down ─────────────────────────────────
  const viewUFCode = viewUF ? UF_IBGE_CODE[viewUF] : null;
  const { data: munGeo, isLoading: loadingMun } = useQuery({
    queryKey: ["ibge-mun-geo-v3", viewUF],
    queryFn: () => fetchStateMunicipiosGeoJSON(viewUF!, viewUFCode!),
    enabled: !!viewUF && !!viewUFCode,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  // Lookup codarea → { nome, microrregião }
  const munMetaLookup = useMemo(() => {
    const m: Record<string, { nome: string; microId: number | null; microNome: string | null }> = {};
    if (!munGeo) return m;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of ((munGeo as any).features ?? [])) {
      const p = f.properties;
      if (p?.codarea && p?.nome) {
        m[p.codarea] = {
          nome: p.nome,
          microId: p.microrregiao_id ?? null,
          microNome: p.microrregiao_nome ?? null,
        };
      }
    }
    return m;
  }, [munGeo]);

  // Lista plena de municípios da UF em drill-down (para detectar "all")
  const allMunsOfViewUF = useMemo(() => {
    if (!munGeo) return [] as string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feats = ((munGeo as any).features ?? []) as Array<{ properties: { nome?: string } }>;
    return feats.map(f => f.properties?.nome).filter((n): n is string => !!n);
  }, [munGeo]);

  const allMunKeysOfViewUF = useMemo(
    () => new Set(allMunsOfViewUF.map(normalizeMunicipio)),
    [allMunsOfViewUF],
  );

  // Microrregiões da UF em drill-down: id → { nome, municípios normalizados }
  const microregioes = useMemo(() => {
    const m: Record<string, { id: number; nome: string; munKeys: Set<string> }> = {};
    if (!munGeo) return m;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of ((munGeo as any).features ?? [])) {
      const p = f.properties;
      const microId = p?.microrregiao_id;
      if (microId == null) continue;
      const key = String(microId);
      if (!m[key]) m[key] = { id: microId, nome: p.microrregiao_nome ?? `#${microId}`, munKeys: new Set() };
      if (p.nome) m[key].munKeys.add(normalizeMunicipio(p.nome));
    }
    return m;
  }, [munGeo]);

  // Map estável: microId → índice (para escolher cor da paleta)
  const microIdToIndex = useMemo(() => {
    const ordered = Object.values(microregioes).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const m: Record<string, number> = {};
    ordered.forEach((r, i) => { m[String(r.id)] = i; });
    return m;
  }, [microregioes]);

  // ── Empresas das UFs em jogo (selecionadas ∪ drill-down) ───────────────────
  const selectedUFList = useMemo(() => Array.from(ufSelection.keys()).sort(), [ufSelection]);
  const queryUFs = useMemo(() => {
    const set = new Set<string>(selectedUFList);
    if (viewUF) set.add(viewUF);
    return Array.from(set).sort();
  }, [selectedUFList, viewUF]);

  const { data: bulkEmpresas = [], isLoading: loadingEmpresas } = useQuery({
    queryKey: ["empresas-map-bulk", queryUFs.join(",")],
    queryFn: async () => {
      if (queryUFs.length === 0) return [] as Empresa[];
      const PAGE = 1000;
      const all: Empresa[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("empresas").select("*")
          .in("uf", queryUFs)
          .order("nome")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as Empresa[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
        if (from > 50_000) break;
      }
      return all;
    },
    enabled: queryUFs.length > 0,
    staleTime: 60 * 1000,
  });

  // ── Set de empresa_ids com elegibilidade (para filtro "Tem ação vinculada") ─
  const temAcaoAtivo = panelFilters.advanced.temAcao != null;
  const { data: withAcaoIds } = useQuery({
    queryKey: ["elegibilidade-empresa-ids"],
    queryFn: async () => {
      const { data } = await supabase.from("elegibilidade").select("empresa_id");
      return new Set((data ?? []).map((r: { empresa_id: string }) => r.empresa_id));
    },
    enabled: temAcaoAtivo,
    staleTime: 5 * 60 * 1000,
  });

  // Empresas que casam com a multi-seleção (UF + município)
  const empresasSelecionadas = useMemo(() => {
    if (selectedUFList.length === 0) return [] as Empresa[];
    return bulkEmpresas.filter(e => {
      if (!e.uf) return false;
      const sel = ufSelection.get(e.uf);
      if (!sel) return false;
      if (sel === "all") return true;
      const k = e.municipio ? normalizeMunicipio(e.municipio) : "";
      return sel.has(k);
    });
  }, [bulkEmpresas, ufSelection, selectedUFList]);

  // Heatmap de municípios para drill-down: conta empresas da viewUF
  const munCounts = useMemo(() => {
    if (!viewUF) return {} as Record<string, number>;
    const acc: Record<string, number> = {};
    for (const e of bulkEmpresas) {
      if (e.uf === viewUF && e.municipio) {
        const k = normalizeMunicipio(e.municipio);
        acc[k] = (acc[k] || 0) + 1;
      }
    }
    return acc;
  }, [bulkEmpresas, viewUF]);

  // ── Empresas do painel (com search/filtros) ───────────────────────────────
  const panelEmpresasFull = useMemo(() => {
    let list = empresasSelecionadas;
    list = applyEmpresaFiltersInMemory(list, panelFilters.advanced, { withAcaoIds });
    if (panelFilters.search) {
      const s = panelFilters.search.toLowerCase();
      list = list.filter(e =>
        e.nome?.toLowerCase().includes(s) ||
        e.cnpj?.includes(panelFilters.search) ||
        e.razao_social?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [empresasSelecionadas, panelFilters, withAcaoIds]);

  // Cap visual de 200 itens na lista (performance)
  const panelEmpresas = useMemo(() => panelEmpresasFull.slice(0, 200), [panelEmpresasFull]);

  // Escalas de cor
  const maxUF  = useMemo(() => Math.max(1, ...Object.values(ufCounts)),  [ufCounts]);
  const maxMun = useMemo(() => Math.max(1, ...Object.values(munCounts)), [munCounts]);

  // ── Estado da UI ───────────────────────────────────────────────────────────
  const panelOpen     = ufSelection.size > 0;
  const isMapLoading  = viewUF ? loadingMun : loadingStates;
  const currentGeo    = viewUF ? munGeo : statesGeo;
  const projection    = viewUF && STATE_MAP_PROJECTIONS[viewUF]
    ? STATE_MAP_PROJECTIONS[viewUF]
    : BRAZIL_PROJECTION;

  // Resumo do painel
  const totalUFs = ufSelection.size;
  const totalMunicipiosExplicitos = useMemo(() => {
    let count = 0;
    for (const v of ufSelection.values()) {
      if (v !== "all") count += v.size;
    }
    return count;
  }, [ufSelection]);
  const totalUFsAll = useMemo(() => {
    let n = 0;
    for (const v of ufSelection.values()) if (v === "all") n++;
    return n;
  }, [ufSelection]);

  // ── Mutadores de seleção ──────────────────────────────────────────────────
  function toggleUF(uf: string) {
    setUfSelection(prev => {
      const next = cloneSel(prev);
      if (next.has(uf)) next.delete(uf);
      else next.set(uf, "all");
      return next;
    });
    // Limpa busca ao mudar seleção; preserva filtros avançados (útil pra
    // comparar a mesma fatia entre estados)
    setPanelFilters(p => ({ search: "", advanced: p.advanced }));
  }

  function setUFAll(uf: string) {
    setUfSelection(prev => {
      const next = cloneSel(prev);
      next.set(uf, "all");
      return next;
    });
  }

  function removeUF(uf: string) {
    setUfSelection(prev => {
      const next = cloneSel(prev);
      next.delete(uf);
      return next;
    });
  }

  function toggleMunicipio(uf: string, munNome: string) {
    const munKey = normalizeMunicipio(munNome);
    setUfSelection(prev => {
      const next = cloneSel(prev);
      const cur = next.get(uf);
      if (cur === undefined) {
        // UF não está na seleção — adiciona só este município
        next.set(uf, new Set([munKey]));
      } else if (cur === "all") {
        // Explodir: tudo menos este
        const all = new Set(allMunKeysOfViewUF);
        all.delete(munKey);
        if (all.size === 0) next.delete(uf);
        else next.set(uf, all);
      } else {
        if (cur.has(munKey)) {
          cur.delete(munKey);
          if (cur.size === 0) next.delete(uf);
        } else {
          cur.add(munKey);
          // Se completou todos os municípios, vira "all"
          if (allMunKeysOfViewUF.size > 0 && cur.size >= allMunKeysOfViewUF.size) {
            next.set(uf, "all");
          }
        }
      }
      return next;
    });
  }

  function removeMunicipio(uf: string, munKey: string) {
    setUfSelection(prev => {
      const next = cloneSel(prev);
      const cur = next.get(uf);
      if (cur === undefined) return prev;
      if (cur === "all") {
        // Explodir e remover
        const all = new Set(allMunKeysOfViewUF);
        all.delete(munKey);
        if (all.size === 0) next.delete(uf);
        else next.set(uf, all);
      } else {
        cur.delete(munKey);
        if (cur.size === 0) next.delete(uf);
      }
      return next;
    });
  }

  function toggleRegiao(uf: string, microId: string) {
    const region = microregioes[microId];
    if (!region) return;
    const regionKeys = region.munKeys;
    setUfSelection(prev => {
      const next = cloneSel(prev);
      const cur = next.get(uf);

      // Está toda selecionada?
      const allSelected = (() => {
        if (cur === undefined) return false;
        if (cur === "all") return true;
        for (const k of regionKeys) if (!cur.has(k)) return false;
        return true;
      })();

      if (allSelected) {
        // Remove todos da região
        if (cur === "all") {
          const all = new Set(allMunKeysOfViewUF);
          for (const k of regionKeys) all.delete(k);
          if (all.size === 0) next.delete(uf);
          else next.set(uf, all);
        } else if (cur instanceof Set) {
          for (const k of regionKeys) cur.delete(k);
          if (cur.size === 0) next.delete(uf);
        }
      } else {
        if (cur === undefined) {
          next.set(uf, new Set(regionKeys));
        } else if (cur instanceof Set) {
          for (const k of regionKeys) cur.add(k);
          if (allMunKeysOfViewUF.size > 0 && cur.size >= allMunKeysOfViewUF.size) {
            next.set(uf, "all");
          }
        }
        // Se já era "all", mantém
      }
      return next;
    });
  }

  function clearSelection() {
    setUfSelection(new Map());
    setPanelFilters(p => ({ search: "", advanced: p.advanced }));
  }

  // ── Handlers de mapa ──────────────────────────────────────────────────────
  function handleStateClick(geo: { properties: { uf?: string } }) {
    const uf = geo.properties.uf ?? "";
    if (!uf) return;
    toggleUF(uf);
  }

  function handleStateDoubleClick(geo: { properties: { uf?: string } }) {
    const uf = geo.properties.uf ?? "";
    if (!uf) return;
    // Duplo-clique drilla, e garante que o estado está selecionado
    setUFAll(uf);
    setViewUF(uf);
  }

  function handleMunClick(geo: { properties: { codarea: string } }) {
    if (!viewUF) return;
    const meta = munMetaLookup[geo.properties.codarea];
    if (!meta) return;
    if (showRegions) {
      // Modo regiões: click toggla a microrregião inteira
      if (meta.microId != null) toggleRegiao(viewUF, String(meta.microId));
    } else {
      toggleMunicipio(viewUF, meta.nome);
    }
  }

  function handleBack() {
    setViewUF(null);
    setHoveredCode(null);
  }

  function handleMouseEnter(
    e: React.MouseEvent,
    code: string,
    name: string,
    count: number,
  ) {
    setHoveredCode(code);
    if (mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      setTooltip({ name, count, x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (tooltip && mapRef.current) {
      const rect = mapRef.current.getBoundingClientRect();
      setTooltip(t => t ? { ...t, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
    }
  }

  function handleMouseLeave() {
    setHoveredCode(null);
    setTooltip(null);
  }

  function handleZoomIn() {
    const max = viewUF ? 12 : 4;
    setMapPosition(p => ({ ...p, zoom: Math.min(p.zoom * 1.5, max) }));
  }

  function handleZoomOut() {
    setMapPosition(p => ({ ...p, zoom: Math.max(p.zoom / 1.5, 1) }));
  }

  function handleDrillFromChip(uf: string) {
    setViewUF(uf);
  }

  // Loading do painel: spinner enquanto a query bulk está em flight (afeta a
  // lista filtrada). loadingEmpresas é true mesmo quando viewUF mudou.
  const loadingPanel = loadingEmpresas && selectedUFList.length > 0;

  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      style={{ height: "calc(100vh - 220px)", minHeight: 480 }}
    >
      {/* ── Área do mapa ───────────────────────────────────────────────── */}
      <div
        ref={mapRef}
        className={`relative transition-[flex-basis] duration-500 ease-in-out overflow-hidden
          ${panelOpen ? "basis-[54%]" : "basis-full"}`}
        style={{ background: "hsl(215 15% 96%)" }}
      >
        {/* Breadcrumb */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">
          {viewUF && (
            <Button variant="secondary" size="sm" onClick={handleBack}
              className="h-7 gap-1 text-xs shadow-sm"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Voltar
            </Button>
          )}
          <nav className="flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-md
            px-2.5 py-1.5 shadow-sm border border-border/40 text-xs"
          >
            <button
              className={`transition-colors ${viewUF ? "text-muted-foreground hover:text-foreground" : "font-semibold text-foreground"}`}
              onClick={() => setViewUF(null)}
            >
              Brasil
            </button>
            {viewUF && (
              <>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold text-foreground">{UF_NOME[viewUF]}</span>
              </>
            )}
          </nav>

          {/* Toggle regiões — só no drill-down */}
          {viewUF && (
            <Button
              variant={showRegions ? "default" : "secondary"}
              size="sm"
              onClick={() => setShowRegions(v => !v)}
              className="h-7 gap-1 text-xs shadow-sm"
              title="Visualizar microrregiões IBGE — clique numa região para selecionar todos os municípios dela"
            >
              <Layers className="h-3.5 w-3.5" />
              Regiões
            </Button>
          )}
        </div>

        {/* Loading overlay */}
        {isMapLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-white/60 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-30 pointer-events-none bg-white rounded-lg px-3 py-2 shadow-lg
              border border-border/60 text-sm transition-opacity duration-150"
            style={{ left: tooltip.x + 14, top: tooltip.y - 48 }}
          >
            <p className="font-semibold text-foreground leading-tight">{tooltip.name}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {tooltip.count} empresa{tooltip.count !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Mapa SVG */}
        {currentGeo && (
          <ComposableMap
            key={viewUF ?? "brasil"}
            width={800}
            height={560}
            projection="geoMercator"
            projectionConfig={projection}
            style={{ width: "100%", height: "100%" }}
          >
            <ZoomableGroup
              zoom={mapPosition.zoom}
              center={mapPosition.center}
              minZoom={1}
              maxZoom={viewUF ? 12 : 4}
              onMoveEnd={({ coordinates, zoom }) =>
                setMapPosition({ center: coordinates as [number, number], zoom })
              }
            >
            <Geographies geography={currentGeo}>
              {({ geographies }) =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                geographies.map((geo: any) => {
                  const code = geo.properties.codarea as string;
                  const hov  = hoveredCode === code;

                  if (!viewUF) {
                    // ─ Vista Brasil (estados) ─
                    const uf    = (geo.properties.uf as string) ?? "";
                    const ratio = uf ? (ufCounts[uf] || 0) / maxUF : 0;
                    const status = ufSelectionStatus(ufSelection.get(uf));
                    const fill   = getStateFill({ ratio, hovered: hov, status });
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke="white"
                        strokeWidth={0.6}
                        style={{
                          default: { outline: "none" },
                          hover:   { outline: "none", cursor: "pointer" },
                          pressed: { outline: "none" },
                        }}
                        onClick={() => handleStateClick(geo)}
                        onDoubleClick={() => handleStateDoubleClick(geo)}
                        onMouseEnter={(e) => handleMouseEnter(
                          e as unknown as React.MouseEvent, code,
                          UF_NOME[uf] ?? uf,
                          ufCounts[uf] || 0,
                        )}
                        onMouseMove={handleMouseMove as unknown as (e: unknown) => void}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  } else {
                    // ─ Vista municípios (drill-down) ─
                    const meta   = munMetaLookup[code];
                    const nome   = meta?.nome ?? "";
                    const munKey = nome ? normalizeMunicipio(nome) : "";
                    const ratio  = munKey ? (munCounts[munKey] || 0) / maxMun : 0;
                    const sel    = ufSelection.get(viewUF);
                    const selected = isMunSelected(sel, munKey);
                    const microId  = meta?.microId != null ? String(meta.microId) : "0";
                    const regionIdx = microIdToIndex[microId] ?? 0;
                    const fill   = getMunicipalFill({
                      ratio, hovered: hov, selected, showRegions, regionIdx,
                    });
                    // Stroke mais forte no contorno entre microrregiões quando regiões ON
                    const strokeWidth = showRegions ? 0.4 : 0.3;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke="white"
                        strokeWidth={strokeWidth}
                        style={{
                          default: { outline: "none" },
                          hover:   { outline: "none", cursor: "pointer" },
                          pressed: { outline: "none" },
                        }}
                        onClick={() => handleMunClick(geo)}
                        onMouseEnter={(e) => {
                          const tooltipName = showRegions && meta?.microNome
                            ? `${meta.microNome} (microrregião)`
                            : (nome || code);
                          const tooltipCount = showRegions && meta?.microId != null
                            ? Array.from(microregioes[String(meta.microId)]?.munKeys ?? [])
                                .reduce((sum, k) => sum + (munCounts[k] || 0), 0)
                            : (munKey ? (munCounts[munKey] || 0) : 0);
                          handleMouseEnter(
                            e as unknown as React.MouseEvent, code,
                            tooltipName, tooltipCount,
                          );
                        }}
                        onMouseMove={handleMouseMove as unknown as (e: unknown) => void}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  }
                })
              }
            </Geographies>

            {/* Siglas dos estados (apenas na vista Brasil) */}
            {!viewUF &&
              Object.entries(UF_LABEL_COORDS).map(([uf, coords]) => {
                const count  = ufCounts[uf] || 0;
                const ratio  = count / maxUF;
                const status = ufSelectionStatus(ufSelection.get(uf));
                const useWhite = status !== "none" || ratio > 0.35;
                return (
                  <Marker key={uf} coordinates={coords}>
                    <text
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight="700"
                      fill={useWhite ? "white" : "#555"}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {uf}
                    </text>
                  </Marker>
                );
              })}
            </ZoomableGroup>
          </ComposableMap>
        )}

        {/* Legenda */}
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg
          px-3 py-2 border border-border/40 shadow-sm max-w-[260px]"
        >
          {viewUF && showRegions ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Microrregiões — {UF_NOME[viewUF]}
              </p>
              <div className="grid grid-cols-1 gap-0.5 max-h-40 overflow-auto pr-1">
                {Object.values(microregioes)
                  .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
                  .map((r) => {
                    const idx = microIdToIndex[String(r.id)] ?? 0;
                    const totalSel = ufSelection.get(viewUF);
                    const allIn = (() => {
                      if (totalSel === "all") return true;
                      if (!(totalSel instanceof Set)) return false;
                      for (const k of r.munKeys) if (!totalSel.has(k)) return false;
                      return true;
                    })();
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleRegiao(viewUF, String(r.id))}
                        className={`flex items-center gap-1.5 text-[10px] px-1 py-0.5 rounded
                          hover:bg-muted/60 transition-colors text-left
                          ${allIn ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-black/10"
                          style={{ background: REGION_PALETTE[idx % REGION_PALETTE.length] }}
                        />
                        <span className="truncate">{r.nome}</span>
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {viewUF ? "Empresas / município" : "Empresas / estado"}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">0</span>
                <div className="w-20 h-2.5 rounded-sm"
                  style={{ background: "linear-gradient(to right, hsl(215 10% 80%), hsl(215 55% 32%))" }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {viewUF ? maxMun : maxUF}
                </span>
              </div>
              {!viewUF && (
                <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
                  Clique = selecionar · duplo-clique = explorar
                </p>
              )}
              {viewUF && (
                <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
                  Clique no município = selecionar
                </p>
              )}
            </>
          )}
        </div>

        {/* Controles de zoom */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
          <Button
            variant="secondary" size="icon" className="h-7 w-7 shadow-sm"
            onClick={handleZoomIn}
            aria-label="Ampliar"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary" size="icon" className="h-7 w-7 shadow-sm"
            onClick={handleZoomOut}
            disabled={mapPosition.zoom <= 1}
            aria-label="Reduzir"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          {mapPosition.zoom > 1.05 && (
            <Button
              variant="secondary" size="icon" className="h-7 w-7 shadow-sm"
              onClick={() => {
                const c: [number, number] = (viewUF && STATE_MAP_PROJECTIONS[viewUF])
                  ? STATE_MAP_PROJECTIONS[viewUF].center
                  : BRAZIL_PROJECTION.center;
                setMapPosition({ zoom: 1, center: c });
              }}
              aria-label="Resetar zoom"
              title="Resetar zoom"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Hint quando mapa vazio */}
        {!currentGeo && !isMapLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">Carregando mapa…</p>
          </div>
        )}
      </div>

      {/* ── Painel lateral ─────────────────────────────────────────────── */}
      <div
        className={`flex flex-col bg-card border-l border-border overflow-hidden
          transition-[flex-basis,opacity] duration-500 ease-in-out
          ${panelOpen ? "basis-[46%] opacity-100" : "basis-0 opacity-0"}`}
      >
        {panelOpen && (
          <>
            {/* Cabeçalho */}
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg leading-tight truncate">
                    {totalUFs === 1
                      ? UF_NOME[selectedUFList[0]]
                      : `${totalUFs} estados selecionados`}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalUFsAll === totalUFs
                      ? totalUFs === 1 ? "Estado inteiro" : "Todos os municípios"
                      : `${totalUFsAll} estado(s) inteiros · ${totalMunicipiosExplicitos} município(s) selecionado(s)`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 mt-0.5"
                  onClick={clearSelection}
                  title="Limpar seleção"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2 mt-2.5">
                <Badge variant="secondary" className="text-xs gap-1">
                  <Building2 className="h-3 w-3" />
                  {loadingPanel
                    ? "carregando…"
                    : `${panelEmpresasFull.length} empresa${panelEmpresasFull.length !== 1 ? "s" : ""}`
                  }
                </Badge>
              </div>

              {/* Chips de seleção */}
              <div className="mt-2.5 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                {selectedUFList.map(uf => {
                  const sel = ufSelection.get(uf);
                  const allIn = sel === "all";
                  return (
                    <div key={uf} className="inline-flex items-stretch rounded-md border border-border
                      bg-muted/40 hover:bg-muted/70 transition-colors text-xs overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => handleDrillFromChip(uf)}
                        className="px-2 py-1 inline-flex items-center gap-1 hover:bg-muted/90"
                        title={`Explorar municípios de ${UF_NOME[uf]}`}
                      >
                        <MapPin className="h-3 w-3" />
                        <span className="font-semibold">{uf}</span>
                        <span className="text-muted-foreground">
                          {allIn ? "todos" : `${(sel as Set<string>).size} mun.`}
                        </span>
                        <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUF(uf)}
                        className="px-1.5 border-l border-border/60 hover:bg-destructive/10 hover:text-destructive"
                        title="Remover este estado da seleção"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}

                {/* Chips de municípios explícitos da viewUF (quando drillado) */}
                {viewUF && ufSelection.get(viewUF) instanceof Set && (() => {
                  const set = ufSelection.get(viewUF) as Set<string>;
                  const ordered = Array.from(set).sort();
                  return ordered.slice(0, 12).map(munKey => {
                    // Tenta achar o nome legível
                    const meta = Object.values(munMetaLookup).find(m => normalizeMunicipio(m.nome) === munKey);
                    const label = meta?.nome ?? munKey;
                    return (
                      <div key={`${viewUF}:${munKey}`} className="inline-flex items-stretch rounded-md
                        border border-primary/30 bg-primary/5 text-xs overflow-hidden"
                      >
                        <span className="px-2 py-1 inline-flex items-center gap-1">
                          <span className="text-muted-foreground">{viewUF}</span>
                          <span className="font-medium">{label}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeMunicipio(viewUF, munKey)}
                          className="px-1.5 border-l border-primary/20 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  });
                })()}

                {viewUF && ufSelection.get(viewUF) instanceof Set
                  && (ufSelection.get(viewUF) as Set<string>).size > 12 && (
                  <span className="text-[10px] text-muted-foreground self-center">
                    +{(ufSelection.get(viewUF) as Set<string>).size - 12} mun.
                  </span>
                )}
              </div>
            </div>

            {/* Filtros */}
            <div className="px-4 py-3 border-b border-border space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Buscar empresa…"
                    value={panelFilters.search}
                    onChange={(e) => setPanelFilters(f => ({ ...f, search: e.target.value }))}
                    className="pl-8 h-8 text-sm bg-background"
                  />
                  {panelFilters.search && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setPanelFilters(f => ({ ...f, search: "" }))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <EmpresaFilterPopover
                  excludeLocation
                  filters={panelFilters.advanced}
                  onChange={(f) => setPanelFilters(p => ({ ...p, advanced: f }))}
                />
              </div>
              <EmpresaFilterChips
                excludeLocation
                filters={panelFilters.advanced}
                onChange={(f) => setPanelFilters(p => ({ ...p, advanced: f }))}
              />
            </div>

            {/* Lista de empresas */}
            <ScrollArea className="flex-1">
              {loadingPanel ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-[68px] w-full rounded-lg" />
                  ))}
                </div>
              ) : panelEmpresas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-52 text-muted-foreground gap-2">
                  <Building2 className="h-10 w-10 opacity-20" />
                  <p className="text-sm font-medium">Nenhuma empresa encontrada</p>
                  <p className="text-xs">Ajuste os filtros ou a seleção no mapa</p>
                </div>
              ) : (
                <div>
                  {panelEmpresas.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-muted/60 active:bg-muted
                        transition-colors border-b border-border/60 last:border-0
                        focus-visible:outline-none focus-visible:bg-muted/60"
                      onClick={() => onOpenDetail(emp)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm leading-tight truncate">{emp.nome}</p>
                          {emp.cnpj && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                              {formatCNPJ(emp.cnpj)}
                            </p>
                          )}
                          {emp.municipio && (
                            <p className="text-[11px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {emp.municipio}{emp.uf ? ` / ${emp.uf}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
                          {emp.situacao_cadastral && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-4 leading-none ${
                                emp.situacao_cadastral === "ATIVA"
                                  ? "border-green-500/40 text-green-700 bg-green-50"
                                  : "border-destructive/40 text-destructive bg-destructive/5"
                              }`}
                            >
                              {emp.situacao_cadastral}
                            </Badge>
                          )}
                          {emp.porte && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 leading-none">
                              {emp.porte}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  {panelEmpresasFull.length > 200 && (
                    <p className="text-center text-xs text-muted-foreground py-4 px-4">
                      Mostrando 200 de {panelEmpresasFull.length}. Use os filtros para refinar.
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}
