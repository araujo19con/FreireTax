-- =========================================================================
-- Sinalização de "telefone errado" em empresa_contatos — ANTES de o número
-- ruim entrar no funil de prospecção.
--
-- Motivação: o time descobre em campo (ligando, mandando WhatsApp) que um
-- número está errado/inexistente. Hoje não há onde registrar isso — o dado
-- ruim continua sendo sugerido pra próxima prospecção (prefill) e pra tarefa
-- "Contato inicial" (link de WhatsApp). Passa a dar pra marcar o contato como
-- "telefone inválido" direto no diretório, e:
--   1) o snapshot em `empresas` (contato_principal_telefone/whatsapp) para
--      de expor esse número — o prefill de prospeccoes/tarefa cai pro
--      fallback (telefone_receita da empresa), sem propagar o dado ruim;
--   2) fica registrado QUEM marcou, QUANDO e (opcionalmente) POR QUÊ, pra
--      análise de qualidade de dados por origem/UF depois (DRIVA x RFB x
--      PJe x manual — qual fonte traz mais número ruim).
-- =========================================================================

ALTER TABLE public.empresa_contatos
  ADD COLUMN IF NOT EXISTS telefone_invalido        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telefone_invalido_motivo  text,
  ADD COLUMN IF NOT EXISTS telefone_invalido_em      timestamptz,
  ADD COLUMN IF NOT EXISTS telefone_invalido_por     uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.empresa_contatos.telefone_invalido IS
  'Marcado pelo time quando o número testado está errado/não existe/não é da empresa. Impede que o número ruim seja sugerido no funil de prospecção (snapshot em empresas) e alimenta análise de qualidade de dados por origem.';

-- Índice parcial: consultas de qualidade ("quantos inválidos por origem/UF")
-- e a tela de auditoria filtram só os marcados.
CREATE INDEX IF NOT EXISTS idx_empresa_contatos_telefone_invalido
  ON public.empresa_contatos(telefone_invalido)
  WHERE telefone_invalido = true;

-- -------------------------------------------------------------------------
-- Carimba quem/quando marcou (ou limpa ao desmarcar) — automático, não
-- depende do front mandar os campos certos.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_telefone_invalido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.telefone_invalido THEN
    IF TG_OP = 'INSERT' OR NOT COALESCE(OLD.telefone_invalido, false) THEN
      NEW.telefone_invalido_em  := now();
      NEW.telefone_invalido_por := auth.uid();
    END IF;
  ELSE
    NEW.telefone_invalido_em     := NULL;
    NEW.telefone_invalido_por    := NULL;
    NEW.telefone_invalido_motivo := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_telefone_invalido ON public.empresa_contatos;
CREATE TRIGGER trg_stamp_telefone_invalido
  BEFORE INSERT OR UPDATE ON public.empresa_contatos
  FOR EACH ROW EXECUTE FUNCTION public.stamp_telefone_invalido();

-- -------------------------------------------------------------------------
-- Snapshot em `empresas`: não deixar telefone/whatsapp inválido virar o
-- contato_principal_telefone (o que alimenta o prefill de prospecção e o
-- link de WhatsApp da tarefa "Contato inicial"). A PESSOA escolhida como
-- melhor contato continua a mesma (nome/cargo/email não mudam) — só o
-- telefone marcado como ruim para de ser sugerido.
-- -------------------------------------------------------------------------
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

  -- Melhor contato: principal explícito > nomeado não-contador > sócio >
  -- telefone VÁLIDO > qualquer canal com dado > mais antigo.
  SELECT * INTO v_best
    FROM public.empresa_contatos
   WHERE empresa_id = v_empresa_id
   ORDER BY principal DESC,
            is_contador ASC,
            (nome IS NULL) ASC,
            (papel = 'socio') DESC,
            (telefone IS NOT NULL AND NOT telefone_invalido) DESC,
            (telefone IS NOT NULL OR email IS NOT NULL) DESC,
            created_at ASC
   LIMIT 1;

  UPDATE public.empresas
     SET contatos_count             = COALESCE(v_count, 0),
         contato_principal_nome     = v_best.nome,
         contato_principal_cargo    = v_best.cargo,
         contato_principal_telefone = CASE WHEN v_best.telefone_invalido THEN NULL ELSE v_best.telefone END,
         contato_principal_email    = v_best.email,
         contato_principal_whatsapp = COALESCE(v_best.whatsapp, false)
                                       AND NOT COALESCE(v_best.telefone_invalido, false)
   WHERE id = v_empresa_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;
