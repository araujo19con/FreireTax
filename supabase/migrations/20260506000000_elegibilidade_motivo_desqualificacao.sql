-- Adiciona campo de motivo de desqualificação na tabela elegibilidade.
-- Idempotente — não falha se a coluna já existir.
ALTER TABLE public.elegibilidade
  ADD COLUMN IF NOT EXISTS motivo_desqualificacao TEXT;
