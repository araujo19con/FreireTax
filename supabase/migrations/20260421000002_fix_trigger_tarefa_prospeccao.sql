-- ===============================================================
-- Fix: trigger trigger_tarefa_on_prospeccao estava inserindo em
-- tarefas uma coluna `user_id` que não existe (a tabela tem
-- `created_by` e `assigned_to`). Isso abortava TODA criação de
-- prospecção com erro "column user_id of relation tarefas does
-- not exist".
-- ===============================================================

CREATE OR REPLACE FUNCTION public.create_initial_tarefa_on_prospeccao()
RETURNS TRIGGER AS $$
DECLARE
  empresa_nome text;
BEGIN
  IF NEW.status_prospeccao = 'Não iniciado' THEN
    -- busca nome da empresa via elegibilidade (fallback 'Empresa' se falhar)
    SELECT e.nome INTO empresa_nome
    FROM public.elegibilidade el
    JOIN public.empresas e ON e.id = el.empresa_id
    WHERE el.id = NEW.elegibilidade_id;

    INSERT INTO public.tarefas (
      titulo, descricao, status, prioridade,
      prospeccao_id, created_by, assigned_to,
      prazo
    ) VALUES (
      'Contato inicial — ' || COALESCE(empresa_nome, 'Empresa'),
      'Prospecção recém-criada. Fazer primeiro contato e registrar cadência.',
      'pendente', 'alta',
      NEW.id,
      NEW.user_id,                                   -- created_by = quem criou a prospecção
      COALESCE(NEW.responsavel_id, NEW.user_id),      -- assigned_to = responsável ou criador
      (CURRENT_DATE + INTERVAL '1 day')::date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger já está registrado (mesma função, só estamos substituindo o corpo)
