-- Adiciona quantidade de funcionários e faturamento anual em empresas.
-- Campos manuais (não vêm da Receita Federal) — populados via:
-- - Edição direta no EmpresaDialog
-- - Importação de planilha (Importação em Massa)
--
-- faturamento_anual é distinto de faturamento_estimado (este último é
-- preenchido por enriquecimento automático no futuro).

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS quantidade_funcionarios integer,
  ADD COLUMN IF NOT EXISTS faturamento_anual numeric(14,2);

COMMENT ON COLUMN empresas.quantidade_funcionarios IS
  'Número de funcionários da empresa (manual, importável via planilha).';

COMMENT ON COLUMN empresas.faturamento_anual IS
  'Faturamento anual em R$ (manual, importável via planilha). Distinto de faturamento_estimado.';

-- Índices opcionais pra filtros futuros por faixa
CREATE INDEX IF NOT EXISTS idx_empresas_quantidade_funcionarios
  ON empresas(quantidade_funcionarios) WHERE quantidade_funcionarios IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_empresas_faturamento_anual
  ON empresas(faturamento_anual) WHERE faturamento_anual IS NOT NULL;
