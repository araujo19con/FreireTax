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

- `empresas` — cadastro RFB-enriquecido. Campos manuais relevantes: `quantidade_funcionarios`, `faturamento_anual`, `regime_tributario` (simples/mei/lucro_presumido/lucro_real/imune_isento), `metadados jsonb` (campos personalizados). **CNPJ tem UNIQUE constraint** (mig 20260425) e é NULLABLE (mig 20260506).
- `rfb_estabelecimentos_busca` — slim da RFB pra buscar CNPJ por razão social (mig 20260514). Populado via `tools/import-rfb-slim.mjs` (só ATIVAS, só UFs configuradas — default RN+PB). Consultada via RPC `buscar_rfb_por_nome(termo, uf, limite)` ou edge function `buscar-cnpj-por-nome`.
- `empresa_contatos` — diretório de contatos (pessoas + canais) por empresa: `nome`, `cargo`, `papel` (enum), `email`, `telefone`/`tipo_telefone`/`whatsapp`, `linkedin`, `is_contador`, `principal`, `origem`. Trigger mantém snapshot em `empresas` (`contatos_count`, `contato_principal_*`). Alimentado por `tools/import-driva-contatos.mjs`. **NÃO é `prospeccao_contatos`** (este é log de toques da cadência).
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
- `contatos.ts` → papel labels/cores (`PAPEL_CONTATO`, `humanizePapel`, `papelColor`), `derivePapel`, telefone BR (`formatPhoneBR`, `toE164BR`), links acionáveis (`telLink`, `waLink`, `mailtoLink`, `linkedinUrl`), `rankContatos`

## Componentes compartilhados (src/components/) — REUSE

- `EmpresaFilterPopover` + `EmpresaFilterChips` — usado em **Empresas** E **Matriz Elegibilidade**. Não duplique a UI de filtros.
- `EmpresaContatosSection` (`pages/empresas/`) + `ContatoDialog` — gestão de contatos da empresa (lista acionável: ligar/WhatsApp/email/LinkedIn, marcar principal). Usado na aba "Contatos" do `EmpresaDetailSheet`. O contato principal aparece também em `EmpresasCardView` e `EmpresasTableView` (coluna "Contato") via snapshot denormalizado em `empresas`.
- `EmpresaDialog` — criação/edição com validação CNPJ duplicado embutida + botão "Buscar pelo nome" (via `BuscarCNPJDialog`) pra empresas sem CNPJ
- `BuscarCNPJDialog` — busca fuzzy de CNPJ pela razão social na base RFB indexada (RN+PB). Usado em `EmpresaDialog` e `EmpresaDetailSheet`.
- `PropostaDialog` + `RichTextEditor` (Tiptap) — proposta com timbrado, preview e print
- `TarefaDialog`, `ReuniaoDialog` — pattern de loadRelations (profiles+empresas+prospeccoes)
- `PageHeader`, `EmptyState`, `LoadingState` — UX consistente

## ⚠️ Regras para economizar contexto

1. **NUNCA leia `src/integrations/supabase/types.ts` inteiro** — tem 1.624 linhas autogeradas. Use `Grep` para encontrar o tipo específico (`Database["public"]["Tables"]["tarefas"]["Row"]` etc.).

2. **Arquivos grandes (>500 linhas) — sempre leia com `offset` + `limit`** antes de `Read` completo. Contagens atualizadas em 2026-05-28 (líderes do ranking, podem aumentar):
   - `src/pages/Prospeccao.tsx` (~1686)
   - `src/pages/Importacao.tsx` (~1594)
   - `src/pages/empresas/EmpresasMapView.tsx` (~1166)
   - `src/pages/Acoes.tsx` (~1167)
   - `src/pages/Empresas.tsx` (~1054)
   - `src/components/EmpresaDialog.tsx` (~953)
   - `src/pages/acoes/ImportacaoProspeccaoDialog.tsx` (~869)
   - `src/pages/empresas/EmpresaDetailSheet.tsx` (~874)
   - `src/pages/acoes/AcaoEmpresasPanel.tsx` (~858)
   - `src/components/PropostaDialog.tsx` (~860)
   - `src/pages/elegibilidade/CriteriosAdmin.tsx` (~843)
   - `src/components/EmpresaFilterPopover.tsx` (~828 — fonte ÚNICA dos filtros)
   - `src/pages/AnaliseRFB.tsx` (~785)
   - `src/pages/Dashboard.tsx` (~773)
   - `src/pages/acoes/AcaoEmpresasFilterPopover.tsx` (~729)
   - `src/components/TarefaDialog.tsx` (~717)
   - `src/pages/tarefas/EquipeView.tsx` (~519)
   - `src/components/ui/sidebar.tsx` (637 — shadcn, raramente precisa ler)

   Para refresh rápido: `wc -l $(git ls-files 'src/**/*.tsx' 'src/**/*.ts' | xargs) | sort -rn | head -20`.

3. **Migrations em `supabase/migrations/`** — só leia a específica que interessa. Nome do arquivo já revela escopo (`20260421_elegibilidade_workflow.sql` etc.).

4. **shadcn primitives (`src/components/ui/*`)** — não editar salvo quando explicitamente pedido. Preferir compor por cima.

## Convenções de código

- Texto de UI em **português** (labels, mensagens, toasts)
- Comentários em português, curtos, explicando _porquê_ (não _o quê_)
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

## Enriquecimento por nome (empresas sem CNPJ)

Empresas cadastradas sem CNPJ podem ser enriquecidas buscando o CNPJ pela
razão social na base slim da RFB (`rfb_estabelecimentos_busca`):

- **UI individual**: botão "Buscar pelo nome" em `EmpresaDialog`; botão "Buscar
  CNPJ" no header de `EmpresaDetailSheet` (aparece apenas quando `empresa.cnpj`
  é vazio).
- **UI em lote**: scope `"sem_cnpj"` no `BulkEnrichDialog` — busca o melhor
  match (score ≥ 0.5) e enriquece automaticamente.
- **Backend**: edge function `buscar-cnpj-por-nome` → RPC `buscar_rfb_por_nome`.

⚠️ A tabela `rfb_estabelecimentos_busca` precisa estar populada (via
`tools/import-rfb-slim.mjs` — ver `tools/README-import-rfb.md`). Sem isso, a
busca retorna lista vazia.

## Fluxo de deploy

1. Commit local → `git push origin main`
2. Vercel redeploy automático (~1-2 min)
3. Supabase: aplicar migration via `supabase db push` OU SQL Editor manual no dashboard

⚠️ **Gate de integridade (após `db push`):** rode `python tools/check_schema_drift.py`
(precisa `SUPABASE_ACCESS_TOKEN` no env). Compara os objetos das migrations com o
banco real e falha se houver "fantasma" — migration marcada como aplicada mas cujo
SQL nunca rodou. O histórico foi inicializado via `repair`, então "applied" ≠ objeto
existe (em ago/2026 isso deixou 5 funções + 2 tabelas ausentes). Ver `check_schema_drift.py`.
