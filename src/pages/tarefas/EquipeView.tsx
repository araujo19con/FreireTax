import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TarefaRow {
  id: string;
  assigned_to: string | null;
  status: string | null;
  prioridade: string | null;
  prazo: string | null;
  titulo: string;
}
interface Profile { id: string; nome: string; email: string | null }

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

export default function EquipeView() {
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
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nome, email");
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });

  const stats = useMemo<PersonStats[]>(() => {
    const byId = new Map<string, PersonStats>();
    for (const p of profilesQ.data ?? []) {
      byId.set(p.id, {
        profile: p,
        pendente: 0, em_andamento: 0, concluida: 0, cancelada: 0,
        atrasadas: 0, urgentes: 0, hoje: 0, semana: 0, total_ativas: 0,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const oneWeek = new Date(); oneWeek.setDate(oneWeek.getDate() + 7);
    const oneWeekIso = oneWeek.toISOString().slice(0, 10);

    for (const t of tarefasQ.data ?? []) {
      if (!t.assigned_to) continue;
      const s = byId.get(t.assigned_to);
      if (!s) continue;

      const status = (t.status || "pendente") as keyof Pick<PersonStats, "pendente" | "em_andamento" | "concluida" | "cancelada">;
      if (status in s) (s[status] as number) += 1;

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
      .sort((a, b) => (b.total_ativas + b.atrasadas * 2) - (a.total_ativas + a.atrasadas * 2));
  }, [tarefasQ.data, profilesQ.data]);

  const loading = tarefasQ.isLoading || profilesQ.isLoading;

  // Totais agregados
  const totais = useMemo(() => {
    let atrasadas = 0, urgentes = 0, ativas = 0, concluidas = 0;
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Equipe — Tarefas"
        description="Visão consolidada de carga de trabalho por pessoa."
        icon={<Users className="h-7 w-7" />}
      />

      {/* Totais */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KPI icon={<Users className="h-4 w-4" />} label="Ativas" value={formatNumber(totais.ativas)} />
        <KPI icon={<AlertCircle className="h-4 w-4" />} label="Atrasadas" value={formatNumber(totais.atrasadas)} accent={totais.atrasadas > 0 ? "danger" : "default"} />
        <KPI icon={<Clock className="h-4 w-4" />} label="Urgentes" value={formatNumber(totais.urgentes)} accent={totais.urgentes > 0 ? "warning" : "default"} />
        <KPI icon={<CheckCircle2 className="h-4 w-4" />} label="Concluídas" value={formatNumber(totais.concluidas)} accent="success" />
      </div>

      {/* Ranking por pessoa */}
      <Card className="shadow-card">
        <div className="p-4 border-b border-border">
          <h3 className="font-medium">Carga por pessoa</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ordenado pelo peso atrasadas ×2 + ativas. Barras mostram proporção de tarefas ativas por pessoa.
          </p>
        </div>

        {loading ? (
          <div className="p-4 space-y-3">
            {[0,1,2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
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
                <div key={s.profile.id} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{s.profile.nome || s.profile.email || "—"}</span>
                        {s.profile.email && (
                          <span className="text-[10px] text-muted-foreground truncate">{s.profile.email}</span>
                        )}
                      </div>

                      {/* Barra horizontal */}
                      <div className="mt-2 h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.atrasadas > 0 ? "bg-destructive/70" : s.urgentes > 0 ? "bg-warning/70" : "bg-primary/70",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {/* Numeritos */}
                      <div className="flex items-center gap-3 mt-2 text-[11px] flex-wrap">
                        <span className="text-muted-foreground">
                          <strong className="text-foreground tabular-nums">{s.total_ativas}</strong> ativa{s.total_ativas !== 1 ? "s" : ""}
                        </span>
                        {s.atrasadas > 0 && (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]">
                            {s.atrasadas} atrasada{s.atrasadas !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {s.urgentes > 0 && (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px]">
                            {s.urgentes} urgente{s.urgentes !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {s.hoje > 0 && (
                          <Badge variant="outline" className="bg-info/10 text-info border-info/30 text-[10px]">
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

                    <div className="flex flex-col items-end gap-1 shrink-0 text-[10px] text-muted-foreground">
                      <div>Pendente: <strong className="tabular-nums text-foreground">{s.pendente}</strong></div>
                      <div>Em andamento: <strong className="tabular-nums text-foreground">{s.em_andamento}</strong></div>
                      <div>Concluídas: <strong className="tabular-nums text-success">{s.concluida}</strong></div>
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

function KPI({ icon, label, value, accent = "default" }: { icon: React.ReactNode; label: string; value: string; accent?: "default" | "danger" | "warning" | "success" }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-2xl font-heading mt-1 tabular-nums">{value}</p>
        </div>
        <div
          className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center",
            accent === "danger"  && "bg-destructive/10 text-destructive",
            accent === "warning" && "bg-warning/10 text-warning",
            accent === "success" && "bg-success/10 text-success",
            accent === "default" && "bg-primary/10 text-primary",
          )}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}
