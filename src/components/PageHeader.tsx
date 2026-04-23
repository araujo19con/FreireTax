import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** conteúdo extra abaixo do título (ex: filtros, tabs) */
  children?: ReactNode;
  className?: string;
  /** Se presente, exibe um ícone "?" que leva pra /tutorial na aba indicada. */
  helpTutorialTab?: "bem-vindo" | "fluxo" | "glossario" | "perfis" | "dicas";
  /** Tooltip do ícone de ajuda — default: "Ver no tutorial". */
  helpTooltip?: string;
}

/**
 * Cabeçalho de página padronizado. Garante hierarquia consistente
 * (h1 com Playfair, descrição muted, slot de actions à direita).
 *
 * Uso:
 *   <PageHeader
 *     title="Prospecção"
 *     description="Pipeline comercial — cadência 7 toques"
 *     icon={<Handshake className="h-7 w-7" />}
 *     actions={<Button><Plus /> Nova</Button>}
 *   />
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
  helpTutorialTab,
  helpTooltip,
}: PageHeaderProps) {
  return (
    <header className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-h1 tracking-tight flex items-center gap-3 text-foreground">
          {icon && <span aria-hidden="true" className="text-primary">{icon}</span>}
          <span className="truncate">{title}</span>
          {helpTutorialTab && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={`/tutorial?tab=${helpTutorialTab}`}
                    aria-label={helpTooltip ?? "Ver no tutorial"}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{helpTooltip ?? "Ver no tutorial"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{description}</p>
        )}
        {children}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
