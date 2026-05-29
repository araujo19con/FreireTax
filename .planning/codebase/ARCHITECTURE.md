# Architecture

**Analysis Date:** 2026-05-29

## Overview

Tax Trakker is a React 18 SPA (Vite + TypeScript) backed by Supabase (Postgres + Auth + Edge Functions). The architecture is page-centric: each top-level route maps to a large page component in `src/pages/`, which composes domain hooks (TanStack Query wrappers over Supabase) with shadcn/ui primitives and shared dialog/filter components. There is no Redux or Zustand — server state lives in TanStack Query, auth state lives in a single `AuthProvider` context, and local UI state lives in `useState` within each page. All Supabase queries go through the typed client at `src/integrations/supabase/client.ts`; mutations use `useMutation` + `queryClient.invalidateQueries` for cache sync.

## Data Flow

```
User action (click / form submit)
  → Page component (e.g., Empresas.tsx)
    → Domain hook mutation (e.g., useCreateEmpresa → useMutation)
      → supabase client (src/integrations/supabase/client.ts)
        → PostgREST / Supabase Auth / Edge Function
          → Postgres (RLS enforced at DB level)
      ← { data, error } (PostgrestResponse)
    ← React Query cache invalidated → useQuery refetch
  ← Component re-renders with fresh data
  → toast (sonner) for user feedback
```

For bulk/large datasets: `fetchAllRows` (`src/lib/supabaseFetchAll.ts`) paginates PostgREST in 1000-row chunks since PostgREST silently caps at max-rows. Used by Dashboard, Acoes, and export flows.

For RFB enrichment: `useBulkEnrich` (`src/hooks/useBulkEnrich.ts`) → edge function `enrich-cnpj` → BrasilAPI → `cnpj_cache` upsert → `empresas` update.

## Auth & Permissions

Auth is managed entirely by `src/hooks/useAuth.tsx` via `AuthProvider` (wraps the whole app in `src/App.tsx`).

On mount, `AuthProvider` calls `supabase.auth.getSession()` then subscribes to `onAuthStateChange`. Profile and roles are fetched in parallel from `profiles` and `user_roles` tables. A `reqIdRef` pattern cancels stale requests if auth state changes rapidly.

**Roles** (stored in `user_roles.role`, typed as `app_role` enum):

- `admin` — full access; exposed as `isAdmin` on context
- `gestor` — management access; exposed as `isGestor`
- `canManageAll` = `isAdmin || isGestor` — controls sidebar visibility for equipe/admin views
- `advogado`, `comercial` — standard users; can only see own tasks (`assigned_to = auth.uid()`)

**Route guard:** `RequireAdmin` component in `src/App.tsx` wraps `/usuarios` — redirects non-admins to `/`. All other routes require only an authenticated session (redirect to `/auth` if `!user`).

**RLS:** Enforced at the Postgres level by Supabase. The front-end does not duplicate access control logic beyond the role checks above.

## Key Patterns

**Domain hooks with TanStack Query:**
Every data domain has a hook file in `src/hooks/`. Hooks export both `useQuery` calls (read) and `useMutation` calls (write), always calling `queryClient.invalidateQueries` after mutations to keep cache consistent. Example: `useEmpresas`, `useCreateEmpresa`, `useUpdateEmpresa` all live in `src/hooks/useEmpresas.ts`.

**QueryClient configuration (`src/App.tsx`):**

- `staleTime: 30_000` — avoids aggressive refetches in CRM context
- `refetchOnWindowFocus: false` — explicit opt-out
- Retry: no retry on 4xx, up to 2 retries on 5xx with exponential backoff

**Lazy loading + Suspense:**
All page components are `React.lazy()`-loaded in `src/App.tsx`. A `<Suspense fallback={<PageFallback />}>` wraps the `<Routes>`. Heavy sub-components within pages (e.g., `EmpresasMapView`) also use inline `lazy()`.

**Shared filter pattern:**
`EmpresaFilterPopover` + `EmpresaFilterChips` (`src/components/EmpresaFilterPopover.tsx`) are the single source of empresa filter UI. Used by both `src/pages/Empresas.tsx` and Matriz Elegibilidade — never duplicated.

**Dialog pattern:**
Domain dialogs (`EmpresaDialog`, `TarefaDialog`, `ReuniaoDialog`, `PropostaDialog`) are self-contained: they fetch their own related data (profiles, empresas, prospeccoes) on open via internal queries, not via prop-drilling from parent.

**Compound page pattern (`Acoes.tsx`):**
The Acoes page renders a list of `acoes_tributarias`; expanding an item renders `AcaoEmpresasPanel` (`src/pages/acoes/AcaoEmpresasPanel.tsx`) — the eligibility matrix for that tese — which in turn uses `AcaoEmpresasFilterPopover` for its own filter state. Each expanded panel is independent.

