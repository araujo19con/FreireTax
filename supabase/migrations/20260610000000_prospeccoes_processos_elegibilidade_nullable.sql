-- Torna elegibilidade_id NULLABLE em prospeccoes e processos.
--
-- Contexto: empresa_id + acao_id viraram a fonte da verdade do vínculo
-- (migrations 20260527000000 / 20260529000001 / 20260529000002 — ambas as
-- colunas já estão NOT NULL e backfilladas). elegibilidade_id continua na
-- tabela como dado legado / lookup de valor_potencial_estimado, mas deixa de
-- ser obrigatório.
--
-- Sem isto, os fluxos que criam o vínculo direto por (empresa, ação) quebram
-- com violação de NOT NULL:
--   * ProspeccaoRapidaDialog (prospecção a partir de uma empresa, sem elegibilidade)
--   * Prospeccao.handleCreate (insert sem elegibilidade_id)
--   * ImportacaoProspeccaoDialog (prospecções e processos importados)
--
-- Os triggers que leem NEW.elegibilidade_id já tratam NULL com fallback para
-- empresa_id (20260527000001, 20260608000003: `ELSIF NEW.elegibilidade_id IS NOT NULL`).
--
-- Idempotente: DROP NOT NULL é no-op se a coluna já for nullable.

ALTER TABLE public.prospeccoes
  ALTER COLUMN elegibilidade_id DROP NOT NULL;

ALTER TABLE public.processos
  ALTER COLUMN elegibilidade_id DROP NOT NULL;

COMMENT ON COLUMN public.prospeccoes.elegibilidade_id IS
  'Legado/opcional. Vínculo canônico = empresa_id + acao_id. Mantido para lookup de valor_potencial_estimado quando existir elegibilidade.';

COMMENT ON COLUMN public.processos.elegibilidade_id IS
  'Legado/opcional. Vínculo canônico = empresa_id + acao_id.';
