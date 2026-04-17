
CREATE TABLE public.processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elegibilidade_id uuid NOT NULL REFERENCES public.elegibilidade(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  numero_processo text DEFAULT '',
  fase text NOT NULL DEFAULT 'Inicial',
  valor_estimado numeric(15,2) DEFAULT 0,
  valor_ganho numeric(15,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'Em andamento',
  observacoes text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own processos"
  ON public.processos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own processos"
  ON public.processos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own processos"
  ON public.processos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own processos"
  ON public.processos FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_processos_elegibilidade ON public.processos(elegibilidade_id);
CREATE INDEX idx_processos_user ON public.processos(user_id);
