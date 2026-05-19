-- =========================================================================
-- Busca de CNPJ por razão social — base slim da RFB pública
--
-- Permite enriquecer empresas que estão cadastradas SEM CNPJ, encontrando
-- o CNPJ correspondente via busca fuzzy (pg_trgm) na razão social/nome
-- fantasia. População da tabela é feita por script ETL externo
-- (tools/import-rfb-slim.mjs) a partir do dump público da RFB.
--
-- Filtros aplicados no ETL pra caber no Supabase Free tier:
--  - Só estabelecimentos ATIVOS
--  - Só UFs configuradas (default: RN, PB)
--  - Schema slim (5 colunas + atualizado_em)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Extensão pg_trgm pra busca por similaridade
-- -------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -------------------------------------------------------------------------
-- 2. Tabela slim de estabelecimentos RFB
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rfb_estabelecimentos_busca (
  cnpj           text PRIMARY KEY,         -- 14 dígitos sem máscara
  razao_social   text NOT NULL,
  nome_fantasia  text,
  uf             text NOT NULL,
  municipio      text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- Constraint defensiva: CNPJ deve ter exatamente 14 dígitos
ALTER TABLE public.rfb_estabelecimentos_busca
  DROP CONSTRAINT IF EXISTS rfb_busca_cnpj_format;
ALTER TABLE public.rfb_estabelecimentos_busca
  ADD CONSTRAINT rfb_busca_cnpj_format
  CHECK (cnpj ~ '^[0-9]{14}$');

-- Índices GIN trigram pra busca fuzzy
CREATE INDEX IF NOT EXISTS idx_rfb_busca_razao_trgm
  ON public.rfb_estabelecimentos_busca USING GIN (razao_social gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rfb_busca_fantasia_trgm
  ON public.rfb_estabelecimentos_busca USING GIN (nome_fantasia gin_trgm_ops)
  WHERE nome_fantasia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rfb_busca_uf
  ON public.rfb_estabelecimentos_busca (uf);

-- -------------------------------------------------------------------------
-- 3. RLS — leitura pra qualquer authenticated, escrita só service_role
--    (ETL roda com service_role; usuários só consultam)
-- -------------------------------------------------------------------------
ALTER TABLE public.rfb_estabelecimentos_busca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read rfb_busca" ON public.rfb_estabelecimentos_busca;
CREATE POLICY "Authenticated read rfb_busca"
  ON public.rfb_estabelecimentos_busca FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------
-- 4. RPC: buscar_rfb_por_nome
--    Retorna top N candidatos rankeados por similarity.
--    Combina razão social e nome fantasia (pega o maior score entre os dois).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_rfb_por_nome(
  termo text,
  uf_filtro text DEFAULT NULL,
  limite int DEFAULT 20
)
RETURNS TABLE (
  cnpj text,
  razao_social text,
  nome_fantasia text,
  uf text,
  municipio text,
  score real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT trim(coalesce(termo, '')) AS t
  )
  SELECT
    r.cnpj,
    r.razao_social,
    r.nome_fantasia,
    r.uf,
    r.municipio,
    GREATEST(
      similarity(r.razao_social, (SELECT t FROM q)),
      COALESCE(similarity(r.nome_fantasia, (SELECT t FROM q)), 0)
    ) AS score
  FROM public.rfb_estabelecimentos_busca r, q
  WHERE
    length(q.t) >= 3
    AND (uf_filtro IS NULL OR r.uf = upper(uf_filtro))
    AND (
      r.razao_social % q.t
      OR (r.nome_fantasia IS NOT NULL AND r.nome_fantasia % q.t)
    )
  ORDER BY score DESC, r.razao_social ASC
  LIMIT GREATEST(LEAST(limite, 100), 1);
$$;

GRANT EXECUTE ON FUNCTION public.buscar_rfb_por_nome(text, text, int) TO authenticated;

-- -------------------------------------------------------------------------
-- 5. View de monitoramento — quantos registros por UF, última atualização
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_rfb_busca_status AS
SELECT
  uf,
  count(*) AS total,
  max(atualizado_em) AS atualizado_em
FROM public.rfb_estabelecimentos_busca
GROUP BY uf
ORDER BY uf;

GRANT SELECT ON public.v_rfb_busca_status TO authenticated;
