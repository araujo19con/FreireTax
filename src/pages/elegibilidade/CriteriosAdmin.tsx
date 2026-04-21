import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, GripVertical, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { useCriterios, useCreateCriterio, useUpdateCriterio, useDeleteCriterio, useReorderCriterios, type Criterio, type TipoResposta } from "@/hooks/useCriterios";
import { toast } from "sonner";

const TIPO_LABELS: Record<TipoResposta, string> = {
  boolean: "Sim / Não",
  date: "Data",
  number: "Número",
  text: "Texto livre",
  select: "Seleção (lista)",
};

interface CriteriosAdminProps {
  acaoId: string;
  acaoNome?: string;
}

export function CriteriosAdmin({ acaoId, acaoNome }: CriteriosAdminProps) {
  const { data: criterios = [], isLoading } = useCriterios(acaoId);
  const createC = useCreateCriterio();
  const updateC = useUpdateCriterio();
  const deleteC = useDeleteCriterio();
  const reorderC = useReorderCriterios();

  const [editing, setEditing] = useState<Criterio | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: Criterio) => { setEditing(c); setDialogOpen(true); };

  const handleMove = async (c: Criterio, dir: -1 | 1) => {
    const sorted = [...criterios].sort((a, b) => a.ordem - b.ordem);
    const i = sorted.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const updates = [
      { id: sorted[i].id, ordem: sorted[j].ordem },
      { id: sorted[j].id, ordem: sorted[i].ordem },
    ];
    await reorderC.mutateAsync(updates);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-heading text-h3">Critérios de elegibilidade</h3>
          <p className="text-xs text-muted-foreground">
            Perguntas que estruturam a qualificação de empresas{acaoNome && <> para <strong>{acaoNome}</strong></>}.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" />Novo critério
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Carregando...</Card>
      ) : criterios.length === 0 ? (
        <Card className="p-8 text-center">
          <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Nenhum critério cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Adicione perguntas (ex: "Há trânsito em julgado antes de 15/09/2020?") para usar o wizard de qualificação.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...criterios].sort((a, b) => a.ordem - b.ordem).map((c, i, arr) => (
            <Card key={c.id} className="p-3">
              <div className="flex items-start gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="text-xs text-muted-foreground mr-2">#{c.ordem + 1}</span>
                        {c.pergunta}
                      </p>
                      {c.descricao && <p className="text-xs text-muted-foreground mt-0.5">{c.descricao}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px]">{TIPO_LABELS[c.tipo_resposta]}</Badge>
                      {c.eh_excludente && (
                        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">excludente</Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px]">peso {c.peso}</Badge>
                    </div>
                  </div>

                  {c.formula_valor && (
                    <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                      <span className="text-muted-foreground/70">fórmula:</span> {c.formula_valor}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(c, -1)} disabled={i === 0}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(c, 1)} disabled={i === arr.length - 1}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}>
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
                        <AlertDialogTitle>Remover critério?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Elegibilidades antigas que responderam este critério mantêm as respostas.
                          Qualificações futuras não usarão ele.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteC.mutate(c.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CriterioFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        criterio={editing}
        acaoId={acaoId}
        nextOrdem={criterios.length}
        onCreate={(data) => createC.mutateAsync(data).then(() => setDialogOpen(false))}
        onUpdate={(id, data) => updateC.mutateAsync({ id, data }).then(() => setDialogOpen(false))}
      />
    </div>
  );
}

// -----------------------------------------
// Form de criação/edição
// -----------------------------------------

interface CriterioFormDialogProps {
  open: boolean;
  onClose: () => void;
  criterio: Criterio | null;
  acaoId: string;
  nextOrdem: number;
  onCreate: (data: Partial<Criterio>) => Promise<unknown>;
  onUpdate: (id: string, data: Partial<Criterio>) => Promise<unknown>;
}

function CriterioFormDialog({
  open, onClose, criterio, acaoId, nextOrdem, onCreate, onUpdate,
}: CriterioFormDialogProps) {
  const [pergunta, setPergunta] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<TipoResposta>("boolean");
  const [opcoesText, setOpcoesText] = useState("");
  const [ehExcludente, setEhExcludente] = useState(false);
  const [peso, setPeso] = useState(1);
  const [formula, setFormula] = useState("");

  // Reset on open
  useState(() => 0); // noop pra manter tipo
  if (!open && criterio) {
    // no-op: reset happens via effect on open change abaixo
  }

  // useState + useEffect combinados pra resetar ao abrir
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPergunta(criterio?.pergunta ?? "");
      setDescricao(criterio?.descricao ?? "");
      setTipo(criterio?.tipo_resposta ?? "boolean");
      setOpcoesText(criterio?.opcoes ? (criterio.opcoes as string[]).join("\n") : "");
      setEhExcludente(criterio?.eh_excludente ?? false);
      setPeso(criterio?.peso ?? 1);
      setFormula(criterio?.formula_valor ?? "");
    }
  }

  const handleSubmit = async () => {
    if (!pergunta.trim()) { toast.error("Pergunta é obrigatória"); return; }

    const opcoes = tipo === "select"
      ? opcoesText.split("\n").map((s) => s.trim()).filter(Boolean)
      : null;

    if (tipo === "select" && (!opcoes || opcoes.length < 2)) {
      toast.error("Informe ao menos 2 opções (uma por linha)");
      return;
    }

    const data: Partial<Criterio> = {
      acao_id: acaoId,
      ordem: criterio?.ordem ?? nextOrdem,
      pergunta: pergunta.trim(),
      descricao: descricao.trim() || null,
      tipo_resposta: tipo,
      opcoes: opcoes as Criterio["opcoes"],
      eh_excludente: ehExcludente,
      peso,
      formula_valor: formula.trim() || null,
    };

    if (criterio) await onUpdate(criterio.id, data);
    else await onCreate(data);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">{criterio ? "Editar critério" : "Novo critério"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Pergunta *</Label>
            <Input
              placeholder="Ex: Há trânsito em julgado antes de 15/09/2020?"
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição / ajuda (opcional)</Label>
            <Textarea
              placeholder="Contexto extra que aparece abaixo da pergunta durante o wizard"
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de resposta</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoResposta)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIPO_LABELS) as TipoResposta[]).map((k) => (
                    <SelectItem key={k} value={k}>{TIPO_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Peso (1-10)</Label>
              <Input
                type="number" min={1} max={10}
                value={peso}
                onChange={(e) => setPeso(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          {tipo === "select" && (
            <div className="space-y-1.5">
              <Label>Opções (uma por linha)</Label>
              <Textarea
                placeholder={"Opção A\nOpção B\nOpção C"}
                rows={4}
                value={opcoesText}
                onChange={(e) => setOpcoesText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              checked={ehExcludente}
              onCheckedChange={(v) => setEhExcludente(v === true)}
              id="excludente"
            />
            <div className="grid gap-1 leading-none">
              <Label htmlFor="excludente" className="cursor-pointer">Critério excludente</Label>
              <p className="text-[11px] text-muted-foreground">
                Se marcado e a resposta for negativa, a empresa automaticamente será considerada não elegível.
              </p>
            </div>
          </div>

          {tipo === "number" && (
            <div className="space-y-1.5">
              <Label>Fórmula de valor (opcional)</Label>
              <Input
                placeholder={`Ex: answers.${criterio?.id ?? "<id>"} * 0.08`}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Expressão JS que usa <code>answers.ID_CRITERIO</code> para calcular valor potencial. Ex:{" "}
                <code>answers.faturamento_criterio_id * 0.08</code>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>{criterio ? "Salvar" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
