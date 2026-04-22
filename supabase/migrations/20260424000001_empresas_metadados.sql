-- Adiciona campos personalizados em empresas via jsonb.
-- Cada empresa pode ter um conjunto livre de pares chave-valor (string→string)
-- definidos pelo usuário, sem alterar o schema toda vez.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS metadados jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN empresas.metadados IS
  'Campos personalizados (jsonb) definidos pelo usuário. Shape: {"<rótulo>": "<valor>"}.';

-- Índice GIN pra permitir busca por chaves/valores no futuro
CREATE INDEX IF NOT EXISTS idx_empresas_metadados_gin
  ON empresas USING gin(metadados);
