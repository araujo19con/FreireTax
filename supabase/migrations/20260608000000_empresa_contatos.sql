-- =========================================================================
-- empresa_contatos — diretório de CONTATOS (pessoas + canais) por empresa.
--
-- Motivação: hoje a empresa só tem campos soltos (email_receita/telefone_receita)
-- e o "contato" da prospecção é flat (um por prospeccao). Para focar na
-- PROSPECÇÃO precisamos saber QUEM falar e COMO — sócios, decisores, financeiro,
-- contador — com telefone/whatsapp/email/linkedin reutilizáveis entre teses.
--
-- Esta migration cria o diretório, alimentável pela base DRIVA
-- (tools/import-driva-contatos.mjs), e mantém um snapshot do contato principal
-- denormalizado em `empresas` para listagens rápidas (sem join).
--
-- NOTA: prospeccao_contatos (cadência de 7 toques) é OUTRA coisa — é o LOG de
-- toques de uma prospecção. Não mexemos nela aqui.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.papel_contato AS ENUM (
    'socio',         -- sócio / sócio-administrador (decisor por excelência)
    'decisor',       -- diretor / C-level / proprietário não-sócio formal
    'financeiro',    -- CFO, gerente financeiro, controladoria
    'juridico',      -- jurídico interno
    'contador',      -- contabilidade (interna ou escritório terceirizado)
    'comercial',     -- comercial / vendas
    'operacional',   -- demais cargos operacionais
    'geral',         -- canal genérico da empresa (recepção, e-mail comercial)
    'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.origem_contato AS ENUM (
    'driva',         -- importado da base DRIVA
    'rfb',           -- derivado dos dados da Receita (QSA, telefone/email RFB)
    'manual',        -- cadastrado à mão no CRM
    'importacao',    -- planilha genérica importada
    'enriquecimento',-- enriquecimento automático (edge function)
    'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tipo_telefone AS ENUM ('fixo', 'movel', 'desconhecido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- Tabela
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.empresa_contatos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,

  -- Identificação da pessoa (nullable: canais genéricos não têm nome)
  nome            text,
  cargo           text,                                   -- texto livre (ex: "Sócio-Administrador", "Diretor Financeiro")
  papel           public.papel_contato NOT NULL DEFAULT 'outro',

  -- Canais
  email           text,
  telefone        text,                                   -- só dígitos OU formato livre; normalizado pelo app
  tipo_telefone   public.tipo_telefone NOT NULL DEFAULT 'desconhecido',
  whatsapp        boolean NOT NULL DEFAULT false,          -- o número tem WhatsApp?
  linkedin        text,

  -- Sinais de qualificação / origem
  is_contador     boolean NOT NULL DEFAULT false,          -- DRIVA "Pertence ao Contador" — costuma NÃO ser decisor
  principal       boolean NOT NULL DEFAULT false,          -- contato principal da empresa (1 por empresa, garantido por trigger)
  origem          public.origem_contato NOT NULL DEFAULT 'manual',

  -- Extras vindos da DRIVA / RFB
  cpf_mascarado   text,                                    -- ex: ***838914**  (LGPD: nunca CPF completo)
  faixa_etaria    text,
  observacoes     text,
  metadados       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Chave de dedupe para upsert idempotente do importador.
  -- NULL para cadastros manuais (NULLs não colidem em UNIQUE no Postgres).
  dedup_key       text,

  created_by      uuid,                                    -- profiles.id
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.empresa_contatos IS
  'Diretório de contatos (pessoas e canais) por empresa para prospecção. Alimentado por DRIVA/RFB/manual.';

CREATE INDEX IF NOT EXISTS idx_empresa_contatos_empresa
  ON public.empresa_contatos(empresa_id);

-- Decisores primeiro nas listagens (principal > não-contador nomeado > resto).
CREATE INDEX IF NOT EXISTS idx_empresa_contatos_ranking
  ON public.empresa_contatos(empresa_id, principal DESC, is_contador, created_at);

-- Upsert idempotente do importador: (empresa_id, dedup_key) único quando dedup_key != null.
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_contatos_dedup
  ON public.empresa_contatos(empresa_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- -------------------------------------------------------------------------
-- updated_at automático
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_empresa_contatos_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_empresa_contatos ON public.empresa_contatos;
CREATE TRIGGER trg_touch_empresa_contatos
  BEFORE UPDATE ON public.empresa_contatos
  FOR EACH ROW EXECUTE FUNCTION public.touch_empresa_contatos_updated_at();

-- -------------------------------------------------------------------------
-- Garante no máximo UM principal por empresa.
-- Ao marcar um contato como principal, rebaixa os demais da mesma empresa.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_single_contato_principal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.principal THEN
    UPDATE public.empresa_contatos
       SET principal = false
     WHERE empresa_id = NEW.empresa_id
       AND id <> NEW.id
       AND principal = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_single_contato_principal ON public.empresa_contatos;
CREATE TRIGGER trg_single_contato_principal
  AFTER INSERT OR UPDATE OF principal ON public.empresa_contatos
  FOR EACH ROW WHEN (NEW.principal = true)
  EXECUTE FUNCTION public.ensure_single_contato_principal();

-- -------------------------------------------------------------------------
-- Snapshot denormalizado em empresas (lista "quem ligar" sem join).
-- -------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS contatos_count               integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contato_principal_nome       text,
  ADD COLUMN IF NOT EXISTS contato_principal_cargo      text,
  ADD COLUMN IF NOT EXISTS contato_principal_telefone   text,
  ADD COLUMN IF NOT EXISTS contato_principal_email      text,
  ADD COLUMN IF NOT EXISTS contato_principal_whatsapp   boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.recalc_empresa_contatos_cache()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_empresa_id uuid;
  v_best       public.empresa_contatos%ROWTYPE;
  v_count      integer;
BEGIN
  v_empresa_id := COALESCE(NEW.empresa_id, OLD.empresa_id);

  SELECT count(*) INTO v_count
    FROM public.empresa_contatos
   WHERE empresa_id = v_empresa_id;

  -- Melhor contato: principal explícito > nomeado não-contador > qualquer.
  SELECT * INTO v_best
    FROM public.empresa_contatos
   WHERE empresa_id = v_empresa_id
   ORDER BY principal DESC,
            is_contador ASC,
            (nome IS NULL) ASC,
            (papel = 'socio') DESC,
            (telefone IS NOT NULL OR email IS NOT NULL) DESC,
            created_at ASC
   LIMIT 1;

  UPDATE public.empresas
     SET contatos_count             = COALESCE(v_count, 0),
         contato_principal_nome     = v_best.nome,
         contato_principal_cargo    = v_best.cargo,
         contato_principal_telefone = v_best.telefone,
         contato_principal_email    = v_best.email,
         contato_principal_whatsapp = COALESCE(v_best.whatsapp, false)
   WHERE id = v_empresa_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_empresa_contatos ON public.empresa_contatos;
CREATE TRIGGER trg_recalc_empresa_contatos
  AFTER INSERT OR UPDATE OR DELETE ON public.empresa_contatos
  FOR EACH ROW EXECUTE FUNCTION public.recalc_empresa_contatos_cache();

-- -------------------------------------------------------------------------
-- RLS — contatos são dados colaborativos da empresa (todo time enriquece).
-- Select/insert/update/delete liberados para autenticados; insert grava autor.
-- -------------------------------------------------------------------------
ALTER TABLE public.empresa_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view empresa_contatos"   ON public.empresa_contatos;
DROP POLICY IF EXISTS "Authenticated insert empresa_contatos" ON public.empresa_contatos;
DROP POLICY IF EXISTS "Authenticated update empresa_contatos" ON public.empresa_contatos;
DROP POLICY IF EXISTS "Author or admin delete empresa_contatos" ON public.empresa_contatos;

CREATE POLICY "Authenticated view empresa_contatos"
  ON public.empresa_contatos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert empresa_contatos"
  ON public.empresa_contatos FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

CREATE POLICY "Authenticated update empresa_contatos"
  ON public.empresa_contatos FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Author or admin delete empresa_contatos"
  ON public.empresa_contatos FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );
