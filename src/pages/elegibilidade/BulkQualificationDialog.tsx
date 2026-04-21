import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Building2, ArrowRight, Play } from "lucide-react";
import { useAcoes, type Acao } from "@/hooks/useAcoes";
import { useEmpresasSimple, type Empresa } from "@/hooks/useEmpresas";
import { QualificacaoWizard } from "./QualificacaoWizard";

interface BulkQualificationDialogProps {
  open: boolean;
  onClose: () => void;
  /** Empresas pré-selecionadas (ex: vindas da aba Empresas via bulk action) */
  empresaIds: string[];
}

export function BulkQualificationDialog({ open, onClose, empresaIds }: BulkQualificationDialogProps) {
  const [selectedAcaoId, setSelectedAcaoId] = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);

  const acoesQ = useAcoes();
  const empresasQ = useEmpresasSimple();

  const acoes = acoesQ.data ?? [];
  const allEmpresas = useMemo(() => empresasQ.data ?? [], [empresasQ.data]);
  const empresas = useMemo(
    () => allEmpresas.filter((e) => empresaIds.includes(e.id)),
    [allEmpresas, empresaIds],
  );

  const acao = acoes.find((a) => a.id === selectedAcaoId);
  const current = empresas[currentIdx];
  const total = empresas.length;

  const handleStart = () => {
    if (!selectedAcaoId) return;
    setCurrentIdx(0);
    setWizardOpen(true);
  };

  const handleWizardClose = () => {
    setWizardOpen(false);
  };

  const handleSaved = () => {
    setWizardOpen(false);
    // Avança pra próxima empresa
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
      setTimeout(() => setWizardOpen(true), 250);
    } else {
      // Terminou lote
      setTimeout(() => onClose(), 500);
    }
  };

  const handleSkip = () => {
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
    } else {
      onClose();
    }
  };

  const progress = total > 0 ? Math.round(((currentIdx) / total) * 100) : 0;

  return (
    <>
      <Dialog open={open && !wizardOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Qualificação em lote ({total} empresa{total !== 1 ? "s" : ""})
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ação tributária a qualificar</Label>
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
              <p className="text-[11px] text-muted-foreground">
                O wizard de qualificação abrirá uma vez para cada empresa, aplicando os critérios desta ação.
              </p>
            </div>

            <div>
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Empresas no lote</Label>
              <Card className="mt-1.5 p-2 max-h-48 overflow-y-auto">
                {empresas.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Nenhuma empresa selecionada
                  </p>
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

            {currentIdx > 0 && (
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
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleStart} disabled={!selectedAcaoId || total === 0}>
              {currentIdx === 0 ? "Iniciar lote" : "Continuar"}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wizard aninhado - um por vez */}
      {wizardOpen && current && acao && (
        <QualificacaoWizard
          open={wizardOpen}
          onClose={handleWizardClose}
          empresa={current as Pick<Empresa, "id" | "nome" | "cnpj">}
          acao={acao as Pick<Acao, "id" | "nome" | "tipo">}
          onSaved={handleSaved}
        />
      )}

      {/* Skip button visible during wizard — rendered em um dialog auxiliar flutuante */}
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
