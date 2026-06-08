-- =========================================================================
-- A tarefa "Contato inicial" automática passa a já vir com o decisor + link
-- clica-pra-WhatsApp na descrição. O rep abre a tarefa e age em 1 clique,
-- sem garimpar quem ligar.
--
-- Telefone do link: o do contato (se houver) OU, como fallback, o telefone
-- da empresa (telefone_receita) — porque o sócio costuma vir só com nome
-- (o canal direto do decisor é o que o Apollo resolveria depois).
--
-- Lê NEW.contato_* (preenchido pelo trigger prefill_prospeccao_contato, que
-- roda BEFORE INSERT — ou pelo que o rep digitou). Resto idêntico ao
-- 20260527000001 (gatilho, estágios, lookup de empresa, SECURITY DEFINER).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_initial_tarefa_on_prospeccao()
RETURNS TRIGGER AS $$
DECLARE
  empresa_nome text;
  empresa_tel  text;
  v_phone      text;
  v_phone_lbl  text;
  v_digits     text;
  v_e164       text;
  v_desc       text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status_prospeccao IN ('Contato feito', 'Contato inicial') THEN

    IF NEW.empresa_id IS NOT NULL THEN
      SELECT nome, telefone_receita INTO empresa_nome, empresa_tel
      FROM public.empresas WHERE id = NEW.empresa_id;
    ELSIF NEW.elegibilidade_id IS NOT NULL THEN
      SELECT e.nome INTO empresa_nome
      FROM public.elegibilidade el
      JOIN public.empresas e ON e.id = el.empresa_id
      WHERE el.id = NEW.elegibilidade_id;
    END IF;

    v_desc := 'Prospecção recém-criada. Fazer primeiro contato e registrar cadência.';

    -- Bloco de contato (quando há decisor associado)
    IF coalesce(NEW.contato_nome, '') <> '' THEN
      v_desc := v_desc || E'\n\n— Contato —\n' || NEW.contato_nome
                || coalesce(' (' || nullif(NEW.contato_cargo, '') || ')', '');

      -- Telefone: do contato, senão o da empresa (label avisa qual é).
      IF nullif(NEW.contato_telefone, '') IS NOT NULL THEN
        v_phone := NEW.contato_telefone;
        v_phone_lbl := 'Telefone';
      ELSIF nullif(empresa_tel, '') IS NOT NULL THEN
        v_phone := empresa_tel;
        v_phone_lbl := 'Telefone (empresa)';
      END IF;

      IF v_phone IS NOT NULL THEN
        v_desc := v_desc || E'\n' || v_phone_lbl || ': ' || v_phone;
        v_digits := regexp_replace(v_phone, '\D', '', 'g');
        IF length(v_digits) IN (10, 11) THEN
          v_e164 := '55' || v_digits;
        ELSIF length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55' THEN
          v_e164 := v_digits;
        ELSE
          v_e164 := NULL;
        END IF;
        IF v_e164 IS NOT NULL THEN
          v_desc := v_desc || E'\nWhatsApp: https://wa.me/' || v_e164;
        END IF;
      END IF;

      IF nullif(NEW.contato_email, '') IS NOT NULL THEN
        v_desc := v_desc || E'\nEmail: ' || NEW.contato_email;
      END IF;
    END IF;

    INSERT INTO public.tarefas (
      titulo, descricao, status, prioridade,
      prospeccao_id, created_by, assigned_to,
      prazo
    ) VALUES (
      'Contato inicial — ' || COALESCE(empresa_nome, 'Empresa'),
      v_desc,
      'pendente', 'alta',
      NEW.id,
      NEW.user_id,
      COALESCE(NEW.responsavel_id, NEW.user_id),
      (CURRENT_DATE + INTERVAL '1 day')::date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.create_initial_tarefa_on_prospeccao() IS
  'Cria tarefa "Contato inicial" em prospecções novas, já com o decisor + link wa.me (contato ou telefone da empresa) na descrição. v20260608.';
