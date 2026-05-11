-- ===============================================================
-- Tarefas de prospecção: assigned_to passa a refletir estritamente
-- o responsavel_id da prospecção (sem fallback pro criador).
--
-- Motivação: hoje a tarefa "Contato inicial — ..." caía no Meu Espaço
-- de quem CRIOU a prospecção quando responsavel_id era NULL. Isso
-- entulhou o Meu Espaço de admins/importadores com centenas de
-- tarefas que não eram deles.
--
-- Comportamento novo:
-- 1. Trigger de INSERT — se responsavel_id IS NULL, NÃO cria tarefa.
--    Se houver responsável, atribui a ele (sem COALESCE).
-- 2. Trigger de UPDATE — quando responsavel_id muda numa prospecção,
--    as tarefas abertas (pendente/em_andamento) são reatribuídas
--    automaticamente ao novo responsável.
-- 3. Backfill — tarefas existentes ligadas a prospecções têm seu
--    assigned_to sincronizado com o responsavel_id atual da
--    prospecção (vira NULL/desatribuída quando a prospecção não
--    tem responsável).
-- ===============================================================

-- 1) Atualiza trigger de INSERT
CREATE OR REPLACE FUNCTION public.create_initial_tarefa_on_prospeccao()
RETURNS TRIGGER AS $$
DECLARE
  empresa_nome text;
BEGIN
  -- Não cria tarefa automática se a prospecção nasce sem responsável:
  -- a tarefa ficaria órfã no sistema sem aparecer no Meu Espaço de ninguém.
  IF NEW.responsavel_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mantém o gatilho histórico: só dispara em "Não iniciado" (status
  -- atualmente não usado, mas preservado caso volte a ser).
  IF NEW.status_prospeccao = 'Não iniciado' THEN
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
      NEW.user_id,           -- created_by = quem criou a prospecção
      NEW.responsavel_id,    -- assigned_to = responsável (sem fallback)
      (CURRENT_DATE + INTERVAL '1 day')::date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2) Novo trigger: sincroniza assigned_to das tarefas da prospecção
--    quando responsavel_id muda. Só toca em tarefas abertas — tarefas
--    já concluídas/canceladas ficam como histórico no dono original.
CREATE OR REPLACE FUNCTION public.sync_tarefas_assigned_to_on_prospeccao_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id THEN
    UPDATE public.tarefas
    SET assigned_to = NEW.responsavel_id,
        updated_at = now()
    WHERE prospeccao_id = NEW.id
      AND status IN ('pendente', 'em_andamento');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_tarefas_assigned_to_on_prospeccao_update ON public.prospeccoes;
CREATE TRIGGER trigger_sync_tarefas_assigned_to_on_prospeccao_update
  AFTER UPDATE OF responsavel_id ON public.prospeccoes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tarefas_assigned_to_on_prospeccao_update();


-- 3) Backfill — alinha tarefas existentes ao responsavel_id atual da
--    prospecção. Tarefas de prospecções sem responsável viram NULL
--    (desaparecem do Meu Espaço de qualquer usuário até alguém claimar).
--    Só backfill em tarefas abertas; concluídas/canceladas preservam
--    histórico.
UPDATE public.tarefas t
SET assigned_to = p.responsavel_id,
    updated_at = now()
FROM public.prospeccoes p
WHERE t.prospeccao_id = p.id
  AND t.status IN ('pendente', 'em_andamento')
  AND t.assigned_to IS DISTINCT FROM p.responsavel_id;
