import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Download, TrendingUp, DollarSign, Target, Percent } from "lucide-react";
import { format, startOfYear } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { formatCurrency } from "@/lib/format";

const GANHAS_STATUS = ["Contrato assinado", "Serviço iniciado"];

interface ProspRow {
  id: string;
  status_prospeccao: string;
  valor_contrato: number | null;
  data_assinatura: string | null;
  responsavel_id: string | null;
  elegibilidade_id: string;
}
interface ElegRow {
  id: string;
  empresa_id: string;
  acao_id: string;
}
interface AcaoRow {
  id: string;
  nome: string;
}
interface EmpresaRow {
  id: string;
  nome: string;
}
interface ProfileRow {
  id: string;
  nome: string;
}

function useRelatorioData() {
  return useQuery({
    queryKey: ["relatorio-data"],
    staleTime: 60_000,
    queryFn: async () => {
      const [prospRes, elegRes, acaoRes, empRes, profRes] = await Promise.all([
        fetchAllRows<ProspRow>(
          supabase
            .from("prospeccoes")
            .select(
              "id, status_prospeccao, valor_contrato, data_assinatura, responsavel_id, elegibilidade_id"
            )
        ),
        fetchAllRows<ElegRow>(supabase.from("elegibilidade").select("id, empresa_id, acao_id")),
        fetchAllRows<AcaoRow>(
          supabase.from("acoes_tributarias").select("id, nome").eq("ativo", true)
        ),
        fetchAllRows<EmpresaRow>(supabase.from("empresas").select("id, nome")),
        fetchAllRows<ProfileRow>(supabase.from("profiles").select("id, nome").eq("ativo", true)),
      ]);
      return {
        prospeccoes: prospRes,
        elegibilidades: elegRes,
        acoes: acaoRes,
        empresas: empRes,
        profiles: profRes,
      };
    },
  });
}

