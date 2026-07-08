# enriquecer-fila — enriquecimento autônomo de contatos

Orquestrador que roda **sozinho** e vai enchendo a base de contatos/e-mails a
partir da Receita, priorizando os leads que mais importam.

## Como funciona (o fluxo completo)

```
                         pg_cron (a cada X horas)
                                  │  POST /functions/v1/enriquecer-fila?limite=25
                                  ▼
        ┌─────────────────  enriquecer-fila  ─────────────────┐
        │ 1. lê v_fila_enriquecimento (empresas com contato   │
        │    fraco/ausente, priorizadas: em pipeline > maior  │
        │    valor potencial > maior capital social)          │
        │ 2. p/ cada CNPJ: BrasilAPI (350ms entre chamadas)   │
        │ 3. grava em empresas (qsa/telefone/email/…)         │
        │ 4. registra em enriquecimento_log                   │
        └───────────────────────┬─────────────────────────────┘
                                │  UPDATE empresas
                                ▼
     trigger derive_contatos_from_rfb  (JÁ EXISTIA)
       → materializa empresa_contatos: sócios (papel=socio) +
         canais (telefone/email, papel=geral), idempotente
                                │
                                ▼
     trigger recalc_empresa_contatos_cache → atualiza
       empresas.contatos_count / contato_principal_*
                                │
                                ▼
     v_empresa_contato_qualidade recalcula score/bucket →
       a empresa sai da fila quando fica "bom"/"otimo"
```

Camadas (migrations `20260707000001`):

- **`v_empresa_contato_qualidade`** — score 0-100 por empresa e bucket
  (`sem_contato` / `fraco` / `bom` / `otimo`). Pesos: decisor 30, e-mail 20,
  celular/WhatsApp 20, LinkedIn 20, fixo 10. `is_contador` **não** conta como decisor.
- **`v_fila_enriquecimento`** — quem processar, já ordenado. Só entra quem tem
  CNPJ válido, situação ATIVA (ou desconhecida), bucket fraco/sem_contato, RFB
  nunca puxada/desatualizada (>90d)/sem contatos. Backoff: sai da fila quem
  falhou ≥3× nos últimos 7 dias.
- **`enriquecimento_log`** — auditoria + backoff.
- **`v_enriquecimento_resumo`** — contagem por bucket (tile de dashboard).

## Deploy

```bash
# 1. aplicar as migrations
supabase db push        # ou colar os 2 .sql no SQL Editor

# 2. publicar a função
supabase functions deploy enriquecer-fila
```

A função usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (auto-populadas pelo
Edge Runtime). **Não precisa** de env extra para o tier RFB.

## Ligar o "roda por si só" (pg_cron)

Cole **uma vez** no Supabase SQL Editor (mesmo padrão do backup semanal):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Roda de hora em hora, das 7h às 20h (BRT ~ 10-23 UTC), 25 empresas por vez.
-- 25 CNPJs × 350ms ≈ 9s por execução — bem abaixo de qualquer limite.
SELECT cron.schedule(
  'enriquecer-fila-horario',
  '0 10-23 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<SEU-PROJETO>.supabase.co/functions/v1/enriquecer-fila?limite=25',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUA-SERVICE-ROLE-KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Substitua `<SEU-PROJETO>` e `<SUA-SERVICE-ROLE-KEY>` (Settings → API).
Para desligar: `SELECT cron.unschedule('enriquecer-fila-horario');`

## Testar sem gravar nada

```bash
curl -X POST 'https://<PROJETO>.supabase.co/functions/v1/enriquecer-fila?dry=1&limite=10' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>'
# devolve a fila priorizada, sem tocar no banco
```

## Tier 2 — LinkedIn e e-mail de decisor (plugável, opcional)

A Receita entrega **sócios + telefone + e-mail genérico** — sobe a maioria das
empresas de `sem_contato` para `fraco`/`bom`. Mas a RFB **não tem LinkedIn** nem
e-mail direto do decisor. Para chegar a `otimo` (bucket com LinkedIn/decisor),
duas opções, ambas já compatíveis com o schema (`empresa_contatos.linkedin`,
`papel='decisor'`, `origem='enriquecimento'`):

1. **DRIVA** (você já usa) — importe contatos via `tools/import-driva-contatos.mjs`.
   Já popula LinkedIn e papel do decisor. É o caminho mais barato hoje.
2. **Provider externo por API** (Apollo, etc.) — plugar aqui, logo após o passo
   BrasilAPI, guardado por env `ENRICH_PROVIDER_API_KEY`:

   ```ts
   // TODO tier-2 (só roda se a env existir — degrada gracioso sem ela):
   const PROVIDER_KEY = Deno.env.get("ENRICH_PROVIDER_API_KEY");
   if (PROVIDER_KEY && stillMissingDecisor) {
     // 1. people-search por domínio/CNPJ no provider
     // 2. upsert em empresa_contatos:
     //    { empresa_id, nome, cargo, papel:'decisor', email, linkedin,
     //      origem:'enriquecimento', dedup_key:'apollo:'+<id> }
     // fonte no log = 'apollo'
   }
   ```

   ⚠️ Antes de ligar um provider pago: custo por lead + base legal LGPD
   (legítimo interesse B2B, com opt-out). Decisão sua — o tier RFB roda sozinho
   sem isso.
