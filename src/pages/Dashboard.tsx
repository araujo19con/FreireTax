import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Scale, FileCheck, TrendingUp, Gavel, Handshake, DollarSign, FileText, Users, Phone, ArrowRight, Download, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart,
} from "recharts";
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";

interface Acao { id: string; nome: string; tipo: string; status: string; }
interface ElegibilidadeRow { id: string; empresa_id: string; acao_id: string; elegivel: boolean; }
interface Empresa { id: string; nome: string; cnpj: string; status: string; }
interface Processo { id: string; elegibilidade_id: string; fase: string; valor_estimado: number; valor_ganho: number; status: string; created_at: string; data_processo: string | null; tribunal: string; }
interface Prospeccao { id: string; elegibilidade_id: string; status_prospeccao: string; valor_contrato: number; contato_nome: string; created_at: string; }

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success, 142 71% 45%))",
  "hsl(var(--warning, 38 92% 50%))",
  "hsl(var(--destructive))",
  "hsl(var(--info, 217 91% 60%))",
  "hsl(var(--accent))",
  "hsl(250 60% 60%)",
  "hsl(340 75% 55%)",
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

export default function Dashboard() {
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [prospeccoes, setProspeccoes] = useState<Prospeccao[]>([]);
  const [selectedAcao, setSelectedAcao] = useState<string>("all");
  const [selectedTribunal, setSelectedTribunal] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const [empRes, acoesRes, elegRes, procRes, prospRes] = await Promise.all([
        supabase.from("empresas").select("id, nome, cnpj, status"),
        supabase.from("acoes_tributarias").select("id, nome, tipo, status"),
        supabase.from("elegibilidade").select("id, empresa_id, acao_id, elegivel"),
        supabase.from("processos").select("*") as any,
        supabase.from("prospeccoes").select("*") as any,
      ]);
      setEmpresas(empRes.data || []);
      setAcoes(acoesRes.data || []);
      setElegibilidades(elegRes.data || []);
      setProcessos(procRes.data || []);
      setProspeccoes(prospRes.data || []);
      setLoading(false);
    };
    fetchData();
  }, []);

  const stats = useMemo(() => {
    const filtEleg = selectedAcao === "all" ? elegibilidades : elegibilidades.filter((e) => e.acao_id === selectedAcao);
    const filtElegIds = new Set(filtEleg.map((e) => e.id));
    let filtProc = processos.filter((p) => filtElegIds.has(p.elegibilidade_id));
    if (selectedTribunal !== "all") {
      filtProc = filtProc.filter((p) => (p.tribunal || "Não informado") === selectedTribunal);
    }
    const filtProsp = prospeccoes.filter((p) => filtElegIds.has(p.elegibilidade_id));

    const elegiveis = filtEleg.filter((e) => e.elegivel);
    const elegiveisIds = new Set(elegiveis.map((e) => e.id));

    const totalEstimado = filtProc.reduce((s, p) => s + (Number(p.valor_estimado) || 0), 0);
    const totalGanho = filtProc.reduce((s, p) => s + (Number(p.valor_ganho) || 0), 0);
    const totalContrato = filtProsp.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);

    // Prospecção funnel with conversion rates
    const prospStatuses = ["Não iniciado", "Contato feito", "Proposta enviada", "Em negociação", "Contrato assinado", "Perdido"];
    const prospFunnel = prospStatuses.map((s) => ({
      name: s,
      value: filtProsp.filter((p) => p.status_prospeccao === s).length,
    })).filter((d) => d.value > 0);

    // Conversion rates between stages (excluding "Perdido")
    const activeStatuses = ["Não iniciado", "Contato feito", "Proposta enviada", "Em negociação", "Contrato assinado"];
    const funnelCounts = activeStatuses.map(s => filtProsp.filter(p => p.status_prospeccao === s).length);
    // Cumulative: items that reached at least stage i = sum of all stages from i onwards
    const cumulativeFunnel = activeStatuses.map((_, i) => funnelCounts.slice(i).reduce((a, b) => a + b, 0));
    const funnelConversion = activeStatuses.map((name, i) => ({
      name: name.length > 14 ? name.slice(0, 12) + "…" : name,
      fullName: name,
      total: cumulativeFunnel[i],
      rate: i === 0 ? 100 : cumulativeFunnel[0] > 0 ? Math.round((cumulativeFunnel[i] / cumulativeFunnel[0]) * 100) : 0,
      stepRate: i === 0 ? 100 : cumulativeFunnel[i - 1] > 0 ? Math.round((cumulativeFunnel[i] / cumulativeFunnel[i - 1]) * 100) : 0,
    }));
    const perdidos = filtProsp.filter(p => p.status_prospeccao === "Perdido").length;
    const taxaPerda = filtProsp.length > 0 ? Math.round((perdidos / filtProsp.length) * 100) : 0;

    // Processo status breakdown
    const procStatuses = ["Em andamento", "Favorável", "Desfavorável", "Suspenso", "Finalizado"];
    const procBreakdown = procStatuses.map((s) => ({
      name: s,
      value: filtProc.filter((p) => p.status === s).length,
    })).filter((d) => d.value > 0);

    // Processo fase breakdown
    const faseBreakdown = ["Inicial", "Recurso", "Sentença", "Acórdão", "Trânsito em Julgado", "Execução", "Finalizado"]
      .map((f) => ({ name: f, value: filtProc.filter((p) => p.fase === f).length }))
      .filter((d) => d.value > 0);

    // Tribunal breakdown
    const tribunalMap: Record<string, number> = {};
    filtProc.forEach((p) => {
      const t = p.tribunal || "Não informado";
      tribunalMap[t] = (tribunalMap[t] || 0) + 1;
    });
    const tribunalBreakdown = Object.entries(tribunalMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Tribunal values
    const tribunalValuesMap: Record<string, { estimado: number; ganho: number }> = {};
    filtProc.forEach((p) => {
      const t = p.tribunal || "Não informado";
      if (!tribunalValuesMap[t]) tribunalValuesMap[t] = { estimado: 0, ganho: 0 };
      tribunalValuesMap[t].estimado += Number(p.valor_estimado) || 0;
      tribunalValuesMap[t].ganho += Number(p.valor_ganho) || 0;
    });
    const tribunalValues = Object.entries(tribunalValuesMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.estimado - a.estimado);

    // Per-ação bar chart data
    const acaoBarData = acoes.map((a) => {
      const acaoElegs = elegibilidades.filter((e) => e.acao_id === a.id);
      const acaoElegIds = new Set(acaoElegs.map((e) => e.id));
      const acaoProc = processos.filter((p) => acaoElegIds.has(p.elegibilidade_id));
      const acaoProsp = prospeccoes.filter((p) => acaoElegIds.has(p.elegibilidade_id));
      return {
        nome: a.nome.length > 20 ? a.nome.slice(0, 18) + "…" : a.nome,
        empresas: acaoElegs.length,
        elegiveis: acaoElegs.filter((e) => e.elegivel).length,
        processos: acaoProc.length,
        prospeccoes: acaoProsp.length,
        estimado: acaoProc.reduce((s, p) => s + (Number(p.valor_estimado) || 0), 0),
        ganho: acaoProc.reduce((s, p) => s + (Number(p.valor_ganho) || 0), 0),
      };
    });

    // Eligible without prospecção
    const prospElegIds = new Set(filtProsp.map((p) => p.elegibilidade_id));
    const semProspeccao = elegiveis.filter((e) => !prospElegIds.has(e.id)).length;

    // Time evolution data - last 12 months (use data_processo when available, fallback to created_at)
    const now = new Date();
    const timelineData = Array.from({ length: 12 }, (_, i) => {
      const monthDate = subMonths(now, 11 - i);
      const monthStart = startOfMonth(monthDate);
      const monthEnd = endOfMonth(monthDate);
      
      const monthProcessos = filtProc.filter((p) => {
        const date = new Date(p.data_processo ? p.data_processo + "T00:00:00" : p.created_at);
        return isWithinInterval(date, { start: monthStart, end: monthEnd });
      }).length;
      
      const monthProspeccoes = filtProsp.filter((p) => {
        const date = new Date(p.created_at);
        return isWithinInterval(date, { start: monthStart, end: monthEnd });
      }).length;
      
      return {
        month: format(monthDate, "MMM yy", { locale: ptBR }),
        processos: monthProcessos,
        prospeccoes: monthProspeccoes,
      };
    });

    return {
      filtEleg, filtProc, filtProsp, elegiveis, elegiveisIds,
      totalEstimado, totalGanho, totalContrato,
      prospFunnel, procBreakdown, faseBreakdown, acaoBarData,
      semProspeccao, timelineData, tribunalBreakdown, tribunalValues,
      funnelConversion, perdidos, taxaPerda,
    };
  }, [acoes, elegibilidades, processos, prospeccoes, selectedAcao, selectedTribunal]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // KPIs sheet
    const kpiData = [
      ["Métrica", "Valor"],
      ["Empresas", empresas.length],
      ["Ações Ativas", acoes.filter((a) => a.status === "Ativa").length],
      ["Elegíveis", stats.elegiveis.length],
      ["Total Análises", stats.filtEleg.length],
      ["Taxa Elegibilidade", stats.filtEleg.length > 0 ? `${Math.round((stats.elegiveis.length / stats.filtEleg.length) * 100)}%` : "0%"],
      ["Processos", stats.filtProc.length],
      ["Prospecções", stats.filtProsp.length],
      ["Valor Estimado", stats.totalEstimado],
      ["Valor Ganho", stats.totalGanho],
      ["Valor Contratos", stats.totalContrato],
      ["Elegíveis sem Prospecção", stats.semProspeccao],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiData), "Resumo");

    // Resumo por Ação sheet
    const acaoHeaders = ["Ação", "Tipo", "Empresas", "Elegíveis", "% Elegíveis", "Processos", "Prospecções", "Valor Estimado", "Valor Ganho"];
    const acaoRows = stats.acaoBarData.map((r, i) => [
      acoes[i]?.nome, acoes[i]?.tipo, r.empresas, r.elegiveis,
      r.empresas > 0 ? `${Math.round((r.elegiveis / r.empresas) * 100)}%` : "0%",
      r.processos, r.prospeccoes, r.estimado, r.ganho,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([acaoHeaders, ...acaoRows]), "Por Ação");

    // Funil Prospecção sheet
    if (stats.prospFunnel.length > 0) {
      const funnelData = [["Status", "Quantidade"], ...stats.prospFunnel.map((d) => [d.name, d.value])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(funnelData), "Funil Prospecção");
    }

    // Processos sheet
    if (stats.procBreakdown.length > 0) {
      const procStatusData = [["Status", "Quantidade"], ...stats.procBreakdown.map((d) => [d.name, d.value])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(procStatusData), "Status Processos");
    }
    if (stats.faseBreakdown.length > 0) {
      const faseData = [["Fase", "Quantidade"], ...stats.faseBreakdown.map((d) => [d.name, d.value])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(faseData), "Fases Processos");
    }

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `dashboard-relatorio-${date}.xlsx`);
  };

  const exportPDF = () => {
    // Build a printable HTML and use window.print
    const date = new Date().toLocaleDateString("pt-BR");
    const filterLabel = selectedAcao === "all" ? "Todas as ações" : acoes.find((a) => a.id === selectedAcao)?.nome || "";

    const rows = stats.acaoBarData.map((r, i) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${acoes[i]?.nome || ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${acoes[i]?.tipo || ""}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${r.empresas}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${r.elegiveis}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${r.processos}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${r.prospeccoes}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(r.estimado)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:green">${formatCurrency(r.ganho)}</td>
      </tr>
    `).join("");

    const funnelRows = stats.prospFunnel.map((d) => `
      <tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${d.name}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:center">${d.value}</td></tr>
    `).join("");

    const procRows = stats.procBreakdown.map((d) => `
      <tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${d.name}</td><td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:center">${d.value}</td></tr>
    `).join("");

    const html = `
      <html><head><title>Relatório Dashboard - ${date}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; color: #1a1a1a; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        h2 { font-size: 16px; margin-top: 30px; margin-bottom: 10px; color: #555; }
        .sub { color: #888; font-size: 13px; margin-bottom: 20px; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
        .kpi { border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px; }
        .kpi .label { font-size: 11px; color: #888; text-transform: uppercase; }
        .kpi .val { font-size: 22px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #666; }
        @media print { body { padding: 20px; } }
      </style></head><body>
        <h1>Relatório Dashboard</h1>
        <div class="sub">${date} · Filtro: ${filterLabel}</div>

        <div class="kpis">
          <div class="kpi"><div class="label">Empresas</div><div class="val">${empresas.length}</div></div>
          <div class="kpi"><div class="label">Elegíveis</div><div class="val">${stats.elegiveis.length} <span style="font-size:13px;color:#888">/ ${stats.filtEleg.length}</span></div></div>
          <div class="kpi"><div class="label">Taxa Elegibilidade</div><div class="val">${stats.filtEleg.length > 0 ? Math.round((stats.elegiveis.length / stats.filtEleg.length) * 100) : 0}%</div></div>
          <div class="kpi"><div class="label">Processos</div><div class="val">${stats.filtProc.length}</div></div>
          <div class="kpi"><div class="label">Prospecções</div><div class="val">${stats.filtProsp.length}</div></div>
          <div class="kpi"><div class="label">Sem Prospecção</div><div class="val">${stats.semProspeccao}</div></div>
          <div class="kpi"><div class="label">Valor Estimado</div><div class="val">${formatCurrency(stats.totalEstimado)}</div></div>
          <div class="kpi"><div class="label">Valor Ganho</div><div class="val" style="color:green">${formatCurrency(stats.totalGanho)}</div></div>
          <div class="kpi"><div class="label">Valor Contratos</div><div class="val">${formatCurrency(stats.totalContrato)}</div></div>
        </div>

        <h2>Resumo por Ação</h2>
        <table>
          <thead><tr><th>Ação</th><th>Tipo</th><th style="text-align:center">Empresas</th><th style="text-align:center">Elegíveis</th><th style="text-align:center">Processos</th><th style="text-align:center">Prospecções</th><th style="text-align:right">Estimado</th><th style="text-align:right">Ganho</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        ${stats.prospFunnel.length > 0 ? `
          <h2>Funil de Prospecção</h2>
          <table><thead><tr><th>Status</th><th style="text-align:center">Quantidade</th></tr></thead><tbody>${funnelRows}</tbody></table>
        ` : ""}

        ${stats.procBreakdown.length > 0 ? `
          <h2>Status dos Processos</h2>
          <table><thead><tr><th>Status</th><th style="text-align:center">Quantidade</th></tr></thead><tbody>${procRows}</tbody></table>
        ` : ""}
      </body></html>
    `;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);
    }
  };

  if (loading) {
    return <LoadingState variant="page" />;
  }

  const kpis = [
    { label: "Empresas", value: empresas.length, icon: Building2, sub: `${empresas.filter((e) => e.status === "cliente").length} clientes` },
    { label: "Ações Ativas", value: acoes.filter((a) => a.status === "Ativa").length, icon: Scale, sub: `${acoes.length} total` },
    { label: "Elegíveis", value: stats.elegiveis.length, icon: FileCheck, sub: `de ${stats.filtEleg.length} análises` },
    { label: "Taxa Elegibilidade", value: stats.filtEleg.length > 0 ? `${Math.round((stats.elegiveis.length / stats.filtEleg.length) * 100)}%` : "—", icon: TrendingUp, sub: "elegíveis / total" },
    { label: "Processos", value: stats.filtProc.length, icon: FileText, sub: `${stats.filtProc.filter((p) => p.status === "Favorável").length} favoráveis` },
    { label: "Prospecções", value: stats.filtProsp.length, icon: Handshake, sub: `${stats.filtProsp.filter((p) => p.status_prospeccao === "Contrato assinado").length} contratos` },
  ];

  const financialKpis = [
    { label: "Valor Estimado", value: formatCurrency(stats.totalEstimado), icon: DollarSign, color: "text-primary" },
    { label: "Valor Ganho", value: formatCurrency(stats.totalGanho), icon: TrendingUp, color: "text-success" },
    { label: "Valor Contratos", value: formatCurrency(stats.totalContrato), icon: Handshake, color: "text-info" },
    { label: "Sem Prospecção", value: stats.semProspeccao.toString(), icon: Phone, color: "text-warning" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Visão geral do acompanhamento tributário"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportExcel} aria-label="Exportar dashboard para Excel">
              <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF} aria-label="Exportar dashboard para PDF">
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />PDF
            </Button>
            <div className="w-56">
              <Select value={selectedAcao} onValueChange={setSelectedAcao}>
                <SelectTrigger aria-label="Filtrar por ação">
                  <SelectValue placeholder="Filtrar por ação..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nome} ({a.tipo})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select value={selectedTribunal} onValueChange={setSelectedTribunal}>
                <SelectTrigger aria-label="Filtrar por tribunal">
                  <SelectValue placeholder="Filtrar por tribunal..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">Todos os tribunais</SelectItem>
                  {(() => {
                    const tribunais = new Set(processos.map((p) => p.tribunal || "Não informado"));
                    return Array.from(tribunais).sort().map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((m) => (
          <Card key={m.label} className="shadow-card hover:shadow-elevated transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
              <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{m.label}</CardTitle>
              <m.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-heading font-bold tabular-nums">{m.value}</div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{m.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {financialKpis.map((m) => (
          <Card key={m.label} className="shadow-card">
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`p-2.5 rounded-lg bg-muted/50 ${m.color}`}>
                <m.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
                <p className={`text-xl font-heading font-bold tabular-nums ${m.color}`}>{m.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prospecção Funnel */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Funil de Prospecção</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.prospFunnel.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma prospecção registrada</p>
            ) : (
              <div className="space-y-3">
                {stats.prospFunnel.map((item, i) => {
                  const max = Math.max(...stats.prospFunnel.map((d) => d.value));
                  const pct = max > 0 ? (item.value / max) * 100 : 0;
                  const colors = {
                    "Não iniciado": "bg-muted-foreground/20",
                    "Contato feito": "bg-info/60",
                    "Proposta enviada": "bg-warning/60",
                    "Em negociação": "bg-primary/60",
                    "Contrato assinado": "bg-success/60",
                    "Perdido": "bg-destructive/60",
                  } as Record<string, string>;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-32 text-right shrink-0">{item.name}</span>
                      <div className="flex-1 h-7 bg-muted/30 rounded-md overflow-hidden relative">
                        <div className={`h-full rounded-md transition-all ${colors[item.name] || "bg-primary/40"}`} style={{ width: `${pct}%` }} />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">{item.value}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Conversão entre Etapas</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.funnelConversion.length === 0 || stats.funnelConversion[0].total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma prospecção registrada</p>
            ) : (
              <div className="space-y-2">
                {stats.funnelConversion.map((step, i) => (
                  <div key={step.fullName}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{step.fullName}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{step.total}</span>
                        {i > 0 && (
                          <Badge variant="outline" className={`text-[10px] border-0 ${
                            step.stepRate >= 60 ? "bg-success/10 text-success" :
                            step.stepRate >= 30 ? "bg-warning/10 text-warning" :
                            "bg-destructive/10 text-destructive"
                          }`}>
                            {step.stepRate}%
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="h-5 bg-muted/30 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-primary/50 rounded-sm transition-all"
                        style={{ width: `${step.rate}%` }}
                      />
                    </div>
                    {i < stats.funnelConversion.length - 1 && (
                      <div className="flex justify-center my-0.5">
                        <ArrowRight className="h-3 w-3 text-muted-foreground rotate-90" />
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs mt-3 pt-2 border-t border-border">
                  <span className="text-destructive">Perdidos</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{stats.perdidos}</span>
                    <Badge variant="outline" className="text-[10px] border-0 bg-destructive/10 text-destructive">{stats.taxaPerda}%</Badge>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Processo Status Pie */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Status dos Processos</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.procBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum processo registrado</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={stats.procBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" nameKey="name">
                    {stats.procBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [value, "Processos"]} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Second charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fase dos Processos */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Fase dos Processos</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.faseBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum processo registrado</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.faseBreakdown} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={75} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Processos" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Valores por Ação */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Valores por Ação</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.acaoBarData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma ação cadastrada</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.acaoBarData} margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="estimado" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Estimado" />
                  <Bar dataKey="ganho" fill="hsl(var(--success, 142 71% 45%))" radius={[4, 4, 0, 0]} name="Ganho" />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Time Evolution Chart */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-sm font-heading">Evolução Temporal (últimos 12 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.timelineData.every((d) => d.processos === 0 && d.prospeccoes === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum dado no período</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={stats.timelineData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradProcessos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradProspeccoes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--success, 142 71% 45%))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--success, 142 71% 45%))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--background))", 
                    borderColor: "hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px"
                  }} 
                />
                <Area 
                  type="monotone" 
                  dataKey="processos" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fill="url(#gradProcessos)" 
                  name="Processos"
                />
                <Area 
                  type="monotone" 
                  dataKey="prospeccoes" 
                  stroke="hsl(var(--success, 142 71% 45%))" 
                  strokeWidth={2}
                  fill="url(#gradProspeccoes)" 
                  name="Prospecções"
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tribunal Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Processos por Tribunal</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.tribunalBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum processo registrado</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.tribunalBreakdown} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={55} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Processos">
                    {stats.tribunalBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-sm font-heading">Valores por Tribunal</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.tribunalValues.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum processo registrado</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.tribunalValues} margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="estimado" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Estimado" />
                  <Bar dataKey="ganho" fill="hsl(var(--success, 142 71% 45%))" radius={[4, 4, 0, 0]} name="Ganho" />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-sm font-heading">Resumo por Ação</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Ação</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tipo</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Empresas</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Elegíveis</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Processos</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Prospecções</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Estimado</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Ganho</th>
                </tr>
              </thead>
              <tbody>
                {stats.acaoBarData.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 font-medium">{acoes[i]?.nome}</td>
                    <td className="py-3 px-4">
                      <Badge variant={acoes[i]?.tipo === "INICIAL" ? "default" : "secondary"} className="text-[10px]">{acoes[i]?.tipo}</Badge>
                    </td>
                    <td className="py-3 px-4 text-center">{row.empresas}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-success font-medium">{row.elegiveis}</span>
                      {row.empresas > 0 && (
                        <span className="text-muted-foreground text-xs ml-1">({Math.round((row.elegiveis / row.empresas) * 100)}%)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">{row.processos}</td>
                    <td className="py-3 px-4 text-center">{row.prospeccoes}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs">{formatCurrency(row.estimado)}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-success">{formatCurrency(row.ganho)}</td>
                  </tr>
                ))}
                {stats.acaoBarData.length > 1 && (
                  <tr className="bg-muted/30 font-medium">
                    <td className="py-3 px-4" colSpan={2}>Total</td>
                    <td className="py-3 px-4 text-center">{stats.acaoBarData.reduce((s, r) => s + r.empresas, 0)}</td>
                    <td className="py-3 px-4 text-center text-success">{stats.acaoBarData.reduce((s, r) => s + r.elegiveis, 0)}</td>
                    <td className="py-3 px-4 text-center">{stats.acaoBarData.reduce((s, r) => s + r.processos, 0)}</td>
                    <td className="py-3 px-4 text-center">{stats.acaoBarData.reduce((s, r) => s + r.prospeccoes, 0)}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs">{formatCurrency(stats.acaoBarData.reduce((s, r) => s + r.estimado, 0))}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-success">{formatCurrency(stats.acaoBarData.reduce((s, r) => s + r.ganho, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
