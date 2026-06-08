-- =========================================================================
-- Enriquecimento ATIVO de contatos a partir do RFB.
--
-- Sempre que uma empresa é enriquecida (a edge function enriquecer-cnpj
-- atualiza empresas.qsa / telefone_receita / email_receita), este trigger
-- deriva automaticamente contatos em empresa_contatos:
--   - cada sócio do QSA  -> contato papel=socio, origem=rfb (cargo=qualificação,
--                           cpf_mascarado=documento)
--   - telefone_receita   -> canal papel=geral, origem=rfb
--   - email_receita      -> canal papel=geral, origem=rfb
--
-- Idempotente (dedup_key igual ao do importador DRIVA — não duplica e não
-- sobrescreve contatos manuais/DRIVA). Define o principal (prefere
-- Sócio-Administrador) se a empresa ainda não tiver nenhum.
--
-- NOTA: o BACKFILL das empresas já enriquecidas NÃO é feito aqui (era pesado
-- demais e estourava o timeout do SQL Editor, revertendo a migration). É um
-- passo operacional rodado em lotes via tools/backfill-contatos-rfb.mjs.
-- Numa base nova isto é desnecessário (não há empresas enriquecidas ainda).
-- =========================================================================

-- -------------------------------------------------------------------------
-- Normalização de nome igual à do importador DRIVA (strip acento + upper +
-- colapsa espaços) para as dedup_keys baterem e dedupar entre fontes.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normaliza_nome_contato(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(
           upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')),
           'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
           'AAAAAEEEEIIIIOOOOOUUUUCN'
         );
$$;

-- -------------------------------------------------------------------------
-- Trigger function
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_contatos_from_rfb()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_socio jsonb;
  v_nome  text;
  v_qual  text;
  v_doc   text;
  v_dedup text;
  v_tel   text;
BEGIN
  -- Sócios do QSA --------------------------------------------------------
  IF NEW.qsa IS NOT NULL AND jsonb_typeof(NEW.qsa) = 'array' THEN
    FOR v_socio IN SELECT * FROM jsonb_array_elements(NEW.qsa)
    LOOP
      v_nome := nullif(btrim(v_socio->>'nome'), '');
      IF v_nome IS NOT NULL THEN
        v_qual := nullif(btrim(v_socio->>'qualificacao'), '');
        v_doc  := nullif(btrim(v_socio->>'documento'), '');
        v_dedup := 'socio:' || public.normaliza_nome_contato(v_nome);

        IF NOT EXISTS (
          SELECT 1 FROM public.empresa_contatos
           WHERE empresa_id = NEW.id AND dedup_key = v_dedup
        ) THEN
          INSERT INTO public.empresa_contatos
            (empresa_id, nome, cargo, papel, cpf_mascarado, origem, dedup_key)
          VALUES
            (NEW.id, v_nome, v_qual, 'socio', v_doc, 'rfb', v_dedup);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Telefone RFB ---------------------------------------------------------
  v_tel := regexp_replace(coalesce(NEW.telefone_receita, ''), '\D', '', 'g');
  IF length(v_tel) >= 8 THEN
    v_dedup := 'tel:' || v_tel;
    IF NOT EXISTS (
      SELECT 1 FROM public.empresa_contatos
       WHERE empresa_id = NEW.id AND dedup_key = v_dedup
    ) THEN
      INSERT INTO public.empresa_contatos
        (empresa_id, telefone, papel, origem, dedup_key)
      VALUES
        (NEW.id, NEW.telefone_receita, 'geral', 'rfb', v_dedup);
    END IF;
  END IF;

  -- Email RFB ------------------------------------------------------------
  IF nullif(btrim(NEW.email_receita), '') IS NOT NULL THEN
    v_dedup := 'email:' || lower(btrim(NEW.email_receita));
    IF NOT EXISTS (
      SELECT 1 FROM public.empresa_contatos
       WHERE empresa_id = NEW.id AND dedup_key = v_dedup
    ) THEN
      INSERT INTO public.empresa_contatos
        (empresa_id, email, papel, origem, dedup_key)
      VALUES
        (NEW.id, lower(btrim(NEW.email_receita)), 'geral', 'rfb', v_dedup);
    END IF;
  END IF;

  -- Define principal se a empresa não tem nenhum (prefere Sócio-Administrador)
  IF NOT EXISTS (
    SELECT 1 FROM public.empresa_contatos
     WHERE empresa_id = NEW.id AND principal = true
  ) THEN
    UPDATE public.empresa_contatos
       SET principal = true
     WHERE id = (
       SELECT id FROM public.empresa_contatos
        WHERE empresa_id = NEW.id
        ORDER BY (papel = 'socio' AND coalesce(cargo, '') ILIKE '%administrador%') DESC,
                 (papel = 'socio') DESC,
                 is_contador ASC,
                 (nome IS NOT NULL) DESC,
                 created_at ASC
        LIMIT 1
     );
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER: precisa do empresa_id já existente para inserir os filhos.
DROP TRIGGER IF EXISTS trg_derive_contatos_rfb ON public.empresas;
CREATE TRIGGER trg_derive_contatos_rfb
  AFTER INSERT OR UPDATE OF qsa, telefone_receita, email_receita
  ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.derive_contatos_from_rfb();
