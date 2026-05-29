-- Torna empresa_id e acao_id NOT NULL em prospeccoes.
-- Pré-condição: migration 20260527000000 já adicionou as colunas e backfillou
-- todos os 36 registros existentes. Verificado: 0 nulos antes de aplicar.

ALTER TABLE public.prospeccoes
  ALTER COLUMN empresa_id SET NOT NULL,
  ALTER COLUMN acao_id    SET NOT NULL;
