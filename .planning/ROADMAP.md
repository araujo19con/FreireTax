# Roadmap — Tax Trakker

**Gerado em:** 2026-05-28
**Fontes:** `CONCERNS.md` (2026-05-27) + `FEATURE_GAPS.md` (2026-05-28)

Cada fase é ordenada por **impacto × facilidade**. Dentro de uma fase os itens são independentes — podem ser feitos em qualquer ordem.

---

## Fase 0 — Quick Wins (já feitos ou triviais, ≤1 hora cada)

| Item                                                            | Arquivo                               | Estado                       |
| --------------------------------------------------------------- | ------------------------------------- | ---------------------------- |
| Badge `agenda_hoje` no sidebar                                  | `AppSidebar.tsx`                      | ✅ Feito (2026-05-28)        |
| Index `prospeccoes(empresa_id, acao_id)`                        | migration `20260527000000`            | ✅ Feito                     |
| Trigger `create_initial_tarefa_on_prospeccao` revivido          | migration `20260527000001`            | ✅ Feito                     |
| `fetchAllRows` extraído para `src/lib/supabaseFetchAll.ts`      | `supabaseFetchAll.ts`                 | ✅ Feito                     |
| Dashboard truncation corrigida                                  | `Dashboard.tsx`                       | ✅ Feito                     |
| PAT Supabase removido de `MIGRATION.md`                         | `MIGRATION.md`                        | ✅ Feito                     |
| Testes para `cnpj.ts`, `criterios.ts`, `proposta.ts`            | `src/lib/*.test.ts`                   | ✅ Feito                     |
| `handleDesqualificar` — persistir `motivo` e `estado`           | `Acoes.tsx:387`                       | ✅ Feito (era pré-existente) |
| Null-check env vars no Supabase client                          | `src/integrations/supabase/client.ts` | ✅ Feito (2026-05-28)        |
| XSS no render de proposta — `sanitizeProposalHTML`              | `PropostaDialog.tsx:649`              | ✅ Feito (era pré-existente) |
| `extractErrorMessage` → `src/lib/errors.ts` (refatorar callers) | `Importacao.tsx:88` → `lib/errors.ts` | **Pendente** (30 min)        |

### Detalhe — `handleDesqualificar` (5 min)

```ts
// Acoes.tsx:387
await supabase
  .from("elegibilidade")
  .update({
    elegivel: false,
    estado: "desqualificada",
    motivo_desqualificacao: motivo, // ← estava sendo silenciado
  })
  .eq("id", elegId);
```

---

## Fase 1 — Segurança (alta prioridade, não bloqueia features)

### 1.1 ~~XSS no render de proposta~~ — ✅ Já implementado

`PropostaDialog.tsx:649` já usa `sanitizeProposalHTML(renderVariaveis(...))` com DOMPurify. `src/lib/proposta.ts` também exporta `sanitizeProposalHtml`. Strings interpoladas são HTML-escaped antes de render. **Não requer ação.**

### 1.2 ~~Audit log via SECURITY DEFINER~~ — ✅ Feito (2026-05-28)

Migration `20260528000000_audit_log_secure_definer.sql` cria `log_audit_secure()` SECURITY DEFINER, revoga INSERT direto. `src/lib/audit.ts` usa `supabase.rpc("log_audit_secure", ...)`.
⚠️ Aplicar migration no Supabase antes do próximo deploy: `supabase db push` ou SQL Editor.

### 1.3 ~~`validateFormula` — eliminar `new Function()`~~ — ✅ Feito (2026-05-28)

`src/lib/criterios.ts` e `src/hooks/useQualificacao.ts` agora usam `expr-eval` Parser.

### 1.4 ~~Null-check da anon key~~ — ✅ Feito (2026-05-28)

`src/integrations/supabase/client.ts` agora lança erro claro se as env vars estiverem ausentes.

### 1.5 `criar-usuario` — atomicidade de role assignment

**Risco:** usuário pode ficar com dois roles se o DELETE da role padrão falhar.
**Fix:** Criar `assign_user_role(uid, role app_role)` Postgres function que faz `DELETE ... INSERT` em transação única.

Complexidade: **baixa** — migration + ajuste na edge function. ~1h.

---

## Fase 2 — Qualidade de Código (médio prazo)

### 2.1 Regenerar `types.ts` + gate no CI

`src/integrations/supabase/types.ts` tem 1.624 linhas autogeradas e está desatualizado (novas migrations não refletidas). Sem gate no CI, diverge silenciosamente.

**Fix:**

