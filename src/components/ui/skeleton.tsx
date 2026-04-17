import { cn } from "@/lib/utils";

/**
 * Skeleton com gradiente shimmer — mais informativo que pulse plano.
 * Usar com a SHAPE do conteúdo final, não um bloco genérico.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:animate-[shimmer_1.8s_ease-in-out_infinite]",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/5 before:to-transparent",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
