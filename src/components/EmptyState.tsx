import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  /** Variante compacta para dentro de colunas de Kanban etc. */
  size?: "default" | "compact";
  className?: string;
  children?: ReactNode;
}

/**
 * Empty state ativo — sempre guia o usuário ao próximo passo.
 * Nielsen heuristic #10: ajuda e documentação. Não deixa vazio.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
  className,
  children,
}: EmptyStateProps) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "rounded-lg border border-dashed border-border bg-muted/20",
        compact ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
      role="status"
    >
      {Icon && (
        <div
          className={cn(
            "rounded-full bg-muted/60 flex items-center justify-center mb-3",
            compact ? "h-9 w-9" : "h-12 w-12",
          )}
          aria-hidden="true"
        >
          <Icon className={cn("text-muted-foreground", compact ? "h-4 w-4" : "h-6 w-6")} />
        </div>
      )}
      <p className={cn("font-heading font-semibold text-foreground", compact ? "text-sm" : "text-h3")}>
        {title}
      </p>
      {description && (
        <p className={cn("text-muted-foreground max-w-sm mt-1", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      )}
      {children && <div className="mt-3">{children}</div>}
      {action && (
        <Button
          onClick={action.onClick}
          size={compact ? "sm" : "default"}
          className="mt-4"
        >
          {action.icon && <action.icon className="mr-2 h-4 w-4" aria-hidden="true" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}