export default function Relatorios() {
  const today = format(new Date(), "yyyy-MM-dd");
  const yearStart = format(startOfYear(new Date()), "yyyy-MM-dd");

  const [dataInicio, setDataInicio] = useState(yearStart);
  const [dataFim, setDataFim] = useState(today);
  const [filterAcao, setFilterAcao] = useState("all");
  const [filterResponsavel, setFilterResponsavel] = useState("all");

  const { data, isLoading } = useRelatorioData();

  const elegMap = useMemo(() => {
    const m = new Map<string, ElegRow>();
    (data?.elegibilidades ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [data?.elegibilidades]);

  const acaoMap = useMemo(() => {
    const m = new Map<string, string>();
    (data?.acoes ?? []).forEach((a) => m.set(a.id, a.nome));
    return m;
  }, [data?.acoes]);

  const empresaMap = useMemo(() => {
    const m = new Map<string, string>();
    (data?.empresas ?? []).forEach((e) => m.set(e.id, e.nome));
    return m;
  }, [data?.empresas]);

  const profileMap = useMemo(() => {
    const m = new Map<string, string>();
    (data?.profiles ?? []).forEach((p) => m.set(p.id, p.nome));
    return m;
  }, [data?.profiles]);

  // Enriquece prospecções com empresa_id e acao_id via elegibilidade_id
  const enriched = useMemo(() => {
    return (data?.prospeccoes ?? []).map((p) => {
      const eleg = elegMap.get(p.elegibilidade_id);
      return {
        ...p,
        empresa_id: eleg?.empresa_id ?? null,
        acao_id: eleg?.acao_id ?? null,
        empresa_nome: eleg ? (empresaMap.get(eleg.empresa_id) ?? "—") : "—",
        acao_nome: eleg ? (acaoMap.get(eleg.acao_id) ?? "—") : "—",
        responsavel_nome: p.responsavel_id ? (profileMap.get(p.responsavel_id) ?? "—") : "—",
      };
    });
  }, [data?.prospeccoes, elegMap, acaoMap, empresaMap, profileMap]);

  // Filtros
  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      if (filterAcao !== "all" && p.acao_id !== filterAcao) return false;
      if (filterResponsavel !== "all" && p.responsavel_id !== filterResponsavel) return false;
      return true;
    });
  }, [enriched, filterAcao, filterResponsavel]);

  // Prospecções ganhas dentro do período (filtra por data_assinatura)
  const ganhas = useMemo(() => {
    return filtered.filter((p) => {
      if (!GANHAS_STATUS.includes(p.status_prospeccao)) return false;
      if (p.data_assinatura) {
        if (p.data_assinatura < dataInicio) return false;
        if (p.data_assinatura > dataFim) return false;
      }
      return true;
    });
  }, [filtered, dataInicio, dataFim]);

  // KPIs
  const totalGanhas = ganhas.length;
  const valorTotal = ganhas.reduce((s, p) => s + (p.valor_contrato ?? 0), 0);
  const totalAtivas = filtered.filter((p) => !["Perdido"].includes(p.status_prospeccao)).length;
  const taxaConversao = totalAtivas > 0 ? (totalGanhas / totalAtivas) * 100 : 0;
  const ticketMedio = totalGanhas > 0 ? valorTotal / totalGanhas : 0;

  // Funil por ação: qualificadas / em_prospeccao / ganhas / perdidas
  const funilData = useMemo(() => {
    const acaoIds =
      filterAcao !== "all"
        ? [filterAcao]
        : Array.from(new Set(filtered.map((p) => p.acao_id).filter(Boolean)));

    return acaoIds
      .map((aId) => {
        const prosp = filtered.filter((p) => p.acao_id === aId);
        const nome = acaoMap.get(aId) ?? aId ?? "—";
        const shortNome = nome.length > 22 ? nome.slice(0, 22) + "…" : nome;
        return {
          nome: shortNome,
          "Em andamento": prosp.filter(
            (p) => !GANHAS_STATUS.includes(p.status_prospeccao) && p.status_prospeccao !== "Perdido"
          ).length,
          Ganhas: prosp.filter((p) => GANHAS_STATUS.includes(p.status_prospeccao)).length,
          Perdidas: prosp.filter((p) => p.status_prospeccao === "Perdido").length,
        };
      })
      .filter((r) => r["Em andamento"] + r.Ganhas + r.Perdidas > 0)
      .sort((a, b) => b.Ganhas - a.Ganhas);
  }, [filtered, filterAcao, acaoMap]);

  async function exportXLSX() {
    const XLSX = await import("xlsx");
    const rows = ganhas.map((p) => ({
      Empresa: p.empresa_nome,
      "Ação Tributária": p.acao_nome,
      Status: p.status_prospeccao,
      "Valor Contrato (R$)": p.valor_contrato ?? 0,
      "Data Assinatura": p.data_assinatura ?? "",
      Responsável: p.responsavel_nome,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ganhas");
    XLSX.writeFile(wb, `relatorio-ganhas-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  }

  const acoesList = data?.acoes ?? [];
  const profilesList = data?.profiles ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Relatórios"
        description="Funil de conversão e prospecções ganhas"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void exportXLSX();
            }}
            disabled={!ganhas.length}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Exportar XLSX
          </Button>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Filtros */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="rel-inicio" className="text-xs">
                Data início
              </Label>
              <input
                id="rel-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="Data de início do período"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rel-fim" className="text-xs">
                Data fim
              </Label>
              <input
                id="rel-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                title="Data de fim do período"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ação tributária</Label>
              <Select value={filterAcao} onValueChange={setFilterAcao}>
                <SelectTrigger className="h-9 w-[220px] text-sm">
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {acoesList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Select value={filterResponsavel} onValueChange={setFilterResponsavel}>
                <SelectTrigger className="h-9 w-[180px] text-sm">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {profilesList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* KPIs */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              icon={<Target className="h-5 w-5 text-success" />}
              label="Contratos ganhos"
              value={String(totalGanhas)}
              sub="no período filtrado"
            />
            <KpiCard
              icon={<DollarSign className="h-5 w-5 text-primary" />}
              label="Valor total"
              value={formatCurrency(valorTotal)}
              sub="soma dos contratos"
            />
            <KpiCard
              icon={<Percent className="h-5 w-5 text-info" />}
              label="Taxa de conversão"
              value={`${taxaConversao.toFixed(1)}%`}
              sub="ganhas / ativas"
            />
            <KpiCard
              icon={<TrendingUp className="h-5 w-5 text-warning" />}
              label="Ticket médio"
              value={totalGanhas > 0 ? formatCurrency(ticketMedio) : "—"}
              sub="por contrato ganho"
            />
          </div>
        )}

        {/* Funil por ação */}
        <Card className="p-4">
          <h2 className="mb-4 text-sm font-semibold">Funil por ação tributária</h2>
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : funilData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma prospecção encontrada para os filtros selecionados.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, funilData.length * 44)}>
              <BarChart data={funilData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={150} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(value: number, name: string) => [value, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Em andamento" fill="hsl(var(--info))" radius={[0, 3, 3, 0]} />
                <Bar dataKey="Ganhas" fill="hsl(var(--success))" radius={[0, 3, 3, 0]} />
                <Bar dataKey="Perdidas" fill="hsl(var(--destructive))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Tabela de contratos ganhos */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Contratos ganhos no período
              {totalGanhas > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {totalGanhas}
                </Badge>
              )}
            </h2>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : ganhas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum contrato ganho no período. Ajuste os filtros ou o intervalo de datas.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Empresa</th>
                    <th className="pb-2 pr-4 font-medium">Ação Tributária</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Valor</th>
                    <th className="pb-2 pr-4 font-medium">Assinatura</th>
                    <th className="pb-2 font-medium">Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {ganhas.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4 font-medium">{p.empresa_nome}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{p.acao_nome}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant="outline"
                          className="border-success/30 bg-success/10 text-[10px] capitalize text-success"
                        >
                          {p.status_prospeccao}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {p.valor_contrato ? formatCurrency(p.valor_contrato) : "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {p.data_assinatura ?? "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">{p.responsavel_nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums leading-tight">{value}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-muted/50 p-2">{icon}</div>
      </div>
    </Card>
  );
}