**In-memory filtering:**
`src/lib/empresaFiltersInMemory.ts` — some filter combinations are applied client-side after fetching all rows (used for export and kanban views).

**Audit logging:**
`src/lib/audit.ts` — `logAudit(action, metadata)` writes to an audit table. Called explicitly in mutations (delete empresa, delete acao, etc.).

**Error handling:**
`src/lib/errors.ts` — `extractErrorMessage(err)` handles both native `Error` and Supabase `PostgrestError` (which is NOT `instanceof Error`). `isUniqueViolation(err)` checks CNPJ duplicate errors (`code === "23505"`). `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps `AppRoutes` and `App` for React-level crash recovery.

**Forms:**
`react-hook-form` + `@hookform/resolvers/zod` throughout all dialogs. Schema defined inline with zod.

**Toasts:** `sonner` (`import { toast } from "sonner"`) — preferred over the older radix-based `use-toast`.

**Date handling:** `date-fns` with `ptBR` locale for display; ISO strings from Supabase.

**Chunk error auto-reload (`src/main.tsx`):**
Listens for `vite:preloadError` and chunk-related unhandled rejections — reloads the page once per minute to recover from stale chunk hashes after Vercel deploys.

## Page / Route Map

| URL                    | Component                              | Guard                          | Description                                                    |
| ---------------------- | -------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `/`                    | `src/pages/Dashboard.tsx`              | user                           | KPIs, funil Hormozi, charts (recharts), resumo de pipeline     |
| `/empresas`            | `src/pages/Empresas.tsx`               | user                           | CRUD empresas; 4 views: table, card, kanban, map (lazy)        |
| `/acoes`               | `src/pages/Acoes.tsx`                  | user                           | CRUD teses tributarias; expand por acao → matrix elegibilidade |
| `/elegibilidade`       | `src/pages/Elegibilidade.tsx`          | user                           | Legado — sem menu; matriz simplificada                         |
| `/prospeccao`          | `src/pages/Prospeccao.tsx`             | user                           | Kanban de pipeline comercial; mover cards entre status         |
| `/importacao`          | `src/pages/Importacao.tsx`             | user                           | Importacao de empresas via planilha XLSX                       |
| `/analise-rfb`         | `src/pages/AnaliseRFB.tsx`             | user                           | Analise de dados RFB; busca por CNPJ/razao social              |
| `/admin`               | `src/pages/Admin.tsx`                  | user                           | Configuracoes gerais (embeds TemplatesAdmin)                   |
| `/usuarios`            | `src/pages/Usuarios.tsx`               | **admin**                      | CRUD usuarios + atribuicao de papeis                           |
| `/auditoria`           | `src/pages/Auditoria.tsx`              | user                           | Log de acoes (audit trail)                                     |
| `/meu-espaco`          | `src/pages/MeuEspaco.tsx`              | user                           | Hub pessoal com abas (tarefas, agenda, semana)                 |
| `/minhas-tarefas`      | `src/pages/MinhasTarefas.tsx`          | user                           | Legado — tarefas do usuario logado                             |
| `/minha-agenda`        | `src/pages/MinhaAgenda.tsx`            | user                           | Legado — agenda do usuario logado                              |
| `/minha-semana`        | `src/pages/MinhaSemana.tsx`            | user                           | Legado — visao semanal do usuario                              |
| `/tarefas/equipe`      | `src/pages/tarefas/EquipeView.tsx`     | user (visivel so gestor/admin) | Tarefas de toda a equipe                                       |
| `/tarefas/templates`   | `src/pages/tarefas/TemplatesAdmin.tsx` | user                           | Templates de tarefas (embed em /admin)                         |
| `/propostas/templates` | `src/pages/PropostasTemplates.tsx`     | user                           | Templates de propostas (Tiptap rich text)                      |
| `/relatorios`          | `src/pages/Relatorios.tsx`             | user                           | Relatorios exportaveis                                         |
| `/financeiro`          | `src/pages/Financeiro.tsx`             | user                           | Visao financeira do pipeline                                   |
| `/prazos`              | `src/pages/Prazos.tsx`                 | user                           | Gestao de prazos processuais                                   |
| `/tutorial`            | `src/pages/Tutorial.tsx`               | user                           | Onboarding guiado                                              |
| `/auth`                | `src/pages/Auth.tsx`                   | non-user                       | Login / cadastro                                               |
| `/reset-password`      | `src/pages/ResetPassword.tsx`          | —                              | Redefinicao de senha                                           |
| `*`                    | `src/pages/NotFound.tsx`               | —                              | 404                                                            |

---

_Architecture analysis: 2026-05-29_
