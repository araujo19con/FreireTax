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

| Enum                     | Valores                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `app_role`               | `admin`, `advogado`, `comercial`, `gestor`                                             |
| `tarefa_prioridade`      | `baixa`, `media`, `alta`, `urgente`                                                    |
| `tarefa_status`          | `pendente`, `em_andamento`, `concluida`, `cancelada`                                   |
| `reuniao_status`         | `agendada`, `realizada`, `cancelada`, `no_show`, `reagendada`                          |
| `situacao_cadastral_rfb` | `ATIVA`, `BAIXADA`, `INAPTA`, `SUSPENSA`, `NULA`                                       |
| `porte_rfb`              | `ME`, `EPP`, `DEMAIS`, `MEI`                                                           |
| `qualificacao_estado`    | `nao_avaliada`, `qualificada`, `desqualificada`, `em_prospeccao`, `fechada`, `perdida` |

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

### `acoes_tributarias` — teses jurídicas

`id`, `nome`, `descricao`, `valor_estimado` numeric, `responsavel_id`, `regras_elegibilidade` jsonb (filtra pool RFB), `ativo` bool, timestamps

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

`id`, `empresa_id`, `acao_id`, `elegivel` bool (legacy), `estado` (qualificacao_estado), `motivo_desqualificacao`, `qualificada_em`, `qualificada_por`, `valor_potencial_estimado` numeric, `justificativa`, `user_id`, timestamps

### `prospeccoes` — pipeline comercial (kanban)

`id`, `empresa_id` (NOT NULL), `acao_id` (NOT NULL), `elegibilidade_id` (legacy, nullable), `status_prospeccao` text, `responsavel_id`, `user_id`, `ultimo_contato_em`, `proximo_contato_em`, `valor_proposta` numeric, `observacoes`, timestamps

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

- `v_cobertura_teses` — KPIs de pool/qualif/prosp por ação
- `v_funil_valor_potencial` — funil hormozi com `valor_potencial`
- `pool_elegivel_por_acao(acao_id)` — função que retorna empresas filtradas pelas regras

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
