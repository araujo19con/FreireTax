import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Video, MapPin, Mail, User, Clock, CalendarCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ReuniaoDialog } from "@/components/ReuniaoDialog";
import type { Database } from "@/integrations/supabase/types";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek, isToday, parseISO, isAfter, subDays, addDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";

type Reuniao = Database["public"]["Tables"]["reunioes"]["Row"];
type ReuniaoStatus = Database["public"]["Enums"]["reuniao_status"];

// Versão local com `data_inicio` pré-parseada — evita chamar parseISO a
// cada render para cada célula do calendário (era o principal custo aqui).
interface ReuniaoView extends Reuniao {
  _inicio: Date;
}

const statusColor: Record<ReuniaoStatus, string> = {
  agendada: "bg-info/15 text-info border-info/30",
  realizada: "bg-success/15 text-success border-success/30",
  cancelada: "bg-destructive/15 text-destructive border-destructive/30",
  no_show: "bg-warning/15 text-warning border-warning/30",
  reagendada: "bg-muted text-muted-foreground border-border",
};

const statusLabel: Record<ReuniaoStatus, string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  cancelada: "Cancelada",
  no_show: "No-show",
  reagendada: "Reagendada",
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export default function MinhaAgenda() {
  const { user, canManageAll } = useAuth();
  const [reunioes, setReunioes] = useState<ReuniaoView[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesAtual, setMesAtual] = useState(() => new Date());
  const [escopo, setEscopo] = useState<"minhas" | "todas">("minhas");
  const [view, setView] = useState<"mes" | "lista">("mes");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReuniao, setEditingReuniao] = useState<Reuniao | null>(null);

  const fetchReunioes = useCallback(async () => {
    setLoading(true);
    // Filtra por uma janela razoável no servidor: mês visível ± 2 meses
    // para suportar navegação sem refetch constante, e inclui próximas
    // reuniões futuras (até 6 meses) para o bloco "Próximas".
    const inicio = subDays(startOfMonth(mesAtual), 60).toISOString();
    const fim = addDays(endOfMonth(addMonths(mesAtual, 6)), 1).toISOString();

    let query = supabase
      .from("reunioes")
      .select("*")
      .gte("data_inicio", inicio)
      .lte("data_inicio", fim)
      .order("data_inicio", { ascending: true });
    if (escopo === "minhas" && user) query = query.eq("advogado_id", user.id);
    const { data, error } = await query;
    if (error) toast.error("Erro ao carregar reuniões");

    setReunioes(
      (data ?? []).map((r) => ({ ...r, _inicio: parseISO(r.data_inicio) }))
    );
    setLoading(false);
  }, [escopo, user, mesAtual]);

  useEffect(() => {
    fetchReunioes();
  }, [fetchReunioes]);

  const dias = useMemo(() => {
    const start = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [mesAtual]);

  // Agrupa reuniões por dia uma única vez por render em vez de varrer o
  // array completo para cada célula do calendário.
  const reunioesPorDia = useMemo(() => {
    const map = new Map<string, ReuniaoView[]>();
    for (const r of reunioes) {
      const key = format(r._inicio, "yyyy-MM-dd");
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    return map;
  }, [reunioes]);

  const getReunioesDoDia = useCallback(
    (d: Date) => reunioesPorDia.get(format(d, "yyyy-MM-dd")) ?? [],
    [reunioesPorDia]
  );

  const proximas = useMemo(() => {
    const now = new Date();
    return reunioes
      .filter((r) => r.status === "agendada" && isAfter(r._inicio, now))
      .slice(0, 5);
  }, [reunioes]);

  const contadores = useMemo(() => {
    let total = 0;
    let hoje = 0;
    let agendadas = 0;
    let realizadas = 0;
    for (const r of reunioes) {
      total++;
      if (r.status === "agendada") {
        agendadas++;
        if (isToday(r._inicio)) hoje++;
      }
      if (r.status === "realizada") realizadas++;
    }
    return { total, hoje, agendadas, realizadas };
  }, [reunioes]);

  const openNew = () => {
    setEditingReuniao(null);
    setDialogOpen(true);
  };
  const openEdit = (r: Reuniao) => {
    setEditingReuniao(r);
    setDialogOpen(true);
  };

  if (loading && reunioes.length === 0) {
    return (
      <div className="space-y-6">
        <LoadingState variant="kpi-grid" count={4} />
        <LoadingState variant="cards" count={1} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Minha Agenda"
        description="Reuniões comerciais — convites por email automático"
        icon={<Calendar className="h-7 w-7" />}
        actions={
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Agendar Reunião
          </Button>
        }
      />

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10"><CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-heading font-bold tabular-nums">{contadores.total}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-warning/10"><Clock className="h-4 w-4 text-warning" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Hoje</p>
              <p className="text-xl font-heading font-bold tabular-nums">{contadores.hoje}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-info/10"><Calendar className="h-4 w-4 text-info" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Agendadas</p>
              <p className="text-xl font-heading font-bold tabular-nums">{contadores.agendadas}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-success/10"><CalendarCheck className="h-4 w-4 text-success" aria-hidden="true" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Realizadas</p>
              <p className="text-xl font-heading font-bold tabular-nums">{contadores.realizadas}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Controles */}
      <Card className="p-4 shadow-card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" type="button" className="h-8 w-8" onClick={() => setMesAtual(subMonths(mesAtual, 1))} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <h2 className="font-heading font-semibold text-lg min-w-[160px] text-center capitalize">
              {format(mesAtual, "MMMM yyyy", { locale: ptBR })}
            </h2>
            <Button variant="outline" size="icon" type="button" className="h-8 w-8" onClick={() => setMesAtual(addMonths(mesAtual, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => setMesAtual(new Date())}>Hoje</Button>
          </div>

          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as "mes" | "lista")}>
              <TabsList>
                <TabsTrigger value="mes">Mês</TabsTrigger>
                <TabsTrigger value="lista">Lista</TabsTrigger>
              </TabsList>
            </Tabs>
            {canManageAll && (
              <Tabs value={escopo} onValueChange={(v) => setEscopo(v as "minhas" | "todas")}>
                <TabsList>
                  <TabsTrigger value="minhas">Minhas</TabsTrigger>
                  <TabsTrigger value="todas">Equipe</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
        </div>
      </Card>

      {loading ? (
        <LoadingState variant="cards" count={1} />
      ) : view === "mes" ? (
        <Card className="p-4 shadow-card">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[11px] text-muted-foreground font-medium uppercase">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dias.map((d) => {
              const events = getReunioesDoDia(d);
              const isCurMonth = isSameMonth(d, mesAtual);
              const today = isToday(d);
              return (
                <div
                  key={d.toISOString()}
                  className={`min-h-[90px] p-1.5 rounded-md border ${isCurMonth ? "border-border bg-card" : "border-transparent bg-muted/20"} ${today ? "ring-2 ring-primary/50" : ""}`}
                >
                  <div className={`text-xs font-medium mb-1 ${isCurMonth ? "" : "text-muted-foreground"} ${today ? "text-primary font-bold" : ""}`}>
                    {format(d, "d")}
                  </div>
                  <div className="space-y-1">
                    {events.slice(0, 3).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => openEdit(r)}
                        className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate border ${statusColor[r.status]}`}
                        title={`${format(r._inicio, "HH:mm")} - ${r.titulo}`}
                      >
                        <span className="font-medium">{format(r._inicio, "HH:mm")}</span> {r.titulo}
                      </button>
                    ))}
                    {events.length > 3 && (
                      <p className="text-[9px] text-muted-foreground px-1">+{events.length - 3} mais</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="shadow-card">
          <div className="divide-y divide-border">
            {reunioes.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">Nenhuma reunião.</div>
            ) : reunioes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                className="w-full p-4 hover:bg-muted/40 transition-colors text-left flex items-start gap-4"
              >
                <div className="flex-shrink-0 text-center min-w-[60px]">
                  <p className="text-[10px] uppercase text-muted-foreground">{format(r._inicio, "MMM", { locale: ptBR })}</p>
                  <p className="text-xl font-heading font-bold">{format(r._inicio, "dd")}</p>
                  <p className="text-[11px] text-muted-foreground">{format(r._inicio, "HH:mm")}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-medium truncate">{r.titulo}</h3>
                    <Badge variant="outline" className={`${statusColor[r.status]} text-[10px]`}>{statusLabel[r.status]}</Badge>
                  </div>
                  {r.descricao && <p className="text-sm text-muted-foreground line-clamp-1 mb-1">{r.descricao}</p>}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" aria-hidden="true" />{r.lead_nome}</span>
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden="true" />{r.lead_email}</span>
                    {r.link_reuniao && <span className="flex items-center gap-1"><Video className="h-3 w-3" aria-hidden="true" />Online</span>}
                    {r.local && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{r.local}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Próximas reuniões */}
      {proximas.length > 0 && (
        <Card className="p-5 shadow-card">
          <h3 className="font-heading font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" aria-hidden="true" />Próximas
          </h3>
          <div className="space-y-2">
            {proximas.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                className="w-full flex items-center gap-3 p-2 rounded-md border border-border hover:bg-muted/40 transition-colors text-left"
              >
                <div className="text-center min-w-[48px]">
                  <p className="text-[10px] uppercase text-muted-foreground">{format(r._inicio, "EEE", { locale: ptBR })}</p>
                  <p className="text-sm font-bold">{format(r._inicio, "dd/MM")}</p>
                  <p className="text-[10px] text-muted-foreground">{format(r._inicio, "HH:mm")}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.titulo}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.lead_nome} — {r.lead_email}</p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <ReuniaoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reuniao={editingReuniao}
        onSaved={fetchReunioes}
      />
    </div>
  );
}
