-- Permite empresas sem CNPJ — necessário pra importar rows de planilhas legadas
-- onde o CNPJ não está preenchido. UNIQUE constraint continua valendo (PostgreSQL
-- permite múltiplos NULLs em colunas UNIQUE por padrão).
ALTER TABLE public.empresas ALTER COLUMN cnpj DROP NOT NULL;
