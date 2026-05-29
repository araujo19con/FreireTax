# Project State — Tax Trakker

**Atualizado:** 2026-05-29
**Milestone ativo:** Estabilização — CONCLUÍDO

---

## Status geral

Todos os itens de estabilização foram concluídos. O sistema está limpo, seguro e com types atualizados.

## Próxima fase recomendada

**Fase opcional de qualidade:**

- ⬜ Remover dialog de prospecção legado em Acoes.tsx (~1563+) — código morto desde remoção de `_openProspDialog`
- ⬜ Limpeza dos `as any` restantes em Importacao.tsx, Prospeccao.tsx, Admin.tsx (gradual)
- ⬜ Fase 2.2 do ROADMAP: limpar campos legacy `elegibilidade_id` em prospeccoes (19 arquivos)

## Trabalho concluído (histórico)

### 2026-05-29 (sessão 2)

- ✅ Guard `/admin` com `<RequireAdmin>` (App.tsx)
- ✅ Validação mod-11 CNPJ no edge function `enriquecer-cnpj`
- ✅ `topojson-client` declarado como dep explícita em package.json
- ✅ Fallback de migration 20260424 removido de Importacao.tsx
- ✅ Trigger Postgres `marcar_honorarios_atrasados` + integração em verificar-prazos
- ✅ xlsx carregado dinamicamente em 10 arquivos (~900 KB off bundle)
- ✅ `types.ts` regenerado: 1624 → 1869 linhas (inclui honorarios, prazos, rfb_busca)
- ✅ 7 funções dead-code `_prefixadas` removidas de Acoes.tsx
- ✅ `formatCurrency` duplicada removida de Acoes.tsx (importa de @/lib/format)
- ✅ Casts `as any` removidos de useQualificacao.ts, usePropostas.ts

### 2026-05-29 (sessão 1)

- ✅ Fix export de ações: faixa de funcionários/faturamento do DRIVA
- ✅ Linting: removidos imports/vars não-usados em Acoes.tsx, Dashboard.tsx, AnaliseRFB.tsx
- ✅ Codebase map completo em `.planning/codebase/` (8 documentos)
- ✅ GSD inicializado: PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md

### 2026-05-28

- ✅ Tela /relatorios com funil e contratos ganhos
- ✅ Módulo financeiro (honorários_lancamentos + CRUD + KPIs + XLSX)
- ✅ Prazos processuais (tabela + edge function verificar-prazos + UI)
- ✅ Timeline cronológica por empresa (EmpresaDetailSheet)
- ✅ Relatório de horas trabalhadas (aba Horas em EquipeView)
- ✅ Drag-and-drop kanban (@hello-pangea/dnd)
- ✅ audit_log via SECURITY DEFINER
- ✅ validateFormula → expr-eval (sem `new Function()`)
- ✅ criar-usuario atomicidade de role assignment
- ✅ fetchAllRows extraído para src/lib/supabaseFetchAll.ts
- ✅ Dashboard truncation corrigida (fetchAllRows)
- ✅ Trigger create_initial_tarefa_on_prospeccao revivido
- ✅ Index prospeccoes(empresa_id, acao_id)
- ✅ Testes para cnpj, criterios, proposta, supabaseFetchAll
- ✅ PAT Supabase removido de MIGRATION.md

## Arquivos de referência

- `.planning/codebase/CONCERNS.md` — bugs e riscos identificados (2026-05-29)
- `.planning/codebase/FEATURE_GAPS.md` — gaps funcionais priorizados (2026-05-28)
- `.planning/ROADMAP.md` — todas as fases com status
- `.planning/REQUIREMENTS.md` — requirements formais
