-- ============================================================================
-- Migration: 20260429000000_rls_role_aware
--
-- Substitui as policies USING(true) das tabelas de negócio por policies
-- role-aware. Resolve C2 do audit de segurança: o modelo de roles existia
-- na UI (canManageAll) mas não era imposto no banco — qualquer authenticated
-- conseguia DELETE direto via PostgREST.
--
-- Padrão geral:
--   SELECT  → permissivo (todo authenticated vê tudo) — escopo do escritório
--   INSERT  → exige user_id/created_by = auth.uid()
--   UPDATE  → owner OR admin OR gestor
--   DELETE  → admin OR gestor (operação destrutiva exige privilégio)
--
-- Pastas personais (pastas_empresas/pasta_empresa_items): restauradas para
-- escopo do dono (cada usuário só vê/gerencia suas próprias pastas).
--
-- audit_logs: SELECT só para admin/gestor (informação sensível).
--
-- Funções auxiliares (já existem):
--   public.is_admin(uuid)              — checa se o uuid é admin
--   public.has_role(uuid, app_role)    — checa role específico (enum)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- empresas
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all empresas" ON public.empresas;
DROP POLICY IF EXISTS "Authenticated can insert empresas" ON public.empresas;
DROP POLICY IF EXISTS "Authenticated can update empresas" ON public.empresas;
DROP POLICY IF EXISTS "Authenticated can delete empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can view own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can insert own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can update own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can delete own empresas" ON public.empresas;

CREATE POLICY "empresas_select" ON public.empresas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "empresas_insert" ON public.empresas
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "empresas_update" ON public.empresas
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "empresas_delete" ON public.empresas
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- acoes_tributarias
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Authenticated can insert acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Authenticated can update acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Authenticated can delete acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can view own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can insert own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can update own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can delete own acoes" ON public.acoes_tributarias;

CREATE POLICY "acoes_select" ON public.acoes_tributarias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "acoes_insert" ON public.acoes_tributarias
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "acoes_update" ON public.acoes_tributarias
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "acoes_delete" ON public.acoes_tributarias
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- prospeccoes
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Authenticated can insert prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Authenticated can update prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Authenticated can delete prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can view own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can insert own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can update own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can delete own prospeccoes" ON public.prospeccoes;

CREATE POLICY "prospeccoes_select" ON public.prospeccoes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prospeccoes_insert" ON public.prospeccoes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "prospeccoes_update" ON public.prospeccoes
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = responsavel_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "prospeccoes_delete" ON public.prospeccoes
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- elegibilidade
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Authenticated can insert elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Authenticated can update elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Authenticated can delete elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can view own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can insert own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can update own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can delete own elegibilidade" ON public.elegibilidade;

CREATE POLICY "elegibilidade_select" ON public.elegibilidade
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "elegibilidade_insert" ON public.elegibilidade
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "elegibilidade_update" ON public.elegibilidade
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR auth.uid() = qualificada_por
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = qualificada_por
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "elegibilidade_delete" ON public.elegibilidade
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- processos
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all processos" ON public.processos;
DROP POLICY IF EXISTS "Authenticated can insert processos" ON public.processos;
DROP POLICY IF EXISTS "Authenticated can update processos" ON public.processos;
DROP POLICY IF EXISTS "Authenticated can delete processos" ON public.processos;
DROP POLICY IF EXISTS "Users can view own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can insert own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can update own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can delete own processos" ON public.processos;

CREATE POLICY "processos_select" ON public.processos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "processos_insert" ON public.processos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "processos_update" ON public.processos
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "processos_delete" ON public.processos
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- propostas (created_by é a coluna de ownership)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS propostas_all_auth ON public.propostas;

CREATE POLICY "propostas_select" ON public.propostas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "propostas_insert" ON public.propostas
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "propostas_update" ON public.propostas
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

CREATE POLICY "propostas_delete" ON public.propostas
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- propostas_templates (compartilhados; só admin/gestor ou criador altera/apaga)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS propostas_templates_all_auth ON public.propostas_templates;

CREATE POLICY "propostas_templates_select" ON public.propostas_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "propostas_templates_insert" ON public.propostas_templates
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "propostas_templates_update" ON public.propostas_templates
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  )
  WITH CHECK (
    auth.uid() = user_id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'gestor')
  );

CREATE POLICY "propostas_templates_delete" ON public.propostas_templates
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ----------------------------------------------------------------------------
-- pastas_empresas (PERSONAIS — restaura escopo de dono)
-- Cada usuário só vê e gerencia suas próprias pastas.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Authenticated can insert pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Authenticated can update pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Authenticated can delete pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can view own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can insert own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can update own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can delete own pastas" ON public.pastas_empresas;

CREATE POLICY "pastas_select_own" ON public.pastas_empresas
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "pastas_insert_own" ON public.pastas_empresas
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pastas_update_own" ON public.pastas_empresas
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "pastas_delete_own" ON public.pastas_empresas
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- pasta_empresa_items (mesmo escopo do dono da pasta)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Authenticated can insert pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Authenticated can delete pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Users can view own pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Users can insert own pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Users can delete own pasta items" ON public.pasta_empresa_items;

CREATE POLICY "pasta_items_select_own" ON public.pasta_empresa_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "pasta_items_insert_own" ON public.pasta_empresa_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pasta_items_delete_own" ON public.pasta_empresa_items
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- audit_logs (SELECT só para admin/gestor — A6 do audit)
-- INSERT continua permissivo (clientes precisam logar suas ações; será
-- substituído por triggers server-side em iteração futura).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;

CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- ============================================================================
-- Rollback (manual, comentado — copiar e rodar no SQL Editor se precisar):
-- ============================================================================
-- DROP POLICY IF EXISTS "empresas_select" ON public.empresas;
-- DROP POLICY IF EXISTS "empresas_insert" ON public.empresas;
-- DROP POLICY IF EXISTS "empresas_update" ON public.empresas;
-- DROP POLICY IF EXISTS "empresas_delete" ON public.empresas;
-- CREATE POLICY "Authenticated can view all empresas" ON public.empresas FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Authenticated can insert empresas" ON public.empresas FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Authenticated can update empresas" ON public.empresas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Authenticated can delete empresas" ON public.empresas FOR DELETE TO authenticated USING (true);
-- (replicar para cada tabela)
