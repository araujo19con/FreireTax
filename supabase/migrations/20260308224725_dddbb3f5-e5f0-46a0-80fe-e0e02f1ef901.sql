ALTER TABLE public.processos ADD COLUMN IF NOT EXISTS data_processo date DEFAULT NULL;
ALTER TABLE public.processos ADD COLUMN IF NOT EXISTS tribunal text DEFAULT ''::text;