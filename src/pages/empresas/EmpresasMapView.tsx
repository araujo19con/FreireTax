import { useState, useMemo, useRef } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  UF_IBGE_CODE, UF_NOME, UF_LABEL_COORDS,
  STATE_MAP_PROJECTIONS, fetchBrazilStatesGeoJSON, fetchStateMunicipiosGeoJSON,
} from "@/lib/ibgeGeo";
import { normalizeMunicipio } from "@/lib/municipiosBrasil";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, MapPin, Building2, X, Search, Loader2 } from "lucide-react";
import { formatCNPJ } from "@/lib/format";
import type { Empresa } from "@/hooks/useEmpresas";

interface EmpresasMapViewProps {
  onOpenDetail: (empresa: Empresa) => void;
}

interface PanelFilters {
  search: string;
  situacao: string;
  porte: string;
}

const BRAZIL_PROJECTION = { center: [-55, -15] as [number, number], scale: 750 };

// Gradiente de cor por densidade de empresas
function getHeatColor(ratio: number, hovered: boolean, selected: boolean): string {
  if (selected) return "hsl(215 80% 55%)";
  if (hovered)  return "hsl(215 65% 62%)";
  if (ratio === 0) return "hsl(215 10% 80%)";
  const l = Math.round(82 - ratio * 50); // 82% → 32%
  return `hsl(215 55% ${l}%)`;
}

