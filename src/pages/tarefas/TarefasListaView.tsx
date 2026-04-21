import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { format, isPast, isToday, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Tarefa = Database["public"]["Tables"]["tarefas"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileSlim = Pick<Profile, "id" | "nome" | "email">;
type TarefaWithProfile = Tarefa & { responsavel?: ProfileSlim };

const prioridadeColor: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-info/10 text-info",
  baixa: "bg-muted text-muted-foreground",
};

const statusColor: Record<string, string> = {
  pendente: "bg-muted text-muted-foreground",
  em_andamento: "bg-info/10 text-info",
  concluida: "bg-success/10 text-success",
  cancelada: "bg-destructive/10 text-destructive",
};

function prazoInfo(prazo: string | null) {
  if (!prazo) return null;
  const d = new Date(prazo);
  const diff = differenceInDays(d, new Date());
  const text = format(d, "dd/MM/yy", { locale: ptBR });
  if (isPast(d) && !isToday(d)) return { text, color: "text-destructive", sub: `${Math.abs(diff)}d atrasada` };
  if (isToday(d)) return { text: "Hoje", color: "text-warning font-semibold", sub: "" };
  if (diff <= 3) return { text, color: "text-warning", sub: `em ${diff}d` };
  return { text, color: "text-muted-foreground", sub: "" };
}

interface TarefasListaViewProps {
  tarefas: TarefaWithProfile[];
  openEdit: (t: Tarefa) => void;
}

export function TarefasListaView({ tarefas, openEdit }: TarefasListaViewProps) {
  if (tarefas.length === 0) {
    return (
      <Card className="p-12 text-center text-sm text-muted-foreground">
        Nenhuma tarefa encontrada
      </Card>
    );
  }

  return (
    <Card className="shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Tarefa</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Prioridade</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Responsável</th>
              <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Prazo</th>
            </tr>
          </thead>
          <tbody>
            {tarefas.map((t, i) => {
              const prazo = prazoInfo(t.prazo);
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-border hover:bg-muted/40 cursor-pointer transition-colors",
                    i % 2 === 1 ? "bg-muted/[0.15]" : "",
                  )}
                  onClick={() => openEdit(t)}
                >
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium line-clamp-1">{t.titulo}</span>
                      {t.descricao && (
                        <span className="text-[11px] text-muted-foreground line-clamp-1">{t.descricao}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge variant="outline" className={`text-[10px] capitalize ${statusColor[t.status || ""] || ""}`}>
                      {t.status?.replace("_", " ") || "—"}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3">
                    {t.prioridade && (
                      <Badge variant="outline" className={`text-[10px] capitalize ${prioridadeColor[t.prioridade] || ""}`}>
                        {t.prioridade}
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {t.responsavel ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-semibold text-primary shrink-0">
                          {t.responsavel.nome.split(" ").slice(0, 2).map((n) => n[0] ?? "").join("").toUpperCase()}
                        </div>
                        <span className="truncate">{t.responsavel.nome.split(" ")[0]}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground"><User className="inline h-3 w-3 mr-1" />—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {prazo ? (
                      <div className={`text-xs ${prazo.color}`}>
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {prazo.text}
                        {prazo.sub && <span className="block text-[10px]">{prazo.sub}</span>}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
        {tarefas.length} tarefa{tarefas.length === 1 ? "" : "s"}
      </div>
    </Card>
  );
}
