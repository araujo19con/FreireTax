import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** conteúdo extra abaixo do título (ex: filtros, tabs) */
  children?: ReactNode;
  className?: string;
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
}: PageHeaderProps) {
  return (
    <header className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-h1 tracking-tight flex items-center gap-3 text-foreground">
          {icon && <span aria-hidden="true" className="text-primary">{icon}</span>}
          <span className="truncate">{title}</span>
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
