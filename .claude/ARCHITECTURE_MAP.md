# Architecture Map

Mapa de "onde as coisas moram" — evita agentes re-explorarem o projeto.

## Rotas → páginas

| URL | Arquivo | Guard |
|-----|---------|-------|
| `/` | `pages/Dashboard.tsx` | user |
| `/empresas` | `pages/Empresas.tsx` | user |
| `/acoes` | `pages/Acoes.tsx` | user |
| `/elegibilidade` | `pages/Elegibilidade.tsx` | user (legacy, sem menu) |
| `/prospeccao` | `pages/Prospeccao.tsx` | user |
| `/analise-rfb` | `pages/AnaliseRFB.tsx` | user |
| `/importacao` | `pages/Importacao.tsx` | user |
| `/admin` | `pages/Admin.tsx` | user |
| `/usuarios` | `pages/Usuarios.tsx` | **admin** |
| `/auditoria` | `pages/Auditoria.tsx` | user |
| `/meu-espaco` | `pages/MeuEspaco.tsx` (hub c/ abas) | user |
| `/minha-semana` | `pages/MinhaSemana.tsx` (legacy, acessível direto) | user |
| `/minhas-tarefas` | `pages/MinhasTarefas.tsx` (legacy) | user |
| `/minha-agenda` | `pages/MinhaAgenda.tsx` (legacy) | user |
| `/tarefas/equipe` | `pages/tarefas/EquipeView.tsx` | user (visível só gestor/admin) |
| `/tarefas/templates` | `pages/tarefas/TemplatesAdmin.tsx` | (embed em Admin) |
| `/auth` | `pages/Auth.tsx` | não-user |

Layout root: `components/AppLayout.tsx` (sidebar + outlet). Sidebar: `components/AppSidebar.tsx`.

## Hooks (`src/hooks/`)

| Hook | Propósito |
|------|-----------|
| `useAuth` | session, profile, isAdmin, canManageAll, signOut. **Contexto global.** |
| `useAcoes` | CRUD ações tributárias |
| `useEmpresas` | CRUD empresas |
| `useElegibilidades` | query/mutation elegibilidade |
| `useQualificacao` | muda estado da qualificação (qualificar/desqualificar bulk) |
| `useCriterios` | regras de elegibilidade (JSONB editor) |
| `usePastas` | organização por pastas |
| `useBulkEnrich` | enriquecimento RFB em lote via BrasilAPI |
| `useTarefasExtras` | subtarefas, comentários, anexos |
| `use-mobile` | breakpoint hook |
| `use-toast` | toast shadcn (preferir `sonner` direto) |

## Componentes de domínio (`src/components/`)

| Componente | Usado em |
|------------|----------|
| `AppLayout` | root wrapper (sidebar + main) |
| `AppSidebar` | navegação lateral |
| `PageHeader` | título + descrição + ícone em cada página |
| `EmptyState` / `LoadingState` | estados genéricos |
| `AcaoDialog` | criar/editar ação tributária |
| `EmpresaDialog` | criar/editar empresa |
| `TarefaDialog` | criar/editar tarefa (com subtarefas/comentários) |
| `TarefaExtras` | abas de subtarefas/comentários/anexos dentro do dialog |
| `ReuniaoDialog` | agendar reunião (gera ics) |
| `ProspeccaoContatosDialog` | histórico de contatos em prospecção |
| `TemplatePicker` / `TemplateSelectorDialog` | escolher template de msg/tarefa |
| `TemplatesAdmin` | CRUD templates (usado também em `/admin`) |
| `FunilHormozi` | funil de valor potencial no Dashboard |
| `NavLink` | wrapper react-router com `activeClassName` |

## shadcn primitives (`src/components/ui/`)

Não editar. 40+ primitives (button, dialog, tabs, sidebar, etc.). O único grandão é `sidebar.tsx` (637 linhas — shadcn oficial).

## Supabase

- Client: `src/integrations/supabase/client.ts`
- Types autogerados: `src/integrations/supabase/types.ts` ← **NÃO LER INTEIRO**. Use `.claude/rules/supabase-schema.md`.
- Migrations: `supabase/migrations/` (append-only, ordem cronológica)
- Edge functions: `supabase/functions/`
  - `enrich-cnpj` — chama BrasilAPI e popula `cnpj_cache` + `empresas`
  - `send-ics-invite` — envia convite .ics por email (standby, aguardando Google Workspace)

## Fluxos principais

### Enriquecimento RFB
`useBulkEnrich` → edge function `enrich-cnpj` → BrasilAPI → `cnpj_cache` (90d TTL) → upsert em `empresas` → `receita_atualizada_em`.

### Pipeline de prospecção
1. Empresa cai no pool (filtro RFB das `regras_elegibilidade` da ação)
2. Usuário qualifica na `/acoes` (expand tese)
3. "Virar prospecção" → insere `prospeccoes` com status "Não iniciado"
4. **Trigger** cria tarefa "Contato inicial — <empresa>" automática
5. Kanban em `/prospeccao` move cards entre colunas
6. Ao chegar em "Contrato assinado" → trigger upsell cria prospecções nas outras teses onde a empresa está qualificada

### Tarefas
- Usuário comum vê só suas tarefas (`assigned_to = auth.uid()`) em `/meu-espaco?tab=tarefas` ou `/minhas-tarefas`
- Gestor/admin vê todas em `/tarefas/equipe`
- Template → criação rápida via `TemplateSelectorDialog`

## Deploy

- `git push main` → Vercel redeploy (1-2 min)
- Migration → `supabase db push` ou SQL Editor manual
- `vercel.json` na raiz: rewrite `/(.*) → /index.html` (SPA fallback, sem ele F5 dá 404)
