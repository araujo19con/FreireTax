
CREATE TABLE public.prospeccoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elegibilidade_id uuid NOT NULL REFERENCES public.elegibilidade(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  contato_nome text DEFAULT '',
  contato_telefone text DEFAULT '',
  contato_email text DEFAULT '',
  contato_cargo text DEFAULT '',
  status_prospeccao text NOT NULL DEFAULT 'Não iniciado',
  notas_prospeccao text DEFAULT '',
  valor_contrato numeric(15,2) DEFAULT 0,
  tipo_contrato text DEFAULT '',
  data_contrato date,
  data_assinatura date,
  observacoes_contrato text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.prospeccoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prospeccoes"
  ON public.prospeccoes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prospeccoes"
  ON public.prospeccoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prospeccoes"
  ON public.prospeccoes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own prospeccoes"
  ON public.prospeccoes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_prospeccoes_elegibilidade ON public.prospeccoes(elegibilidade_id);
CREATE INDEX idx_prospeccoes_user ON public.prospeccoes(user_id);
