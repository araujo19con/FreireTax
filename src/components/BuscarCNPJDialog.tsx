import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import { useBuscarCNPJ, type CandidatoCNPJ } from "@/hooks/useBuscarCNPJ";
import { maskCNPJ } from "@/lib/cnpj";
import { cn } from "@/lib/utils";

interface BuscarCNPJDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Termo inicial — geralmente o nome da empresa já cadastrado */
  termoInicial?: string;
  /** UF padrão pra filtrar (se conhecido) */
  ufInicial?: string;
  /** Callback quando o usuário confirma um candidato */
  onSelect: (candidato: CandidatoCNPJ) => void;
}

/** Cor do score: >0.7 = forte, 0.4-0.7 = médio, <0.4 = fraco */
function scoreColor(score: number): string {
  if (score >= 0.7) return "bg-success/10 text-success border-success/30";
  if (score >= 0.4) return "bg-warning/10 text-warning border-warning/30";
  return "bg-muted text-muted-foreground border-muted-foreground/20";
}

function scoreLabel(score: number): string {
  if (score >= 0.7) return "match forte";
  if (score >= 0.4) return "match médio";
  return "match fraco";
}

export function BuscarCNPJDialog({
  open,
  onOpenChange,
  termoInicial = "",
  ufInicial = "",
  onSelect,
}: BuscarCNPJDialogProps) {
  const [termo, setTermo] = useState(termoInicial);
  const [uf, setUf] = useState(ufInicial);
  const [selectedCnpj, setSelectedCnpj] = useState<string | null>(null);
  const { loading, error, candidatos, buscar, reset } = useBuscarCNPJ();

  // Reset estado ao abrir/fechar
  useEffect(() => {
    if (open) {
      setTermo(termoInicial);
      setUf(ufInicial);
      setSelectedCnpj(null);
      reset();
      // Se já tem termo inicial válido, dispara busca automática
      if (termoInicial && termoInicial.trim().length >= 3) {
        buscar(termoInicial.trim(), ufInicial || undefined);
      }
    }
  }, [open, termoInicial, ufInicial, buscar, reset]);

  const handleBuscar = () => {
    if (termo.trim().length < 3) return;
    setSelectedCnpj(null);
    buscar(termo.trim(), uf || undefined);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleBuscar();
  };

  const selecionar = (c: CandidatoCNPJ) => {
    setSelectedCnpj(c.cnpj);
  };

  const confirmar = () => {
    const escolhido = candidatos.find((c) => c.cnpj === selectedCnpj);
    if (escolhido) {
      onSelect(escolhido);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <Search className="h-5 w-5 text-primary" />
            Buscar CNPJ pelo nome
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="busca-termo" className="text-xs">
                Razão social ou nome fantasia
              </Label>
              <Input
                id="busca-termo"
                placeholder="Ex: Tech Solutions"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="busca-uf" className="text-xs">
                UF
              </Label>
              <Select value={uf || "_all"} onValueChange={(v) => setUf(v === "_all" ? "" : v)}>
                <SelectTrigger id="busca-uf">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="RN">RN</SelectItem>
                  <SelectItem value="PB">PB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={loading || termo.trim().length < 3}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-1.5">Buscar</span>
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            A busca é fuzzy (tolera variações). Resultados rankeados por similaridade. Apenas
            empresas ATIVAS nas UFs indexadas.
          </p>
        </form>

        {/* Estados */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && candidatos.length === 0 && termo.trim().length >= 3 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum candidato encontrado. Tente variar o termo ou retirar o filtro de UF.
          </div>
        )}

        {candidatos.length > 0 && (
          <ScrollArea className="min-h-0 flex-1 rounded-md border">
            <ul className="divide-y">
              {candidatos.map((c) => {
                const selected = c.cnpj === selectedCnpj;
                return (
                  <li key={c.cnpj}>
                    <button
                      type="button"
                      onClick={() => selecionar(c)}
                      className={cn(
                        "w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
                        selected && "bg-primary/10 hover:bg-primary/15"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            {selected && (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                            )}
                            <span className="truncate">{c.razao_social}</span>
                          </div>
                          {c.nome_fantasia && (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {c.nome_fantasia}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="font-mono">{maskCNPJ(c.cnpj)}</span>
                            <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {c.municipio ? `${c.municipio}/${c.uf}` : c.uf}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("shrink-0 text-[10px]", scoreColor(c.score))}
                        >
                          {Math.round(c.score * 100)}% · {scoreLabel(c.score)}
                        </Badge>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!selectedCnpj}>
            Usar este CNPJ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
