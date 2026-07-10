-- =========================================================================
-- Fila de telefones: empresas ATIVAS, com CNPJ e município, sem NENHUM
-- contato celular/whatsapp ainda, e sem tentativa de enriquecimento via
-- google_places/website nos últimos 30 dias — prioriza RN/PB, depois
-- pipeline ativo > valor potencial > capital social.
--
-- RECONSTRUÍDA (09/07/2026): aplicada em produção em 08/07/2026 sem o
-- arquivo local correspondente ter sido commitado — mesmo drift de
-- [[20260707000001_enriquecimento_qualidade_fila]] (depende de
-- `enriquecimento_log`, criada lá). Conteúdo reconstruído via
-- pg_get_viewdef a partir do que já está rodando em prod.
-- =========================================================================

CREATE OR REPLACE VIEW public.v_fila_telefones AS
SELECT
  e.id AS empresa_id,
  COALESCE(e.razao_social, e.nome) AS razao_social,
  e.nome, e.municipio, e.uf, e.cnpj,
  el.valor_potencial_estimado,
  pp.em_pipeline,
  e.capital_social,
  e.email_receita,
  e.nome_fantasia
FROM public.empresas e
LEFT JOIN LATERAL (
  SELECT max(el2.valor_potencial_estimado) AS valor_potencial_estimado
  FROM public.elegibilidade el2
  WHERE el2.empresa_id = e.id
) el ON true
LEFT JOIN LATERAL (
  SELECT bool_or(pr.status_prospeccao <> ALL (ARRAY['Perdido', 'Contrato assinado', 'Serviço iniciado'])) AS em_pipeline
  FROM public.prospeccoes pr
  WHERE pr.empresa_id = e.id
) pp ON true
WHERE e.cnpj IS NOT NULL
  AND length(regexp_replace(e.cnpj, '\D', '', 'g')) = 14
  AND (e.situacao_cadastral = 'ATIVA'::public.situacao_cadastral_rfb OR e.situacao_cadastral IS NULL)
  AND e.municipio IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.empresa_contatos c
    WHERE c.empresa_id = e.id AND (c.tipo_telefone = 'movel'::public.tipo_telefone OR c.whatsapp = true)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.enriquecimento_log l
    WHERE l.empresa_id = e.id
      AND l.fonte = ANY (ARRAY['google_places', 'website'])
      AND l.created_at > (now() - interval '30 days')
  )
ORDER BY
  (CASE WHEN e.uf = ANY (ARRAY['RN', 'PB']) THEN 1 ELSE 2 END),
  COALESCE(pp.em_pipeline, false) DESC,
  COALESCE(el.valor_potencial_estimado, 0) DESC,
  e.capital_social DESC NULLS LAST;
