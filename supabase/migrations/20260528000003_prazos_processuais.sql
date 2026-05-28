-- Prazos processuais vinculados às prospecções/ações tributárias.
-- Edge function verificar-prazos (cron diário) envia alertas por email.

CREATE TYPE prazo_status AS ENUM ('pendente', 'cumprido', 'perdido');

CREATE TABLE public.prazos_processuais (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id             uuid        REFERENCES public.prospeccoes(id) ON DELETE CASCADE,
  empresa_id                uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  acao_id                   uuid        REFERENCES public.acoes_tributarias(id) ON DELETE SET NULL,
  tipo                      text        NOT NULL, -- contestacao, recurso, manifestacao, audiencia, etc.
  descricao                 text,
  data_vencimento           date        NOT NULL,
  alerta_antecedencia_dias  int         NOT NULL DEFAULT 3 CHECK (alerta_antecedencia_dias >= 0),
  status                    prazo_status NOT NULL DEFAULT 'pendente',
  alerta_enviado_em         timestamptz,
  responsavel_id            uuid        REFERENCES public.profiles(id),
  observacao                text,
  criado_por                uuid        REFERENCES public.profiles(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER prazos_updated_at
  BEFORE UPDATE ON public.prazos_processuais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Índices para queries de alertas e listagem
CREATE INDEX prazos_empresa_idx      ON public.prazos_processuais (empresa_id);
CREATE INDEX prazos_vencimento_idx   ON public.prazos_processuais (data_vencimento);
CREATE INDEX prazos_responsavel_idx  ON public.prazos_processuais (responsavel_id);
CREATE INDEX prazos_status_idx       ON public.prazos_processuais (status);

-- RLS
ALTER TABLE public.prazos_processuais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prazos_select" ON public.prazos_processuais
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'gestor')
    )
    OR responsavel_id = auth.uid()
    OR criado_por = auth.uid()
  );

CREATE POLICY "prazos_insert" ON public.prazos_processuais
  FOR INSERT WITH CHECK (criado_por = auth.uid());

CREATE POLICY "prazos_update" ON public.prazos_processuais
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'gestor')
    )
    OR responsavel_id = auth.uid()
    OR criado_por = auth.uid()
  );

CREATE POLICY "prazos_delete" ON public.prazos_processuais
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
    OR criado_por = auth.uid()
  );

-- RPC para a edge function verificar-prazos buscar prazos a alertar hoje
-- (data_vencimento - alerta_antecedencia_dias = hoje E alerta_enviado_em IS NULL)
CREATE OR REPLACE FUNCTION public.prazos_a_alertar_hoje()
RETURNS TABLE (
  prazo_id        uuid,
  empresa_nome    text,
  acao_nome       text,
  tipo            text,
  descricao       text,
  data_vencimento date,
  responsavel_id  uuid,
  responsavel_email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pp.id,
    e.nome,
    at.nome,
    pp.tipo,
    pp.descricao,
    pp.data_vencimento,
    pp.responsavel_id,
    pr.email
  FROM public.prazos_processuais pp
  JOIN public.empresas e ON e.id = pp.empresa_id
  LEFT JOIN public.acoes_tributarias at ON at.id = pp.acao_id
  LEFT JOIN public.profiles pr ON pr.id = pp.responsavel_id
  WHERE pp.status = 'pendente'
    AND pp.alerta_enviado_em IS NULL
    AND (pp.data_vencimento - pp.alerta_antecedencia_dias) <= CURRENT_DATE
    AND pp.data_vencimento >= CURRENT_DATE
$$;

REVOKE ALL ON FUNCTION public.prazos_a_alertar_hoje FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prazos_a_alertar_hoje TO service_role;

COMMENT ON TABLE public.prazos_processuais IS
  'Prazos judiciais/administrativos vinculados a prospecções. '
  'Edge function verificar-prazos envia alertas via email.';
