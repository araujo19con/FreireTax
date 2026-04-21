import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { FileText, Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTarefasTemplates, type TarefaTemplate } from "@/hooks/useTarefasExtras";

interface TemplatePickerProps {
  onPick: (template: TarefaTemplate) => void;
  /** ID da ação associada — se fornecido, filtra templates vinculados */
  acaoId?: string | null;
  className?: string;
}

const PRIO_COLOR: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-info/10 text-info",
  baixa: "bg-muted text-muted-foreground",
};

export function TemplatePicker({ onPick, acaoId, className }: TemplatePickerProps) {
  const { data: templates = [], isLoading } = useTarefasTemplates();
  const [open, setOpen] = useState(false);

  const filtered = acaoId
    ? [...templates.filter((t) => t.acao_id === acaoId), ...templates.filter((t) => !t.acao_id)]
    : templates;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
          disabled={isLoading || templates.length === 0}
          title={templates.length === 0 ? "Crie templates em /tarefas/templates" : "Aplicar template"}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Aplicar template
          {templates.length > 0 && (
            <Badge variant="secondary" className="h-4 text-[9px] ml-1">{templates.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <Command>
          <CommandInput placeholder="Buscar template..." />
          <CommandList>
            <CommandEmpty>Nenhum template encontrado.</CommandEmpty>
            <CommandGroup>
              {filtered.map((t) => {
                const subs = Array.isArray(t.subtarefas_padrao) ? t.subtarefas_padrao : [];
                return (
                  <CommandItem
                    key={t.id}
                    value={`${t.nome} ${t.categoria ?? ""} ${t.titulo_padrao}`}
                    onSelect={() => {
                      onPick(t);
                      setOpen(false);
                    }}
                    className="flex flex-col items-start gap-1 py-2.5 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm truncate flex-1">{t.nome}</span>
                      {t.prioridade_padrao && (
                        <Badge variant="outline" className={`text-[9px] h-4 ${PRIO_COLOR[t.prioridade_padrao] || ""}`}>
                          {t.prioridade_padrao}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pl-5">
                      {t.categoria && <span>· {t.categoria}</span>}
                      {t.prazo_relativo_dias != null && <span>· +{t.prazo_relativo_dias}d</span>}
                      {subs.length > 0 && <span>· {subs.length} subtarefa{subs.length > 1 ? "s" : ""}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground pl-5 truncate w-full">
                      → {t.titulo_padrao}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

void Check;
