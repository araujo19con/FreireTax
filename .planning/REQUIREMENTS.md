# Requirements

_Gerado em 2026-05-29 via análise do codebase (`.planning/codebase/CONCERNS.md` + `FEATURE_GAPS.md`)._

---

## Milestone 1 — Estabilização (bugs críticos + débito técnico)

### REQ-01: Segurança — guard da rota /admin

- A rota `/admin` deve ser protegida por `<RequireAdmin>` ou guard equivalente
- Usuários não-admin navegando para `/admin` devem ser redirecionados para `/`
- Arquivo: `src/App.tsx:126`

### REQ-02: Segurança — validação de CNPJ no edge function

- `supabase/functions/enriquecer-cnpj/index.ts` deve validar CNPJ com mod-11, não apenas `length === 14`
- Implementar a mesma lógica de `src/lib/cnpj.ts` (ou importar via shared lib)

### REQ-03: Integridade — status `atrasado` persistido no banco

- `honorarios_lancamentos` deve ter status atualizado via trigger Postgres ou cron, não apenas derivado em runtime no frontend
- `Financeiro.tsx` deve refletir o status do banco, não recalcular

### REQ-04: Integridade — remover fallback de migration antiga em Importacao.tsx

- Remover o bloco de retry sem colunas novas (linhas 856–869 de `Importacao.tsx`)
- Erros reais de insert devem surfar corretamente

### REQ-05: Qualidade — regenerar types Supabase

- Executar `supabase gen types typescript` e commitar `src/integrations/supabase/types.ts` atualizado
- Eliminar os `as any` casts que cobrem tabelas já tipadas

### REQ-06: Qualidade — remover dead code em Acoes.tsx

- Remover funções com prefixo `_` que nunca são chamadas (`_handleDeleteProcesso`, `_handleDeleteProsp`, etc.)
- Remover `formatCurrency` local duplicada (importar de `@/lib/format`)

### REQ-07: Performance — cache para GeoJSON do IBGE

- `src/lib/ibgeGeo.ts` deve usar React Query com `queryKey: ["geo", uf]` e `staleTime: 3_600_000`
- Eliminar os 27 fetches paralelos sem cache a cada abertura do mapa

### REQ-08: Performance — xlsx carregado dinamicamente

- `import * as XLSX from "xlsx"` deve ser dinâmico dentro dos handlers de export/import
- Não deve carregar no bundle estático da rota

### REQ-09: Fix rápido — badge `agenda_hoje` ausente no sidebar

- `AppSidebar.tsx` deve exibir o contador de reuniões de hoje no item "Minha Agenda"
- Adicionar `badgeKey: "agenda_hoje"` no item correspondente

### REQ-10: Dependência — adicionar `topojson-client` como dependência explícita

- Adicionar `topojson-client` e `@types/topojson-client` em `package.json`

---

## Milestone 2 — Features prioritárias

### REQ-11: Relatórios exportáveis

- Página `/relatorios` com filtros: período, advogado responsável, ação tributária, status de prospecção
- Exportar para XLSX: funil de prospecção, tarefas por advogado, horas trabalhadas por `tarefas_tempo`
- Não duplicar lógica já existente no Dashboard — reusar componentes

### REQ-12: Prazos processuais

- Tabela `prazos_processuais` vinculada a `processos` e `empresas`
- Campos: tipo de prazo, data de vencimento, responsável, status (pendente/cumprido/perdido)
- Alertas automáticos: edge function que dispara alerta 7 e 2 dias antes do vencimento
- UI: lista de prazos na página de Ações ou página dedicada `/prazos`

### REQ-13: Módulo de honorários / recebimentos

- Tabela `honorarios_recebidos` (empresa, ação, valor, data recebimento, tipo: entrada/êxito/mensalidade)
- Página `/financeiro` com: a receber vs. recebido, vencimentos, filtros por período
- Trigger Postgres para marcar `atrasado` automaticamente (endereça REQ-03)
- Dashboard KPI de receita total no período

---

## Não-objetivos (fora do escopo deste ciclo)

- Integração com Gmail/WhatsApp outbound (muito complexo, baixo ROI imediato)
- Supabase Realtime (nice-to-have, baixa urgência)
- Migração de `xlsx` para `exceljs` (breaking change nos exports existentes)
- Refatoração completa de Acoes.tsx (risco alto, retorno incremental)
