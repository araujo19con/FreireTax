-- ===============================================================
-- Limpa tarefas "Contato inicial — ..." órfãs.
--
-- Contexto: a migration 20260506000004 deletou todas as prospecções
-- com status "Não iniciado". A FK tarefas.prospeccao_id é ON DELETE
-- SET NULL, então essas tarefas perderam o link mas continuaram
-- aparecendo no Meu Espaço de quem importou/criou (assigned_to
-- caía no created_by via COALESCE no trigger antigo).
--
-- Aqui apagamos somente as tarefas auto-geradas pelo trigger
-- (título "Contato inicial — ...") que ficaram sem prospecção
-- pai. Histórico de concluídas/canceladas é preservado.
-- ===============================================================

DELETE FROM public.tarefas
WHERE prospeccao_id IS NULL
  AND titulo LIKE 'Contato inicial — %'
  AND status IN ('pendente', 'em_andamento');