export function EmpresasMapView({ onOpenDetail }: EmpresasMapViewProps) {
  const [selectedUF, setSelectedUF]         = useState<string | null>(null);
  const [selectedMunNome, setSelectedMunNome] = useState<string | null>(null);
  const [hoveredCode, setHoveredCode]        = useState<string | null>(null);
  const [panelFilters, setPanelFilters]      = useState<PanelFilters>({ search: "", situacao: "", porte: "" });
  const [tooltip, setTooltip]                = useState<{ name: string; count: number; x: number; y: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  // ── Contagem de empresas por UF (colore os estados) ────────────────────────
  const { data: ufCounts = {} } = useQuery({
    queryKey: ["empresas-uf-counts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas")
        .select("uf")
        .not("uf", "is", null)
        .limit(100000);
      return (data ?? []).reduce((acc: Record<string, number>, { uf }) => {
        if (uf) acc[uf] = (acc[uf] || 0) + 1;
        return acc;
      }, {});
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── GeoJSON estados Brasil ──────────────────────────────────────────────────
  const { data: statesGeo, isLoading: loadingStates } = useQuery({
    queryKey: ["ibge-states-geo-v2"],
    queryFn: fetchBrazilStatesGeoJSON,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  // ── GeoJSON municípios do estado selecionado (nomes + boundaries combinados) ──
  const selectedUFCode = selectedUF ? UF_IBGE_CODE[selectedUF] : null;
  const { data: munGeo, isLoading: loadingMun } = useQuery({
    queryKey: ["ibge-mun-geo-v2", selectedUF],
    queryFn: () => fetchStateMunicipiosGeoJSON(selectedUF!, selectedUFCode!),
    enabled: !!selectedUF && !!selectedUFCode,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  // Deriva lookup codarea → nome diretamente do geo já combinado
  const munNomeLookup = useMemo(() => {
    const m: Record<string, string> = {};
    if (!munGeo) return m;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of ((munGeo as any).features ?? [])) {
      if (f.properties?.codarea && f.properties?.nome) {
        m[f.properties.codarea] = f.properties.nome;
      }
    }
    return m;
  }, [munGeo]);

  // ── Empresas do estado selecionado (base para painel e heatmap municipal) ───
  const { data: ufEmpresas = [], isLoading: loadingUfEmpresas } = useQuery({
    queryKey: ["empresas-map-uf", selectedUF],
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas").select("*")
        .eq("uf", selectedUF!).order("nome");
      return (data ?? []) as Empresa[];
    },
    enabled: !!selectedUF,
    staleTime: 60 * 1000,
  });

  // Contagem por município normalizado (para colorir o mapa de municípios)
  const munCounts = useMemo(() => {
    return ufEmpresas.reduce((acc: Record<string, number>, e) => {
      if (e.municipio) {
        const k = normalizeMunicipio(e.municipio);
        acc[k] = (acc[k] || 0) + 1;
      }
      return acc;
    }, {});
  }, [ufEmpresas]);

  // ── Empresas filtradas para o painel ───────────────────────────────────────
  const panelEmpresas = useMemo(() => {
    let list = [...ufEmpresas];
    if (selectedMunNome) {
      const norm = normalizeMunicipio(selectedMunNome);
      list = list.filter(e => normalizeMunicipio(e.municipio) === norm);
    }
    if (panelFilters.situacao) list = list.filter(e => e.situacao_cadastral === panelFilters.situacao);
    if (panelFilters.porte)    list = list.filter(e => e.porte === panelFilters.porte);
    if (panelFilters.search) {
      const s = panelFilters.search.toLowerCase();
      list = list.filter(e =>
        e.nome?.toLowerCase().includes(s) ||
        e.cnpj?.includes(panelFilters.search) ||
        e.razao_social?.toLowerCase().includes(s)
      );
    }
    return list.slice(0, 200);
  }, [ufEmpresas, selectedMunNome, panelFilters]);

  // ── Escalas de cor ─────────────────────────────────────────────────────────
  const maxUF  = useMemo(() => Math.max(1, ...Object.values(ufCounts)),  [ufCounts]);
  const maxMun = useMemo(() => Math.max(1, ...Object.values(munCounts)), [munCounts]);

  // ── Estado da UI ──────────────────────────────────────────────────────────
  const panelOpen     = !!selectedUF;
  const isMapLoading  = selectedUF ? (loadingMun || loadingUfEmpresas) : loadingStates;
  const currentGeo    = selectedUF ? munGeo : statesGeo;
  const projection    = selectedUF && STATE_MAP_PROJECTIONS[selectedUF]
    ? STATE_MAP_PROJECTIONS[selectedUF]
    : BRAZIL_PROJECTION;

  const panelTitle    = selectedMunNome || (selectedUF ? UF_NOME[selectedUF] : "");
  const panelSubtitle = selectedMunNome ? UF_NOME[selectedUF!] : "Brasil";

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleStateClick(geo: { properties: { codarea: string; uf?: string } }) {
    const uf = geo.properties.uf ?? "";
    if (!uf) return;
    setSelectedUF(uf);
    setSelectedMunNome(null);
    setPanelFilters({ search: "", situacao: "", porte: "" });
  }

  function handleMunClick(geo: { properties: { codarea: string } }) {
    const nome = munNomeLookup[geo.properties.codarea];
    if (!nome) return;
    setSelectedMunNome(prev => prev === nome ? null : nome);
    setPanelFilters({ search: "", situacao: "", porte: "" });
  }

  function handleBack() {
    if (selectedMunNome) {
      setSelectedMunNome(null);
    } else {
      setSelectedUF(null);
      setSelectedMunNome(null);
    }
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
          {selectedUF && (
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
              className={`transition-colors ${selectedUF ? "text-muted-foreground hover:text-foreground" : "font-semibold text-foreground"}`}
              onClick={() => { setSelectedUF(null); setSelectedMunNome(null); }}
            >
              Brasil
            </button>
            {selectedUF && (
              <>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  className={`transition-colors ${selectedMunNome ? "text-muted-foreground hover:text-foreground" : "font-semibold text-foreground"}`}
                  onClick={() => setSelectedMunNome(null)}
                >
                  {UF_NOME[selectedUF]}
                </button>
              </>
            )}
            {selectedMunNome && (
              <>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-semibold text-foreground">{selectedMunNome}</span>
              </>
            )}
          </nav>
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
            key={selectedUF ?? "brasil"}
            width={800}
            height={560}
            projection="geoMercator"
            projectionConfig={projection}
            style={{ width: "100%", height: "100%" }}
          >
            <Geographies geography={currentGeo}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const code = geo.properties.codarea as string;
                  const hov  = hoveredCode === code;

                  if (!selectedUF) {
                    // ─ Vista estados ─
                    const uf    = (geo.properties.uf as string) ?? code;
                    const ratio = uf ? (ufCounts[uf] || 0) / maxUF : 0;
                    const sel   = selectedUF === uf;
                    const fill  = getHeatColor(ratio, hov, sel);
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
                    // ─ Vista municípios ─
                    const nome  = munNomeLookup[code];
                    const norm  = nome ? normalizeMunicipio(nome) : "";
                    const ratio = norm ? (munCounts[norm] || 0) / maxMun : 0;
                    const sel   = nome === selectedMunNome;
                    const fill  = getHeatColor(ratio, hov, sel);
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke="white"
                        strokeWidth={0.3}
                        style={{
                          default: { outline: "none" },
                          hover:   { outline: "none", cursor: "pointer" },
                          pressed: { outline: "none" },
                        }}
                        onClick={() => handleMunClick(geo)}
                        onMouseEnter={(e) => handleMouseEnter(
                          e as unknown as React.MouseEvent, code,
                          nome || code,
                          norm ? (munCounts[norm] || 0) : 0,
                        )}
                        onMouseMove={handleMouseMove as unknown as (e: unknown) => void}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  }
                })
              }
            </Geographies>

            {/* Siglas dos estados (apenas na vista Brasil, só para estados com empresas) */}
            {!selectedUF &&
              Object.entries(UF_LABEL_COORDS).map(([uf, coords]) => {
                const count = ufCounts[uf] || 0;
                const ratio = count / maxUF;
                return (
                  <Marker key={uf} coordinates={coords}>
                    <text
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight="700"
                      fill={ratio > 0.35 ? "white" : "#555"}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {uf}
                    </text>
                  </Marker>
                );
              })}
          </ComposableMap>
        )}

        {/* Legenda */}
        <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg
          px-3 py-2 border border-border/40 shadow-sm"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            {selectedUF ? "Empresas / município" : "Empresas / estado"}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">0</span>
            <div className="w-20 h-2.5 rounded-sm"
              style={{ background: "linear-gradient(to right, hsl(215 10% 80%), hsl(215 55% 32%))" }}
            />
            <span className="text-[10px] text-muted-foreground">
              {selectedUF ? maxMun : maxUF}
            </span>
          </div>
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
                  <h3 className="font-semibold text-lg leading-tight truncate">{panelTitle}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{panelSubtitle}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 mt-0.5"
                  onClick={() => { setSelectedUF(null); setSelectedMunNome(null); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <Badge variant="secondary" className="text-xs gap-1">
                  <Building2 className="h-3 w-3" />
                  {loadingUfEmpresas
                    ? "carregando…"
                    : `${panelEmpresas.length} empresa${panelEmpresas.length !== 1 ? "s" : ""}`
                  }
                </Badge>
                {selectedUF && !selectedMunNome && (
                  <Badge variant="outline" className="text-xs">
                    <MapPin className="h-2.5 w-2.5 mr-1" />
                    {selectedUF}
                  </Badge>
                )}
              </div>
            </div>

            {/* Filtros */}
            <div className="px-4 py-3 border-b border-border space-y-2 bg-muted/30">
              <div className="relative">
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
              <div className="flex gap-2">
                <Select
                  value={panelFilters.situacao || "all"}
                  onValueChange={(v) => setPanelFilters(f => ({ ...f, situacao: v === "all" ? "" : v }))}
                >
                  <SelectTrigger className="h-8 text-xs flex-1 bg-background">
                    <SelectValue placeholder="Situação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas situações</SelectItem>
                    <SelectItem value="ATIVA">Ativa</SelectItem>
                    <SelectItem value="BAIXADA">Baixada</SelectItem>
                    <SelectItem value="INAPTA">Inapta</SelectItem>
                    <SelectItem value="SUSPENSA">Suspensa</SelectItem>
                    <SelectItem value="NULA">Nula</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={panelFilters.porte || "all"}
                  onValueChange={(v) => setPanelFilters(f => ({ ...f, porte: v === "all" ? "" : v }))}
                >
                  <SelectTrigger className="h-8 text-xs flex-1 bg-background">
                    <SelectValue placeholder="Porte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos portes</SelectItem>
                    <SelectItem value="MEI">MEI</SelectItem>
                    <SelectItem value="ME">ME</SelectItem>
                    <SelectItem value="EPP">EPP</SelectItem>
                    <SelectItem value="DEMAIS">Demais</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Lista de empresas */}
            <ScrollArea className="flex-1">
              {loadingUfEmpresas ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-[68px] w-full rounded-lg" />
                  ))}
                </div>
              ) : panelEmpresas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-52 text-muted-foreground gap-2">
                  <Building2 className="h-10 w-10 opacity-20" />
                  <p className="text-sm font-medium">Nenhuma empresa encontrada</p>
                  <p className="text-xs">
                    {selectedMunNome ? "Tente selecionar outro município" : "Ajuste os filtros acima"}
                  </p>
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
                          {!selectedMunNome && emp.municipio && (
                            <p className="text-[11px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {emp.municipio}
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
                  {panelEmpresas.length >= 200 && (
                    <p className="text-center text-xs text-muted-foreground py-4 px-4">
                      Mostrando 200 registros. Use os filtros para refinar.
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
