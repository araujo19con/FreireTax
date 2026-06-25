-- =========================================================================
-- Captura de TODOS os telefones do RFB (incl. CELULAR), não só o 1º.
--
-- Problema: a edge function enriquecer-cnpj gravava só `telefone_receita`
-- (= ddd_telefone_1, quase sempre o FIXO da empresa) e descartava os demais
-- telefones que o BrasilAPI (ddd_telefone_2) e o CNPJa (phones[] tipado)
-- retornam — onde costuma estar o CELULAR do negócio/dono.
--
-- Solução: nova coluna `empresas.telefones` (jsonb array de números) que a
-- edge function passa a preencher com TODOS os telefones da Receita. O trigger
-- derive_contatos_from_rfb materializa cada um como empresa_contatos (papel
-- geral, origem rfb), idempotente (dedup_key 'tel:'+dígitos, igual ao do
-- telefone_receita — não duplica). O tipo (fixo/movel) sai automático do
-- BEFORE trigger trg_set_tipo_telefone (11 díg = movel).
-- =========================================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS telefones jsonb;

COMMENT ON COLUMN public.empresas.telefones IS
  'Todos os telefones da Receita (array de números). Preenchido pela edge function enriquecer-cnpj; materializado em empresa_contatos pelo trigger derive_contatos_from_rfb.';

-- -------------------------------------------------------------------------
-- Trigger function: mesma de 20260608000001 + bloco que materializa o array
-- `telefones`. Mantém SECURITY DEFINER + search_path (de 20260608000004).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_contatos_from_rfb()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_socio jsonb;
  v_nome  text;
  v_qual  text;
  v_doc   text;
  v_dedup text;
  v_tel   text;
  v_telj  jsonb;
  v_num   text;
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

  -- Telefone RFB principal (telefone_receita) ----------------------------
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

  -- TODOS os telefones RFB (array `telefones`, incl. celular) -------------
  -- Cada número vira um canal geral/rfb; tipo (fixo/movel) é classificado
  -- pelo BEFORE trigger trg_set_tipo_telefone. Dedup pelo mesmo 'tel:'+díg,
  -- então não duplica o telefone_receita acima nem entre re-enriquecimentos.
  IF NEW.telefones IS NOT NULL AND jsonb_typeof(NEW.telefones) = 'array' THEN
    FOR v_telj IN SELECT * FROM jsonb_array_elements(NEW.telefones)
    LOOP
      v_num := regexp_replace(coalesce(v_telj #>> '{}', ''), '\D', '', 'g');
      IF length(v_num) >= 10 THEN
        v_dedup := 'tel:' || v_num;
        IF NOT EXISTS (
          SELECT 1 FROM public.empresa_contatos
           WHERE empresa_id = NEW.id AND dedup_key = v_dedup
        ) THEN
          INSERT INTO public.empresa_contatos
            (empresa_id, telefone, papel, origem, dedup_key)
          VALUES
            (NEW.id, v_telj #>> '{}', 'geral', 'rfb', v_dedup);
        END IF;
      END IF;
    END LOOP;
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

-- Recria o trigger incluindo `telefones` nas colunas observadas no UPDATE.
DROP TRIGGER IF EXISTS trg_derive_contatos_rfb ON public.empresas;
CREATE TRIGGER trg_derive_contatos_rfb
  AFTER INSERT OR UPDATE OF qsa, telefone_receita, email_receita, telefones
  ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.derive_contatos_from_rfb();