1. Rodar `npx supabase gen types typescript --project-id fxsuwvgcybjbuqqcuskt > src/integrations/supabase/types.ts`.
2. Adicionar step no GitHub Actions (ou Vercel Build Command): `npx supabase gen types ... --check` que falha se o arquivo divergir do schema atual.

Complexidade: **baixa** — infra, não código de produto. ~1h.

### 2.2 Limpar campos legacy (`elegibilidade_id`, `elegivel` bool)

| Campo                          | Encontrado em                            | Status                                |
| ------------------------------ | ---------------------------------------- | ------------------------------------- |
| `prospeccoes.elegibilidade_id` | 147 ocorrências em 19 arquivos           | Atualizar para `empresa_id`/`acao_id` |
| `elegibilidade.elegivel`       | `Prospeccao.tsx:565`, `Dashboard.tsx:84` | Migrar para `estado` enum             |

**Plano em fases:**

- Fase A: helpers `getEmpresaId(prosp)` e `getAcaoId(prosp)` que preferem novos campos com fallback legacy.
- Fase B: backfill de rows com `elegibilidade_id` != null e `empresa_id` null via migration.
- Fase C (após backfill): `ALTER TABLE prospeccoes DROP COLUMN elegibilidade_id`.

Complexidade: **alta** — cirurgia em 19 arquivos + migration. Executar em sprints pequenos.

### 2.3 Atualizar `CLAUDE.md` e `.claude/rules/large-files.md`

Contagens de linhas desatualizadas. Roda `wc -l $(git ls-files 'src/**/*.tsx' 'src/**/*.ts') | sort -rn | head -20` e atualiza as tabelas. 10 min.

---

## Fase 3 — Performance / UX

### 3.1 Drag-and-drop real no kanban de prospecção

**Impacto:** equipe comercial com volume alto de cards.
**Implementação:**

- Adicionar `@hello-pangea/dnd` (fork mantido de `react-beautiful-dnd`).
- Em `Prospeccao.tsx`, trocar `<KanbanColumn>` por `<Droppable>` e cards por `<Draggable>`.
- `onDragEnd` chama `supabase.from("prospeccoes").update({ status_prospeccao: destColumn })`.

Complexidade: **média** — ~4h de implementação + testes visuais.

### 3.2 Virtualização do AcaoEmpresasPanel e MatrizView

**Impacto:** tabelas com 300-500+ rows travam UI (~300ms jank).
**Fix:** `@tanstack/react-virtual` com `useVirtualizer` para linhas de `AcaoEmpresasPanel.tsx` e `MatrizView.tsx` quando `rowCount > 100`.

Complexidade: **média** — 2-3h por componente.

### 3.3 "Reenriquecer falhas" no BulkEnrichDialog

Adicionar scope `"com_erro"` em `BulkEnrichDialog`: filtra `empresas WHERE receita_erro IS NOT NULL` e re-executa enriquecimento. Evita ter que reimportar manual o CSV inteiro após timeout da BrasilAPI.

Complexidade: **baixa** — 2h.

---

## Fase 4 — Features Novas (médio porte)

### 4.1 Relatório de horas trabalhadas por advogado

**Dados:** `tarefas_tempo` tem `started_at`, `stopped_at`, `duration_sec`, `tarefa_id`. Timer existe na UI mas dados não são explorados em nenhuma view gerencial.

**Implementação mínima:** nova aba "Horas" em `EquipeTarefas` (ou em `AnaliseRFB`) com:

- Filtros: período (data), advogado, ação tributária, empresa
- Tabela: advogado × horas_totais (sum `duration_sec` / 3600) + linhas de detalhe por tarefa
- Export XLSX

Complexidade: **baixa** — query de agregação + tabela básica. ~3h.

### 4.2 Timeline cronológica por empresa

**Gap atual:** `EmpresaDetailSheet` tem abas separadas (Tarefas | Reuniões | Histórico). Não há visão cronológica integrada.

**Implementação:** nova aba "Timeline" no detail sheet que faz 3 queries em paralelo e merge+sort:

- `audit_logs WHERE tabela = 'empresas' AND registro_id = empresa.id`
- `tarefas WHERE empresa_id = empresa.id ORDER BY created_at`
- `reunioes WHERE empresa_id = empresa.id ORDER BY data_inicio`
- `prospeccoes WHERE empresa_id = empresa.id` (marcos de status change via audit_log)

Exibe como feed vertical com ícone por tipo de evento.

Complexidade: **média** — UI simples, a query é o desafio (sem view materializada). ~4h.

### 4.3 Tela `/relatorios` básica

