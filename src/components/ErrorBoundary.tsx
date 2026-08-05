import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Erro de chunk/lazy desatualizado (deploy novo mudou os hashes; a aba antiga
// pede um chunk que não existe mais). A rejeição do React.lazy chega AQUI (não
// no window.error de main.tsx), então o auto-reload precisa acontecer no boundary.
// O "reading 'default'" cobre o caso em que o Vercel devolvia index.html no lugar
// do JS (agora corrigido no rewrite, mas mantido por segurança).
function isChunkLoadError(error: Error | null): boolean {
  const s = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|module script failed|Loading chunk|Loading CSS chunk|MIME type of ("|')?text\/html|Unexpected token '<'|reading 'default'/i.test(
    s
  );
}

// Recarrega no máximo 1x/min (mesma chave do handler de main.tsx) — evita loop
// se o erro persistir (aí mostra o boundary de verdade).
function reloadOnceEmChunkError(): boolean {
  const KEY = "chunk-error-reload-ts";
  try {
    const ultimo = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - ultimo < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sessionStorage indisponível — recarrega mesmo assim */
  }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Chunk desatualizado: recarrega automaticamente (uma vez) em vez de mostrar
    // "Algo deu errado" — o reload traz o index.html novo com os hashes certos.
    if (isChunkLoadError(error) && reloadOnceEmChunkError()) return;
    console.error("[ErrorBoundary] Erro capturado:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="font-heading text-xl font-semibold">Algo deu errado</h1>
          <p className="text-sm text-muted-foreground">
            O sistema encontrou um erro inesperado. Tente recarregar a página.
          </p>
          <details className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-left font-mono text-xs text-muted-foreground">
            <summary className="mb-2 cursor-pointer font-sans text-sm text-foreground">
              Detalhes do erro
            </summary>
            <p className="font-semibold">{error.message}</p>
            {error.stack && <pre className="mt-2 whitespace-pre-wrap break-all">{error.stack}</pre>}
          </details>
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Recarregar página
          </Button>
        </div>
      </div>
    );
  }
}
