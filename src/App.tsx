import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Páginas em lazy-load — reduz o bundle inicial e melhora o TTI.
// A tela de login também fica em lazy: o único fluxo que precisa dela é
// usuário não-autenticado, então não vale penalizar os logados.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Empresas = lazy(() => import("./pages/Empresas"));
const Acoes = lazy(() => import("./pages/Acoes"));
const Elegibilidade = lazy(() => import("./pages/Elegibilidade"));
const Importacao = lazy(() => import("./pages/Importacao"));
const Admin = lazy(() => import("./pages/Admin"));
const Auditoria = lazy(() => import("./pages/Auditoria"));
const Prospeccao = lazy(() => import("./pages/Prospeccao"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MinhasTarefas = lazy(() => import("./pages/MinhasTarefas"));
const EquipeTarefas = lazy(() => import("./pages/tarefas/EquipeView"));
const TemplatesTarefas = lazy(() => import("./pages/tarefas/TemplatesAdmin"));
const PropostasTemplates = lazy(() => import("./pages/PropostasTemplates"));
const MinhaAgenda = lazy(() => import("./pages/MinhaAgenda"));
const MinhaSemana = lazy(() => import("./pages/MinhaSemana"));
const MeuEspaco = lazy(() => import("./pages/MeuEspaco"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const AnaliseRFB = lazy(() => import("./pages/AnaliseRFB"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Prazos = lazy(() => import("./pages/Prazos"));
const Tutorial = lazy(() => import("./pages/Tutorial"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Evita refetch agressivo em cada foco da aba; o CRM não precisa.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // Não retry em 4xx (bad request/auth); retry 2x em 5xx/network — resiliente em rede móvel.
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
    },
  },
});

function PageFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Carregando página"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        <span>Preparando a interface…</span>
      </div>
    </div>
  );
}

/**
 * Guard de rota — redireciona se o usuário não atende o predicado.
 * Evita renderizar a página (e fazer queries) antes da checagem.
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background"
        role="status"
        aria-live="polite"
      >
        <div
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10"
          aria-hidden="true"
        >
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
        <p className="font-heading text-sm text-muted-foreground">Carregando Tax Trakker…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <AppLayout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/empresas" element={<Empresas />} />
          <Route path="/acoes" element={<Acoes />} />
          <Route path="/elegibilidade" element={<Elegibilidade />} />
          <Route path="/prospeccao" element={<Prospeccao />} />
          <Route path="/importacao" element={<Importacao />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            }
          />
          <Route
            path="/usuarios"
            element={
              <RequireAdmin>
                <Usuarios />
              </RequireAdmin>
            }
          />
          <Route path="/meu-espaco" element={<MeuEspaco />} />
          <Route path="/minhas-tarefas" element={<MinhasTarefas />} />
          <Route path="/tarefas/equipe" element={<EquipeTarefas />} />
          <Route path="/tarefas/templates" element={<TemplatesTarefas />} />
          <Route path="/propostas/templates" element={<PropostasTemplates />} />
          <Route path="/minha-agenda" element={<MinhaAgenda />} />
          <Route path="/minha-semana" element={<MinhaSemana />} />
          <Route path="/analise-rfb" element={<AnaliseRFB />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/financeiro" element={<Financeiro />} />
          <Route path="/prazos" element={<Prazos />} />
          <Route path="/tutorial" element={<Tutorial />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
