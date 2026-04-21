# Tax Trakker — Contexto do Projeto

CRM jurídico-tributário para Freire Pignataro Advogados. Gerencia empresas (clientes/prospects), ações tributárias (teses), elegibilidade, prospecção, tarefas e agenda.

## Stack

- **Frontend**: Vite + React 18 + TypeScript + React Router v6 (lazy + Suspense)
- **UI**: shadcn/ui + Tailwind + lucide-react
- **Estado/Data**: @tanstack/react-query (staleTime 30s, sem refetchOnWindowFocus)
- **Backend**: Supabase (auth + Postgres + edge functions Deno)
- **Package manager**: `bun` (use `bun` nos comandos, não `npm`)
- **Deploy**: Vercel (`freire-tax.vercel.app`), auto-deploy no push `main`

## Comandos

```bash
bun dev          # dev server
bun run build    # production build
bun test         # vitest run
bun run lint     # eslint
```

## Estrutura

- `src/pages/` — rotas top-level (Dashboard, Empresas, Acoes, Prospeccao, etc.)
- `src/components/` — componentes reutilizáveis
- `src/components/ui/` — shadcn primitives (raramente editar)
- `src/hooks/` — hooks customizados (useAuth é o principal)
- `src/integrations/supabase/` — client + types AUTOGERADOS
- `src/lib/` — utils
- `supabase/migrations/` — migrations SQL (append-only, ordenadas por timestamp)
- `supabase/functions/` — edge functions Deno

Aliases: `@/` → `src/`.

## Contexto adicional sob demanda

- **Schema Supabase completo** → `.claude/rules/supabase-schema.md` (ativa automaticamente em arquivos `src/**` — evita abrir `types.ts`)
- **Mapa de arquitetura** (rotas, hooks, componentes, fluxos) → `.claude/ARCHITECTURE_MAP.md`
- **Regra de leitura de arquivos grandes** → `.claude/rules/large-files.md`

## Schema Supabase (tabelas principais)

- `empresas` — cadastro de clientes/prospects enriquecido com dados RFB (~25 campos: porte, situacao_cadastral, uf, cnae_principal, capital_social, opcao_simples, opcao_mei, receita_atualizada_em, etc.)
- `acoes_tributarias` — teses jurídicas; campo `regras_elegibilidade jsonb` filtra pool
- `elegibilidade` — qualificação (empresa, acao, estado: nao_avaliada/qualificada/desqualificada/em_prospeccao/fechada/perdida)
- `prospeccoes` — pipeline comercial (FK: empresa_id, acao_id). Status: "Não iniciado", "Contato inicial", ..., "Contrato assinado", "Perdido"
- `tarefas` — colunas: `created_by`, `assigned_to`, `prazo`, `status`, `prospeccao_id`. **NÃO existe coluna `user_id`**
- `reunioes` — agenda (advogado_id, data_inicio, data_fim)
- `profiles` — perfis de usuário (nome, email, role)
- `user_roles` — roles: admin, gestor, advogado

Regra de visibilidade no sidebar: `isAdmin`, `canManageAll` (gestor ou admin).

## ⚠️ Regras para economizar contexto

1. **NUNCA leia `src/integrations/supabase/types.ts` inteiro** — tem 1.624 linhas autogeradas. Use `Grep` para encontrar o tipo específico (`Database["public"]["Tables"]["tarefas"]["Row"]` etc.).

2. **Arquivos grandes (>500 linhas) — sempre leia com `offset` + `limit`** antes de `Read` completo:
   - `src/pages/Prospeccao.tsx` (1046)
   - `src/pages/Acoes.tsx` (923)
   - `src/pages/Empresas.tsx` (810)
   - `src/pages/Dashboard.tsx` (757)
   - `src/pages/AnaliseRFB.tsx` (701)
   - `src/components/ui/sidebar.tsx` (637 — shadcn, raramente precisa ler)

3. **Migrations em `supabase/migrations/`** — só leia a específica que interessa. Nome do arquivo já revela escopo (`20260421_elegibilidade_workflow.sql` etc.).

4. **shadcn primitives (`src/components/ui/*`)** — não editar salvo quando explicitamente pedido. Preferir compor por cima.

## Convenções de código

- Texto de UI em **português** (labels, mensagens, toasts)
- Comentários em português, curtos, explicando *porquê* (não *o quê*)
- Nada de emoji em código ou arquivos salvo se o user pedir
- `date-fns` para datas (locale pt-BR quando mostrar)
- Toast: `import { toast } from "sonner"` (preferir sonner ao radix toast)
- Forms: `react-hook-form` + `@hookform/resolvers/zod`

## Pontos de atenção (bugs já corrigidos — não reintroduzir)

- **Trigger `create_initial_tarefa_on_prospeccao`** usa `created_by`/`assigned_to`, NÃO `user_id`.
- **Vercel SPA**: `vercel.json` na raiz faz rewrite `/(.*) → /index.html`. Sem isso, F5 dá 404.
- **BrasilAPI** tem rate limit agressivo — backfill precisa de delay 350ms + retry em 429.
- **Toda prospecção precisa de `empresa_id` + `acao_id`** (denormalizado; `elegibilidade_id` é legacy).

## Fluxo de deploy

1. Commit local → `git push origin main`
2. Vercel redeploy automático (~1-2 min)
3. Supabase: aplicar migration via `supabase db push` OU SQL Editor manual no dashboard
