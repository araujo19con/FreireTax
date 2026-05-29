# Project State — Tax Trakker

**Atualizado:** 2026-05-29
**Milestone ativo:** Fase 2.2 concluída — elegibilidade_id legacy cleanup

---

## Status geral

Fase 2.2 da limpeza de campos legacy concluída. `empresa_id` e `acao_id` estão agora como colunas diretas em `prospeccoes` e o código usa esses campos em vez de joins via `elegibilidade_id`.

## O que ainda referencia elegibilidade_id (59 ocorrências — todas legítimas)

| Categoria                            | Arquivos                                               | Motivo para manter                                   |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| `processos.elegibilidade_id`         | `Acoes.tsx`, `Dashboard.tsx`                           | Tabela `processos` ainda usa FK legada               |
| `valor_potencial_estimado` lookup    | `Prospeccao.tsx`                                       | Campo vive em `elegibilidade`, não foi denormalizado |
| Payloads INSERT com elegibilidade_id | `ProspeccaoRapidaDialog`, `ImportacaoProspeccaoDialog` | Backward compat — campo ainda NOT NULL no DB         |
| `elegibilidade_respostas` FK         | `useQualificacao.ts`                                   | Tabela separada, FK legítima                         |
| Fallback pattern                     | `TarefaDialog`, `ReuniaoDialog`, `AcaoEmpresasPanel`   | Já implementado corretamente                         |
| Schema types.ts                      | `types.ts`                                             | Reflete DB real — remover quando dropado do schema   |

## Próximas etapas opcionais (não urgentes)

1. **Adicionar `NOT NULL` constraint** em `empresa_id`/`acao_id` de prospeccoes (após confirmar que todas rows futuras terão esses campos — já são 36/36)
2. **Migrar `processos`** para ter `empresa_id`/`acao_id` diretamente (similar surgery)
3. **Denormalizar `valor_potencial_estimado`** em prospeccoes (elimina todos os lookups restantes via elegibilidade_id em Prospeccao.tsx)
4. **Drop `elegibilidade_id`** de prospeccoes (etapa final — após toda a codebase migrada)

## Trabalho concluído (histórico completo)

### 2026-05-29 (sessão 3 — Fase 2.2 elegibilidade_id)

- ✅ Migration aplicada ao cloud: empresa_id + acao_id em prospeccoes (36/36 backfill)
- ✅ types.ts regenerado: 1869 → 1889 linhas
- ✅ ProspeccaoRapidaDialog: insert tipado com empresa_id + acao_id
- ✅ Prospeccao.tsx: handleCreate passa empresa_id + acao_id; elegiveisForCreate usa campos diretos
- ✅ ImportacaoProspeccaoDialog: queries por empresa_id+acao_id em vez de elegibilidade_id
- ✅ Dashboard.tsx: filtProsp e semProspeccao usam campos diretos
- ✅ Relatorios.tsx: query de elegibilidades eliminada; enriched usa campos diretos
- ✅ Prospeccao.tsx: getEmpresa/getAcao usam empresa_id/acao_id diretamente; elegMap removido
- ✅ Interfaces Prospeccao atualizadas em todos os arquivos

### 2026-05-29 (sessão 2 — Estabilização)

- ✅ Guard `/admin`, CNPJ mod-11, topojson-client, fallback migration removido
- ✅ Trigger atrasado honorários, xlsx dinâmico, types.ts regenerado
- ✅ Dead code Acoes.tsx (-222 linhas), formatCurrency deduplicada, as any removidos

### 2026-05-29 (sessão 1)

- ✅ Fix export ações faixa DRIVA, codebase map, GSD inicializado

### 2026-05-28

- ✅ /relatorios, financeiro, prazos processuais, timeline, horas, kanban DnD
- ✅ audit_log SECURITY DEFINER, expr-eval, criar-usuario atômico
- ✅ fetchAllRows, Dashboard truncation, trigger, index, testes, PAT removido

## Arquivos de referência

- `.planning/codebase/CONCERNS.md` — bugs e riscos (2026-05-29)
- `.planning/ROADMAP.md` — todas as fases com status
- `.planning/REQUIREMENTS.md` — requirements formais
