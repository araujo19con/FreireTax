-- =========================================================================
-- Evolução do fluxo de enriquecimento — qualidade + eficiência.
--
-- Dois ajustes cirúrgicos nas views que governam os loops autônomos:
--
-- 1) QUALIDADE — v_empresa_contato_qualidade: telefone marcado como
--    inválido (feature 20260709000001) NÃO conta mais como cobertura.
--    Antes, um número que o time confirmou errado ainda inflava o score
--    (tem_telefone/tem_movel) e mantinha a empresa como "coberta". Agora,
--    marcar inválido derruba o bucket (ex: bom -> fraco), o que re-inclui
--    a empresa na v_fila_enriquecimento automaticamente — loop auto-curável.
--
-- 2) EFICIÊNCIA — v_fila_telefones: o loop de telefone (fonte 'osm') estava
--    re-servindo TODA empresa que o OSM já tinha falhado, porque a exclusão
--    só listava 'google_places'/'website'. Resultado medido: ~140 falhas /
--    4 sucessos em 30 dias, re-tentando os mesmos ~41 becos sem saída todo
--    dia. OSM é dado estático (se não tinha telefone hoje, não terá amanhã),
--    então: (a) 'osm' entra na lista de exclusão; (b) janela de 90 dias
--    (quarterly revisit) em vez de re-bater diário. Também: uma empresa cujo
--    ÚNICO celular foi marcado inválido volta pra fila (antes o NOT EXISTS
--    de 'movel' a mantinha fora mesmo com o número furado).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Qualidade: telefone inválido não conta como tem_telefone/tem_movel.
-- (decisor/email/linkedin permanecem — um decisor nomeado continua decisor
--  mesmo com o telefone furado; só a cobertura de TELEFONE é afetada.)
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_empresa_contato_qualidade AS
WITH agg AS (
  SELECT e.id AS empresa_id,
         e.nome,
         e.uf,
         e.municipio,
         COALESCE(e.contatos_count, 0) AS contatos_count,
         COALESCE(bool_or(
           c.nome IS NOT NULL
           AND NOT COALESCE(c.is_contador, false)
           AND c.papel IN ('socio', 'decisor', 'financeiro', 'juridico')
         ), false) AS tem_decisor,
         COALESCE(bool_or(nullif(btrim(c.email), '') IS NOT NULL), false) AS tem_email,
         COALESCE(bool_or(
           (COALESCE(c.whatsapp, false) OR c.tipo_telefone = 'movel')
           AND NOT COALESCE(c.telefone_invalido, false)
         ), false) AS tem_movel,
         COALESCE(bool_or(
           nullif(btrim(c.telefone), '') IS NOT NULL
           AND NOT COALESCE(c.telefone_invalido, false)
         ), false) AS tem_telefone,
         COALESCE(bool_or(nullif(btrim(c.linkedin), '') IS NOT NULL), false) AS tem_linkedin
  FROM public.empresas e
  LEFT JOIN public.empresa_contatos c ON c.empresa_id = e.id
  GROUP BY e.id, e.nome, e.uf, e.municipio, e.contatos_count
),
scored AS (
  SELECT agg.*,
         ( (CASE WHEN tem_decisor  THEN 30 ELSE 0 END)
         + (CASE WHEN tem_email    THEN 20 ELSE 0 END)
         + (CASE WHEN tem_movel    THEN 20 ELSE 0 END)
         + (CASE WHEN tem_linkedin THEN 20 ELSE 0 END)
         + (CASE WHEN tem_telefone THEN 10 ELSE 0 END) ) AS score
  FROM agg
)
SELECT scored.*,
       CASE
         WHEN contatos_count = 0 THEN 'sem_contato'
         WHEN score >= 70        THEN 'otimo'
         WHEN score >= 40        THEN 'bom'
         ELSE 'fraco'
       END AS bucket
FROM scored;

-- -------------------------------------------------------------------------
-- 2) Eficiência: fila de telefone para de re-bater becos do OSM e considera
--    telefone inválido ao decidir se a empresa "já tem celular".
-- -------------------------------------------------------------------------
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
  SELECT bool_or(pr.status_prospeccao <> ALL (ARRAY['Perdido', 'Contrato assinado', 'Serviço iniciado'])) AS em_pipeline
  FROM public.prospeccoes pr
  WHERE pr.empresa_id = e.id
) pp ON true
WHERE e.cnpj IS NOT NULL
  AND length(regexp_replace(e.cnpj, '\D', '', 'g')) = 14
  AND (e.situacao_cadastral = 'ATIVA' OR e.situacao_cadastral IS NULL)
  AND e.municipio IS NOT NULL
  -- Já tem celular VÁLIDO? sai da fila. (Se o único celular foi marcado
  -- inválido, volta pra fila — o número furado não conta.)
  AND NOT EXISTS (
    SELECT 1 FROM public.empresa_contatos c
    WHERE c.empresa_id = e.id
      AND (c.tipo_telefone = 'movel' OR c.whatsapp = true)
      AND NOT COALESCE(c.telefone_invalido, false)
  )
  -- Não re-bater fontes já tentadas nos últimos 90 dias. 'osm' incluído:
  -- é dado estático e estava faltando na lista, causando re-tentativa diária.
  AND NOT EXISTS (
    SELECT 1 FROM public.enriquecimento_log l
    WHERE l.empresa_id = e.id
      AND l.fonte = ANY (ARRAY['osm', 'google_places', 'website'])
      AND l.created_at > now() - interval '90 days'
  )
ORDER BY (CASE WHEN e.uf = ANY (ARRAY['RN', 'PB']) THEN 1 ELSE 2 END),
         COALESCE(pp.em_pipeline, false) DESC,
         COALESCE(el.valor_potencial_estimado, 0) DESC,
         e.capital_social DESC NULLS LAST;
