import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Sparkles, Square, Play,
} from "lucide-react";
import { useBulkEnrich, type BulkScope } from "@/hooks/useBulkEnrich";
import { cn } from "@/lib/utils";

interface BulkEnrichDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkEnrichDialog({ open, onOpenChange }: BulkEnrichDialogProps) {
  const { progress, start, cancel, reset } = useBulkEnrich();
  const [scope, setScope] = useState<BulkScope>("missing");

  const isRunning = progress.status === "running";
  const isDone = progress.status === "done" || progress.status === "cancelled";
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const elapsedSec = progress.startedAt
    ? Math.round(((progress.finishedAt ?? Date.now()) - progress.startedAt) / 1000)
    : 0;
  const avgMs = progress.processed > 0 ? Math.round((elapsedSec * 1000) / progress.processed) : 0;
  const etaSec = progress.processed > 0 && isRunning
    ? Math.round(((progress.total - progress.processed) * avgMs) / 1000)
    : 0;

  const handleStart = () => {
    start({ scope, delayMs: 600 });
  };

  const handleClose = () => {
    if (isRunning) {
      // se cancelando, pede confirmação
      if (!confirm("Cancelar o enriquecimento em andamento?")) return;
      cancel();
    }
    onOpenChange(false);
    if (isDone) reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Enriquecimento RFB em lote
          </DialogTitle>
        </DialogHeader>

        {/* Setup (antes de iniciar) */}
        {progress.status === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Consulta a Receita Federal (via BrasilAPI) e atualiza os dados de todas as empresas selecionadas.
              Processamento sequencial com delay de 600ms pra respeitar rate limit (~100 empresas/minuto).
            </p>

            <RadioGroup value={scope} onValueChange={(v) => setScope(v as BulkScope)} className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="missing" className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-warning" />
                    Apenas faltantes (recomendado)
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Empresas sem dados de RFB ou com erro da última consulta.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                <RadioGroupItem value="all" className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Todas as empresas
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Reconsulta tudo, ignorando cache. Use pra refresh massivo (lento).
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>
        )}

        {/* Progresso em andamento */}
        {isRunning && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <RefreshCw className="inline h-3.5 w-3.5 mr-1.5 animate-spin text-primary" />
                  Processando {progress.processed + 1} de {progress.total}
                </p>
                {progress.current && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    → {progress.current.nome}
                  </p>
                )}
              </div>
              <Badge variant="secondary" className="tabular-nums">{pct}%</Badge>
            </div>

            <Progress value={pct} className="h-2" />

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Card className="p-2 text-center">
                <div className="text-muted-foreground">Sucesso</div>
                <div className="text-success font-bold tabular-nums">{progress.success}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-muted-foreground">Falhas</div>
                <div className="text-destructive font-bold tabular-nums">{progress.failed}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-muted-foreground">ETA</div>
                <div className="font-bold tabular-nums">{etaSec > 0 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : "—"}</div>
              </Card>
            </div>

            {progress.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-destructive">{progress.errors.length} erro(s)</summary>
                <ScrollArea className="max-h-32 mt-2">
                  <ul className="space-y-1">
                    {progress.errors.slice(-10).map((err, i) => (
                      <li key={i} className="px-2 py-1 bg-destructive/5 rounded">
                        <span className="font-medium">{err.empresa.nome}:</span>{" "}
                        <span className="text-muted-foreground">{err.erro}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </details>
            )}
          </div>
        )}

        {/* Finalizado */}
        {isDone && (
          <div className="space-y-4">
            <Card className={cn(
              "p-4 flex items-center gap-3",
              progress.status === "cancelled" ? "bg-warning/5 border-warning/30" : "bg-success/5 border-success/30",
            )}>
              {progress.status === "cancelled" ? (
                <Square className="h-8 w-8 text-warning shrink-0" />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-success shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-heading text-h3">
                  {progress.status === "cancelled" ? "Cancelado" : "Concluído"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {progress.success} sucessos · {progress.failed} falhas · {elapsedSec}s total
                </p>
              </div>
            </Card>

            {progress.errors.length > 0 && (
              <div>
                <Label className="text-xs text-destructive">Erros ({progress.errors.length})</Label>
                <ScrollArea className="max-h-40 mt-1.5 border rounded">
                  <ul className="text-xs divide-y">
                    {progress.errors.map((err, i) => (
                      <li key={i} className="p-2 hover:bg-muted/30">
                        <div className="font-medium">{err.empresa.nome}</div>
                        <div className="text-muted-foreground text-[11px]">{err.empresa.cnpj}</div>
                        <div className="text-destructive mt-0.5">{err.erro}</div>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {progress.status === "idle" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleStart}>
                <Play className="mr-1.5 h-3.5 w-3.5" />Iniciar
              </Button>
            </>
          )}
          {isRunning && (
            <Button variant="destructive" onClick={cancel}>
              <Square className="mr-1.5 h-3.5 w-3.5" />Parar
            </Button>
          )}
          {isDone && (
            <>
              <Button variant="outline" onClick={() => { reset(); }}>Novo lote</Button>
              <Button onClick={handleClose}>Fechar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
