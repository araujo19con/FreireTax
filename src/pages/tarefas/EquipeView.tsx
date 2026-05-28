import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, AlertCircle, Clock, CheckCircle2, Timer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfDay } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TarefaRow {
  id: string;
  assigned_to: string | null;
  status: string | null;
  prioridade: string | null;
  prazo: string | null;
  titulo: string;
}

interface Profile {
  id: string;
  nome: string;
  email: string | null;
}

interface PersonStats {
  profile: Profile;
  pendente: number;
  em_andamento: number;
  concluida: number;
  cancelada: number;
  atrasadas: number;
  urgentes: number;
  hoje: number;
  semana: number;
  total_ativas: number;
}

interface TempoRow {
  user_id: string;
  duration_sec: number | null;
  started_at: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function EquipeView() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Equipe — Tarefas"
        description="Carga de trabalho e horas registradas por pessoa."
        icon={<Users className="h-7 w-7" />}
      />
      <Tabs defaultValue="carga">
        <TabsList>
          <TabsTrigger value="carga" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Carga
          </TabsTrigger>
          <TabsTrigger value="horas" className="gap-1.5">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            Horas registradas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="carga" className="mt-4">
          <CargaTab />
        </TabsContent>
        <TabsContent value="horas" className="mt-4">
          <HorasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Aba Carga ────────────────────────────────────────────────────────────────

function CargaTab() {
  const tarefasQ = useQuery({
    queryKey: ["tarefas-equipe"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("id, assigned_to, status, prioridade, prazo, titulo");
      if (error) throw error;
      return (data || []) as TarefaRow[];
    },
  });

  const profilesQ = useQuery({
    queryKey: ["profiles-equipe"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome, email");
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });

  const stats = useMemo<PersonStats[]>(() => {
    const byId = new Map<string, PersonStats>();
    for (const p of profilesQ.data ?? []) {
      byId.set(p.id, {
        profile: p,
        pendente: 0,
        em_andamento: 0,
        concluida: 0,
        cancelada: 0,
        atrasadas: 0,
        urgentes: 0,
        hoje: 0,
        semana: 0,
        total_ativas: 0,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const oneWeek = new Date();
    oneWeek.setDate(oneWeek.getDate() + 7);
    const oneWeekIso = oneWeek.toISOString().slice(0, 10);

    for (const t of tarefasQ.data ?? []) {
      if (!t.assigned_to) continue;
      const s = byId.get(t.assigned_to);
      if (!s) continue;

      const status = (t.status || "pendente") as keyof Pick<
        PersonStats,
        "pendente" | "em_andamento" | "concluida" | "cancelada"
      >;
      if (status in s) s[status] += 1;

      if (status !== "concluida" && status !== "cancelada") {
        s.total_ativas += 1;
        if (t.prioridade === "urgente") s.urgentes += 1;
        if (t.prazo) {
          if (t.prazo < today) s.atrasadas += 1;
          else if (t.prazo === today) s.hoje += 1;
          else if (t.prazo <= oneWeekIso) s.semana += 1;
        }
      }
    }

    return Array.from(byId.values())
      .filter((s) => s.total_ativas > 0 || s.concluida > 0)
      .sort((a, b) => b.total_ativas + b.atrasadas * 2 - (a.total_ativas + a.atrasadas * 2));
  }, [tarefasQ.data, profilesQ.data]);

  const loading = tarefasQ.isLoading || profilesQ.isLoading;

  const totais = useMemo(() => {
    let atrasadas = 0,
      urgentes = 0,
      ativas = 0,
      concluidas = 0;
    for (const s of stats) {
      atrasadas += s.atrasadas;
      urgentes += s.urgentes;
      ativas += s.total_ativas;
      concluidas += s.concluida;
    }
    return { atrasadas, urgentes, ativas, concluidas };
  }, [stats]);

  const maxAtivas = Math.max(1, ...stats.map((s) => s.total_ativas));

  return (
    <div className="space-y-4">
      {/* Totais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KPI
          icon={<Users className="h-4 w-4" />}
          label="Ativas"
          value={formatNumber(totais.ativas)}
        />
        <KPI
          icon={<AlertCircle className="h-4 w-4" />}
          label="Atrasadas"
          value={formatNumber(totais.atrasadas)}
          accent={totais.atrasadas > 0 ? "danger" : "default"}
        />
        <KPI
          icon={<Clock className="h-4 w-4" />}
          label="Urgentes"
          value={formatNumber(totais.urgentes)}
          accent={totais.urgentes > 0 ? "warning" : "default"}
        />
        <KPI
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Concluídas"
          value={formatNumber(totais.concluidas)}
          accent="success"
        />
      </div>

      {/* Ranking por pessoa */}
      <Card className="shadow-card">
        <div className="border-b border-border p-4">
          <h3 className="font-medium">Carga por pessoa</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ordenado pelo peso atrasadas ×2 + ativas. Barras mostram proporção de tarefas ativas por
            pessoa.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : stats.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Sem tarefas atribuídas ainda.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stats.map((s) => {
              const pct = Math.round((s.total_ativas / maxAtivas) * 100);
              return (
                <div key={s.profile.id} className="p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {s.profile.nome || s.profile.email || "—"}
                        </span>
                        {s.profile.email && (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {s.profile.email}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.atrasadas > 0
                              ? "bg-destructive/70"
                              : s.urgentes > 0
                                ? "bg-warning/70"
                                : "bg-primary/70"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                        <span className="text-muted-foreground">
                          <strong className="tabular-nums text-foreground">{s.total_ativas}</strong>{" "}
                          ativa{s.total_ativas !== 1 ? "s" : ""}
                        </span>
                        {s.atrasadas > 0 && (
                          <Badge
                            variant="outline"
                            className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
                          >
                            {s.atrasadas} atrasada{s.atrasadas !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {s.urgentes > 0 && (
                          <Badge
                            variant="outline"
                            className="border-warning/30 bg-warning/10 text-[10px] text-warning"
                          >
                            {s.urgentes} urgente{s.urgentes !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {s.hoje > 0 && (
                          <Badge
                            variant="outline"
                            className="border-info/30 bg-info/10 text-[10px] text-info"
                          >
                            {s.hoje} hoje
                          </Badge>
                        )}
                        {s.semana > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {s.semana} esta semana
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] text-muted-foreground">
                      <div>
                        Pendente:{" "}
                        <strong className="tabular-nums text-foreground">{s.pendente}</strong>
                      </div>
                      <div>
                        Em andamento:{" "}
                        <strong className="tabular-nums text-foreground">{s.em_andamento}</strong>
                      </div>
                      <div>
                        Concluídas:{" "}
                        <strong className="tabular-nums text-success">{s.concluida}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Aba Horas ────────────────────────────────────────────────────────────────

function HorasTab() {
  const [dataInicio, setDataInicio] = useState(() =>
    format(startOfMonth(new Date()), "yyyy-MM-dd")
  );
  const [dataFim, setDataFim] = useState(() => format(endOfDay(new Date()), "yyyy-MM-dd"));

  const tempoQ = useQuery({
    queryKey: ["tarefas-tempo-equipe", dataInicio, dataFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_tempo")
        .select("user_id, duration_sec, started_at")
        .gte("started_at", dataInicio + "T00:00:00")
        .lte("started_at", dataFim + "T23:59:59");
      if (error) throw error;
      return (data || []) as TempoRow[];
    },
  });

  const profilesQ = useQuery({
    queryKey: ["profiles-equipe"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome, email");
      if (error) throw error;
      return (data || []) as Profile[];
    },
    staleTime: 5 * 60_000,
  });

  const horasPorPessoa = useMemo(() => {
    const profileMap = new Map((profilesQ.data ?? []).map((p) => [p.id, p]));
    const agg = new Map<string, { profile: Profile; segundos: number; entradas: number }>();

    for (const t of tempoQ.data ?? []) {
      if (!t.duration_sec) continue;
      const profile = profileMap.get(t.user_id);
      if (!profile) continue;
      const entry = agg.get(t.user_id) ?? { profile, segundos: 0, entradas: 0 };
      entry.segundos += t.duration_sec;
      entry.entradas += 1;
      agg.set(t.user_id, entry);
    }

    return Array.from(agg.values()).sort((a, b) => b.segundos - a.segundos);
  }, [tempoQ.data, profilesQ.data]);

  const totalSegundos = horasPorPessoa.reduce((s, r) => s + r.segundos, 0);

  const fmtHoras = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const loading = tempoQ.isLoading || profilesQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Filtros de período */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="horas-data-inicio" className="mb-1 block text-xs text-muted-foreground">
              De
            </label>
            <input
              id="horas-data-inicio"
              type="date"
              value={dataInicio}
              title="Data de início do período"
              onChange={(e) => setDataInicio(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="horas-data-fim" className="mb-1 block text-xs text-muted-foreground">
              Até
            </label>
            <input
              id="horas-data-fim"
              type="date"
              value={dataFim}
              title="Data de fim do período"
              onChange={(e) => setDataFim(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="pb-0.5 text-sm text-muted-foreground">
            Total do período: <strong className="text-foreground">{fmtHoras(totalSegundos)}</strong>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden shadow-card">
        <div className="border-b border-border p-4">
          <h3 className="font-medium">Horas por advogado</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Soma de <code>duration_sec</code> das entradas de timer no período selecionado.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : horasPorPessoa.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhum tempo registrado no período.{" "}
            <span className="mt-1 block text-xs">
              O timer está em Meu Espaço → Tarefas → botão ▶ em cada tarefa.
            </span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                  Advogado
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                  Horas
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                  Entradas
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                  Média/entrada
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {horasPorPessoa.map((r) => {
                const media = r.entradas > 0 ? r.segundos / r.entradas : 0;
                return (
                  <tr key={r.profile.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {r.profile.nome || r.profile.email || "—"}
                      </span>
                      {r.profile.email && (
                        <span className="block text-[10px] text-muted-foreground">
                          {r.profile.email}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {fmtHoras(r.segundos)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {r.entradas}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {fmtHoras(media)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPI({
  icon,
  label,
  value,
  accent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "default" | "danger" | "warning" | "success";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 font-heading text-2xl tabular-nums">{value}</p>
        </div>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            accent === "danger" && "bg-destructive/10 text-destructive",
            accent === "warning" && "bg-warning/10 text-warning",
            accent === "success" && "bg-success/10 text-success",
            accent === "default" && "bg-primary/10 text-primary"
          )}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}
