# Feature Inventory & Gaps

**Analysis Date:** 2026-05-28
**Scope:** Feature audit complementar ao CONCERNS.md (2026-05-27). Foco em o que existe vs. o que falta num CRM jurídico-tributário.

---

## 1. Inventário de Features Existentes

### Módulo Principal (src/App.tsx — rotas)

| Rota                   | Componente           | Propósito                                                             |
| ---------------------- | -------------------- | --------------------------------------------------------------------- |
| `/`                    | `Dashboard`          | KPIs, funil de conversão, gráficos por tribunal/ação, export XLSX/PDF |
| `/empresas`            | `Empresas`           | CRUD de empresas, views: tabela/card/mapa/kanban                      |
| `/acoes`               | `Acoes`              | Gestão de teses tributárias + painel elegíveis por ação               |
| `/elegibilidade`       | `Elegibilidade`      | Matriz elegibilidade, critérios por tese, qualificação por empresa    |
| `/prospeccao`          | `Prospeccao`         | Kanban 6 colunas + KPIs + contatos + proposta launcher                |
| `/importacao`          | `Importacao`         | Upload RFB (CSV/XLSX), enriquecimento CNPJ em lote                    |
| `/analise-rfb`         | `AnaliseRFB`         | Análise da base RFB por porte/regime/CNAE                             |
| `/meu-espaco`          | `MeuEspaco`          | Hub: Semana + Tarefas + Agenda (abas)                                 |
| `/minhas-tarefas`      | `MinhasTarefas`      | Tarefas pessoais, views: kanban/lista/timeline                        |
| `/tarefas/equipe`      | `EquipeTarefas`      | Visão gestor de tarefas de toda equipe                                |
| `/tarefas/templates`   | `TemplatesAdmin`     | Templates de tarefa com subtarefas predefinidas                       |
| `/propostas/templates` | `PropostasTemplates` | Editor rich-text de templates de proposta com variáveis               |
| `/minha-agenda`        | `MinhaAgenda`        | Calendário mensal de reuniões + ReuniaoDialog                         |
| `/minha-semana`        | `MinhaSemana`        | Visão semanal integrada tarefas + reuniões                            |
| `/admin`               | `Admin`              | CRUD de ações tributárias + admin ações                               |
| `/usuarios`            | `Usuarios`           | Gestão de usuários (admin-only)                                       |
| `/auditoria`           | `Auditoria`          | Log de auditoria filtrado                                             |
| `/analise-rfb`         | `AnaliseRFB`         | Gráficos RFB: porte, regime, CNAE, dispersão faturamento              |
| `/tutorial`            | `Tutorial`           | Onboarding passo-a-passo                                              |

### Sidebar (src/components/AppSidebar.tsx)

Badges de atenção reativos (polling 2 min):

- `tarefas_atrasadas` — tarefas pendentes/em_andamento com `prazo < hoje` do usuário
- `agenda_hoje` — reuniões do dia (contabilizado mas sem badge visual ativo na sidebar atual — `agenda_hoje` está em `CountState` mas nenhum `ItemDef` usa `badgeKey: "agenda_hoje"`)
- `prosp_parados` — prospecções paradas ≥7 dias sem contato

**Gap descoberto:** `agenda_hoje` é carregado e armazenado em state (`CountState`) mas nenhum item do sidebar referencia `badgeKey: "agenda_hoje"`. O contador existe no código mas é silenciosamente descartado. Arquivo: `src/components/AppSidebar.tsx:50,89-92`.

### Edge Functions (supabase/functions/)

| Função                      | Propósito                                              |
| --------------------------- | ------------------------------------------------------ |
| `enriquecer-cnpj`           | Cascade BrasilAPI → CNPJa → ReceitaWS; cacheia 90 dias |
| `buscar-cnpj-por-nome`      | Busca por razão social via BrasilAPI                   |
| `criar-usuario`             | Cria usuário no Auth + profile + role (admin-only)     |
| `enviar-convite-reuniao`    | Gera ICS e envia via Gmail SMTP (denominailer)         |
| `gerar-tarefas-recorrentes` | Scheduler diário: daily/weekly/monthly rules           |
| `backup-completo`           | Export JSON de todas as tabelas para Supabase Storage  |

### Tabelas de banco (src/integrations/supabase/types.ts)

