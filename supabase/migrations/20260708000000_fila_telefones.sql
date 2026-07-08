-- =========================================================================
-- Fila de enriquecimento de TELEFONE (foco em móvel/WhatsApp).
--
-- Complementa v_fila_enriquecimento (que cuida do RFB). Aqui o alvo é
-- diferente: empresas SEM um telefone MÓVEL/WhatsApp — mesmo que já tenham
-- sócio + email (bucket 'bom'). A RFB quase nunca traz celular; a fonte que
-- traz é o Google Places (grátis até 5k/mês) + o site da empresa.
--
-- Consumida pela edge function `enriquecer-telefones`. Priorização:
-- RN/PB primeiro (mercado real e cota grátis finita), depois em pipeline,
-- maior valor potencial, maior capital.
-- =========================================================================

CREATE OR REPLACE VIEW public.v_fila_telefones AS
SELECT e.id AS empresa_id,
       COALESCE(e.razao_social, e.nome) AS razao_social,
       e.nome,
       e.municipio,
       e.uf,
       e.cnpj,
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
  SELECT bool_or(pr.status_prospeccao NOT IN ('Perdido', 'Contrato assinado', 'Serviço iniciado')) AS em_pipeline
  FROM public.prospeccoes pr
  WHERE pr.empresa_id = e.id
) pp ON true
WHERE e.cnpj IS NOT NULL
  AND length(regexp_replace(e.cnpj, '\D', '', 'g')) = 14
  AND (e.situacao_cadastral = 'ATIVA' OR e.situacao_cadastral IS NULL)
  AND e.municipio IS NOT NULL           -- precisa da cidade pra query específica no Places
  -- Sem telefone móvel/WhatsApp ainda
  AND NOT EXISTS (
    SELECT 1 FROM public.empresa_contatos c
    WHERE c.empresa_id = e.id
      AND (c.tipo_telefone = 'movel' OR c.whatsapp = true)
  )
  -- Backoff: não re-tenta a mesma empresa por 30 dias (achou ou não, respeita a cota)
  AND NOT EXISTS (
    SELECT 1 FROM public.enriquecimento_log l
    WHERE l.empresa_id = e.id
      AND l.fonte IN ('google_places', 'website')
      AND l.created_at > now() - interval '30 days'
  )
ORDER BY (CASE WHEN e.uf IN ('RN', 'PB') THEN 1 ELSE 2 END),
         COALESCE(pp.em_pipeline, false) DESC,
         COALESCE(el.valor_potencial_estimado, 0) DESC,
         e.capital_social DESC NULLS LAST;
