-- =========================================================================
-- Status do telefone por contato — categoriza o RESULTADO de cada número
-- individualmente (não atendeu, número errado, não existe, atendeu, caixa
-- postal, ocupado) SEM contar como toque de prospecção.
--
-- É coluna em empresa_contatos — NÃO toca prospeccoes / prospeccao_contatos
-- (a cadência de "contato feito" continua totalmente separada). Serve pra
-- qualificar o número (dá pra ligar de novo? é ruim?) e priorizar tentativas.
--
-- Relação com telefone_invalido (mig 20260709000001): os status 'numero_errado'
-- e 'nao_existe' DERIVAM telefone_invalido=true (via trigger). Assim toda a
-- máquina de exclusão do snapshot em `empresas` continua funcionando sem
-- duplicar lógica — telefone_invalido vira um espelho derivado do status.
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.telefone_status_contato AS ENUM (
    'nao_testado', 'atendeu', 'nao_atendeu', 'caixa_postal', 'ocupado',
    'numero_errado', 'nao_existe'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.empresa_contatos
  ADD COLUMN IF NOT EXISTS telefone_status      public.telefone_status_contato NOT NULL DEFAULT 'nao_testado',
  ADD COLUMN IF NOT EXISTS telefone_status_nota text,
  ADD COLUMN IF NOT EXISTS telefone_status_em   timestamptz,
  ADD COLUMN IF NOT EXISTS telefone_status_por  uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.empresa_contatos.telefone_status IS
  'Resultado da tentativa por telefone (nao_atendeu, numero_errado, nao_existe, atendeu, caixa_postal, ocupado). NÃO é toque de prospecção — é qualidade/reachability do número. numero_errado/nao_existe derivam telefone_invalido=true.';

-- Backfill ANTES de criar o trigger (pra não sobrescrever os timestamps
-- originais): quem já estava telefone_invalido=true herda 'numero_errado'
-- (bucket genérico de número ruim), preservando nota/quem/quando.
UPDATE public.empresa_contatos
   SET telefone_status      = 'numero_errado',
       telefone_status_nota = telefone_invalido_motivo,
       telefone_status_em   = telefone_invalido_em,
       telefone_status_por  = telefone_invalido_por
 WHERE telefone_invalido = true
   AND telefone_status = 'nao_testado';

CREATE INDEX IF NOT EXISTS idx_empresa_contatos_telefone_status
  ON public.empresa_contatos(telefone_status)
  WHERE telefone_status <> 'nao_testado';

-- -------------------------------------------------------------------------
-- Deriva telefone_invalido do status e carimba status_em/_por na mudança.
-- O nome 'trg_derive...' ordena ANTES de 'trg_stamp_telefone_invalido'
-- (d < s), então quando o stamp roda NEW.telefone_invalido já está setado.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_telefone_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- status "ruim" ⇒ número inválido (reusa a exclusão do snapshot existente)
  NEW.telefone_invalido := NEW.telefone_status IN ('numero_errado', 'nao_existe');
  -- mantém o motivo legado em sincronia (ContatosCoverageCard lê telefone_invalido_motivo)
  IF NEW.telefone_invalido THEN
    NEW.telefone_invalido_motivo := NULLIF(btrim(COALESCE(NEW.telefone_status_nota, '')), '');
  END IF;
  -- carimba quem/quando mexeu no status
  IF TG_OP = 'INSERT' THEN
    IF NEW.telefone_status <> 'nao_testado' THEN
      NEW.telefone_status_em  := COALESCE(NEW.telefone_status_em, now());
      NEW.telefone_status_por := COALESCE(NEW.telefone_status_por, auth.uid());
    END IF;
  ELSIF NEW.telefone_status IS DISTINCT FROM OLD.telefone_status THEN
    IF NEW.telefone_status = 'nao_testado' THEN
      NEW.telefone_status_em  := NULL;
      NEW.telefone_status_por := NULL;
    ELSE
      NEW.telefone_status_em  := now();
      NEW.telefone_status_por := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_telefone_status ON public.empresa_contatos;
CREATE TRIGGER trg_derive_telefone_status
  BEFORE INSERT OR UPDATE ON public.empresa_contatos
  FOR EACH ROW EXECUTE FUNCTION public.derive_telefone_status();
