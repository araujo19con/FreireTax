import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Search, ClipboardList, AlertCircle, Calendar, Clock, CheckCircle2, User,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TarefaDialog } from "@/components/TarefaDialog";
import type { Database } from "@/integrations/supabase/types";
import { format, isPast, isToday, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

type Tarefa = Database["public"]["Tables"]["tarefas"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Status = Database["public"]["Enums"]["tarefa_status"];
type ProfileSlim = Pick<Profile, "id" | "nome" | "email">;

interface TarefaWithProfile extends Tarefa {
  responsavel?: ProfileSlim;
}

const statusColumns: { key: Status; label: string; color: string; dot: string }[] = [
  { key: "pendente", label: "Pendente", color: "bg-muted/40", dot: "bg-muted-foreground" },
  { key: "em_andamento", label: "Em Andamento", color: "bg-info/5", dot: "bg-info" },
  { key: "concluida", label: "Concluída", color: "bg-success/5", dot: "bg-success" },
  { key: "cancelada", label: "Cancelada", color: "bg-destructive/5", dot: "bg-destructive" },
];

const prioridadeColor: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-info/10 text-info",
  baixa: "bg-muted text-muted-foreground",
};

function initials(nome: string) {
  return nome.split(" ").slice(0, 2).map((n) => n[0] ?? "").join("").toUpperCase() || "?";
}

export default function MinhasTarefas() {
  const { user, canManageAll } = useAuth();
  const [tarefas, setTarefas] = useState<TarefaWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPrioridade, setFilterPrioridade] = useState<string>("all");
  const [escopo, setEscopo] = useState<"minhas" | "todas">("minhas");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarefa, setEditingTarefa] = useState<Tarefa | null>(null);

  const fetchTarefas = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("tarefas")
      .select("*")
      .order("prazo", { ascending: true, nullsFirst: false });
    if (escopo === "minhas" && user) query = query.eq("assigned_to", user.id);

    const { data, error } = await query;
    if (error) {
      toast.error("Erro ao carregar tarefas");
      setLoading(false);
      return;
    }

    const userIds = Array.from(
      new Set((data ?? []).map((t) => t.assigned_to).filter((v): v is string => Boolean(v)))
    );
    let profilesMap = new Map<string, ProfileSlim>();
    if (userIds.length) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, nome, email")
        .in("id", userIds);
      profilesMap = new Map((prof ?? []).map((p) => [p.id, p as ProfileSlim]));
    }

    setTarefas(
      (data ?? []).map((t) => ({
        ...t,
        responsavel: t.assigned_to ? profilesMap.get(t.assigned_to) : undefined,
      }))
    );
    setLoading(false);
  }, [escopo, user]);

  useEffect(() => {
    fetchTarefas();
  }, [fetchTarefas]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tarefas.filter((t) => {
      if (filterPrioridade !== "all" && t.prioridade !== filterPrioridade) return false;
      if (!s) return true;
      return (
        t.titulo.toLowerCase().includes(s) ||
        (t.descricao?.toLowerCase().includes(s) ?? false)
      );
    });
  }, [tarefas, search, filterPrioridade]);

  // Pré-calcula as colunas do Kanban em um único passe (antes, byStatus
  // percorria o array filtrado 4× a cada render).
  const byStatus = useMemo(() => {
    const out: Record<Status, TarefaWithProfile[]> = {
      pendente: [],
      em_andamento: [],
      concluida: [],
      cancelada: [],
    };
    for (const t of filtered) out[t.status].push(t);
    return out;
  }, [filtered]);

  const resumo = useMemo(() => {
    const now = new Date();
    let atrasadas = 0;
    let hoje = 0;
    for (const t of filtered) {
      if (!t.prazo) continue;
      const d = new Date(t.prazo);
      if (isToday(d)) hoje++;
      if (t.status !== "concluida" && t.status !== "cancelada" && isPast(d) && !isToday(d)) {
        atrasadas++;
      }
    }
    return { atrasadas, hoje, concluidas: byStatus.concluida.length, now };
  }, [filtered, byStatus]);

  const openNew = () => {
    setEditingTarefa(null);
    setDialogOpen(true);
  };
  const openEdit = (t: Tarefa) => {
    setEditingTarefa(t);
    setDialogOpen(true);
  };

  // Atualização local + rollback em caso de erro — sem refetch de toda a lista.
  const quickUpdateStatus = async (id: string, next: Status) => {
    const prev = tarefas;
    const nowIso = new Date().toISOString();
    setTarefas((curr) =>
      curr.map((t) =>
        t.id === id
          ? { ...t, status: next, concluida_em: next === "concluida" ? nowIso : null }
          : t
      )
    );
    const { error } = await supabase
      .from("tarefas")
      .update({
        status: next,
        concluida_em: next === "concluida" ? nowIso : null,
      })
      .eq("id", id);
    if (error) {
      setTarefas(prev);
      toast.error("Erro ao mover");
    }
  };

  const prazoLabel = (prazo: string | null) => {
    if (!prazo) return null;
    const d = new Date(prazo);
    const diff = differenceInDays(d, new Date());
    if (isPast(d) && !isToday(d)) return { text: `Atrasada ${Math.abs(diff)}d`, color: "text-destructive" };
    if (isToday(d)) return { text: "Hoje", color: "text-warning" };
    if (diff <= 3) return { text: `Em ${diff}d`, color: "text-warning" };
    return { text: format(d, "dd/MM", { locale: ptBR }), color: "text-muted-foreground" };
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-7 w-7" aria-hidden="true" />
            Minhas Tarefas
          </h1>
          <p className="text-muted-foreground mt-1">Kanban das tarefas atribuídas a você</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Nova Tarefa
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10"><ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-heading font-bold">{filtered.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-destructive/10"><AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Atrasadas</p>
              <p className="text-xl font-heading font-bold">{resumo.atrasadas}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-warning/10"><Clock className="h-4 w-4 text-warning" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Para hoje</p>
              <p className="text-xl font-heading font-bold">{resumo.hoje}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-success/10"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Concluídas</p>
              <p className="text-xl font-heading font-bold">{resumo.concluidas}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-4 shadow-card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              className="pl-9"
              placeholder="Buscar por título ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar tarefas"
            />
          </div>
          <Select value={filterPrioridade} onValueChange={setFilterPrioridade}>
            <SelectTrigger className="w-40" aria-label="Filtrar por prioridade"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas prioridades</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="media">Média</SelectItem>
              <SelectItem value="baixa">Baixa</SelectItem>
            </SelectContent>
          </Select>
          {canManageAll && (
            <Tabs value={escopo} onValueChange={(v) => setEscopo(v as "minhas" | "todas")}>
              <TabsList>
                <TabsTrigger value="minhas">Minhas</TabsTrigger>
                <TabsTrigger value="todas">Equipe</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </Card>

      {/* Kanban */}
      {loading ? (
        <div className="py-12 text-center text-muted-foreground" role="status" aria-live="polite">
          Carregando...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {statusColumns.map((col) => {
            const items = byStatus[col.key];
            return (
              <div
                key={col.key}
                className={`rounded-lg border border-border ${col.color} p-3 flex flex-col min-h-[400px]`}
                role="region"
                aria-label={`Coluna ${col.label}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} aria-hidden="true" />
                    <h3 className="font-heading font-semibold text-sm">{col.label}</h3>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">Nenhuma tarefa</p>
                  ) : items.map((t) => {
                    const prazo = prazoLabel(t.prazo);
                    return (
                      <Card
                        key={t.id}
                        className="p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => openEdit(t)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openEdit(t);
                          }
                        }}
                        aria-label={`Editar tarefa ${t.titulo}`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium line-clamp-2">{t.titulo}</p>
                            <Badge className={`text-[9px] ${prioridadeColor[t.prioridade]}`} variant="secondary">
                              {t.prioridade}
                            </Badge>
                          </div>
                          {t.descricao && <p className="text-xs text-muted-foreground line-clamp-2">{t.descricao}</p>}
                          <div className="flex items-center justify-between text-[10px]">
                            {t.responsavel ? (
                              <div className="flex items-center gap-1">
                                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-semibold text-primary" aria-hidden="true">
                                  {initials(t.responsavel.nome)}
                                </div>
                                <span className="text-muted-foreground truncate max-w-[80px]">{t.responsavel.nome.split(" ")[0]}</span>
                              </div>
                            ) : <span className="text-muted-foreground"><User className="inline h-3 w-3" aria-hidden="true" /></span>}
                            {prazo && (
                              <span className={`flex items-center gap-1 ${prazo.color}`}>
                                <Calendar className="h-3 w-3" aria-hidden="true" />{prazo.text}
                              </span>
                            )}
                          </div>
                          {t.status !== "concluida" && t.status !== "cancelada" && (
                            <div className="flex gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                              {col.key !== "em_andamento" && t.status === "pendente" && (
                                <Button size="sm" variant="outline" type="button" className="h-6 text-[10px] flex-1" onClick={() => quickUpdateStatus(t.id, "em_andamento")}>
                                  Iniciar
                                </Button>
                              )}
                              <Button size="sm" variant="outline" type="button" className="h-6 text-[10px] flex-1" onClick={() => quickUpdateStatus(t.id, "concluida")}>
                                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />Concluir
                              </Button>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TarefaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tarefa={editingTarefa}
        defaultAssignedTo={user?.id}
        onSaved={fetchTarefas}
      />
    </div>
  );
}
