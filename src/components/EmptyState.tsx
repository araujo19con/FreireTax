import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";

interface EmptyActionBase {
  label: string;
  icon?: LucideIcon;
}
type EmptyAction =
  | (EmptyActionBase & { onClick: () => void; to?: never })
  | (EmptyActionBase & { to: string; onClick?: never });

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Ação primária (botão cheio). Pode ter onClick ou to (link interno). */
  action?: EmptyAction;
  /** Ação secundária opcional (botão ghost, ao lado da primária). */
  secondaryAction?: EmptyAction;
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
  secondaryAction,
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
      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
          {action && <EmptyActionButton action={action} size={compact ? "sm" : "default"} variant="default" />}
          {secondaryAction && (
            <EmptyActionButton action={secondaryAction} size={compact ? "sm" : "default"} variant="ghost" />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyActionButton({
  action,
  size,
  variant,
}: {
  action: EmptyAction;
  size: "sm" | "default";
  variant: "default" | "ghost";
}) {
  const content = (
    <>
      {action.icon && <action.icon className="mr-2 h-4 w-4" aria-hidden="true" />}
      {action.label}
    </>
  );
  if (action.to) {
    return (
      <Button asChild size={size} variant={variant}>
        <Link to={action.to}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button onClick={action.onClick} size={size} variant={variant}>
      {content}
    </Button>
  );
}
