-- Adiciona regime tributário identificado em empresas.
-- A RFB só fornece opcao_simples e opcao_mei (boolean). Não distingue
-- entre Lucro Real e Lucro Presumido. Esse campo permite o usuário
-- marcar manualmente o regime exato.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS regime_tributario text
  CHECK (regime_tributario IS NULL OR regime_tributario IN (
    'simples', 'mei', 'lucro_presumido', 'lucro_real', 'imune_isento'
  ));

COMMENT ON COLUMN empresas.regime_tributario IS
  'Regime tributário identificado. Valores: simples, mei, lucro_presumido, lucro_real, imune_isento. NULL = não definido.';

-- Backfill: deriva o regime de opcao_simples/opcao_mei quando possível.
-- - opcao_mei = true → mei
-- - opcao_simples = true → simples
-- - opcao_simples = false → fica NULL (não dá pra distinguir presumido/real pelo RFB)
UPDATE empresas
SET regime_tributario = CASE
  WHEN opcao_mei = true THEN 'mei'
  WHEN opcao_simples = true THEN 'simples'
  ELSE NULL
END
WHERE regime_tributario IS NULL;

CREATE INDEX IF NOT EXISTS idx_empresas_regime_tributario
  ON empresas(regime_tributario) WHERE regime_tributario IS NOT NULL;