**Entregas mínimas do MVP:**

1. Filtros por período, advogado, ação tributária
2. Tabela de prospecções ganhas (Contrato assinado + Serviço iniciado) com `valor_proposta`
3. Funil: qualificadas → em prospecção → ganhas → perdidas (por ação)
4. Export XLSX

Reutiliza `fetchAllRows`, `EmpresaFilterChips`, componentes Recharts existentes do Dashboard.

Complexidade: **média** — ~6h.

---

## Fase 5 — Módulos Novos (alto porte, planning separado)

### 5.1 Módulo financeiro / honorários

**Lacuna crítica:** não há registro de recebimentos. O sistema sabe o `valor_proposta` mas não quanto foi pago, quando, e o que está a receber.

**Schema mínimo:**

```sql
CREATE TABLE honorarios_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id uuid REFERENCES prospeccoes(id),
  empresa_id uuid REFERENCES empresas(id),
  tipo text CHECK (tipo IN ('retainer', 'exito', 'avulso')),
  valor numeric NOT NULL,
  data_vencimento date NOT NULL,
  data_pagamento date,
  status text CHECK (status IN ('pendente', 'pago', 'atrasado', 'cancelado')),
  nota text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
```

**UI:** página `/financeiro` com:

- Calendário de vencimentos
- Dashboard: a receber / recebido / atrasado
- Filtros por ação, advogado, período

Complexidade: **alta** — nova tabela + UI completa. Sprint de 2-3 dias.

### 5.2 Controle de prazos processuais

**Gap crítico para advocacia:** `processos` não tem prazos judiciais. O risco de perda de prazo não é atendido por tarefas genéricas.

**Schema mínimo:**

```sql
CREATE TABLE prazos_processuais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid REFERENCES processos(id),
  tipo text, -- contestacao, recurso, manifestacao, audiencia, etc.
  data_vencimento date NOT NULL,
  alerta_antecedencia_dias int DEFAULT 3,
  status text CHECK (status IN ('pendente', 'cumprido', 'perdido')),
  observacao text,
  criado_por uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
```

**Alertas:** edge function `verificar-prazos` (cron diário) envia email para `responsavel_id` do processo quando `data_vencimento - alerta_antecedencia_dias <= hoje`.

Complexidade: **alta** — schema + edge function de alerta + UI. Sprint de 2-3 dias.

### 5.3 Notificações proativas

**Gap:** usuário só vê badges na sidebar. Não há alerta antes de vencimento.

**MVP:**

- Edge function `enviar-lembretes` (cron diário 08h): busca tarefas com `prazo = amanhã` e envia email via Resend/SendGrid para `assigned_to`.
- Push opcional (baixa prioridade — Web Push API + service worker).

Complexidade: **média** — edge function + Resend API key. ~4h para email básico.

---

## Fase Futura (não planificado)

| Item                                             | Bloqueio / razão                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Supabase Realtime para colaboração               | Baixo ROI imediato; polling 2 min cobre o uso atual                      |
| Envio real de email/WhatsApp via API             | Alta complexidade (OAuth Gmail, WA Business API review)                  |
| Integração DataJud/ESAJ para consulta processual | API paga + credenciais institucionais necessárias                        |
| Split de `Prospeccao.tsx` em subcomponentes      | Útil mas não urgente — abordar quando a próxima feature tocar no arquivo |

---

## Resumo priorizado

```
P0 (imediato, < 1h cada):
  ✅ Badge agenda_hoje
  ✅ handleDesqualificar motivo (era pré-existente)
  ✅ anon key null-check (client.ts)
  ✅ DOMPurify em proposta.ts (era pré-existente)
  ⬜ extractErrorMessage → lib/errors.ts

P1 (próximo sprint, segurança):
  ✅ audit_log SECURITY DEFINER (2026-05-28)
  ✅ validateFormula → expr-eval (2026-05-28)
  ⬜ criar-usuario atomicidade

P2 (qualidade, faz a base ficar sólida):
  ⬜ regenerar types.ts + CI check
  ⬜ extractErrorMessage → lib/errors.ts
  ⬜ CLAUDE.md / large-files.md atualizado

P3 (UX visível):
  ⬜ Drag-and-drop kanban
  ⬜ Relatório horas trabalhadas
  ⬜ Timeline por empresa

P4 (features estratégicas):
  ⬜ Tela /relatorios básica
  ⬜ Módulo financeiro / honorários
  ⬜ Prazos processuais + alertas
```

---

_Roadmap atualizado em: 2026-05-28_