```
acoes_tributarias, audit_logs, cnpj_cache, criterios_elegibilidade,
elegibilidade, elegibilidade_respostas, empresas, pasta_empresa_items,
pastas_empresas, processos, profiles, prospeccao_contatos, prospeccoes,
reunioes, subtarefas, tarefa_anexos, tarefa_comentarios, tarefas,
tarefas_dependencias, tarefas_templates, tarefas_tempo, tarefas_views_salvas,
templates_mensagem, user_roles
```

Views materializadas: `v_funil_conversao`, `v_funil_valor_potencial`.

### Módulo de Tarefas — profundidade real

O módulo de tarefas é o mais rico do sistema. `TarefaDialog` (`src/components/TarefaDialog.tsx`) suporta:

- Título, descrição, responsável, prazo, prioridade (baixa/média/alta/urgente), status
- **Subtarefas** com checklist inline (`subtarefas` table)
- **Comentários** com thread + autoria (`tarefa_comentarios`)
- **Anexos** de até 10 MB (`tarefa_anexos`, Supabase Storage)
- **Timer de tempo** start/stop que registra em `tarefas_tempo` (start/stop em `TarefaExtras.tsx:72,80`) — o schema inclui `started_at`, `stopped_at`, `duration_sec`, `nota`
- **Dependências** entre tarefas (`tarefas_dependencias`, verificada por `pode_iniciar_tarefa()`)
- **Tarefas recorrentes** — `recurrence_rule` (daily/weekly/monthly) + `recurrence_next_run` processado pelo edge function scheduler
- **Views salvas** de filtros (`tarefas_views_salvas`) + barra `SavedViewsBar`
- **Templates** de tarefa com subtarefas predefinidas (`TemplatesAdmin`, `TemplatePicker`)
- Vinculação a empresa, prospecção, ação

`MinhasTarefas` (`src/pages/MinhasTarefas.tsx`) oferece três views: kanban por status, lista, e timeline de prazo (Gantt simplificado, 7d lookback + 30d lookahead). `EquipeView` adiciona escopo gestor.

### Módulo de Prospecção — pipeline kanban

6 colunas definidas em `src/lib/prospeccaoStatus.ts`:

1. Contato feito → 2. Proposta enviada → 3. Em negociação → 4. Contrato assinado → 5. Serviço iniciado → 6. Perdido

Funcionalidades no kanban (`Prospeccao.tsx`):

- KPIs: total, contratos assinados, serviços iniciados, perdidos, valor total, dias médios
- Quick status change por drag (sem biblioteca — manipulação manual de estado)
- Filtros: ação, responsável, texto, status
- Contatos por prospecção (`ProspeccaoContatosDialog`) — suporta canais: email, telefone, whatsapp, linkedin, reunião online/presencial
- Lançador de proposta (`PropostaDialog`) direto do card
- Template selector de mensagens (`TemplateSelectorDialog`) — rascunha mensagens de abertura/follow-up/objeção por canal
- Badge "parada" para prospecções sem contato há ≥7 dias
- Importação de elegibilidades para prospecção (`ImportacaoProspeccaoDialog`)

---

## 2. Status das Correções do Top 10 (CONCERNS.md 2026-05-27)

### Item 1 — PAT vazado em MIGRATION.md

**Status: CORRIGIDO.**
`MIGRATION.md:63-65` agora contém apenas `<seu_supabase_personal_access_token>` como placeholder. O token `sbp_1a8...` foi removido. A linha 228 mostra `SUPABASE_ACCESS_TOKEN = "sbp_..."` (placeholder). O token literal não está mais presente no arquivo.

### Item 2 — Dashboard 1000-row truncation (`Dashboard.tsx:60`)

**Status: CORRIGIDO.**
`src/pages/Dashboard.tsx:21` importa `import { fetchAllRows } from "@/lib/supabaseFetchAll"`. Linhas 67-74 usam `fetchAllRows<ElegibilidadeRow>(...)`, `fetchAllRows<Processo>(...)`, `fetchAllRows<Prospeccao>(...)`. O padrão `.range(0, 9999)` foi removido. Empresas usa `{ count: "exact", head: true }` (correto — só precisa do count).

### Item 4 — Extrair `fetchAllRows` para `src/lib/`

