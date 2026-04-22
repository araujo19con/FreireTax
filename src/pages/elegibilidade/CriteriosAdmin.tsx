import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Pencil, Trash2, GripVertical, ArrowUp, ArrowDown, AlertCircle,
  Sparkles, Copy, ChevronDown, CheckCircle2, XCircle,
} from "lucide-react";
import {
  useCriterios, useCreateCriterio, useUpdateCriterio, useDeleteCriterio, useReorderCriterios,
  type Criterio, type TipoResposta,
} from "@/hooks/useCriterios";
import {
  defaultRegraFor, humanizeRegra, validateRegra, validateFormula,
  type RegraExcludente, type NumberOp, type DateOp, type TextOp,
} from "@/lib/criterios";
import { supabase } from "@/integrations/supabase/client";
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
  const [importOpen, setImportOpen] = useState(false);
  const [presetSeed, setPresetSeed] = useState<Partial<Criterio> | null>(null);

  const openNew = () => { setEditing(null); setPresetSeed(null); setDialogOpen(true); };
  const openEdit = (c: Criterio) => { setEditing(c); setPresetSeed(null); setDialogOpen(true); };
  const openPreset = (preset: Partial<Criterio>) => { setEditing(null); setPresetSeed(preset); setDialogOpen(true); };

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
            Perguntas que estruturam a qualificação{acaoNome && <> para <strong>{acaoNome}</strong></>}.
            Critérios excludentes <strong>desqualificam</strong> a empresa quando a regra dispara.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Sparkles className="mr-1.5 h-4 w-4" />Presets<ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs">Modelos prontos</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRESETS.map((p) => (
                <DropdownMenuItem key={p.label} onClick={() => openPreset(p.seed)}>
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-sm">{p.label}</span>
                    <span className="text-[10px] text-muted-foreground">{p.descricao}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Copy className="mr-1.5 h-4 w-4" />Importar
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" />Novo critério
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Carregando...</Card>
      ) : criterios.length === 0 ? (
        <Card className="p-8 text-center">
          <AlertCircle className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Nenhum critério cadastrado</p>
          <p className="text-xs text-muted-foreground mt-1">
            Comece com um preset ou crie do zero.
          </p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={openNew}>Criar do zero</Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />Importar de outra ação
            </Button>
          </div>
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
                      {c.eh_excludente && (
                        <p className="text-[11px] text-destructive mt-1.5 flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          {humanizeRegra(c.regra_excludente)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px]">{TIPO_LABELS[c.tipo_resposta]}</Badge>
                      {c.eh_excludente && (
                        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                          excludente
                        </Badge>
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
        seed={presetSeed}
        acaoId={acaoId}
        nextOrdem={criterios.length}
        onCreate={(data) => createC.mutateAsync(data).then(() => setDialogOpen(false))}
        onUpdate={(id, data) => updateC.mutateAsync({ id, data }).then(() => setDialogOpen(false))}
      />

      <ImportFromOtherDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        currentAcaoId={acaoId}
        onImported={() => setImportOpen(false)}
      />
    </div>
  );
}

// =========================================================================
// PRESETS
// =========================================================================

const PRESETS: Array<{ label: string; descricao: string; seed: Partial<Criterio> }> = [
  {
    label: "Capital social mínimo",
    descricao: "Excluir empresas com capital abaixo do limite",
    seed: {
      pergunta: "Qual o capital social da empresa?",
      descricao: "Em reais. Buscar no contrato social ou cartão CNPJ.",
      tipo_resposta: "number",
      eh_excludente: true,
      peso: 3,
      regra_excludente: { tipo: "number", operator: "lt", value: 1000 },
    },
  },
  {
    label: "Optante do Simples (excludente)",
    descricao: "Exclui se a empresa for do Simples Nacional",
    seed: {
      pergunta: "A empresa é optante do Simples Nacional?",
      descricao: "Empresas do Simples geralmente ficam fora desta tese.",
      tipo_resposta: "boolean",
      eh_excludente: true,
      peso: 5,
      regra_excludente: { tipo: "boolean", excludeWhen: true },
    },
  },
  {
    label: "Trânsito em julgado antes da modulação",
    descricao: "Tema 985 — exige trânsito antes de 15/09/2020",
    seed: {
      pergunta: "Qual a data do trânsito em julgado?",
      descricao: "Tema 985: rescisória só vale se trânsito ocorreu antes de 15/09/2020.",
      tipo_resposta: "date",
      eh_excludente: true,
      peso: 5,
      regra_excludente: { tipo: "date", operator: "after", value: "2020-09-15" },
    },
  },
  {
    label: "Situação cadastral RFB válida",
    descricao: "Excluir BAIXADA, INAPTA, NULA",
    seed: {
      pergunta: "Qual a situação cadastral atual da empresa?",
      tipo_resposta: "select",
      opcoes: ["ATIVA", "SUSPENSA", "INAPTA", "BAIXADA", "NULA"],
      eh_excludente: true,
      peso: 4,
      regra_excludente: { tipo: "select", excludeOptions: ["BAIXADA", "INAPTA", "NULA"] },
    },
  },
  {
    label: "Faixa de faturamento (com fórmula)",
    descricao: "Number + fórmula de valor potencial (8% do faturamento)",
    seed: {
      pergunta: "Qual o faturamento anual aproximado?",
      descricao: "Em reais. Usado pra estimar o valor potencial do crédito.",
      tipo_resposta: "number",
      eh_excludente: false,
      peso: 2,
      formula_valor: "answers[__ID__] * 0.08",
    },
  },
];

// =========================================================================
// IMPORT DE OUTRA AÇÃO
// =========================================================================

interface ImportFromOtherDialogProps {
  open: boolean;
  onClose: () => void;
  currentAcaoId: string;
  onImported: () => void;
}

function ImportFromOtherDialog({ open, onClose, currentAcaoId, onImported }: ImportFromOtherDialogProps) {
  const [acoes, setAcoes] = useState<Array<{ id: string; nome: string; count: number }>>([]);
  const [selectedAcaoId, setSelectedAcaoId] = useState("");
  const [importing, setImporting] = useState(false);
  const createC = useCreateCriterio();

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: as } = await supabase.from("acoes_tributarias").select("id, nome").order("nome");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: cs } = await ((supabase.from as any)("criterios_elegibilidade").select("acao_id"));
      const counts = new Map<string, number>();
      for (const c of (cs || []) as Array<{ acao_id: string }>) {
        counts.set(c.acao_id, (counts.get(c.acao_id) || 0) + 1);
      }
      const filtered = (as || [])
        .filter((a) => a.id !== currentAcaoId && (counts.get(a.id) || 0) > 0)
        .map((a) => ({ id: a.id, nome: a.nome, count: counts.get(a.id) || 0 }));
      setAcoes(filtered);
    })();
  }, [open, currentAcaoId]);

  const handleImport = async () => {
    if (!selectedAcaoId) return;
    setImporting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: source } = await ((supabase.from as any)("criterios_elegibilidade")
        .select("*").eq("acao_id", selectedAcaoId).order("ordem"));
      const rows = (source || []) as Criterio[];
      // Busca a próxima ordem disponível na ação destino
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dest } = await ((supabase.from as any)("criterios_elegibilidade")
        .select("ordem").eq("acao_id", currentAcaoId));
      const nextOrdem = ((dest || []).reduce((max: number, r: { ordem: number }) =>
        Math.max(max, r.ordem), -1) as number) + 1;

      let i = 0;
      for (const c of rows) {
        await createC.mutateAsync({
          acao_id: currentAcaoId,
          ordem: nextOrdem + i,
          pergunta: c.pergunta,
          descricao: c.descricao,
          tipo_resposta: c.tipo_resposta,
          opcoes: c.opcoes,
          eh_excludente: c.eh_excludente,
          regra_excludente: c.regra_excludente,
          peso: c.peso,
          formula_valor: null, // fórmula referencia IDs específicos — não copiar
        });
        i++;
      }
      toast.success(`${rows.length} critério${rows.length === 1 ? "" : "s"} importado${rows.length === 1 ? "" : "s"}`);
      onImported();
    } catch (e) {
      toast.error("Erro ao importar: " + (e instanceof Error ? e.message : "falha"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Importar critérios de outra ação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Copia todos os critérios de uma ação existente. Fórmulas de valor (que referenciam IDs)
            não são copiadas.
          </p>
          {acoes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Nenhuma outra ação com critérios cadastrados.
            </p>
          ) : (
            <Select value={selectedAcaoId} onValueChange={setSelectedAcaoId}>
              <SelectTrigger><SelectValue placeholder="Selecione uma ação..." /></SelectTrigger>
              <SelectContent>
                {acoes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome} <span className="text-muted-foreground text-[11px] ml-1">· {a.count} critério{a.count === 1 ? "" : "s"}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleImport} disabled={!selectedAcaoId || importing}>
            {importing ? "Importando..." : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// FORM DE CRIAÇÃO/EDIÇÃO
// =========================================================================

interface CriterioFormDialogProps {
  open: boolean;
  onClose: () => void;
  criterio: Criterio | null;
  seed: Partial<Criterio> | null;
  acaoId: string;
  nextOrdem: number;
  onCreate: (data: Partial<Criterio>) => Promise<unknown>;
  onUpdate: (id: string, data: Partial<Criterio>) => Promise<unknown>;
}

function CriterioFormDialog({
  open, onClose, criterio, seed, acaoId, nextOrdem, onCreate, onUpdate,
}: CriterioFormDialogProps) {
  const [pergunta, setPergunta] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<TipoResposta>("boolean");
  const [opcoesText, setOpcoesText] = useState("");
  const [ehExcludente, setEhExcludente] = useState(false);
  const [regra, setRegra] = useState<RegraExcludente>(defaultRegraFor("boolean"));
  const [peso, setPeso] = useState(1);
  const [formula, setFormula] = useState("");

  // Reset on open
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const source = criterio ?? seed ?? null;
      const t = (source?.tipo_resposta ?? "boolean") as TipoResposta;
      setPergunta(source?.pergunta ?? "");
      setDescricao(source?.descricao ?? "");
      setTipo(t);
      setOpcoesText(source?.opcoes ? (source.opcoes as string[]).join("\n") : "");
      setEhExcludente(source?.eh_excludente ?? false);
      setRegra(
        (source?.regra_excludente as RegraExcludente | null | undefined) ?? defaultRegraFor(t)
      );
      setPeso(source?.peso ?? 1);
      setFormula(source?.formula_valor ?? "");
    }
  }

  // Quando muda o tipo, reseta a regra para o default daquele tipo
  // (só se não estiver editando — pra evitar perder a regra existente)
  const handleTipoChange = (t: TipoResposta) => {
    setTipo(t);
    if (regra.tipo !== t) {
      setRegra(defaultRegraFor(t));
    }
  };

  // Lista de opções pra select (atualiza conforme usuário digita)
  const opcoesArr = useMemo(
    () => opcoesText.split("\n").map((s) => s.trim()).filter(Boolean),
    [opcoesText]
  );

  // Validações ao vivo
  const formulaErr = useMemo(() => validateFormula(formula), [formula]);
  const regraErr = useMemo(() => (ehExcludente ? validateRegra(regra) : null), [ehExcludente, regra]);

  const handleSubmit = async () => {
    if (!pergunta.trim()) { toast.error("Pergunta é obrigatória"); return; }
    if (tipo === "select" && opcoesArr.length < 2) {
      toast.error("Informe ao menos 2 opções (uma por linha)");
      return;
    }
    if (ehExcludente && regraErr) { toast.error(regraErr); return; }
    if (formula && formulaErr) { toast.error(formulaErr); return; }

    const data: Partial<Criterio> = {
      acao_id: acaoId,
      ordem: criterio?.ordem ?? nextOrdem,
      pergunta: pergunta.trim(),
      descricao: descricao.trim() || null,
      tipo_resposta: tipo,
      opcoes: tipo === "select" ? opcoesArr : null,
      eh_excludente: ehExcludente,
      regra_excludente: ehExcludente ? regra : null,
      peso,
      formula_valor: formula.trim() || null,
    };

    if (criterio) await onUpdate(criterio.id, data);
    else await onCreate(data);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{criterio ? "Editar critério" : "Novo critério"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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
              <Select value={tipo} onValueChange={(v) => handleTipoChange(v as TipoResposta)}>
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
                placeholder={"ATIVA\nSUSPENSA\nINAPTA\nBAIXADA"}
                rows={4}
                value={opcoesText}
                onChange={(e) => setOpcoesText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="flex items-start gap-2 pt-1 border-t border-border pt-3">
            <Checkbox
              checked={ehExcludente}
              onCheckedChange={(v) => setEhExcludente(v === true)}
              id="excludente"
            />
            <div className="grid gap-1 leading-none flex-1">
              <Label htmlFor="excludente" className="cursor-pointer">Critério excludente</Label>
              <p className="text-[11px] text-muted-foreground">
                Quando a regra abaixo dispara, a empresa é automaticamente desqualificada.
              </p>
            </div>
          </div>

          {ehExcludente && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-3">
              <p className="text-xs font-semibold uppercase text-destructive">Quando desqualificar?</p>
              <RegraEditor
                tipo={tipo}
                regra={regra}
                onChange={setRegra}
                opcoes={opcoesArr}
              />
              {/* Preview humanizado */}
              <div className="flex items-start gap-1.5 text-[11px] mt-2 pt-2 border-t border-destructive/20">
                {regraErr ? (
                  <>
                    <AlertCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                    <span className="text-destructive">{regraErr}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-success mt-0.5 shrink-0" />
                    <span className="text-foreground"><strong>Preview:</strong> {humanizeRegra(regra)}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {tipo === "number" && (
            <div className="space-y-1.5">
              <Label>Fórmula de valor potencial (opcional)</Label>
              <Input
                placeholder={`Ex: answers["${criterio?.id ?? "<id_critério>"}"] * 0.08`}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                className="font-mono text-xs"
              />
              {formula && (
                <div className="flex items-center gap-1 text-[11px]">
                  {formulaErr ? (
                    <><XCircle className="h-3 w-3 text-destructive" /><span className="text-destructive">{formulaErr}</span></>
                  ) : (
                    <><CheckCircle2 className="h-3 w-3 text-success" /><span className="text-success">Fórmula válida</span></>
                  )}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Expressão JS que usa <code>answers["ID_CRITERIO"]</code> para calcular valor potencial.
                Acesse o ID do critério após salvar (no card listado).
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

// =========================================================================
// EDITOR DE REGRA POR TIPO
// =========================================================================

interface RegraEditorProps {
  tipo: TipoResposta;
  regra: RegraExcludente;
  onChange: (r: RegraExcludente) => void;
  opcoes: string[]; // pra tipo select
}

function RegraEditor({ tipo, regra, onChange, opcoes }: RegraEditorProps) {
  // Sanitiza: se tipo da regra divergir do tipo do critério, reseta
  if (regra.tipo !== tipo) {
    onChange(defaultRegraFor(tipo));
    return null;
  }

  if (regra.tipo === "boolean") {
    return (
      <RadioGroup
        value={regra.excludeWhen ? "yes" : "no"}
        onValueChange={(v) => onChange({ tipo: "boolean", excludeWhen: v === "yes" })}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="yes" id="rb-yes" />
          <Label htmlFor="rb-yes" className="text-sm cursor-pointer">Excluir quando responder <strong>Sim</strong></Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id="rb-no" />
          <Label htmlFor="rb-no" className="text-sm cursor-pointer">Excluir quando responder <strong>Não</strong></Label>
        </div>
      </RadioGroup>
    );
  }

  if (regra.tipo === "number") {
    const needs2 = regra.operator === "between" || regra.operator === "outside";
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Operador</Label>
            <Select
              value={regra.operator}
              onValueChange={(v) => onChange({ ...regra, operator: v as NumberOp })}
            >
              <SelectTrigger className="h-9 mt-0.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lt">Menor que (&lt;)</SelectItem>
                <SelectItem value="lte">Menor ou igual (≤)</SelectItem>
                <SelectItem value="eq">Igual a (=)</SelectItem>
                <SelectItem value="gte">Maior ou igual (≥)</SelectItem>
                <SelectItem value="gt">Maior que (&gt;)</SelectItem>
                <SelectItem value="between">Entre (intervalo fechado)</SelectItem>
                <SelectItem value="outside">Fora de (intervalo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">{needs2 ? "De" : "Valor"}</Label>
            <Input
              type="number" inputMode="decimal"
              value={Number.isFinite(regra.value) ? regra.value : ""}
              onChange={(e) => onChange({ ...regra, value: Number(e.target.value) || 0 })}
              className="h-9 mt-0.5"
            />
          </div>
        </div>
        {needs2 && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Até</Label>
            <Input
              type="number" inputMode="decimal"
              value={regra.value2 ?? ""}
              onChange={(e) => onChange({ ...regra, value2: e.target.value === "" ? undefined : Number(e.target.value) })}
              className="h-9 mt-0.5"
            />
          </div>
        )}
      </div>
    );
  }

  if (regra.tipo === "date") {
    const needsValue = regra.operator !== "empty" && regra.operator !== "non_empty";
    const needs2 = regra.operator === "between" || regra.operator === "outside";
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Operador</Label>
          <Select
            value={regra.operator}
            onValueChange={(v) => onChange({ ...regra, operator: v as DateOp })}
          >
            <SelectTrigger className="h-9 mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="before">Antes de</SelectItem>
              <SelectItem value="after">Depois de</SelectItem>
              <SelectItem value="between">Entre</SelectItem>
              <SelectItem value="outside">Fora de</SelectItem>
              <SelectItem value="empty">Vazia (não preenchida)</SelectItem>
              <SelectItem value="non_empty">Preenchida (qualquer data)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsValue && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">{needs2 ? "De" : "Data"}</Label>
              <Input
                type="date"
                value={regra.value ?? ""}
                onChange={(e) => onChange({ ...regra, value: e.target.value || undefined })}
                className="h-9 mt-0.5"
              />
            </div>
            {needs2 && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Até</Label>
                <Input
                  type="date"
                  value={regra.value2 ?? ""}
                  onChange={(e) => onChange({ ...regra, value2: e.target.value || undefined })}
                  className="h-9 mt-0.5"
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (regra.tipo === "select") {
    if (opcoes.length === 0) {
      return (
        <p className="text-[11px] text-muted-foreground italic">
          Adicione opções no campo acima primeiro.
        </p>
      );
    }
    const toggle = (opt: string) => {
      const has = regra.excludeOptions.includes(opt);
      onChange({
        tipo: "select",
        excludeOptions: has
          ? regra.excludeOptions.filter((x) => x !== opt)
          : [...regra.excludeOptions, opt],
      });
    };
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground">Marque as opções que desqualificam:</p>
        {opcoes.map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-1">
            <Checkbox
              checked={regra.excludeOptions.includes(opt)}
              onCheckedChange={() => toggle(opt)}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (regra.tipo === "text") {
    const needsValue = regra.operator === "contains" || regra.operator === "not_contains";
    return (
      <div className="space-y-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Operador</Label>
          <Select
            value={regra.operator}
            onValueChange={(v) => onChange({ ...regra, operator: v as TextOp })}
          >
            <SelectTrigger className="h-9 mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="empty">Vazio</SelectItem>
              <SelectItem value="non_empty">Preenchido</SelectItem>
              <SelectItem value="contains">Contém</SelectItem>
              <SelectItem value="not_contains">Não contém</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsValue && (
          <div>
            <Label className="text-[10px] text-muted-foreground">Termo</Label>
            <Input
              placeholder="Ex: simples"
              value={regra.value ?? ""}
              onChange={(e) => onChange({ ...regra, value: e.target.value })}
              className="h-9 mt-0.5"
            />
          </div>
        )}
      </div>
    );
  }

  return null;
}
