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

- `empresas` — cadastro RFB-enriquecido. Campos manuais relevantes: `quantidade_funcionarios`, `faturamento_anual`, `regime_tributario` (simples/mei/lucro_presumido/lucro_real/imune_isento), `metadados jsonb` (campos personalizados). **CNPJ tem UNIQUE constraint** (mig 20260425).
- `acoes_tributarias` — teses jurídicas; campo `regras_elegibilidade jsonb` filtra pool
- `criterios_elegibilidade` — critérios c/ `regra_excludente jsonb` (mig 20260422)
- `elegibilidade` — qualificação empresa×ação (estados: nao_avaliada/qualificada/desqualificada/em_prospeccao/fechada/perdida)
- `prospeccoes` — pipeline comercial. Status: "Não iniciado" → "Contato feito" → "Proposta enviada" → "Em negociação" → "Contrato assinado" → **"Serviço iniciado"** → "Perdido"
- `propostas_templates` + `propostas` — templates reutilizáveis e proposta única por prospecção (mig 20260423)
- `tarefas` — colunas: `created_by`, `assigned_to`, `prazo`, `status`. **NÃO existe `user_id`**
- `reunioes` — agenda (advogado_id, data_inicio)
- `profiles`, `user_roles` — perfis e roles (admin, gestor, advogado, comercial)

Regra de visibilidade no sidebar: `isAdmin`, `canManageAll` (gestor ou admin).

## Helpers compartilhados (src/lib/) — REUSE em vez de reimplementar

- `regimeTributario.ts` → `REGIMES_TRIBUTARIOS`, `getRegimeEffective(emp)`, `humanizeRegime`, `regimeColor`
- `proposta.ts` → `ESCRITORIO_DEFAULT`, `renderVariaveis(html, ctx)`, `VARIAVEIS_DISPONIVEIS`
- `criterios.ts` → `defaultRegraFor(tipo)`, `respostaDisparaExclusao`, `humanizeRegra`, `validateRegra`
- `seedTemplates.ts` → templates seed de tarefas
- `format.ts` → `formatCNPJ`, `formatCurrency`, `formatCompactCurrency`, `formatDate`, `formatRelativeDate`
- `cnpj.ts` → `validateCNPJ` (mod 11 real), `validateCNPJMessage`, `maskCNPJ`, `unmaskCNPJ`

## Componentes compartilhados (src/components/) — REUSE

- `EmpresaFilterPopover` + `EmpresaFilterChips` — usado em **Empresas** E **Matriz Elegibilidade**. Não duplique a UI de filtros.
- `EmpresaDialog` — criação/edição com validação CNPJ duplicado embutida
- `PropostaDialog` + `RichTextEditor` (Tiptap) — proposta com timbrado, preview e print
- `TarefaDialog`, `ReuniaoDialog` — pattern de loadRelations (profiles+empresas+prospeccoes)
- `PageHeader`, `EmptyState`, `LoadingState` — UX consistente

## ⚠️ Regras para economizar contexto

1. **NUNCA leia `src/integrations/supabase/types.ts` inteiro** — tem 1.624 linhas autogeradas. Use `Grep` para encontrar o tipo específico (`Database["public"]["Tables"]["tarefas"]["Row"]` etc.).

2. **Arquivos grandes (>500 linhas) — sempre leia com `offset` + `limit`** antes de `Read` completo:
   - `src/pages/Prospeccao.tsx` (1247)
   - `src/pages/Acoes.tsx` (923)
   - `src/pages/Empresas.tsx` (832)
   - `src/components/PropostaDialog.tsx` (800)
   - `src/pages/AnaliseRFB.tsx` (772)
   - `src/pages/Dashboard.tsx` (757)
   - `src/pages/Importacao.tsx` (670)
   - `src/components/EmpresaDialog.tsx` (647)
   - `src/components/EmpresaFilterPopover.tsx` (626 — fonte ÚNICA dos filtros)
   - `src/pages/empresas/EmpresaDetailSheet.tsx` (576)
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
- **`prospeccoes` sem FK direta a empresa nos types**: linkar via `elegibilidade_id` → `elegibilidade.empresa_id` (pattern em Prospeccao.tsx `getEmpresa`/`getAcao`)
- **Importação**: distinguir status CRM (`prospect/cliente/inativo`) de situação RFB (`ATIVA/SUSPENSA/...`). Use `findColumnExact` pra "status" para evitar falso positivo com "situação".
- **Erros Postgres**: PostgrestError NÃO é `instanceof Error`. Use `extractErrorMessage(err)` (em `src/pages/Importacao.tsx`) ou checagem de `e.code === "23505"` para unique violation (CNPJ duplicado).
- **Print PDF (PropostaDialog)**: para timbrado em todas as páginas, usar `<table>` com `<thead>`/`<tfoot>` (nunca `position: fixed`, que só ancora na primeira página no Chrome print).

## Fluxo de deploy

1. Commit local → `git push origin main`
2. Vercel redeploy automático (~1-2 min)
3. Supabase: aplicar migration via `supabase db push` OU SQL Editor manual no dashboard
