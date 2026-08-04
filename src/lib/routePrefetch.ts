// Prefetch do CHUNK lazy da rota ao passar o mouse (ou focar) no item do menu:
// o JS da página já baixa ANTES do clique, então a navegação abre mais rápido
// (some o "carregando" da 1ª visita). Idempotente — só dispara uma vez por rota;
// o import() do Vite/browser cacheia o módulo depois disso.
//
// Mantém em sincronia com os lazy() do App.tsx (mesmas rotas do AppSidebar).

const routeImports: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Dashboard"),
  "/empresas": () => import("@/pages/Empresas"),
  "/contatos": () => import("@/pages/Contatos"),
  "/acoes": () => import("@/pages/Acoes"),
  "/elegibilidade": () => import("@/pages/Elegibilidade"),
  "/prospeccao": () => import("@/pages/Prospeccao"),
  "/analise-rfb": () => import("@/pages/AnaliseRFB"),
  "/relatorios": () => import("@/pages/Relatorios"),
  "/financeiro": () => import("@/pages/Financeiro"),
  "/prazos": () => import("@/pages/Prazos"),
  "/importacao": () => import("@/pages/Importacao"),
  "/meu-espaco": () => import("@/pages/MeuEspaco"),
  "/tarefas/equipe": () => import("@/pages/tarefas/EquipeView"),
  "/tutorial": () => import("@/pages/Tutorial"),
  "/admin": () => import("@/pages/Admin"),
  "/propostas/templates": () => import("@/pages/PropostasTemplates"),
  "/usuarios": () => import("@/pages/Usuarios"),
  "/auditoria": () => import("@/pages/Auditoria"),
};

const jaFeito = new Set<string>();

export function prefetchRoute(path: string): void {
  if (jaFeito.has(path)) return;
  const imp = routeImports[path];
  if (!imp) return;
  jaFeito.add(path);
  void imp().catch(() => jaFeito.delete(path)); // re-tenta se a rede falhar
}
