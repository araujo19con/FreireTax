-- Adiciona campos de destaque e notas de contexto/contatos na elegibilidade
ALTER TABLE public.elegibilidade
  ADD COLUMN IF NOT EXISTS destaque BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notas_contexto TEXT;
