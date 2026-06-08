-- =========================================================================
-- Adiciona a ORIGEM do contato principal ao snapshot denormalizado em
-- empresas, pra a lista (cards/tabela) mostrar a procedência (DRIVA/Receita/
-- Manual...) sem join com empresa_contatos.
--
-- Recria recalc_empresa_contatos_cache incluindo contato_principal_origem
-- (mantendo SECURITY DEFINER da mig 20260608000004) + backfill.
-- =========================================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS contato_principal_origem public.origem_contato;

CREATE OR REPLACE FUNCTION public.recalc_empresa_contatos_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_best       public.empresa_contatos%ROWTYPE;
  v_count      integer;
BEGIN
  v_empresa_id := COALESCE(NEW.empresa_id, OLD.empresa_id);

  SELECT count(*) INTO v_count
    FROM public.empresa_contatos
   WHERE empresa_id = v_empresa_id;

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
         contato_principal_whatsapp = COALESCE(v_best.whatsapp, false),
         contato_principal_origem   = v_best.origem
   WHERE id = v_empresa_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Backfill (não dispara triggers: não toca qsa/telefone_receita/email_receita).
UPDATE public.empresas e
   SET contato_principal_origem = (
     SELECT c.origem
       FROM public.empresa_contatos c
      WHERE c.empresa_id = e.id
      ORDER BY c.principal DESC,
               c.is_contador ASC,
               (c.nome IS NULL) ASC,
               (c.papel = 'socio') DESC,
               (c.telefone IS NOT NULL OR c.email IS NOT NULL) DESC,
               c.created_at ASC
      LIMIT 1
   )
 WHERE e.contatos_count > 0;
