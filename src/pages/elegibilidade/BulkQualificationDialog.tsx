import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Building2, ArrowRight, Play, Zap, Wand2, CheckCircle2, XCircle } from "lucide-react";
import { useAcoes, type Acao } from "@/hooks/useAcoes";
import { useEmpresasSimple, type Empresa } from "@/hooks/useEmpresas";
import { QualificacaoWizard } from "./QualificacaoWizard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

interface BulkQualificationDialogProps {
  open: boolean;
  onClose: () => void;
  empresaIds: string[];
}

type Mode = "quick" | "wizard";

export function BulkQualificationDialog({ open, onClose, empresaIds }: BulkQualificationDialogProps) {
  const [mode, setMode] = useState<Mode>("quick");
  const [selectedAcaoId, setSelectedAcaoId] = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modo rápido — campos compartilhados aplicados a todas as empresas
  const [quickElegivel, setQuickElegivel] = useState<"yes" | "no">("yes");
  const [quickValor, setQuickValor] = useState<string>("");
  const [quickJustificativa, setQuickJustificativa] = useState("");

  const acoesQ = useAcoes();
  const empresasQ = useEmpresasSimple();
  const { user } = useAuth();
  const qc = useQueryClient();

  const acoes = acoesQ.data ?? [];
  const allEmpresas = useMemo(() => empresasQ.data ?? [], [empresasQ.data]);
  const empresas = useMemo(
    () => allEmpresas.filter((e) => empresaIds.includes(e.id)),
    [allEmpresas, empresaIds],
  );

  const acao = acoes.find((a) => a.id === selectedAcaoId);
  const current = empresas[currentIdx];
  const total = empresas.length;

  // Modo wizard — abre 1 por 1
  const handleStartWizard = () => {
    if (!selectedAcaoId) return;
    setCurrentIdx(0);
    setWizardOpen(true);
  };
  const handleWizardClose = () => setWizardOpen(false);
  const handleSaved = () => {
    setWizardOpen(false);
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
      setTimeout(() => setWizardOpen(true), 250);
    } else {
      setTimeout(() => onClose(), 500);
    }
  };
  const handleSkip = () => {
    if (currentIdx < total - 1) setCurrentIdx((i) => i + 1);
    else onClose();
  };

  // Modo rápido — insere/upserta tudo de uma vez
  const handleQuickSubmit = async () => {
    if (!selectedAcaoId || total === 0 || !user) return;
    setSaving(true);
    try {
      const elegivel = quickElegivel === "yes";
      const valor = quickValor.trim() === "" ? null : Number(quickValor);
      const justificativa = quickJustificativa.trim() || null;

      // Busca elegibilidades existentes pra evitar duplicar (upsert lógico)
      const { data: existing, error: existErr } = await supabase
        .from("elegibilidade")
        .select("id, empresa_id")
        .eq("acao_id", selectedAcaoId)
        .in("empresa_id", empresaIds);
      if (existErr) throw existErr;

      const existingMap = new Map((existing || []).map((r) => [r.empresa_id, r.id]));
      const toUpdate = empresaIds.filter((id) => existingMap.has(id));
      const toInsert = empresaIds.filter((id) => !existingMap.has(id));

      // Inserts em batch
      if (toInsert.length > 0) {
        const rows = toInsert.map((empresa_id) => ({
          empresa_id,
          acao_id: selectedAcaoId,
          elegivel,
          valor_potencial_estimado: valor,
          justificativa,
          user_id: user.id,
          qualificada_em: new Date().toISOString(),
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insErr } = await (supabase.from("elegibilidade") as any).insert(rows);
        if (insErr) throw insErr;
      }

      // Updates 1×1 (Supabase não tem update batch nativo — fazemos em paralelo)
      if (toUpdate.length > 0) {
        await Promise.all(toUpdate.map((empresa_id) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (supabase.from("elegibilidade") as any)
            .update({
              elegivel,
              valor_potencial_estimado: valor,
              justificativa,
              qualificada_em: new Date().toISOString(),
            })
            .eq("id", existingMap.get(empresa_id));
        }));
      }

      await logAudit({
        tabela: "elegibilidade",
        acao: "Qualificação em lote (modo rápido)",
        detalhes: {
          acao_id: selectedAcaoId,
          total: empresaIds.length,
          inseridas: toInsert.length,
          atualizadas: toUpdate.length,
          elegivel,
        },
      });

      toast.success(
        `${empresaIds.length} elegibilidade${empresaIds.length === 1 ? "" : "s"} salva${empresaIds.length === 1 ? "" : "s"}` +
        (toUpdate.length > 0 ? ` (${toUpdate.length} atualizada${toUpdate.length === 1 ? "" : "s"})` : "")
      );
      qc.invalidateQueries({ queryKey: ["elegibilidade"] });
      qc.invalidateQueries({ queryKey: ["matriz-elegs"] });
      qc.invalidateQueries({ queryKey: ["elegibilidade-recentes"] });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "falha";
      toast.error("Erro no lote: " + msg);
    } finally {
      setSaving(false);
    }
  };

  const progress = total > 0 ? Math.round((currentIdx / total) * 100) : 0;

  return (
    <>
      <Dialog open={open && !wizardOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Qualificação em lote ({total} empresa{total !== 1 ? "s" : ""})
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Modo */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Modo</Label>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v as Mode)}
                className="grid grid-cols-2 gap-2"
              >
                <ToggleGroupItem value="quick" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground border h-auto py-2 flex-col gap-1">
                  <Zap className="h-4 w-4" />
                  <span className="text-xs">Rápido (mesma decisão p/ todas)</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="wizard" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground border h-auto py-2 flex-col gap-1">
                  <Wand2 className="h-4 w-4" />
                  <span className="text-xs">Wizard (1× por empresa)</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Ação */}
            <div className="space-y-2">
              <Label>Ação tributária</Label>
              <Select value={selectedAcaoId} onValueChange={setSelectedAcaoId}>
                <SelectTrigger><SelectValue placeholder="Selecione uma ação..." /></SelectTrigger>
                <SelectContent>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome} {a.tipo && <span className="text-muted-foreground text-[11px]">· {a.tipo}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Modo rápido — campos */}
            {mode === "quick" && (
              <div className="space-y-3 border border-border rounded-md p-3 bg-muted/20">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Resultado</Label>
                  <ToggleGroup
                    type="single"
                    value={quickElegivel}
                    onValueChange={(v) => v && setQuickElegivel(v as "yes" | "no")}
                    className="grid grid-cols-2 gap-2"
                  >
                    <ToggleGroupItem value="yes" className="data-[state=on]:bg-success data-[state=on]:text-success-foreground border gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />Elegível
                    </ToggleGroupItem>
                    <ToggleGroupItem value="no" className="data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground border gap-1.5">
                      <XCircle className="h-4 w-4" />Não elegível
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {quickElegivel === "yes" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor potencial estimado por empresa (R$)</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="Opcional — ex: 50000"
                      value={quickValor}
                      onChange={(e) => setQuickValor(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Justificativa (aplicada a todas)</Label>
                  <Textarea
                    rows={2}
                    placeholder={quickElegivel === "yes"
                      ? "Ex: Empresa atende aos critérios da tese (CNAE, regime tributário, porte)."
                      : "Ex: Optante do Simples Nacional — fora do escopo da tese."}
                    value={quickJustificativa}
                    onChange={(e) => setQuickJustificativa(e.target.value)}
                  />
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Modo rápido grava a mesma decisão para todas as empresas selecionadas. Empresas que já tinham elegibilidade desta ação serão <strong>atualizadas</strong>.
                </p>
              </div>
            )}

            {/* Lista */}
            <div>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Empresas no lote</Label>
              <Card className="mt-1.5 p-2 max-h-40 overflow-y-auto">
                {empresas.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhuma empresa selecionada</p>
                ) : (
                  <ul className="space-y-1">
                    {empresas.map((e, i) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted/50">
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{e.nome}</span>
                        <Badge variant="secondary" className="h-4 text-[9px] ml-auto shrink-0">{i + 1}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {mode === "wizard" && currentIdx > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progresso do lote</span>
                  <span className="font-medium tabular-nums">{currentIdx}/{total} · {progress}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            {mode === "quick" ? (
              <Button onClick={handleQuickSubmit} disabled={!selectedAcaoId || total === 0 || saving}>
                {saving ? "Salvando..." : `Salvar ${total} elegibilidade${total === 1 ? "" : "s"}`}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button onClick={handleStartWizard} disabled={!selectedAcaoId || total === 0}>
                {currentIdx === 0 ? "Iniciar wizard" : "Continuar"}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {wizardOpen && current && acao && (
        <QualificacaoWizard
          open={wizardOpen}
          onClose={handleWizardClose}
          empresa={current as Pick<Empresa, "id" | "nome" | "cnpj">}
          acao={acao as Pick<Acao, "id" | "nome" | "tipo">}
          onSaved={handleSaved}
        />
      )}

      {wizardOpen && current && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]">
          <Card className="px-3 py-1.5 shadow-elevated flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Lote {currentIdx + 1}/{total}</span>
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={handleSkip}>
              Pular esta
            </Button>
          </Card>
        </div>
      )}
    </>
  );
}
