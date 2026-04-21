import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { format, differenceInDays, startOfDay, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Tarefa = Database["public"]["Tables"]["tarefas"]["Row"];

const prioridadeColor: Record<string, string> = {
  urgente: "bg-destructive/60 hover:bg-destructive/80",
  alta: "bg-warning/60 hover:bg-warning/80",
  media: "bg-info/60 hover:bg-info/80",
  baixa: "bg-muted-foreground/40 hover:bg-muted-foreground/60",
};

const statusOpacity: Record<string, string> = {
  pendente: "opacity-100",
  em_andamento: "opacity-100 ring-2 ring-primary/50",
  concluida: "opacity-50 line-through",
  cancelada: "opacity-30",
};

interface TimelineViewProps {
  tarefas: Tarefa[];
  openEdit: (t: Tarefa) => void;
  /** Número de dias a exibir (a partir de hoje - lookback até hoje + lookahead) */
  lookback?: number;
  lookahead?: number;
}

export function TarefasTimelineView({
  tarefas, openEdit, lookback = 7, lookahead = 30,
}: TimelineViewProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const totalDays = lookback + lookahead + 1;

  // Gera array de datas para header
  const days = useMemo(() => {
    return Array.from({ length: totalDays }, (_, i) => addDays(today, i - lookback));
  }, [today, lookback, totalDays]);

  // Filtra tarefas que têm prazo dentro do range OU created_at recente
  const tarefasNoRange = useMemo(() => {
    return tarefas
      .filter((t) => !!t.prazo)
      .map((t) => {
        const prazoDate = startOfDay(new Date(t.prazo!));
        const dayOffset = differenceInDays(prazoDate, today) + lookback;
        return { ...t, dayOffset };
      })
      .filter((t) => t.dayOffset >= 0 && t.dayOffset < totalDays);
  }, [tarefas, today, lookback, totalDays]);

  if (tarefasNoRange.length === 0) {
    return (
      <Card className="p-12 text-center text-sm text-muted-foreground">
        Nenhuma tarefa com prazo no range visível ({lookback}d antes até {lookahead}d à frente)
      </Card>
    );
  }

  const colWidth = 36; // px por dia

  return (
    <Card className="shadow-card overflow-hidden">
      <div className="p-3 border-b border-border text-xs flex items-center justify-between flex-wrap gap-2">
        <span className="text-muted-foreground">
          Timeline · <strong className="text-foreground">{tarefasNoRange.length}</strong> tarefas com prazo entre{" "}
          <strong className="text-foreground">{format(days[0], "dd/MM", { locale: ptBR })}</strong> e{" "}
          <strong className="text-foreground">{format(days[days.length - 1], "dd/MM/yy", { locale: ptBR })}</strong>
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {["urgente", "alta", "media", "baixa"].map((p) => (
            <div key={p} className="flex items-center gap-1">
              <span className={`h-2.5 w-2.5 rounded ${prioridadeColor[p]}`} />
              <span className="capitalize text-muted-foreground">{p}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${totalDays * colWidth + 280}px` }}>
          {/* Header com datas */}
          <div className="flex sticky top-0 bg-muted/30 border-b border-border z-10">
            <div className="w-[280px] shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-r border-border">
              Tarefa
            </div>
            <div className="flex relative" style={{ width: `${totalDays * colWidth}px` }}>
              {days.map((day, i) => {
                const isToday = i === lookback;
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                const isFirstOfMonth = day.getDate() === 1;
                return (
                  <div
                    key={i}
                    className={cn(
                      "border-r border-border/30 text-center text-[9px] py-1 shrink-0",
                      isToday && "bg-primary/20 font-semibold",
                      isWeekend && !isToday && "bg-muted/40",
                      isFirstOfMonth && "border-l-2 border-l-primary/40",
                    )}
                    style={{ width: `${colWidth}px` }}
                  >
                    <div>{format(day, "dd", { locale: ptBR })}</div>
                    <div className="text-muted-foreground text-[8px] lowercase">
                      {format(day, "EEE", { locale: ptBR }).slice(0, 3)}
                    </div>
                    {isFirstOfMonth && (
                      <div className="text-[8px] text-primary font-medium">
                        {format(day, "MMM", { locale: ptBR })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-border">
            {tarefasNoRange.map((t) => (
              <div key={t.id} className="flex hover:bg-muted/20 transition-colors">
                <div
                  className="w-[280px] shrink-0 px-3 py-2 border-r border-border cursor-pointer"
                  onClick={() => openEdit(t)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium line-clamp-1">{t.titulo}</p>
                      {t.status && (
                        <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                          {t.status.replace("_", " ")}
                        </p>
                      )}
                    </div>
                    {t.prioridade && (
                      <Badge variant="outline" className="text-[9px] shrink-0">{t.prioridade[0].toUpperCase()}</Badge>
                    )}
                  </div>
                </div>

                <div className="relative" style={{ width: `${totalDays * colWidth}px` }}>
                  {/* Linha vertical hoje */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary/30 pointer-events-none"
                    style={{ left: `${lookback * colWidth + colWidth / 2}px` }}
                  />
                  {/* Bolota do prazo */}
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 h-4 rounded-full cursor-pointer transition-all shadow-sm",
                      prioridadeColor[t.prioridade ?? "media"] || "bg-muted-foreground/40",
                      statusOpacity[t.status ?? "pendente"] || "opacity-100",
                    )}
                    style={{
                      left: `${t.dayOffset * colWidth + 4}px`,
                      width: `${colWidth - 8}px`,
                    }}
                    title={`${t.titulo} · ${format(new Date(t.prazo!), "dd/MM/yy", { locale: ptBR })}`}
                  >
                    <Calendar className="h-2.5 w-2.5 text-white mx-auto" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
