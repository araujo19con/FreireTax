-- Migration: 20260429000002_rls_templates_mensagem
--
-- Corrige RLS de templates_mensagem: a policy "Authenticated manage templates"
-- usava USING(true) — qualquer usuário autenticado conseguia deletar templates
-- de outros. Substitui por policy role-aware idêntica ao padrão das demais tabelas.
--
-- templates_mensagem.created_by é a coluna de ownership.

DROP POLICY IF EXISTS "Authenticated manage templates" ON public.templates_mensagem;

CREATE POLICY "templates_mensagem_insert" ON public.templates_mensagem
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "templates_mensagem_update" ON public.templates_mensagem
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = created_by
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "templates_mensagem_delete" ON public.templates_mensagem
  FOR DELETE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );
