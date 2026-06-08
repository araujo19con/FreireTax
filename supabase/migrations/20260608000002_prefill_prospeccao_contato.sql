-- =========================================================================
-- Auto-preenche o contato da prospecção a partir do contato principal da
-- empresa. Antes o rep digitava nome/cargo/telefone/email à mão em toda
-- prospecção nova; agora vem pronto do diretório de contatos (snapshot em
-- empresas), e o rep só ajusta se precisar.
--
-- BEFORE INSERT: só preenche quando o campo veio vazio (não sobrescreve o
-- que o rep digitar). Backend puro — a UI de prospecção já exibe/edita esses
-- campos, então o ganho aparece sem mudar o front.
--
-- (Backfill das 33 prospecções existentes é feito via service role, fora da
-- migration — lição do timeout/rollback.)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.prefill_prospeccao_contato()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_nome  text;
  v_cargo text;
  v_tel   text;
  v_email text;
BEGIN
  IF coalesce(NEW.contato_nome, '') = '' THEN
    SELECT contato_principal_nome, contato_principal_cargo,
           contato_principal_telefone, contato_principal_email
      INTO v_nome, v_cargo, v_tel, v_email
      FROM public.empresas
     WHERE id = NEW.empresa_id;

    IF v_nome IS NOT NULL THEN
      NEW.contato_nome     := v_nome;
      NEW.contato_cargo    := coalesce(nullif(NEW.contato_cargo, ''), v_cargo);
      NEW.contato_telefone := coalesce(nullif(NEW.contato_telefone, ''), v_tel);
      NEW.contato_email    := coalesce(nullif(NEW.contato_email, ''), v_email);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prefill_prospeccao_contato ON public.prospeccoes;
CREATE TRIGGER trg_prefill_prospeccao_contato
  BEFORE INSERT ON public.prospeccoes
  FOR EACH ROW EXECUTE FUNCTION public.prefill_prospeccao_contato();
