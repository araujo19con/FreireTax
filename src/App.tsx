import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

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
const MinhaAgenda = lazy(() => import("./pages/MinhaAgenda"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const AnaliseRFB = lazy(() => import("./pages/AnaliseRFB"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Evita refetch agressivo em cada foco da aba; o CRM não precisa.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function PageFallback() {
  return (
    <div
      className="min-h-[40vh] flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Carregando página"
    >
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
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
        className="min-h-screen flex flex-col items-center justify-center bg-background gap-4"
        role="status"
        aria-live="polite"
      >
        <div className="h-11 w-11 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center" aria-hidden="true">
          <span className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
          <Route path="/admin" element={<Admin />} />
          <Route
            path="/usuarios"
            element={
              <RequireAdmin>
                <Usuarios />
              </RequireAdmin>
            }
          />
          <Route path="/minhas-tarefas" element={<MinhasTarefas />} />
          <Route path="/minha-agenda" element={<MinhaAgenda />} />
          <Route path="/analise-rfb" element={<AnaliseRFB />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