**Status: CORRIGIDO.**
`src/lib/supabaseFetchAll.ts` existe (2.9K), com dois overloads: por nome de tabela e por `BuildQuery`. `PAGE_SIZE = 1000`, `SAFETY_CAP = 200_000`. Importado em `Prospeccao.tsx:34` e `Dashboard.tsx:21`.

### Item 5 — Tests para `cnpj.ts`, `proposta.ts`, `criterios.ts`

**Status: CORRIGIDO (parcialmente).**
Os três arquivos de teste existem e têm conteúdo real:

- `src/lib/cnpj.test.ts` — testa `unmaskCNPJ`, `maskCNPJ`, `validateCNPJ` com casos concretos
- `src/lib/criterios.test.ts` — testa `defaultRegraFor`, `respostaDisparaExclusao`, `validateRegra`
- `src/lib/proposta.test.ts` — testa `renderVariaveis`, `renderSecoes`, `sanitizeProposalHtml`
- `src/lib/supabaseFetchAll.test.ts` — teste de paginação também existe (3.5K)

**Gap residual:** `src/pages/Importacao.tsx` parsers (`parseRegime`, faixa parsers), triggers Postgres (pgtap), e happy paths dos edge functions ainda não têm cobertura.

### Item 8 — Dead trigger `create_initial_tarefa_on_prospeccao`

**Status: CORRIGIDO.**
Migration `supabase/migrations/20260527000001_fix_trigger_tarefa_prospeccao_revive.sql` revivifica o trigger com `IF TG_OP = 'INSERT' AND NEW.status_prospeccao IN ('Contato feito', 'Contato inicial')`. Usa `empresa_id` canônico com fallback para `elegibilidade_id` legado.

### Item 10 — Index `prospeccoes(empresa_id, acao_id)` faltando

**Status: CORRIGIDO.**
`supabase/migrations/20260527000000_prospeccoes_empresa_acao_index.sql` existe (751B).

### Itens 3, 6, 7, 9 — Não verificados nesta análise

Esses itens (XSS proposta, regeneração de types, virtualização, audit log SECURITY DEFINER) não foram verificados como corrigidos — não há evidência de novas migrations ou mudanças no código para esses pontos.

---

## 3. Análise de Fluxos de Usuário

### Pipeline kanban de prospecção

O kanban em `Prospeccao.tsx` usa os 6 status definidos em `src/lib/prospeccaoStatus.ts`. O drag-and-drop é manual (sem dnd-kit/react-beautiful-dnd): o usuário clica num select ou botão quick-change para mover. Não há arrastar-e-soltar real com feedback visual de coluna.

**Gap:** Ausência de drag-and-drop nativo implica UX mais lenta para equipe comercial que trabalha com volume alto de cards. Sem `@hello-pangea/dnd` ou `@dnd-kit/core` em `package.json` — confirmado ausência de dependência.

### Tela de relatórios dedicada

**Não existe.** O único export é no Dashboard (`Dashboard.tsx:258` — XLSX; `Dashboard.tsx:288` — impressão HTML). Não há rota `/relatorios` nem componente específico. O Dashboard serve como substituto mas não permite filtros personalizados, recortes por período arbitrário ou export por critério (ex: "todas as prospecções ganhas no trimestre por advogado").

### Gestão de honorários / financeiro

**Não existe como módulo.** Situação atual:

- `propostas` tem `valor_entrada` e `percentual_exito` (capturado ao criar a proposta)
- `prospeccoes.valor_contrato` registra o valor negociado
- `processos.valor_estimado` e `valor_ganho` registram o financeiro do processo
- **Não há tabela de recebimentos** — zero registros de `honorarios_recebidos`, `parcelas`, `cobranca`, ou similar no schema (confirmado via busca em `types.ts`)
- **Não há visão de "quanto já recebemos"** vs. "quanto temos a receber"

Um CRM jurídico-tributário maduro precisaria: emissão de nota/recibo, controle de parcelas de honorários de êxito, dashboard de recebimentos por ação/empresa, alertas de vencimento de parcela.

### Histórico/timeline por empresa

**Parcialmente implementado.** `EmpresaDetailSheet.tsx` tem aba "Histórico" (`value="audit"`, linha 394/825) que mostra até 30 registros do `audit_logs` filtrado por `tabela = 'empresas'` e `registro_id = empresa.id`. É funcional mas limitado:

