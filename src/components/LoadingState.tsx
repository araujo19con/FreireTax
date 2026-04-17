import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  variant?: "page" | "kpi-grid" | "table" | "kanban" | "cards";
  /** Número de itens a renderizar (default varia por variante) */
  count?: number;
  className?: string;
}

/**
 * Loading state com SHAPE coerente ao conteúdo — não um spinner genérico.
 * Respeita hierarquia da página (header → KPIs → conteúdo) e evita
 * layout shift quando os dados chegam.
 */
export function LoadingState({ variant = "page", count, className }: LoadingStateProps) {
  if (variant === "page") {
    return (
      <div className={cn("space-y-6", className)} aria-busy="true" aria-label="Carregando conteúdo">
        {/* Header skeleton */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        {/* KPI grid */}
        <LoadingState variant="kpi-grid" />
        {/* Content */}
        <LoadingState variant="cards" count={3} />
      </div>
    );
  }

  if (variant === "kpi-grid") {
    const n = count ?? 4;
    return (
      <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", className)}>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "table") {
    const n = count ?? 6;
    return (
      <div className={cn("rounded-lg border border-border bg-card shadow-card overflow-hidden", className)}>
        <div className="border-b border-border p-3 flex gap-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="p-3 flex gap-4 border-b border-border last:border-0">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "kanban") {
    const n = count ?? 4;
    return (
      <div className={cn("flex gap-4 overflow-x-auto pb-4", className)}>
        {Array.from({ length: n }).map((_, col) => (
          <div key={col} className="flex-shrink-0 w-[300px] space-y-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3 shadow-card space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-14" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    const n = count ?? 3;
    return (
      <div className={cn("grid grid-cols-1 lg:grid-cols-3 gap-4", className)}>
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-5 shadow-card space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-32 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return null;
}
