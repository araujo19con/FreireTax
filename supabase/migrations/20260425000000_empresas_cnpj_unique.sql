-- Garante que CNPJ é único na tabela empresas.
-- Antes desta migration, era possível cadastrar manualmente o mesmo CNPJ
-- várias vezes (a importação já tinha lógica de match-by-CNPJ, mas o
-- EmpresaDialog não validava).

-- Passo 1: dedup — mantém a empresa mais antiga (created_at mais cedo)
-- e remove as duplicatas posteriores. Empresas com CNPJ NULL/vazio são ignoradas.
DELETE FROM empresas a
USING empresas b
WHERE a.cnpj = b.cnpj
  AND a.cnpj IS NOT NULL
  AND a.cnpj <> ''
  AND a.created_at > b.created_at;

-- Passo 2: adiciona o constraint UNIQUE.
-- Postgres aceita múltiplos NULL em colunas UNIQUE por padrão (compatível
-- com casos legados onde cnpj possa estar vazio temporariamente).
ALTER TABLE empresas
  ADD CONSTRAINT empresas_cnpj_unique UNIQUE (cnpj);

COMMENT ON CONSTRAINT empresas_cnpj_unique ON empresas IS
  'Cada CNPJ pode existir apenas uma vez. Cadastros duplicados retornam código 23505.';