- Mostra apenas eventos do `audit_logs` (criação/edição da empresa), não uma timeline unificada de reuniões, tarefas, mudanças de prospecção
- As abas do detail sheet são: Visão Geral | RFB | Pastas | Ações | Tarefas | Reuniões | Histórico — separadas por entidade, não em timeline cronológica integrada

**Gap:** Não há uma timeline unificada cronológica mostrando: "em 10/05 reunião realizada → em 12/05 proposta enviada → em 15/05 contrato assinado" para um relacionamento empresa×ação específico.

### Integração de e-mail / comunicação

**Parcial.** O sistema tem:

- `enviar-convite-reuniao` (edge function) — envia ICS via Gmail SMTP; ativa somente para convites de reunião
- `templates_mensagem` — templates para WhatsApp, email, telefone, LinkedIn (usado em `TemplateSelectorDialog` no kanban), mas apenas copia o texto para a área de transferência — **não dispara envio real de email/WhatsApp**
- `ProspeccaoContatosDialog` — registra contatos manuais por canal (whatsapp, email, etc.) com data/hora, mas o canal é informativo — não integra com Gmail/Outlook/WhatsApp API

**Gap:** Zero integração outbound de email/WhatsApp a partir do sistema. O template de mensagem gera o texto, o usuário copia e cola manualmente na ferramenta de comunicação. Não há rastreamento de abertura de email, nem envio programático.

### Controle de prazos processuais além de tarefas genéricas

**Não existe como módulo dedicado.** Situação atual:

- `acoes_tributarias` tem `data_limite_prescricao` e `tipo_prazo` (enum `tipo_prazo`) e `observacao_prazo`
- `processos` tem `data_processo` (data do ajuizamento) mas **nenhuma coluna de prazo processual, data de audiência, data de intimação, ou vencimento de recurso**
- Não há tabela `prazos_processuais`, `intimacoes`, `movimentacoes`, ou similar no schema
- Prazos são controlados via tarefas genéricas (campo `prazo` em `tarefas`), o que funciona mas não oferece integração com número do processo, tribunal, ou tipo de prazo (contestação, recurso, etc.)

**Gap crítico para escritório de advocacia:** Um CRM jurídico-tributário precisa de módulo de prazos com: alertas de vencimento automáticos por tipo processual, vinculação a número de processo, histórico de andamentos, e integração com sistemas de consulta processual (DataJud/ESAJ).

---

## 4. Análise de Notificações e Alertas

### O que existe

- **Badges reativas na sidebar** (`AppSidebar.tsx:110-140`): polling a cada 2 min para tarefas atrasadas (`tarefas_atrasadas`) e prospecções paradas (`prosp_parados`). Exibe contador vermelho.
- **Convite de reunião por email** (`enviar-convite-reuniao`): email ICS enviado ao criar/editar reunião
- **Tarefas recorrentes** (`gerar-tarefas-recorrentes`): cria tarefa nova automaticamente via scheduler cron (necessita agendamento manual via `supabase functions schedule`)
- **Trigger de tarefa inicial** (`20260527000001`): cria tarefa "Contato inicial" automaticamente ao criar prospecção

### O que não existe

- **Sem push/web notifications** — zero uso de `Notification API`, `service worker`, ou push backend (não há `firebase`, `OneSignal`, `WebPush` em `package.json`). Confirmado pela busca por `notif|push_notification|FCM|OneSignal` em `src/` — zero resultados relevantes.
- **Sem realtime Supabase** — não há `supabase.channel(...).subscribe()` em nenhum componente. AppSidebar explicitamente comenta "não é realtime, mas suficiente pra CRM" (`AppSidebar.tsx:151`). Mudanças feitas por outro usuário não aparecem sem recarregar.
- **Sem sistema de alertas proativos** para prazos de tarefas — a badge mostra tarefas JÁ atrasadas, não um alerta antes do vencimento (ex: "tarefa vence amanhã").
- **Sem email de lembrete** — não há edge function `enviar-lembrete-tarefa` ou similar. O `gerar-tarefas-recorrentes` cria novas tarefas mas não envia notificação ao responsável.
- **`agenda_hoje` sem badge visível** — como detalhado na Seção 1: o contador de reuniões de hoje é carregado mas nenhum item de menu usa `badgeKey: "agenda_hoje"`. Bug de feature incompleta em `AppSidebar.tsx:50` (tipo `CountState`) vs. a definição dos items onde `agenda` não tem `badgeKey`.

