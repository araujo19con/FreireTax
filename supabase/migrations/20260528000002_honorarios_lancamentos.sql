-- Módulo financeiro: lançamentos de honorários por prospecção/empresa.
-- Tipos: retainer (mensal), exito (success fee), avulso (único).
-- Status: pendente → pago | atrasado | cancelado.

CREATE TYPE honorario_tipo AS ENUM ('retainer', 'exito', 'avulso');
CREATE TYPE honorario_status AS ENUM ('pendente', 'pago', 'atrasado', 'cancelado');

CREATE TABLE public.honorarios_lancamentos (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id     uuid        REFERENCES public.prospeccoes(id) ON DELETE SET NULL,
  empresa_id        uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo              honorario_tipo NOT NULL DEFAULT 'avulso',
  descricao         text,
  valor             numeric(14, 2) NOT NULL CHECK (valor > 0),
  data_vencimento   date        NOT NULL,
  data_pagamento    date,
  status            honorario_status NOT NULL DEFAULT 'pendente',
  nota              text,
  created_by        uuid        REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER honorarios_updated_at
  BEFORE UPDATE ON public.honorarios_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índices para as queries mais comuns
CREATE INDEX honorarios_empresa_id_idx  ON public.honorarios_lancamentos (empresa_id);
CREATE INDEX honorarios_prospeccao_idx  ON public.honorarios_lancamentos (prospeccao_id);
CREATE INDEX honorarios_vencimento_idx  ON public.honorarios_lancamentos (data_vencimento);
CREATE INDEX honorarios_status_idx      ON public.honorarios_lancamentos (status);

-- RLS
ALTER TABLE public.honorarios_lancamentos ENABLE ROW LEVEL SECURITY;

-- Admin e gestor veem tudo; advogado/comercial veem os próprios lançamentos
CREATE POLICY "honorarios_select" ON public.honorarios_lancamentos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'gestor')
    )
    OR created_by = auth.uid()
  );

CREATE POLICY "honorarios_insert" ON public.honorarios_lancamentos
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "honorarios_update" ON public.honorarios_lancamentos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'gestor')
    )
    OR created_by = auth.uid()
  );

-- Apenas admin pode deletar
CREATE POLICY "honorarios_delete" ON public.honorarios_lancamentos
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

COMMENT ON TABLE public.honorarios_lancamentos IS
  'Lançamentos financeiros de honorários (retainer, sucesso, avulso) por empresa/prospecção.';
