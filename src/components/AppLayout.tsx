import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Rotas → label legível para breadcrumb contextual.
 * Centralizado aqui pra sincronizar com a sidebar.
 */
const ROUTE_LABELS: Record<string, string> = {
  "/":              "Dashboard",
  "/empresas":      "Empresas",
  "/acoes":         "Ações Tributárias",
  "/elegibilidade": "Elegibilidade",
  "/prospeccao":    "Prospecção",
  "/importacao":    "Importação",
  "/minhas-tarefas":"Minhas Tarefas",
  "/minha-agenda":  "Minha Agenda",
  "/admin":         "Administração",
  "/usuarios":      "Usuários",
  "/auditoria":     "Auditoria",
};

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const currentLabel = ROUTE_LABELS[location.pathname] ?? "";
  const isRoot = location.pathname === "/";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between gap-3 border-b border-border bg-card/80 backdrop-blur-sm px-4 shrink-0 sticky top-0 z-30">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger
                className="shrink-0"
                aria-label="Alternar menu lateral"
              />
              {/* Breadcrumb contextual */}
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
                <Link
                  to="/"
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Ir para Dashboard"
                >
                  <Home className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                {!isRoot && currentLabel && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
                    <span className="font-medium text-foreground truncate" aria-current="page">
                      {currentLabel}
                    </span>
                  </>
                )}
              </nav>
            </div>
            {/* Slot direito reservado para ações globais futuras (busca, perfil, notifs) */}
            <div className="flex items-center gap-2" />
          </header>
          <main className="flex-1 p-6 overflow-auto" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
