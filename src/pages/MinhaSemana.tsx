import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, CheckSquare, ChevronLeft, ChevronRight, CalendarDays, Clock, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { TarefaDialog } from "@/components/TarefaDialog";
import { ReuniaoDialog } from "@/components/ReuniaoDialog";
import {
  startOfWeek, endOfWeek, addWeeks, format, eachDayOfInterval,
  isToday, isSameDay, parseISO, startOfDay,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Tarefa = { id: string; titulo: string; prazo: string | null; prioridade: string | null; status: string | null; empresa_id: string | null };
type Reuniao = { id: string; titulo: string | null; data_inicio: string; data_fim: string | null; status: string | null; empresa_id: string | null };

const prioColor: Record<string, string> = {
  urgente: "border-l-destructive bg-destructive/5",
  alta: "border-l-warning bg-warning/5",
  media: "border-l-info bg-info/5",
  baixa: "border-l-muted-foreground bg-muted/30",
};

export default function MinhaSemana() {
  const { user } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0); // 0 = esta semana, -1 = anterior, +1 = próxima
  const [editingTarefa, setEditingTarefa] = useState<Tarefa | null>(null);
  const [editingReuniao, setEditingReuniao] = useState<Reuniao | null>(null);

  const weekStart = useMemo(() => startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1, locale: ptBR }), [weekOffset]);
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1, locale: ptBR }), [weekStart]);
  const days = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);

  // Tarefas com prazo nesta semana
  const tarefasQ = useQuery({
    queryKey: ["minha-semana-tarefas", user?.id, weekStart.toISOString()],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as Tarefa[];
      const { data, error } = await supabase
        .from("tarefas")
        .select("id, titulo, prazo, prioridade, status, empresa_id")
        .eq("assigned_to", user.id)
        .gte("prazo", weekStart.toISOString())
        .lte("prazo", weekEnd.toISOString());
      if (error) throw error;
      return (data || []) as Tarefa[];
    },
  });

  // Reuniões do advogado nesta semana
  const reunioesQ = useQuery({
    queryKey: ["minha-semana-reunioes", user?.id, weekStart.toISOString()],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as Reuniao[];
      const { data, error } = await supabase
        .from("reunioes")
        .select("id, titulo, data_inicio, data_fim, status, empresa_id")
        .eq("advogado_id", user.id)
        .gte("data_inicio", weekStart.toISOString())
        .lte("data_inicio", weekEnd.toISOString());
      if (error) throw error;
      return (data || []) as Reuniao[];
    },
  });

  const tarefas = useMemo(() => tarefasQ.data ?? [], [tarefasQ.data]);
  const reunioes = useMemo(() => reunioesQ.data ?? [], [reunioesQ.data]);

  // Agrupa por dia
  const byDay = useMemo(() => {
    const map = new Map<string, { tarefas: Tarefa[]; reunioes: Reuniao[] }>();
    for (const d of days) {
      map.set(format(d, "yyyy-MM-dd"), { tarefas: [], reunioes: [] });
    }
    for (const t of tarefas) {
      if (!t.prazo) continue;
      const key = format(startOfDay(parseISO(t.prazo)), "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.tarefas.push(t);
    }
    for (const r of reunioes) {
      const key = format(startOfDay(parseISO(r.data_inicio)), "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.reunioes.push(r);
    }
    return map;
  }, [tarefas, reunioes, days]);

  const totalSemana = tarefas.length + reunioes.length;
  const loading = tarefasQ.isLoading || reunioesQ.isLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Minha Semana"
        description="Tarefas com prazo e reuniões agendadas, dia a dia."
        icon={<CalendarDays className="h-7 w-7" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>
              {weekOffset === 0 ? "Esta semana" : `Voltar pra hoje`}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card className="p-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-medium text-sm">
            {format(weekStart, "dd 'de' MMMM", { locale: ptBR })} — {format(weekEnd, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {tarefas.length} tarefa{tarefas.length !== 1 ? "s" : ""} · {reunioes.length} reunião{reunioes.length !== 1 ? "ões" : ""} · <strong>{totalSemana}</strong> itens
          </p>
        </div>
        {totalSemana === 0 && !loading && (
          <Badge variant="outline" className="text-xs">
            Semana leve · nada agendado
          </Badge>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const bucket = byDay.get(key) || { tarefas: [], reunioes: [] };
          const total = bucket.tarefas.length + bucket.reunioes.length;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isTodayDay = isToday(day);

          return (
            <Card
              key={key}
              className={cn(
                "p-2 min-h-[200px] flex flex-col",
                isTodayDay && "ring-2 ring-primary",
                isWeekend && !isTodayDay && "bg-muted/20",
              )}
            >
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
                <div>
                  <p className={cn("text-xs uppercase tracking-wider", isTodayDay ? "text-primary font-bold" : "text-muted-foreground")}>
                    {format(day, "EEE", { locale: ptBR })}
                  </p>
                  <p className={cn("text-xl font-heading tabular-nums", isTodayDay && "text-primary")}>
                    {format(day, "dd")}
                  </p>
                </div>
                {total > 0 && (
                  <Badge variant="secondary" className="h-5 text-[10px]">{total}</Badge>
                )}
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto">
                {loading && (
                  <>
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </>
                )}

                {!loading && bucket.reunioes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setEditingReuniao(r)}
                    className="w-full text-left p-1.5 rounded border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-primary shrink-0" />
                      <span className="text-[10px] text-primary font-medium">
                        {format(parseISO(r.data_inicio), "HH:mm")}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 line-clamp-2">{r.titulo || "Reunião"}</p>
                  </button>
                ))}

                {!loading && bucket.tarefas.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEditingTarefa(t)}
                    className={cn(
                      "w-full text-left p-1.5 rounded border-l-2 hover:bg-muted/50 transition-colors",
                      prioColor[t.prioridade ?? "media"] || "border-l-muted-foreground bg-muted/30",
                      t.status === "concluida" && "opacity-60 line-through",
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <CheckSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[9px] uppercase text-muted-foreground">{t.prioridade?.slice(0, 3) || "---"}</span>
                    </div>
                    <p className="text-xs mt-0.5 line-clamp-2">{t.titulo}</p>
                  </button>
                ))}

                {!loading && total === 0 && (
                  <p className="text-[10px] text-muted-foreground/60 text-center py-4 italic">livre</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Resumo abaixo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Tarefas desta semana</h3>
          </div>
          {tarefas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma tarefa com prazo.</p>
          ) : (
            <ul className="space-y-1 text-xs max-h-48 overflow-y-auto">
              {tarefas.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                    onClick={() => setEditingTarefa(t)}>
                  <span className="truncate">{t.titulo}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {t.prazo ? format(parseISO(t.prazo), "dd/MM", { locale: ptBR }) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Reuniões desta semana</h3>
          </div>
          {reunioes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma reunião agendada.</p>
          ) : (
            <ul className="space-y-1 text-xs max-h-48 overflow-y-auto">
              {reunioes.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                    onClick={() => setEditingReuniao(r)}>
                  <span className="truncate">{r.titulo || "Reunião"}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {format(parseISO(r.data_inicio), "EEE HH:mm", { locale: ptBR })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-warning" />
            <h3 className="font-medium text-sm">Destaques</h3>
          </div>
          <ul className="space-y-1 text-xs">
            {tarefas.filter((t) => t.prioridade === "urgente" && t.status !== "concluida").slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-destructive">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                <span className="truncate">{t.titulo}</span>
              </li>
            ))}
            {tarefas.filter((t) => t.prioridade === "urgente" && t.status !== "concluida").length === 0 && (
              <li className="text-muted-foreground">Sem tarefas urgentes ✨</li>
            )}
          </ul>
        </Card>
      </div>

      {/* Edit dialogs */}
      {editingTarefa && (
        <TarefaDialog
          open={!!editingTarefa}
          onOpenChange={(v) => !v && setEditingTarefa(null)}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tarefa={editingTarefa as any}
          onSaved={() => { tarefasQ.refetch(); }}
        />
      )}
      {editingReuniao && (
        <ReuniaoDialog
          open={!!editingReuniao}
          onOpenChange={(v) => !v && setEditingReuniao(null)}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          reuniao={editingReuniao as any}
          onSaved={() => { reunioesQ.refetch(); }}
        />
      )}
    </div>
  );
}
