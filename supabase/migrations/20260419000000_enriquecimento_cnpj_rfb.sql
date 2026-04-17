-- =========================================================================
-- Enriquecimento de CNPJ via Receita Federal (BrasilAPI)
-- Adiciona dados institucionais e cadastrais nas empresas.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enum situação cadastral (RFB)
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.situacao_cadastral_rfb AS ENUM (
    'NULA',          -- 1
    'ATIVA',         -- 2
    'SUSPENSA',      -- 3
    'INAPTA',        -- 4
    'BAIXADA'        -- 8
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.porte_rfb AS ENUM (
    'MEI',           -- Microempreendedor Individual
    'ME',            -- Microempresa
    'EPP',           -- Empresa de Pequeno Porte
    'DEMAIS',        -- Médio/grande
    'NAO_INFORMADO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 2. Colunas novas em empresas
-- -------------------------------------------------------------------------
ALTER TABLE public.empresas
  -- Identificação oficial
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS nome_fantasia text,
  ADD COLUMN IF NOT EXISTS data_abertura date,

  -- Situação cadastral
  ADD COLUMN IF NOT EXISTS situacao_cadastral public.situacao_cadastral_rfb,
  ADD COLUMN IF NOT EXISTS situacao_cadastral_data date,
  ADD COLUMN IF NOT EXISTS motivo_situacao text,

  -- Porte e natureza
  ADD COLUMN IF NOT EXISTS porte public.porte_rfb,
  ADD COLUMN IF NOT EXISTS natureza_juridica text,
  ADD COLUMN IF NOT EXISTS capital_social numeric(18, 2),

  -- Regime tributário (importante p/ teses)
  ADD COLUMN IF NOT EXISTS opcao_simples boolean,
  ADD COLUMN IF NOT EXISTS data_opcao_simples date,
  ADD COLUMN IF NOT EXISTS opcao_mei boolean,

  -- CNAE principal
  ADD COLUMN IF NOT EXISTS cnae_principal text,
  ADD COLUMN IF NOT EXISTS cnae_principal_desc text,
  ADD COLUMN IF NOT EXISTS cnaes_secundarios jsonb DEFAULT '[]'::jsonb,

  -- Endereço
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero_endereco text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS municipio text,
  ADD COLUMN IF NOT EXISTS uf text,
  ADD COLUMN IF NOT EXISTS cep text,

  -- Contato na Receita
  ADD COLUMN IF NOT EXISTS telefone_receita text,
  ADD COLUMN IF NOT EXISTS email_receita text,

  -- Quadro societário — array de {nome, qualificacao, data_entrada}
  ADD COLUMN IF NOT EXISTS qsa jsonb DEFAULT '[]'::jsonb,

  -- Meta: controle do enriquecimento
  ADD COLUMN IF NOT EXISTS receita_atualizada_em timestamptz,
  ADD COLUMN IF NOT EXISTS receita_erro text;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_empresas_situacao ON public.empresas(situacao_cadastral);
CREATE INDEX IF NOT EXISTS idx_empresas_porte ON public.empresas(porte);
CREATE INDEX IF NOT EXISTS idx_empresas_uf ON public.empresas(uf);
CREATE INDEX IF NOT EXISTS idx_empresas_cnae ON public.empresas(cnae_principal) WHERE cnae_principal IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_empresas_receita_stale
  ON public.empresas(receita_atualizada_em NULLS FIRST);

-- -------------------------------------------------------------------------
-- 3. Tabela de cache RAW (auditoria + evita re-consulta)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cnpj_cache (
  cnpj text PRIMARY KEY,            -- somente dígitos, 14 chars
  payload jsonb NOT NULL,           -- resposta bruta da API
  fonte text NOT NULL DEFAULT 'brasilapi',
  consultado_em timestamptz NOT NULL DEFAULT now(),
  sucesso boolean NOT NULL DEFAULT true,
  erro text
);

CREATE INDEX IF NOT EXISTS idx_cnpj_cache_consultado ON public.cnpj_cache(consultado_em DESC);

ALTER TABLE public.cnpj_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read cnpj_cache" ON public.cnpj_cache;
DROP POLICY IF EXISTS "Authenticated insert cnpj_cache" ON public.cnpj_cache;
DROP POLICY IF EXISTS "Authenticated update cnpj_cache" ON public.cnpj_cache;

CREATE POLICY "Authenticated read cnpj_cache"
  ON public.cnpj_cache FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert cnpj_cache"
  ON public.cnpj_cache FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update cnpj_cache"
  ON public.cnpj_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- -------------------------------------------------------------------------
-- 4. Função utilitária: normalizar CNPJ (remove mascara)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normaliza_cnpj(txt text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(COALESCE(txt, ''), '\D', '', 'g');
$$;

-- -------------------------------------------------------------------------
-- 5. View helpers para relatórios (porte, UF, situação)
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_empresas_enriquecidas AS
SELECT
  count(*)                                    AS total,
  count(*) FILTER (WHERE receita_atualizada_em IS NOT NULL) AS enriquecidas,
  count(*) FILTER (WHERE situacao_cadastral = 'ATIVA')       AS ativas_rfb,
  count(*) FILTER (WHERE situacao_cadastral = 'BAIXADA')     AS baixadas_rfb,
  count(*) FILTER (WHERE opcao_simples = true)               AS simples,
  count(*) FILTER (WHERE opcao_mei = true)                   AS mei,
  count(*) FILTER (WHERE porte = 'DEMAIS')                   AS medio_grande,
  count(*) FILTER (WHERE porte = 'EPP')                      AS epp,
  count(*) FILTER (WHERE porte = 'ME')                       AS me
FROM public.empresas;

GRANT SELECT ON public.v_empresas_enriquecidas TO authenticated;
