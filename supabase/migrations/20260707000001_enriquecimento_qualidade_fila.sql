-- =========================================================================
-- Fila de qualidade/enriquecimento de contatos: log de tentativas de
-- enriquecimento + views de priorização (quem enriquecer/prospectar
-- primeiro, por qualidade de dado de contato).
--
-- RECONSTRUÍDA (09/07/2026): aplicada em produção em 07/07/2026 sem o
-- arquivo local correspondente ter sido commitado (mesmo drift de
-- [[20260707000000_prospeccao_historico_etapa]] — ver nota lá). Conteúdo
-- reconstruído via introspecção (information_schema + pg_get_viewdef)
-- a partir do que já está rodando em prod.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Log de tentativas de enriquecimento (por empresa/fonte) — usado pelas
-- views de fila pra não insistir numa empresa que já falhou repetidamente
-- numa fonte recentemente. Escrito por edge function / job via service
-- role (sem policy de INSERT — só SELECT pra autenticados).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enriquecimento_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  cnpj             text,
  fonte            text,                    -- 'google_places' | 'website' | outros
  sucesso          boolean NOT NULL DEFAULT false,
  erro             text,
  contatos_antes   integer,
  contatos_depois  integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enriq_log_empresa_data
  ON public.enriquecimento_log(empresa_id, created_at DESC);

ALTER TABLE public.enriquecimento_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enriq_log_select" ON public.enriquecimento_log;
CREATE POLICY "enriq_log_select"
  ON public.enriquecimento_log FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------
-- v_empresa_contato_qualidade: score de qualidade de contato por empresa
-- (decisor nomeado, email, celular/whatsapp, linkedin, telefone qualquer)
-- e bucket (sem_contato / fraco / bom / otimo).
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_empresa_contato_qualidade AS
WITH agg AS (
  SELECT
    e.id AS empresa_id,
    e.nome,
    e.uf,
    e.municipio,
    COALESCE(e.contatos_count, 0) AS contatos_count,
    COALESCE(bool_or(
      c.nome IS NOT NULL AND NOT COALESCE(c.is_contador, false)
      AND c.papel = ANY (ARRAY['socio', 'decisor', 'financeiro', 'juridico']::public.papel_contato[])
    ), false) AS tem_decisor,
    COALESCE(bool_or(NULLIF(btrim(c.email), '') IS NOT NULL), false) AS tem_email,
    COALESCE(bool_or(COALESCE(c.whatsapp, false) OR c.tipo_telefone = 'movel'::public.tipo_telefone), false) AS tem_movel,
    COALESCE(bool_or(NULLIF(btrim(c.telefone), '') IS NOT NULL), false) AS tem_telefone,
    COALESCE(bool_or(NULLIF(btrim(c.linkedin), '') IS NOT NULL), false) AS tem_linkedin
  FROM public.empresas e
  LEFT JOIN public.empresa_contatos c ON c.empresa_id = e.id
  GROUP BY e.id, e.nome, e.uf, e.municipio, e.contatos_count
),
scored AS (
  SELECT
    agg.*,
    (CASE WHEN agg.tem_decisor THEN 30 ELSE 0 END)
    + (CASE WHEN agg.tem_email THEN 20 ELSE 0 END)
    + (CASE WHEN agg.tem_movel THEN 20 ELSE 0 END)
    + (CASE WHEN agg.tem_linkedin THEN 20 ELSE 0 END)
    + (CASE WHEN agg.tem_telefone THEN 10 ELSE 0 END) AS score
  FROM agg
)
SELECT
  empresa_id, nome, uf, municipio, contatos_count,
  tem_decisor, tem_email, tem_movel, tem_telefone, tem_linkedin, score,
  CASE
    WHEN contatos_count = 0 THEN 'sem_contato'
    WHEN score >= 70 THEN 'otimo'
    WHEN score >= 40 THEN 'bom'
    ELSE 'fraco'
  END AS bucket
FROM scored;

-- -------------------------------------------------------------------------
-- v_fila_enriquecimento: empresas ATIVAS, com CNPJ válido, contato fraco/
-- inexistente, receita desatualizada (>90 dias ou nunca) e sem 3+ falhas
-- de enriquecimento nos últimos 7 dias — ordenada por pipeline ativo >
-- valor potencial > capital social.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_fila_enriquecimento AS
SELECT
  q.empresa_id, e.nome, e.cnpj, e.uf, e.situacao_cadastral, e.receita_atualizada_em,
  q.bucket, q.score,
  el.valor_potencial_estimado,
  pp.em_pipeline,
  e.capital_social
FROM public.v_empresa_contato_qualidade q
JOIN public.empresas e ON e.id = q.empresa_id
LEFT JOIN LATERAL (
  SELECT max(el2.valor_potencial_estimado) AS valor_potencial_estimado
  FROM public.elegibilidade el2
  WHERE el2.empresa_id = q.empresa_id
) el ON true
LEFT JOIN LATERAL (
  SELECT bool_or(pr.status_prospeccao <> ALL (ARRAY['Perdido', 'Contrato assinado', 'Serviço iniciado'])) AS em_pipeline
  FROM public.prospeccoes pr
  WHERE pr.empresa_id = q.empresa_id
) pp ON true
WHERE e.cnpj IS NOT NULL
  AND length(regexp_replace(e.cnpj, '\D', '', 'g')) = 14
  AND (e.situacao_cadastral = 'ATIVA'::public.situacao_cadastral_rfb OR e.situacao_cadastral IS NULL)
  AND q.bucket = ANY (ARRAY['sem_contato', 'fraco'])
  AND (e.receita_atualizada_em IS NULL OR e.receita_atualizada_em < (now() - interval '90 days'))
  AND NOT EXISTS (
    SELECT 1 FROM public.enriquecimento_log l
    WHERE l.empresa_id = q.empresa_id AND l.sucesso = false AND l.created_at > (now() - interval '7 days')
    GROUP BY l.empresa_id
    HAVING count(*) >= 3
  )
ORDER BY
  COALESCE(pp.em_pipeline, false) DESC,
  COALESCE(el.valor_potencial_estimado, 0) DESC,
  e.capital_social DESC NULLS LAST;
