-- ============================================================================
-- Migration: 20260706000000_prospeccoes_delete_owner
--
-- Amplia a policy de DELETE em prospeccoes pra permitir que o dono
-- (user_id/responsavel_id) apague sua própria prospecção, não só
-- admin/gestor. Motivação: permitir excluir um card criado por engano
-- (ex: duplicado) sem precisar movê-lo para "Perdido" nem depender de
-- um gestor. Mesmo padrão já usado em prospeccoes_update (mig 20260429).
--
-- FKs que apontam pra prospeccoes já são seguras para DELETE:
--   prospeccao_contatos.prospeccao_id  -> ON DELETE CASCADE (log de toques)
--   propostas.prospeccao_id            -> ON DELETE CASCADE (proposta única da prospecção)
--   prazos_processuais.prospeccao_id   -> ON DELETE CASCADE
--   tarefas.prospeccao_id              -> ON DELETE SET NULL (tarefa preservada, só desvincula)
--   reunioes.prospeccao_id             -> ON DELETE SET NULL
--   honorarios_lancamentos.prospeccao_id -> ON DELETE SET NULL
-- ============================================================================

DROP POLICY IF EXISTS "prospeccoes_delete" ON public.prospeccoes;

CREATE POLICY "prospeccoes_delete" ON public.prospeccoes
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

-- ============================================================================
-- Rollback (manual, comentado — copiar e rodar no SQL Editor se precisar):
-- ============================================================================
-- DROP POLICY IF EXISTS "prospeccoes_delete" ON public.prospeccoes;
-- CREATE POLICY "prospeccoes_delete" ON public.prospeccoes
--   FOR DELETE TO authenticated
--   USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));
