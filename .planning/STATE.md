# Project State — Tax Trakker

**Atualizado:** 2026-05-29
**Milestone ativo:** Estabilização (bugs críticos + débito técnico)

---

## Status geral

A maior parte do trabalho P0–P4 planejado em 2026-05-28 foi concluída. O sistema está funcional e em produção. A análise de 2026-05-29 revelou novos bugs críticos que precisam de atenção.

## Próxima fase recomendada

**Fase: Segurança imediata (achados 2026-05-29)**

Tarefas ordenadas por esforço/impacto:

1. ⬜ Confirmar `ALLOWED_ORIGINS` no Supabase (15 min) — risco produção
2. ⬜ Guard da rota `/admin` em `src/App.tsx` (30 min) — segurança
3. ⬜ Declarar `topojson-client` em `package.json` (15 min) — estabilidade
4. ⬜ Remover dead functions `_prefixadas` em `Acoes.tsx` (30 min) — limpeza
5. ⬜ Validação mod-11 no edge function `enriquecer-cnpj` (1h) — segurança
6. ⬜ Remover fallback de migration antiga em `Importacao.tsx` (1h) — integridade
7. ⬜ Trigger Postgres para `atrasado` em `honorarios_lancamentos` (2h) — integridade
8. ⬜ Cache React Query para IBGE geo (2h) — performance
9. ⬜ Dynamic import de `xlsx` nos handlers (2h) — performance
10. ⬜ Regenerar `src/integrations/supabase/types.ts` (1h) — qualidade

## Trabalho concluído (histórico)

### 2026-05-29

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