---

## 5. Análise do Módulo de Tarefas

### Profundidade atual

O módulo é genuinamente profundo (ver Seção 1). O `TarefaDialog` tem abas implícitas gerenciadas por `Tabs`:

- Aba principal: título, descrição, responsável, empresa, prospecção, ação, prazo, prioridade, status
- `TarefaExtras` (`src/components/TarefaExtras.tsx`): timer start/stop (registra em `tarefas_tempo`), dependências, recorrência
- Subtarefas inline com checklist
- Comentários com thread
- Anexos (upload + download, max 10 MB)

### Gaps no módulo de tarefas

**Sem relatório de tempo por advogado/projeto:** A tabela `tarefas_tempo` armazena `started_at`, `stopped_at`, `duration_sec` por entrada de timer, mas não há nenhuma view, página ou componente que agregue "horas trabalhadas por advogado × ação × período". O timer existe no schema e UI mas os dados ficam sem utilidade gerencial.

**Sem notificação ao responsável ao ser atribuído:** Quando `assigned_to` muda, o usuário designado não recebe notificação (sem push, sem email, sem badge específica de "nova tarefa atribuída"). A sidebar mostra `tarefas_atrasadas` mas não "tarefas novas recebidas hoje".

**Sem sistema de aprovação / revisão:** Não há status de "em revisão" ou "aguardando aprovação" — o fluxo é linear (pendente → em_andamento → concluída). Para escritório que trabalha com revisão de documentos/minutas, isso é uma limitação.

**`TemplateSelectorDialog` só usado em Prospecção:** O dialog que permite selecionar templates de mensagem (`src/components/TemplateSelectorDialog.tsx`) é importado apenas em `Prospeccao.tsx:50,1568`. O módulo de tarefas e reuniões poderia se beneficiar de templates de follow-up, mas não integra com `templates_mensagem`.

**Views de tarefas do projeto ausentes:** `MinhasTarefas` mostra "minhas tarefas" e `EquipeView` mostra tarefas da equipe, mas não há visão "por empresa" ou "por ação tributária" — para ver todas as tarefas de um cliente específico, o usuário precisa ir ao `EmpresaDetailSheet` (mostra apenas as 20 mais recentes, sem filtros).

---

## 6. Gaps Funcionais — Resumo Priorizado

| Gap                                                     | Impacto                                      | Complexidade | Próxima ação sugerida                                                            |
| ------------------------------------------------------- | -------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Módulo de honorários / financeiro                       | Alto — escritório não acompanha recebimentos | Alta         | Nova tabela `honorarios_recebidos` + página `/financeiro`                        |
| Controle de prazos processuais dedicado                 | Alto — risco de perda de prazo               | Alta         | Tabela `prazos_processuais` + alertas por email                                  |
| Relatórios exportáveis personalizados                   | Alto — gestão sem dados filtrados            | Média        | Página `/relatorios` com filtros por período/advogado/ação                       |
| Badge `agenda_hoje` não exibida                         | Baixo                                        | Mínimo       | Adicionar `badgeKey: "agenda_hoje"` em item `MinhaAgenda` em `AppSidebar.tsx:67` |
| Notificações proativas (email/push) antes de vencimento | Médio                                        | Alta         | Edge function `enviar-lembrete-tarefa` + Web Push API                            |
| Drag-and-drop real no kanban                            | Médio (UX)                                   | Média        | Adicionar `@hello-pangea/dnd` ou `@dnd-kit/core`                                 |
| Timeline cronológica unificada por empresa              | Médio                                        | Média        | View que une audit_logs + tarefas + reuniões + status prospecção                 |
| Relatório de horas trabalhadas por advogado             | Médio                                        | Baixa        | Agregar `tarefas_tempo` em `/relatorios` ou `AnaliseRFB`                         |
| Envio real de email/WhatsApp (não só cópia de template) | Baixo (complexo)                             | Muito alta   | Integração Gmail API ou Resend + WhatsApp Business API                           |
| Supabase Realtime para colaboração                      | Baixo                                        | Média        | `supabase.channel('tarefas').on('postgres_changes', ...)`                        |

---

_Feature gap audit: 2026-05-28_
