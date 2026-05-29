-- ===============================================================
-- Reanima trigger create_initial_tarefa_on_prospeccao
--
-- Histórico:
--  - 20260421000002 criou o trigger gatilhando em status = 'Não iniciado'
--  - 20260506000004 removeu o status 'Não iniciado' do sistema
--  - 20260421000000 adicionou prospeccoes.empresa_id (antes só elegibilidade_id)
--  - Default de novas prospecções passou a ser 'Contato feito' (Prospeccao.tsx:579)
--
-- Consequência: o trigger nunca disparava mais. A "tarefa inicial automática"
-- documentada em CLAUDE.md silenciosamente parou de existir.
--
-- Fix:
--  - Gatilha em INSERT de prospecções com status iniciais (Contato feito ou
--    Contato inicial) — cobre tanto o default novo quanto importações legacy.
--  - Busca empresa.nome via empresa_id direto (não mais elegibilidade_id legacy),
--    com fallback pro padrão antigo caso empresa_id seja null (compat).
-- ===============================================================

CREATE OR REPLACE FUNCTION public.create_initial_tarefa_on_prospeccao()
RETURNS TRIGGER AS $$
DECLARE
  empresa_nome text;
BEGIN
  -- Só cria a tarefa quando a prospecção nasce em estágio inicial. Updates de
  -- status (ex: "Em negociação" → "Contrato assinado") não geram novas tarefas.
  IF TG_OP = 'INSERT' AND NEW.status_prospeccao IN ('Contato feito', 'Contato inicial') THEN

    -- Preferir empresa_id (campo canônico desde mig 20260421000000); fallback
    -- pra elegibilidade_id pra cobrir prospecções legacy sem empresa_id.
    IF NEW.empresa_id IS NOT NULL THEN
      SELECT nome INTO empresa_nome FROM public.empresas WHERE id = NEW.empresa_id;
    ELSIF NEW.elegibilidade_id IS NOT NULL THEN
      SELECT e.nome INTO empresa_nome
      FROM public.elegibilidade el
      JOIN public.empresas e ON e.id = el.empresa_id
      WHERE el.id = NEW.elegibilidade_id;
    END IF;

    INSERT INTO public.tarefas (
      titulo, descricao, status, prioridade,
      prospeccao_id, created_by, assigned_to,
      prazo
    ) VALUES (
      'Contato inicial — ' || COALESCE(empresa_nome, 'Empresa'),
      'Prospecção recém-criada. Fazer primeiro contato e registrar cadência.',
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
  'Cria tarefa "Contato inicial" automaticamente em prospecções recém-criadas em estágio inicial. Re-vivificado em 20260527 após a remoção do status "Não iniciado" deixar o trigger inerte.';
