-- =========================================================================
-- Enriquecimento autônomo de contatos — camada de qualidade + fila.
--
-- Objetivo: ter contatos, e-mails e (quando disponível) LinkedIn de BOA
-- QUALIDADE por empresa, e uma FILA priorizada que a edge function
-- `enriquecer-fila` consome sozinha (via pg_cron) — ver README da função.
--
-- Este arquivo NÃO chama API nenhuma. Só define:
--   1. enriquecimento_log      — observabilidade + backoff de falhas
--   2. v_empresa_contato_qualidade — score 0-100 e bucket por empresa
--   3. v_fila_enriquecimento    — quem enriquecer primeiro (qualificados,
--                                  alto valor potencial, contato fraco/ausente)
--   4. v_enriquecimento_resumo  — contagem por bucket (tile de dashboard)
--
-- Fluxo completo:
--   RFB (BrasilAPI) -> empresas.qsa/telefone_receita/email_receita
--     -> trigger derive_contatos_from_rfb (já existe) materializa
--        empresa_contatos (sócios + canais) automaticamente.
--   LinkedIn / e-mail de decisor: vem de DRIVA (import) ou de um provider
--   externo plugável na edge function (Apollo/Driva) — ver README.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Log de tentativas de enriquecimento (para auditoria e backoff)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enriquecimento_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  cnpj            text,
  fonte           text,                 -- 'brasilapi' | 'cnpja' | 'receitaws' | 'driva' | 'apollo'
  sucesso         boolean NOT NULL DEFAULT false,
  erro            text,
  contatos_antes  integer,
  contatos_depois integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enriq_log_empresa_data
  ON public.enriquecimento_log (empresa_id, created_at DESC);

ALTER TABLE public.enriquecimento_log ENABLE ROW LEVEL SECURITY;

-- Leitura para autenticados; escrita só pela service-role (bypassa RLS).
DROP POLICY IF EXISTS "enriq_log_select" ON public.enriquecimento_log;
CREATE POLICY "enriq_log_select" ON public.enriquecimento_log
  FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------
-- 2. Qualidade de contato por empresa (score 0-100 + bucket)
--    Pesos: decisor 30 | e-mail 20 | celular/WhatsApp 20 | LinkedIn 20 |
--           telefone fixo 10.  is_contador NÃO conta como decisor.
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
         COALESCE(bool_or(nullif(btrim(c.email), '') IS NOT NULL), false)    AS tem_email,
         COALESCE(bool_or(COALESCE(c.whatsapp, false) OR c.tipo_telefone = 'movel'), false) AS tem_movel,
         COALESCE(bool_or(nullif(btrim(c.telefone), '') IS NOT NULL), false) AS tem_telefone,
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
-- 3. Fila de enriquecimento — quem a edge function processa, em ordem.
--    Regras:
--      - CNPJ válido (14 dígitos) e situação ATIVA (ou ainda desconhecida)
--      - contato ausente ou fraco
--      - RFB nunca puxada, ou desatualizada (>90d), ou sem contatos
--      - backoff: exclui quem falhou >=3x nos últimos 7 dias
--    Ordem: em pipeline (qualificada/em_prospeccao) primeiro, depois maior
--    valor potencial, depois maior capital social.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_fila_enriquecimento AS
SELECT q.empresa_id,
       e.nome,
       e.cnpj,
       e.uf,
       e.situacao_cadastral,
       e.receita_atualizada_em,
       q.bucket,
       q.score,
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
  -- "em pipeline" = tem prospecção ativa. O pipeline real vive em prospeccoes;
  -- elegibilidade.status_qualificacao hoje é só 'legado', então não serve de sinal.
  SELECT bool_or(pr.status_prospeccao NOT IN ('Perdido', 'Contrato assinado', 'Serviço iniciado')) AS em_pipeline
  FROM public.prospeccoes pr
  WHERE pr.empresa_id = q.empresa_id
) pp ON true
WHERE e.cnpj IS NOT NULL
  AND length(regexp_replace(e.cnpj, '\D', '', 'g')) = 14
  AND (e.situacao_cadastral = 'ATIVA' OR e.situacao_cadastral IS NULL)
  AND q.bucket IN ('sem_contato', 'fraco')
  -- Uma vez enriquecida (receita_atualizada_em setada), sai da fila por 90 dias —
  -- mesmo que continue sem contato (RFB não tem dado; re-bater não ajuda). Volta
  -- quando a RFB envelhece; contatos de decisor/LinkedIn vêm de DRIVA/provider.
  AND (
        e.receita_atualizada_em IS NULL
        OR e.receita_atualizada_em < now() - interval '90 days'
      )
  AND NOT EXISTS (
        SELECT 1
        FROM public.enriquecimento_log l
        WHERE l.empresa_id = q.empresa_id
          AND l.sucesso = false
          AND l.created_at > now() - interval '7 days'
        GROUP BY l.empresa_id
        HAVING count(*) >= 3
      )
ORDER BY COALESCE(pp.em_pipeline, false) DESC,
         COALESCE(el.valor_potencial_estimado, 0) DESC,
         e.capital_social DESC NULLS LAST;

-- -------------------------------------------------------------------------
-- 4. Resumo por bucket (para um tile "cobertura de contatos" no dashboard)
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_enriquecimento_resumo AS
SELECT bucket,
       count(*) AS empresas
FROM public.v_empresa_contato_qualidade
GROUP BY bucket;
