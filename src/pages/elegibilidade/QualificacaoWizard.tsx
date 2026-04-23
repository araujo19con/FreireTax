import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertCircle, Sparkles, Gavel, Building2,
} from "lucide-react";
import type { Criterio } from "@/hooks/useCriterios";
import { useCriterios } from "@/hooks/useCriterios";
import { useRespostas, useSalvarQualificacao, useCriarProspeccaoFromEleg, evaluateAnswers, isExcludenteFalhouAgora, type AnswersMap } from "@/hooks/useQualificacao";
import { humanizeRegra } from "@/lib/criterios";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Empresa } from "@/hooks/useEmpresas";
import type { Acao } from "@/hooks/useAcoes";
import { formatCurrency } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface QualificacaoWizardProps {
  open: boolean;
  onClose: () => void;
  empresa: Pick<Empresa, "id" | "nome" | "cnpj">;
  acao: Pick<Acao, "id" | "nome" | "tipo">;
  /** Elegibilidade existente pra pré-preencher respostas (modo requalificar) */
  elegibilidadeId?: string;
  /** Chamado após salvar com sucesso — recebe id da elegibilidade */
  onSaved?: (elegibilidadeId: string) => void;
}

type Step = "intro" | "questions" | "result";

export function QualificacaoWizard({
  open, onClose, empresa, acao, elegibilidadeId, onSaved,
}: QualificacaoWizardProps) {
  const [step, setStep] = useState<Step>("intro");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [savedElegId, setSavedElegId] = useState<string | null>(null);

  const criteriosQ = useCriterios(acao.id);
  const respostasQ = useRespostas(elegibilidadeId);
  const salvar = useSalvarQualificacao();
  const criarProspeccao = useCriarProspeccaoFromEleg();
  const navigate = useNavigate();

  const criterios = useMemo(() => criteriosQ.data ?? [], [criteriosQ.data]);

  // Pré-popular respostas se for requalificação
  useEffect(() => {
    if (!respostasQ.data || respostasQ.data.length === 0) return;
    const map: AnswersMap = {};
    for (const r of respostasQ.data) {
      map[r.criterio_id] = {
        bool: r.resposta_bool ?? undefined,
        date: r.resposta_date ?? undefined,
        number: r.resposta_number ?? undefined,
        text: r.resposta_text ?? undefined,
        select: r.resposta_select ?? undefined,
      };
    }
    setAnswers(map);
  }, [respostasQ.data]);

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setStep("intro");
      setCurrentIdx(0);
      setSavedElegId(null);
      if (!elegibilidadeId) setAnswers({});
    }
  }, [open, elegibilidadeId]);

  const hasCriterios = criterios.length > 0;
  const evaluated = useMemo(() => evaluateAnswers(criterios, answers), [criterios, answers]);
  const progress = criterios.length > 0 ? Math.round((Object.keys(answers).length / criterios.length) * 100) : 0;

  const current = criterios[currentIdx];
  const currentAnswer = current ? answers[current.id] : undefined;

  const setAnswerField = (criterioId: string, field: keyof AnswersMap[string], value: unknown) => {
    setAnswers((prev) => ({
      ...prev,
      [criterioId]: { ...prev[criterioId], [field]: value },
    }));
  };

  const canAdvance = (): boolean => {
    if (!current) return false;
    if (!currentAnswer) return false;
    switch (current.tipo_resposta) {
      case "boolean": return typeof currentAnswer.bool === "boolean";
      case "date":    return !!currentAnswer.date;
      case "number":  return typeof currentAnswer.number === "number";
      case "text":    return !!(currentAnswer.text && currentAnswer.text.trim());
      case "select":  return !!currentAnswer.select;
    }
  };

  const handleNext = () => {
    if (currentIdx < criterios.length - 1) {
      setCurrentIdx((i) => i + 1);
    } else {
      setStep("result");
    }
  };

  const handleBack = () => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
    else setStep("intro");
  };

  const handleSalvar = async () => {
    const result = await salvar.mutateAsync({
      empresa_id: empresa.id,
      acao_id: acao.id,
      criterios,
      answers,
    });
    setSavedElegId(result.elegibilidadeId);
    toast.success(
      result.evaluated.elegivel
        ? `Elegível! Score ${result.evaluated.score}%${result.evaluated.valor ? ` · ${formatCurrency(result.evaluated.valor)}` : ""}`
        : `Não elegível (score ${result.evaluated.score}%)`,
    );
    onSaved?.(result.elegibilidadeId);
  };

  const handleCriarProspeccao = async () => {
    if (!savedElegId) return;
    await criarProspeccao.mutateAsync(savedElegId);
    onClose();
    navigate("/prospeccao");
  };

  const handleCriarTarefa = async () => {
    if (!savedElegId) return;
    // Cria tarefa rápida com default apontando pra empresa/ação
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("tarefas") as any).insert({
        titulo: `Análise aprofundada — ${acao.nome} (${empresa.nome})`,
        descricao: `Elegibilidade ${savedElegId} qualificada. Revisar jurisprudência e preparar peça.`,
        status: "pendente",
        prioridade: "alta",
        empresa_id: empresa.id,
        acao_id: acao.id,
        user_id: user.id,
        created_by: user.id,
        assigned_to: user.id,
      });
      if (error) throw error;
      toast.success("Tarefa criada em Minhas Tarefas");
      onClose();
      navigate("/minhas-tarefas");
    } catch (err) {
      toast.error("Erro ao criar tarefa: " + ((err as Error)?.message ?? "falha"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl w-[calc(100vw-2rem)] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Qualificação de Elegibilidade
          </DialogTitle>
        </DialogHeader>

        {/* Contexto fixo no topo */}
        <Card className="p-3 bg-muted/30 space-y-1.5 text-sm overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate flex-1 min-w-0" title={empresa.nome}>
              {empresa.nome}
            </span>
            <span className="text-xs text-muted-foreground font-mono shrink-0">{empresa.cnpj}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Gavel className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium truncate flex-1 min-w-0" title={acao.nome}>
              {acao.nome}
            </span>
            {acao.tipo && <Badge variant="outline" className="text-[10px] shrink-0">{acao.tipo}</Badge>}
          </div>
        </Card>

        {/* Barra de progresso (só em questions) */}
        {step === "questions" && hasCriterios && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Pergunta {currentIdx + 1} de {criterios.length}</span>
              <span className="font-medium tabular-nums">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* INTRO */}
        {step === "intro" && (
          <div className="space-y-4 min-h-[180px] flex flex-col justify-center">
            {criteriosQ.isLoading ? (
              <p className="text-sm text-muted-foreground text-center">Carregando critérios...</p>
            ) : !hasCriterios ? (
              <div className="text-center space-y-3">
                <AlertCircle className="h-10 w-10 text-warning mx-auto" />
                <p className="text-sm font-medium">Esta ação não tem critérios cadastrados</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Critérios são as perguntas que guiam a qualificação — cada uma tem peso e pode ser excludente.
                  Cadastre-as em <strong>Ações Tributárias → Critérios</strong> antes de qualificar empresas nesta tese.
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <Sparkles className="h-10 w-10 text-primary mx-auto" />
                <p className="text-sm font-medium">
                  Você vai responder {criterios.length} pergunta{criterios.length > 1 ? "s" : ""} sobre esta empresa × ação.
                </p>
                <p className="text-xs text-muted-foreground">
                  Ao final, o sistema calcula automaticamente se é <strong>elegível</strong>, o <strong>score</strong> e um <strong>valor potencial</strong> estimado.
                  Você poderá converter em prospecção ou criar uma tarefa de análise.
                </p>
              </div>
            )}
          </div>
        )}

        {/* QUESTIONS */}
        {step === "questions" && current && (
          <div className="space-y-3 min-h-[220px]">
            <Card className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm">{current.pergunta}</h3>
                  {current.descricao && (
                    <p className="text-xs text-muted-foreground mt-1">{current.descricao}</p>
                  )}
                </div>
                <TooltipProvider delayDuration={200}>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {current.eh_excludente && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-destructive/10 text-destructive border-destructive/30 cursor-help"
                          >
                            excludente
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs leading-relaxed">
                          Critério excludente — se a resposta desatende a regra, a empresa é desqualificada automaticamente, independente do score das outras perguntas.
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="text-[10px] cursor-help">
                          peso {current.peso}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs leading-relaxed">
                        Peso na composição do score. Respostas positivas somam o peso; score final = (soma dos pesos positivos) ÷ (soma total de pesos) × 100.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>

              <div className="pt-1">
                {renderAnswerInput(current, currentAnswer, (field, value) => setAnswerField(current.id, field, value))}
              </div>

              {/* Aviso inline quando a resposta dispara excludente */}
              {isExcludenteFalhouAgora(current, currentAnswer) && (
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Esta resposta desqualifica a empresa</AlertTitle>
                  <AlertDescription className="text-xs">
                    {current.regra_excludente
                      ? <>Regra: <em>{humanizeRegra(current.regra_excludente)}</em>. Você pode continuar — a qualificação registrará "Não elegível".</>
                      : <>Critério excludente — resposta negativa. Você pode continuar; a qualificação registrará "Não elegível".</>
                    }
                  </AlertDescription>
                </Alert>
              )}
            </Card>
          </div>
        )}

        {/* RESULT */}
        {step === "result" && (
          <div className="space-y-3 min-h-[200px]">
            {!savedElegId ? (
              <Card className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  {evaluated.elegivel ? (
                    <CheckCircle2 className="h-10 w-10 text-success shrink-0" />
                  ) : (
                    <XCircle className="h-10 w-10 text-destructive shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h3 className={`font-heading text-h2 ${evaluated.elegivel ? "text-success" : "text-destructive"}`}>
                      {evaluated.elegivel ? "Elegível" : "Não elegível"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50">
                              Score: <strong>{evaluated.score}%</strong>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs leading-relaxed">
                            Soma dos pesos das respostas positivas ÷ soma total de pesos × 100. Score ≥ 70% + nenhum excludente falhou = elegível.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {evaluated.valor && <> · Valor estimado: <strong>{formatCurrency(evaluated.valor)}</strong></>}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                  {evaluated.justificativa}
                </div>
              </Card>
            ) : (
              <Card className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-10 w-10 text-success shrink-0" />
                  <div>
                    <h3 className="font-heading text-h2">Qualificação salva!</h3>
                    <p className="text-sm text-muted-foreground">Escolha o próximo passo:</p>
                  </div>
                </div>

                {evaluated.elegivel && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                    <Button onClick={handleCriarProspeccao} disabled={criarProspeccao.isPending}>
                      Criar prospecção
                    </Button>
                    <Button variant="outline" onClick={handleCriarTarefa}>
                      Criar tarefa de análise
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        <DialogFooter className="flex-row justify-between gap-2">
          {step === "intro" && (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep("questions")} disabled={!hasCriterios}>
                Começar <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {step === "questions" && (
            <>
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                {currentIdx === 0 ? "Voltar" : "Anterior"}
              </Button>
              <Button onClick={handleNext} disabled={!canAdvance()}>
                {currentIdx === criterios.length - 1 ? "Ver resultado" : "Próxima"}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {step === "result" && (
            <>
              {!savedElegId ? (
                <>
                  <Button variant="outline" onClick={() => setStep("questions")}>Revisar respostas</Button>
                  <Button onClick={handleSalvar} disabled={salvar.isPending}>
                    {salvar.isPending ? "Salvando..." : "Salvar qualificação"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={onClose} className="ml-auto">Fechar</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Render de input por tipo de resposta
function renderAnswerInput(
  criterio: Criterio,
  answer: AnswersMap[string] | undefined,
  setField: (field: keyof AnswersMap[string], value: unknown) => void,
) {
  switch (criterio.tipo_resposta) {
    case "boolean":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={answer?.bool === true ? "default" : "outline"}
            onClick={() => setField("bool", true)}
            className="h-12"
          >
            Sim
          </Button>
          <Button
            variant={answer?.bool === false ? "default" : "outline"}
            onClick={() => setField("bool", false)}
            className="h-12"
          >
            Não
          </Button>
        </div>
      );
    case "date":
      return (
        <Input
          type="date"
          value={answer?.date ?? ""}
          onChange={(e) => setField("date", e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Digite um número"
          value={answer?.number ?? ""}
          onChange={(e) => setField("number", e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "text":
      return (
        <Textarea
          placeholder="Digite a resposta"
          rows={3}
          value={answer?.text ?? ""}
          onChange={(e) => setField("text", e.target.value)}
        />
      );
    case "select": {
      const opts = Array.isArray(criterio.opcoes) ? criterio.opcoes : [];
      return (
        <Select value={answer?.select ?? ""} onValueChange={(v) => setField("select", v)}>
          <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
          <SelectContent>
            {opts.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
  }
}

// --- Explicitly used imports to silence linters
void Checkbox;
void Label;
