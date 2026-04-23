import { HelpCircle } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Ícone "?" discreto ao lado de um Label pra explicar um campo com jargão.
 * Uso:
 *   <Label>Regras de elegibilidade <FieldHelp>Filtros que ...</FieldHelp></Label>
 */
export function FieldHelp({ children, side = "top" }: { children: string; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          tabIndex={0}
          className="inline-flex ml-1 text-muted-foreground hover:text-foreground align-middle"
          aria-label="Ajuda sobre este campo"
          onClick={(e) => e.preventDefault()}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
