---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "supabase/**"
---

# Schema Supabase — Referência rápida

**Use este arquivo ao invés de abrir `src/integrations/supabase/types.ts` (1.624 linhas).**

Para tipar queries TypeScript:

```ts
import type { Database } from "@/integrations/supabase/types";
type Tarefa = Database["public"]["Tables"]["tarefas"]["Row"];
type TarefaInsert = Database["public"]["Tables"]["tarefas"]["Insert"];
type TarefaStatus = Database["public"]["Enums"]["tarefa_status"];
```

## Enums

| Enum                      | Valores                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app_role`                | `admin`, `advogado`, `comercial`, `gestor`                                                                                      |
| `tarefa_prioridade`       | `baixa`, `media`, `alta`, `urgente`                                                                                             |
| `tarefa_status`           | `pendente`, `em_andamento`, `concluida`, `cancelada`                                                                            |
| `reuniao_status`          | `agendada`, `realizada`, `cancelada`, `no_show`, `reagendada`                                                                   |
| `situacao_cadastral_rfb`  | `ATIVA`, `BAIXADA`, `INAPTA`, `SUSPENSA`, `NULA`                                                                                |
| `porte_rfb`               | `ME`, `EPP`, `DEMAIS`, `MEI`                                                                                                    |
| ~~`qualificacao_estado`~~ | **NÃO EXISTE** (nunca criado). O estado da elegibilidade vem de `elegivel`+`status_qualificacao`+`ja_ajuizada`, não de um enum. |
| `papel_contato`           | `socio`, `decisor`, `financeiro`, `juridico`, `contador`, `comercial`, `operacional`, `geral`, `outro`                          |
| `origem_contato`          | `driva`, `rfb`, `manual`, `importacao`, `enriquecimento`, `outro`                                                               |
| `tipo_telefone`           | `fixo`, `movel`, `desconhecido`                                                                                                 |
| `telefone_status_contato` | `nao_testado`, `atendeu`, `nao_atendeu`, `caixa_postal`, `ocupado`, `numero_errado`, `nao_existe`                               |

Status de prospecção (text, não enum): `"Não iniciado"`, `"Contato inicial"`, `"Qualificação"`, `"Proposta enviada"`, `"Negociação"`, `"Contrato assinado"`, `"Perdido"`.

## Tabelas principais

### `profiles` — usuários do sistema

`id` (uuid, FK auth.users), `nome`, `email`, `ativo` bool, `role` (legacy — use `user_roles`), `created_at`, `updated_at`

### `user_roles`

`id`, `user_id` (FK profiles), `role` (app_role)

### `empresas` — clientes e prospects (enriquecido RFB)

Essenciais: `id`, `nome`, `cnpj`, `responsavel_id` (FK profiles)
RFB: `razao_social`, `nome_fantasia`, `situacao_cadastral` (enum), `porte` (enum), `uf`, `municipio`, `cnae_principal`, `cnae_descricao`, `capital_social` numeric, `opcao_simples` bool, `opcao_mei` bool, `data_abertura` date, `natureza_juridica`, `email_rfb`, `telefone_rfb`, `endereco_*`, `receita_atualizada_em` timestamptz
Timestamps: `created_at`, `updated_at`

### `empresa_contatos` — diretório de contatos por empresa (mig 20260608)

Pessoas e canais reais de cada empresa (sócios, decisores, financeiro, contador, canais genéricos) — alimentado por DRIVA/RFB/manual. É o "QUEM e COMO falar" da prospecção.

`id`, `empresa_id` (FK CASCADE), `nome` (nullable — canal sem nome), `cargo`, `papel` (enum `papel_contato`), `email`, `telefone`, `tipo_telefone` (enum: fixo/movel/desconhecido), `whatsapp` bool, `linkedin`, `is_contador` bool (DRIVA "Pertence ao Contador" — NÃO é decisor), `principal` bool (1 por empresa, garantido por trigger), `origem` (enum `origem_contato`), `cpf_mascarado`, `faixa_etaria`, `observacoes`, `metadados` jsonb, `dedup_key` (idempotência do importador — UNIQUE parcial `(empresa_id, dedup_key)`), `telefone_invalido` bool (mig `20260709000001` — marca número testado como errado/inexistente ANTES de entrar em prospecção), `telefone_invalido_motivo`, `telefone_invalido_em`, `telefone_invalido_por` (FK profiles — carimbados automaticamente por trigger), `telefone_status` (enum `telefone_status_contato`, mig `20260715000000` — categoriza o RESULTADO de cada telefone: nao_atendeu/atendeu/caixa_postal/ocupado/numero_errado/nao_existe; **NÃO é toque de prospecção**), `telefone_status_nota`, `telefone_status_em`, `telefone_status_por`, `created_by`, timestamps.

- Trigger `derive_telefone_status` (BEFORE, roda antes do `stamp_telefone_invalido`): `telefone_status IN (numero_errado, nao_existe)` DERIVA `telefone_invalido=true` (espelho) e sincroniza `telefone_invalido_motivo := telefone_status_nota`; carimba `telefone_status_em/_por` na mudança. Ou seja, `telefone_invalido` virou derivado do status — o front grava só `telefone_status` (+ nota). UI: select de status no `ContatoDialog`, badge + filtro "Status tel." + colunas no CSV em `Contatos.tsx`, badge + toggle rápido em `EmpresaContatosSection`. Helpers `TELEFONE_STATUS`/`telefoneStatusMeta`/`humanizeTelefoneStatus`/`telefoneStatusInvalida` em `src/lib/contatos.ts`.

- Trigger `recalc_empresa_contatos_cache` mantém snapshot em `empresas`: `contatos_count`, `contato_principal_nome/cargo/telefone/email/whatsapp`. Telefone/whatsapp de contato com `telefone_invalido=true` NUNCA entram nesse snapshot (cai pro fallback `telefone_receita` na tarefa "Contato inicial").
- Trigger `ensure_single_contato_principal` rebaixa os demais ao marcar um principal.
- Trigger `stamp_telefone_invalido` carimba `telefone_invalido_em/_por` ao marcar, limpa os 3 campos ao desmarcar.
- **NÃO confundir com `prospeccao_contatos`** (log de toques da cadência) — coisas diferentes.
- UI: `EmpresaContatosSection` (aba "Contatos" do `EmpresaDetailSheet`) + `ContatoDialog` (checkbox "Telefone errado" + motivo) + tela global `Contatos.tsx` (filtro "Telefone inválido", badge, toggle rápido, coluna no CSV) + `ContatosCoverageCard` (tile de qualidade + origem dos inválidos). Helpers em `src/lib/contatos.ts`. Importador: `tools/import-driva-contatos.mjs`.

### `acoes_tributarias` — teses jurídicas

`id`, `nome`, `descricao`, `tipo` (INICIAL/RESCISÓRIA), `status` text (**gate real de visibilidade**: `"Ativa"`/`"Em análise"`/`"Inativa"`), `vinculo`, `valor_estimado` numeric, `responsavel_id`, `regras_elegibilidade` jsonb, `ativo` bool, timestamps

- ⚠️ **`ativo` (bool) é MORTO** — nada lê. Quem esconde do pool/matriz/detecção é `status <> "Ativa"`. Para desativar uma tese, use `status="Inativa"` (não `ativo=false`).
- ⚠️ **Sem UNIQUE em `nome`** — mas a detecção PJe mapeia tese→`acao_id` por NOME normalizado; nome duplicado quebra o mapeamento. Há checagem de nome duplicado na criação (front).
- `regras_elegibilidade` (jsonb) e a RPC `pool_elegivel_por_acao` são **legado/não usados** no código — o "pool" hoje = linhas de `elegibilidade` criadas manual/em lote.

Shape de `regras_elegibilidade`:

```json
{
  "situacao_cadastral": ["ATIVA"],
  "porte": ["EPP", "DEMAIS"],
  "opcao_simples": false,
  "uf": ["RN", "PB"],
  "cnae_prefixos": ["451"],
  "capital_social_min": 0
}
```

### `elegibilidade` — qualificação empresa × tese

`id`, `empresa_id`, `acao_id`, `elegivel` bool, `status_qualificacao` text (`nao_qualificada`/`incompleta`/`qualificada`/`desqualificada`/`legado`), `motivo_desqualificacao`, `score_elegibilidade`, `valor_calculado`, `valor_potencial_estimado` numeric, `destaque` bool, `notas_contexto`, `observacao_valor`, `justificativa`, `qualificada_em`, `qualificada_por`, `user_id`, timestamps.
**Ajuizamento** (mig 20260713000000): `ja_ajuizada` bool, `ajuizada_por_nos` bool (null=?/true=nós/false=terceiro), `ajuizamento_notas`.

- **NÃO existe coluna `estado` nem enum `qualificacao_estado`** — o "estado" da célula é derivado de `elegivel` + `status_qualificacao` + `ja_ajuizada`. (Havia código gravando `estado` — bug, corrigido.)
- **UNIQUE(empresa_id, acao_id)** (mig 20260506000002) — use upsert `on_conflict=empresa_id,acao_id`, nunca insert cru.
- **`ja_ajuizada=true` SAI do pool/elegível/matriz/candidatas a prospecção** (filtrado no front — `statusOf` em applyAcaoEmpresaFilters.ts devolve `"ja_ajuizada"`). A linha permanece (rastreável). Marcação é MANUAL (não há bridge automático da detecção PJe).

### `prospeccoes` — pipeline comercial (kanban)

`id`, `empresa_id` (NOT NULL), `acao_id` (NOT NULL), `elegibilidade_id` (legacy, nullable), `status_prospeccao` text, `responsavel_id`, `user_id`, `ultimo_contato_em`, `proximo_contato_em`, `valor_proposta` numeric, `observacoes`, timestamps

- **Índice único PARCIAL `uq_prospeccoes_empresa_acao_ativa`** (mig 20260803000000): no máximo UMA prospecção ATIVA (status_prospeccao <> 'Perdido') por (empresa_id, acao_id). Permite reabrir após "Perdido". Inserts fazem pré-check + tratam 23505 (upsert não infere índice parcial no PostgREST).

### `tarefas`

`id`, `titulo`, `descricao`, **`assigned_to`** (FK profiles — NÃO tem `user_id`!), **`created_by`**, `empresa_id`, `acao_id`, `prospeccao_id`, `prazo` timestamptz, `prioridade` (enum), `status` (enum), `concluida_em`, timestamps

### `subtarefas`

`id`, `tarefa_id` (CASCADE), `titulo`, `concluida` bool, `ordem` int, `created_at`

### `tarefa_comentarios`

`id`, `tarefa_id` (CASCADE), `user_id` (FK profiles), `texto`, `created_at`

### `tarefa_anexos`

`id`, `tarefa_id` (CASCADE), `user_id`, `nome`, `storage_path`, `tamanho_bytes` bigint, `mime_type`, `created_at`
Storage bucket: `tarefa-anexos` (privado)

### `reunioes` — agenda

`id`, `titulo`, `descricao`, `advogado_id` (FK profiles), `created_by`, `empresa_id`, `prospeccao_id`, `lead_nome`, `lead_email`, `data_inicio`, `data_fim`, `local`, `link_reuniao`, `status` (enum), `notas`, `ics_uid` unique, `ics_enviado_em`, timestamps

### `cnpj_cache` — cache BrasilAPI (90 dias)

`cnpj` PK, `payload` jsonb, `atualizado_em` timestamptz

### `rfb_estabelecimentos_busca` — slim RFB pra busca por nome (mig 20260514)

`cnpj` PK, `razao_social`, `nome_fantasia`, `uf`, `municipio`, `atualizado_em`. Populada via ETL local `tools/import-rfb-slim.mjs` (só ATIVAS + UFs configuradas, default RN+PB). Use a RPC `buscar_rfb_por_nome(termo, uf_filtro, limite)` (índice GIN trigram, fuzzy). View `v_rfb_busca_status` mostra cobertura por UF.

### `templates_mensagem` / `templates_tarefa`

Templates reutilizáveis. Templates de tarefa têm `titulo_template`, `descricao_template`, `prioridade`, `offset_prazo_dias`, `subtarefas` jsonb[].

### Views úteis

- `v_funil_valor_potencial` — funil hormozi com `valor_potencial` (mig 20260418000000; usado em FunilHormozi.tsx)
- ~~`v_cobertura_teses`~~ e ~~`pool_elegivel_por_acao(acao_id)`~~ — **não existem no código/migrations** (só no doc antigo). O pool real = linhas de `elegibilidade`.

## RLS (padrão)

- Admin vê tudo
- Gestor vê tudo no escopo
- Advogado/comercial vê só próprios recursos (responsavel_id/assigned_to = auth.uid())
- Insert sempre com `created_by = auth.uid()`

## Gotchas

1. **`tarefas` NÃO tem `user_id`** — use `created_by` + `assigned_to`
2. **`prospeccoes`** precisa de `empresa_id + acao_id` desde a migration `20260421_elegibilidade_workflow`. `elegibilidade_id` é legacy.
3. **Trigger `create_initial_tarefa_on_prospeccao`** dispara em insert de prospecção com status "Não iniciado" (cria tarefa "Contato inicial — <empresa>").
4. **Enriquecimento RFB** é disparado async por edge function, atualizando `receita_atualizada_em`. Nunca editar campos RFB manualmente no frontend.
