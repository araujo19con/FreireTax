import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Square, Clock, Repeat, Link2, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useTempo, useStartTempo, useStopTempo,
  useDependencias, useAddDependencia, useRemoveDependencia,
} from "@/hooks/useTarefasExtras";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

interface TarefaExtrasProps {
  tarefaId: string | null;
}

export function TarefaExtras({ tarefaId }: TarefaExtrasProps) {
  if (!tarefaId) {
    return <p className="text-sm text-muted-foreground text-center py-4">Salve a tarefa primeiro pra usar estes recursos.</p>;
  }
  return (
    <div className="space-y-4">
      <TimerSection tarefaId={tarefaId} />
      <RecurrenceSection tarefaId={tarefaId} />
      <DependenciasSection tarefaId={tarefaId} />
    </div>
  );
}

// -----------------------------------------
// TIMER / TIME TRACKING
// -----------------------------------------
function TimerSection({ tarefaId }: { tarefaId: string }) {
  const { user } = useAuth();
  const { data: entries = [] } = useTempo(tarefaId);
  const startT = useStartTempo();
  const stopT = useStopTempo();

  const running = entries.find((e) => !e.stopped_at && e.user_id === user?.id);

  const totalSec = useMemo(
    () => entries.reduce((s, e) => s + (e.duration_sec || 0), 0),
    [entries],
  );
  const totalHoras = Math.floor(totalSec / 3600);
  const totalMin = Math.floor((totalSec % 3600) / 60);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />Tempo gasto
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Total: <strong className="tabular-nums text-foreground">{totalHoras}h {totalMin}min</strong>
            {entries.length > 0 && <> · {entries.length} entrada{entries.length > 1 ? "s" : ""}</>}
          </p>
        </div>
        {running ? (
          <Button
            variant="destructive" size="sm"
            onClick={() => stopT.mutate({ id: running.id })}
            disabled={stopT.isPending}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />Parar timer
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => startT.mutate(tarefaId)}
            disabled={startT.isPending}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />Iniciar timer
          </Button>
        )}
      </div>

      {entries.length > 0 && (
        <ul className="space-y-1 text-xs max-h-40 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/50">
              <span className="text-muted-foreground">{formatDateTime(e.started_at)}</span>
              <span className="tabular-nums">
                {e.duration_sec
                  ? `${Math.floor(e.duration_sec / 60)}m ${e.duration_sec % 60}s`
                  : <Badge variant="outline" className="text-[9px] bg-warning/10 text-warning border-warning/30">rodando</Badge>
                }
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -----------------------------------------
// RECORRÊNCIA
// -----------------------------------------
function RecurrenceSection({ tarefaId }: { tarefaId: string }) {
  const [rule, setRule] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: tarefa } = useQuery({
    queryKey: ["tarefa-recur", tarefaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("id, recurrence_rule, recurrence_next_run")
        .eq("id", tarefaId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; recurrence_rule: string | null; recurrence_next_run: string | null } | null;
    },
  });

  const currentRule = (tarefa?.recurrence_rule ?? "").trim();

  const handleSave = async () => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = { recurrence_rule: rule || null };
      if (rule) {
        patch.recurrence_next_run = new Date().toISOString().slice(0, 10);
      } else {
        patch.recurrence_next_run = null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("tarefas") as any).update(patch).eq("id", tarefaId);
      if (error) throw error;
      toast.success(rule ? "Recorrência configurada" : "Recorrência removida");
    } catch (e) {
      toast.error("Erro: " + ((e as Error)?.message ?? "falha"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Repeat className="h-3.5 w-3.5" />Recorrência
        </h3>
        <p className="text-[11px] text-muted-foreground">
          A tarefa se autoreplica conforme a regra. Edge function `gerar-tarefas-recorrentes` processa diariamente.
        </p>
      </div>

      {currentRule && (
        <div className="text-xs p-2 bg-muted/50 rounded flex items-center justify-between gap-2">
          <div>
            <span className="text-muted-foreground">Regra ativa:</span>{" "}
            <code className="font-mono">{currentRule}</code>
            {tarefa?.recurrence_next_run && (
              <span className="text-muted-foreground ml-2">
                · próxima: <span className="tabular-nums">{tarefa.recurrence_next_run}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px]">Regra</Label>
          <Select value={rule} onValueChange={setRule}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sem recorrência" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem recorrência</SelectItem>
              <SelectItem value="daily">Diário</SelectItem>
              <SelectItem value="weekly">Semanal (a cada 7 dias)</SelectItem>
              <SelectItem value="weekly:MON">Semanal (toda segunda)</SelectItem>
              <SelectItem value="weekly:FRI">Semanal (toda sexta)</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="monthly:1">Dia 1 do mês</SelectItem>
              <SelectItem value="monthly:15">Dia 15 do mês</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            size="sm" className="w-full"
            onClick={() => handleSave()}
            disabled={saving || rule === currentRule}
          >
            {saving ? "Salvando..." : "Aplicar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// -----------------------------------------
// DEPENDÊNCIAS
// -----------------------------------------
function DependenciasSection({ tarefaId }: { tarefaId: string }) {
  const { data: deps = [] } = useDependencias(tarefaId);
  const addDep = useAddDependencia();
  const removeDep = useRemoveDependencia();
  const [selectedId, setSelectedId] = useState("");

  // Lista de tarefas candidatas (exceto esta e já dependentes)
  const { data: candidatas = [] } = useQuery({
    queryKey: ["tarefas-candidatas-dep", tarefaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("id, titulo, status")
        .neq("id", tarefaId)
        .in("status", ["pendente", "em_andamento", "concluida"])
        .order("titulo")
        .limit(100);
      if (error) throw error;
      return (data || []) as Array<{ id: string; titulo: string; status: string }>;
    },
  });

  const existingDepIds = new Set(deps.map((d) => d.depende_de_id));
  const disponíveis = candidatas.filter((c) => !existingDepIds.has(c.id));

  // Resolve títulos das dependências
  const depIds = deps.map((d) => d.depende_de_id);
  const { data: depTitles } = useQuery({
    queryKey: ["dep-titles", depIds.join(",")],
    enabled: depIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas")
        .select("id, titulo, status")
        .in("id", depIds);
      if (error) throw error;
      return (data || []) as Array<{ id: string; titulo: string; status: string }>;
    },
  });
  const titleById = new Map((depTitles ?? []).map((t) => [t.id, t]));

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" />Dependências
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Esta tarefa só pode ser iniciada quando todas as dependências estiverem concluídas.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Adicionar dependência..." /></SelectTrigger>
          <SelectContent>
            {disponíveis.length === 0 ? (
              <SelectItem value="_" disabled>Nenhuma tarefa disponível</SelectItem>
            ) : (
              disponíveis.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.titulo} <span className="text-muted-foreground text-[10px] ml-1">· {c.status}</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={async () => {
            if (!selectedId) return;
            await addDep.mutateAsync({ tarefaId, dependeDeId: selectedId });
            setSelectedId("");
          }}
          disabled={!selectedId || addDep.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {deps.length > 0 ? (
        <ul className="space-y-1">
          {deps.map((d) => {
            const t = titleById.get(d.depende_de_id);
            return (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-muted/30">
                <div className="min-w-0 flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${t?.status === "concluida" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}
                  >
                    {t?.status === "concluida" ? "✓" : "⏳"}
                  </Badge>
                  <span className="truncate">{t?.titulo || "(tarefa removida)"}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => removeDep.mutate({ id: d.id, tarefaId })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">Nenhuma dependência.</p>
      )}

      {deps.length > 0 && titleById.size > 0 && (() => {
        const allDone = Array.from(titleById.values()).every((t) => t.status === "concluida");
        return allDone ? (
          <div className="text-[11px] text-success p-2 bg-success/10 rounded">
            ✓ Todas as dependências concluídas — esta tarefa pode ser iniciada.
          </div>
        ) : (
          <div className="text-[11px] text-warning p-2 bg-warning/10 rounded">
            ⏳ Aguardando {Array.from(titleById.values()).filter((t) => t.status !== "concluida").length} dependência(s).
          </div>
        );
      })()}
    </Card>
  );
}

// Silencia lint de imports used in subcomponentes
void Input;
