import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Erro capturado:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="font-heading text-xl font-semibold">Algo deu errado</h1>
          <p className="text-sm text-muted-foreground">
            O sistema encontrou um erro inesperado. Tente recarregar a página.
          </p>
          <details className="text-left rounded-md border border-border bg-muted/40 p-3 text-xs font-mono text-muted-foreground overflow-auto max-h-40">
            <summary className="cursor-pointer mb-2 font-sans text-sm text-foreground">
              Detalhes do erro
            </summary>
            <p className="font-semibold">{error.message}</p>
            {error.stack && (
              <pre className="mt-2 whitespace-pre-wrap break-all">{error.stack}</pre>
            )}
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
