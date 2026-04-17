import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2, Filter, MapPin, FileText, Search, RefreshCw,
  CheckCircle2, XCircle, TrendingUp, Users, Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";

type Empresa = Database["public"]["Tables"]["empresas"]["Row"];

function formatBRL(v: number) {
  if (!v) return "R$ 0";
  if (v >= 1_000_000_000) return `R$ ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

// Cores temáticas (usam vars do theme atual: preto + bege + semantic)
const CHART_COLORS = [
  "hsl(var(--primary))",          // preto
  "hsl(var(--info))",
  "hsl(var(--warning))",
  "hsl(var(--success))",
  "hsl(var(--destructive))",
  "hsl(var(--accent-foreground))", // cinza escuro
  "hsl(var(--muted-foreground))",
  "hsl(28 16% 60%)",               // bege escuro
];

const PORTE_LABELS: Record<string, string> = {
  "MEI": "MEI",
  "ME": "Microempresa",
  "EPP": "Pequeno Porte",
  "DEMAIS": "Médio/Grande",
  "NAO_INFORMADO": "Não informado",
};

const SITUACAO_LABELS: Record<string, string> = {
  ATIVA: "Ativa",
  BAIXADA: "Baixada",
  SUSPENSA: "Suspensa",
  INAPTA: "Inapta",
  NULA: "Nula",
};

interface Filtros {
  uf: string[];
  porte: string[];
  situacao: string[];
  regime: "all" | "simples" | "mei" | "outros";
  search: string;
}

export default function AnaliseRFB() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState<Filtros>({
    uf: [],
    porte: [],
    situacao: [],
    regime: "all",
    search: "",
  });

  const fetchEmpresas = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("empresas")
      .select("*")
      .order("valor_potencial_total", { ascending: false, nullsFirst: false });
    if (error) toast.error("Erro ao carregar empresas");
    setEmpresas((data as Empresa[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchEmpresas(); }, []);

  // ========= FILTROS =========
  const filtered = useMemo(() => {
    const s = filtros.search.trim().toLowerCase();
    return empresas.filter((e) => {
      const any = e as any;
      if (filtros.uf.length > 0 && !filtros.uf.includes(any.uf ?? "")) return false;
      if (filtros.porte.length > 0 && !filtros.porte.includes(any.porte ?? "NAO_INFORMADO")) return false;
      if (filtros.situacao.length > 0 && !filtros.situacao.includes(any.situacao_cadastral ?? "")) return false;
      if (filtros.regime === "simples" && !any.opcao_simples) return false;
      if (filtros.regime === "mei" && !any.opcao_mei) return false;
      if (filtros.regime === "outros" && (any.opcao_simples || any.opcao_mei)) return false;
      if (s && !(
        e.nome.toLowerCase().includes(s) ||
        e.cnpj.includes(s) ||
        (any.razao_social ?? "").toLowerCase().includes(s) ||
        (any.cnae_principal_desc ?? "").toLowerCase().includes(s) ||
        (any.municipio ?? "").toLowerCase().includes(s)
      )) return false;
      return true;
    });
  }, [empresas, filtros]);

  // ========= AGREGAÇÕES =========
  const agg = useMemo(() => {
    const base = filtered;

    const porUF: Record<string, number> = {};
    const porPorte: Record<string, number> = {};
    const porSituacao: Record<string, number> = {};
    const porCNAE: Record<string, number> = {};
    const porRegime = { simples: 0, mei: 0, outros: 0 };
    const porStatusCRM: Record<string, number> = {};

    let capitalTotal = 0;
    let valorPotencialTotal = 0;
    let comQSA = 0;
    let enriquecidas = 0;
    let semEnriquecer = 0;
    let comErro = 0;

    for (const e of base) {
      const any = e as any;

      if (any.receita_atualizada_em) enriquecidas++;
      else semEnriquecer++;
      if (any.receita_erro) comErro++;

      if (any.uf) porUF[any.uf] = (porUF[any.uf] ?? 0) + 1;

      const porte = any.porte ?? "NAO_INFORMADO";
      porPorte[porte] = (porPorte[porte] ?? 0) + 1;

      if (any.situacao_cadastral) {
        porSituacao[any.situacao_cadastral] = (porSituacao[any.situacao_cadastral] ?? 0) + 1;
      }

      const cnaeDesc = any.cnae_principal_desc;
      if (cnaeDesc) porCNAE[cnaeDesc] = (porCNAE[cnaeDesc] ?? 0) + 1;

      if (any.opcao_mei) porRegime.mei++;
      else if (any.opcao_simples) porRegime.simples++;
      else porRegime.outros++;

      porStatusCRM[e.status] = (porStatusCRM[e.status] ?? 0) + 1;

      capitalTotal += Number(any.capital_social ?? 0);
      valorPotencialTotal += Number(any.valor_potencial_total ?? 0);
      if (Array.isArray(any.qsa) && any.qsa.length > 0) comQSA++;
    }

    // converte pra arrays ordenados para charts
    const toSortedArray = (obj: Record<string, number>) =>
      Object.entries(obj).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value);

    return {
      total: base.length,
      enriquecidas, semEnriquecer, comErro,
      capitalTotal, valorPotencialTotal, comQSA,
      capitalMedio: enriquecidas > 0 ? capitalTotal / enriquecidas : 0,
      porUF: toSortedArray(porUF).slice(0, 10),
      porPorte: toSortedArray(porPorte),
      porSituacao: toSortedArray(porSituacao),
      porCNAE: toSortedArray(porCNAE).slice(0, 10),
      porRegime: [
        { name: "Simples Nacional", value: porRegime.simples },
        { name: "MEI",              value: porRegime.mei },
        { name: "Lucro Presumido/Real", value: porRegime.outros },
      ],
      porStatusCRM: toSortedArray(porStatusCRM),
    };
  }, [filtered]);

  // ========= OPÇÕES PRA CHIPS =========
  const opcoes = useMemo(() => {
    const ufs = new Set<string>();
    const portes = new Set<string>();
    const situacoes = new Set<string>();
    for (const e of empresas) {
      const any = e as any;
      if (any.uf) ufs.add(any.uf);
      if (any.porte) portes.add(any.porte);
      if (any.situacao_cadastral) situacoes.add(any.situacao_cadastral);
    }
    return {
      ufs: [...ufs].sort(),
      portes: [...portes].sort(),
      situacoes: [...situacoes].sort(),
    };
  }, [empresas]);

  const toggleFiltro = (key: "uf" | "porte" | "situacao", v: string) => {
    setFiltros((curr) => ({
      ...curr,
      [key]: curr[key].includes(v) ? curr[key].filter((x) => x !== v) : [...curr[key], v],
    }));
  };

  const limparFiltros = () => {
    setFiltros({ uf: [], porte: [], situacao: [], regime: "all", search: "" });
  };

  const hasFiltros =
    filtros.uf.length > 0 || filtros.porte.length > 0 || filtros.situacao.length > 0 ||
    filtros.regime !== "all" || filtros.search.trim() !== "";

  const exportarFiltradas = () => {
    if (filtered.length === 0) return toast.error("Nenhuma empresa filtrada para exportar");
    const rows = filtered.map((e) => {
      const any = e as any;
      return {
        Nome: e.nome,
        CNPJ: e.cnpj,
        "Razão Social": any.razao_social ?? "",
        "Nome Fantasia": any.nome_fantasia ?? "",
        "Status CRM": e.status,
        Situação: any.situacao_cadastral ?? "",
        Porte: any.porte ?? "",
        Regime: any.opcao_mei ? "MEI" : any.opcao_simples ? "Simples" : "Lucro Presumido/Real",
        UF: any.uf ?? "",
        Município: any.municipio ?? "",
        CEP: any.cep ?? "",
        CNAE: any.cnae_principal ?? "",
        "CNAE Descrição": any.cnae_principal_desc ?? "",
        "Capital Social": any.capital_social ?? 0,
        "Data Abertura": any.data_abertura ?? "",
        "Natureza Jurídica": any.natureza_juridica ?? "",
        "Nº Sócios (QSA)": Array.isArray(any.qsa) ? any.qsa.length : 0,
        Telefone: any.telefone_receita ?? "",
        Email: any.email_receita ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Empresas RFB");
    XLSX.writeFile(wb, `analise-rfb-${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success(`${rows.length} empresas exportadas`);
  };

  if (loading) return <LoadingState variant="page" />;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Análise RFB"
        description="Distribuições, filtros e scoring de empresas pelos dados da Receita Federal"
        icon={<Filter className="h-7 w-7" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportarFiltradas} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar {filtered.length}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchEmpresas}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar
            </Button>
          </>
        }
      />

      {empresas.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-10 w-10" />}
          title="Nenhuma empresa"
          description="Cadastre empresas na aba Empresas para ver análises aqui."
        />
      ) : (
        <>
          {/* KPIs top */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="shadow-card">
              <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Filtradas</CardTitle>
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-heading font-bold tabular-nums">{agg.total}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  de {empresas.length} totais
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Capital total</CardTitle>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-heading font-bold tabular-nums">{formatBRL(agg.capitalTotal)}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  média {formatBRL(agg.capitalMedio)}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Enriquecidas</CardTitle>
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-heading font-bold tabular-nums text-success">{agg.enriquecidas}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {agg.comErro > 0 && <span className="text-destructive">{agg.comErro} erro · </span>}
                  {agg.semEnriquecer > 0 && <>{agg.semEnriquecer} pendente</>}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Com QSA</CardTitle>
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="text-2xl font-heading font-bold tabular-nums">{agg.comQSA}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  decisores mapeados
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filtros */}
          <Card className="p-4 shadow-card space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Filter className="h-4 w-4" />Filtros
              </h3>
              {hasFiltros && (
                <Button variant="ghost" size="sm" onClick={limparFiltros}>
                  <XCircle className="mr-1.5 h-3 w-3" />Limpar filtros
                </Button>
              )}
            </div>

            {/* Busca */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-9 h-9 text-sm"
                placeholder="Buscar por nome, razão social, CNPJ, CNAE, município..."
                value={filtros.search}
                onChange={(e) => setFiltros((f) => ({ ...f, search: e.target.value }))}
              />
            </div>

            {/* UFs */}
            {opcoes.ufs.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <MapPin className="h-3 w-3" />UF
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {opcoes.ufs.map((uf) => {
                    const active = filtros.uf.includes(uf);
                    const count = empresas.filter((e) => (e as any).uf === uf).length;
                    return (
                      <button
                        key={uf} type="button"
                        onClick={() => toggleFiltro("uf", uf)}
                        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {active && "✓ "}{uf} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Portes */}
            {opcoes.portes.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <Building2 className="h-3 w-3" />Porte
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {opcoes.portes.map((p) => {
                    const active = filtros.porte.includes(p);
                    const count = empresas.filter((e) => (e as any).porte === p).length;
                    return (
                      <button
                        key={p} type="button"
                        onClick={() => toggleFiltro("porte", p)}
                        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {active && "✓ "}{PORTE_LABELS[p] ?? p} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Situação */}
            {opcoes.situacoes.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Situação RFB</p>
                <div className="flex flex-wrap gap-1.5">
                  {opcoes.situacoes.map((s) => {
                    const active = filtros.situacao.includes(s);
                    const count = empresas.filter((e) => (e as any).situacao_cadastral === s).length;
                    const danger = s === "BAIXADA" || s === "INAPTA" || s === "NULA";
                    return (
                      <button
                        key={s} type="button"
                        onClick={() => toggleFiltro("situacao", s)}
                        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                          active
                            ? danger
                              ? "bg-destructive text-destructive-foreground border-destructive"
                              : "bg-success text-success-foreground border-success"
                            : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {active && "✓ "}{SITUACAO_LABELS[s] ?? s} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regime */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Regime tributário</p>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "simples", "mei", "outros"] as const).map((r) => (
                  <button
                    key={r} type="button"
                    onClick={() => setFiltros((f) => ({ ...f, regime: r }))}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                      filtros.regime === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {r === "all" ? "Todos" : r === "simples" ? "Simples Nacional" : r === "mei" ? "MEI" : "Lucro Presumido/Real"}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* UF bar */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />Top 10 UFs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={agg.porUF} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={40} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Porte pie */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4" />Distribuição por Porte
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={agg.porPorte.map((p) => ({ ...p, name: PORTE_LABELS[p.name] ?? p.name }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(entry) => `${entry.name}: ${entry.value}`}
                      labelLine={false}
                    >
                      {agg.porPorte.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Regime bar */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Regime Tributário</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={agg.porRegime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {agg.porRegime.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Situação pie */}
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Situação Cadastral</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={agg.porSituacao.map((p) => ({ ...p, name: SITUACAO_LABELS[p.name] ?? p.name }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={(e) => `${e.name}: ${e.value}`}
                      labelLine={false}
                    >
                      {agg.porSituacao.map((p, i) => {
                        const danger = p.name === "BAIXADA" || p.name === "INAPTA" || p.name === "NULA";
                        return (
                          <Cell
                            key={i}
                            fill={p.name === "ATIVA" ? "hsl(var(--success))" : danger ? "hsl(var(--destructive))" : "hsl(var(--warning))"}
                          />
                        );
                      })}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* CNAE chart */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />Top 10 CNAEs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {agg.porCNAE.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Sem dados de CNAE nas empresas filtradas.</p>
              ) : (
                <div className="space-y-1.5">
                  {agg.porCNAE.map((c, i) => {
                    const pct = (c.value / Math.max(1, agg.total)) * 100;
                    return (
                      <div key={c.name} className="group">
                        <div className="flex items-center justify-between mb-0.5 text-xs">
                          <span className="line-clamp-1 flex-1">{c.name}</span>
                          <span className="text-muted-foreground tabular-nums ml-2">
                            {c.value} <span className="text-[10px]">({pct.toFixed(0)}%)</span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabela de empresas filtradas */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Empresas filtradas</span>
                <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">Empresa</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">Porte</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">Situação</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">UF / Município</th>
                      <th className="text-left py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">CNAE</th>
                      <th className="text-right py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">Capital</th>
                      <th className="text-center py-2 px-3 font-medium text-muted-foreground text-[11px] uppercase">QSA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          Nenhuma empresa bate com os filtros atuais.
                        </td>
                      </tr>
                    ) : filtered.slice(0, 200).map((e, idx) => {
                      const any = e as any;
                      const danger = any.situacao_cadastral === "BAIXADA" || any.situacao_cadastral === "INAPTA" || any.situacao_cadastral === "NULA";
                      return (
                        <tr
                          key={e.id}
                          className={`border-b border-border last:border-0 hover:bg-muted/40 ${idx % 2 === 1 ? "bg-muted/[0.15]" : ""}`}
                        >
                          <td className="py-2 px-3">
                            <div className="font-medium line-clamp-1">{e.nome}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{e.cnpj}</div>
                          </td>
                          <td className="py-2 px-3">
                            {any.porte ? (
                              <Badge variant="outline" className="text-[10px]">{PORTE_LABELS[any.porte] ?? any.porte}</Badge>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-3">
                            {any.situacao_cadastral ? (
                              <Badge variant="secondary" className={`text-[10px] ${
                                any.situacao_cadastral === "ATIVA" ? "bg-success/10 text-success"
                                : danger ? "bg-destructive/10 text-destructive"
                                : "bg-warning/10 text-warning"
                              }`}>
                                {SITUACAO_LABELS[any.situacao_cadastral] ?? any.situacao_cadastral}
                              </Badge>
                            ) : <span className="text-[10px] text-muted-foreground">sem dados</span>}
                          </td>
                          <td className="py-2 px-3 text-[11px]">
                            {any.uf ? (
                              <>
                                <span className="font-medium">{any.uf}</span>
                                {any.municipio && <span className="text-muted-foreground"> · {any.municipio}</span>}
                              </>
                            ) : "—"}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-muted-foreground line-clamp-1 max-w-xs">
                            {any.cnae_principal_desc ?? "—"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-[11px]">
                            {any.capital_social ? formatBRL(Number(any.capital_social)) : "—"}
                          </td>
                          <td className="py-2 px-3 text-center tabular-nums text-[11px]">
                            {Array.isArray(any.qsa) && any.qsa.length > 0 ? any.qsa.length : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length > 200 && (
                      <tr>
                        <td colSpan={7} className="py-3 text-center text-[11px] text-muted-foreground">
                          ... + {filtered.length - 200} empresas. Use filtros mais específicos ou exporte pra ver todas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
