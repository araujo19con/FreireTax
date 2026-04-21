import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Pencil, GripVertical, FileText, AlertCircle, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useAcoes } from "@/hooks/useAcoes";
import {
  useTarefasTemplates, useCreateTemplate, useDeleteTemplate,
  type TarefaTemplate, type TemplateInput,
} from "@/hooks/useTarefasExtras";
import { toast } from "sonner";

const PRIORIDADE_OPTS = [
  { value: "urgente", label: "Urgente", color: "bg-destructive/10 text-destructive" },
  { value: "alta", label: "Alta", color: "bg-warning/10 text-warning" },
  { value: "media", label: "Média", color: "bg-info/10 text-info" },
  { value: "baixa", label: "Baixa", color: "bg-muted text-muted-foreground" },
];

export default function TemplatesAdmin() {
  const templatesQ = useTarefasTemplates();
  const acoesQ = useAcoes();
  const createT = useCreateTemplate();
  const deleteT = useDeleteTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TarefaTemplate | null>(null);

  const acoes = acoesQ.data ?? [];
  const templates = templatesQ.data ?? [];

  const openNew = () => { setEditing(null); setDialogOpen(true); };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Templates de Tarefa"
        description="Crie modelos reutilizáveis com subtarefas, prioridade e prazo relativo. Reduz retrabalho em workflows recorrentes (ex: análise Tema 985)."
        icon={<FileText className="h-7 w-7" />}
        actions={<Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Novo template</Button>}
      />

      {templatesQ.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando templates...</Card>
      ) : templates.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Nenhum template cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Templates economizam tempo: um clique cria tarefa com título, descrição, prioridade e subtarefas pré-definidas.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={openNew}>
            Criar primeiro template
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => {
            const acao = acoes.find((a) => a.id === t.acao_id);
            const subs = Array.isArray(t.subtarefas_padrao) ? t.subtarefas_padrao : [];
            const prioCfg = PRIORIDADE_OPTS.find((p) => p.value === t.prioridade_padrao);
            return (
              <Card key={t.id} className="p-4 shadow-card hover:shadow-elevated transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm truncate">{t.nome}</h3>
                    {t.categoria && (
                      <p className="text-[11px] text-muted-foreground">{t.categoria}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover template "{t.nome}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tarefas já criadas a partir deste template não serão afetadas.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteT.mutate(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remover
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="mt-3 text-xs border-t border-border pt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>Título padrão:</span>
                    <span className="text-foreground truncate">{t.titulo_padrao}</span>
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5">
                    {prioCfg && <Badge variant="outline" className={`text-[10px] ${prioCfg.color}`}>{prioCfg.label}</Badge>}
                    {t.prazo_relativo_dias != null && (
                      <Badge variant="outline" className="text-[10px]">+{t.prazo_relativo_dias}d prazo</Badge>
                    )}
                    {acao && (
                      <Badge variant="outline" className="text-[10px]">🏛️ {acao.nome}</Badge>
                    )}
                    {subs.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{subs.length} subtarefa{subs.length > 1 ? "s" : ""}</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        template={editing}
        acoes={acoes}
        onCreate={async (data) => { await createT.mutateAsync(data); setDialogOpen(false); }}
      />
    </div>
  );
}

// =========================================================================
// FORM DIALOG
// =========================================================================
interface TemplateFormDialogProps {
  open: boolean;
  onClose: () => void;
  template: TarefaTemplate | null;
  acoes: Array<{ id: string; nome: string }>;
  onCreate: (data: Partial<TemplateInput>) => Promise<void>;
}

function TemplateFormDialog({ open, onClose, template, acoes, onCreate }: TemplateFormDialogProps) {
  const [form, setForm] = useState<Partial<TemplateInput>>({});
  const [subsText, setSubsText] = useState("");
  const [prevOpen, setPrevOpen] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setForm({
        nome: template?.nome ?? "",
        categoria: template?.categoria ?? "",
        titulo_padrao: template?.titulo_padrao ?? "",
        descricao_padrao: template?.descricao_padrao ?? "",
        prioridade_padrao: template?.prioridade_padrao ?? "media",
        prazo_relativo_dias: template?.prazo_relativo_dias ?? null,
        acao_id: template?.acao_id ?? null,
      });
      const subs = Array.isArray(template?.subtarefas_padrao) ? template.subtarefas_padrao : [];
      setSubsText(subs.map((s) => s.titulo).join("\n"));
    }
  }

  const setField = <K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.nome?.trim()) { toast.error("Nome do template é obrigatório"); return; }
    if (!form.titulo_padrao?.trim()) { toast.error("Título padrão é obrigatório"); return; }

    const subtarefas = subsText.split("\n")
      .map((s, i) => ({ titulo: s.trim(), ordem: i }))
      .filter((s) => s.titulo.length > 0);

    await onCreate({
      ...form,
      subtarefas_padrao: subtarefas,
    } as Partial<TemplateInput>);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{template ? "Editar template" : "Novo template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do template *</Label>
            <Input
              placeholder="Ex: Análise Tema 985"
              value={form.nome ?? ""}
              onChange={(e) => setField("nome", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Input
                placeholder="Ex: tema_985, onboarding"
                value={form.categoria ?? ""}
                onChange={(e) => setField("categoria", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ação vinculada (opcional)</Label>
              <Select
                value={form.acao_id ?? "_none"}
                onValueChange={(v) => setField("acao_id", v === "_none" ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Nenhuma</SelectItem>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Título padrão da tarefa *</Label>
            <Input
              placeholder="Ex: Analisar processo para Tema 985"
              value={form.titulo_padrao ?? ""}
              onChange={(e) => setField("titulo_padrao", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição padrão</Label>
            <Textarea
              placeholder="Contexto ou instruções que aparecem na tarefa criada"
              rows={3}
              value={form.descricao_padrao ?? ""}
              onChange={(e) => setField("descricao_padrao", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Prioridade padrão</Label>
              <Select
                value={form.prioridade_padrao ?? "media"}
                onValueChange={(v) => setField("prioridade_padrao", v as TemplateInput["prioridade_padrao"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORIDADE_OPTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prazo relativo (dias)</Label>
              <Input
                type="number"
                placeholder="Ex: 7 (hoje + 7 dias)"
                value={form.prazo_relativo_dias ?? ""}
                onChange={(e) => setField("prazo_relativo_dias", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subtarefas padrão (uma por linha)</Label>
            <Textarea
              placeholder={"Verificar trânsito em julgado\nConferir modulação\nConfirmar prescrição\nRedigir peça"}
              rows={5}
              value={subsText}
              onChange={(e) => setSubsText(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Cada linha vira uma subtarefa marcada como não concluída.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>{template ? "Salvar" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

void GripVertical; void X;
