
-- acoes_tributarias: shared data
DROP POLICY IF EXISTS "Users can view own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can insert own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can update own acoes" ON public.acoes_tributarias;
DROP POLICY IF EXISTS "Users can delete own acoes" ON public.acoes_tributarias;

CREATE POLICY "Authenticated can view all acoes" ON public.acoes_tributarias FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert acoes" ON public.acoes_tributarias FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update acoes" ON public.acoes_tributarias FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete acoes" ON public.acoes_tributarias FOR DELETE TO authenticated USING (true);

-- empresas: shared data
DROP POLICY IF EXISTS "Users can view own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can insert own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can update own empresas" ON public.empresas;
DROP POLICY IF EXISTS "Users can delete own empresas" ON public.empresas;

CREATE POLICY "Authenticated can view all empresas" ON public.empresas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert empresas" ON public.empresas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update empresas" ON public.empresas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete empresas" ON public.empresas FOR DELETE TO authenticated USING (true);

-- elegibilidade: shared data
DROP POLICY IF EXISTS "Users can view own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can insert own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can update own elegibilidade" ON public.elegibilidade;
DROP POLICY IF EXISTS "Users can delete own elegibilidade" ON public.elegibilidade;

CREATE POLICY "Authenticated can view all elegibilidade" ON public.elegibilidade FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert elegibilidade" ON public.elegibilidade FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update elegibilidade" ON public.elegibilidade FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete elegibilidade" ON public.elegibilidade FOR DELETE TO authenticated USING (true);

-- processos: shared data
DROP POLICY IF EXISTS "Users can view own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can insert own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can update own processos" ON public.processos;
DROP POLICY IF EXISTS "Users can delete own processos" ON public.processos;

CREATE POLICY "Authenticated can view all processos" ON public.processos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert processos" ON public.processos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update processos" ON public.processos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete processos" ON public.processos FOR DELETE TO authenticated USING (true);

-- prospeccoes: shared data
DROP POLICY IF EXISTS "Users can view own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can insert own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can update own prospeccoes" ON public.prospeccoes;
DROP POLICY IF EXISTS "Users can delete own prospeccoes" ON public.prospeccoes;

CREATE POLICY "Authenticated can view all prospeccoes" ON public.prospeccoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert prospeccoes" ON public.prospeccoes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update prospeccoes" ON public.prospeccoes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete prospeccoes" ON public.prospeccoes FOR DELETE TO authenticated USING (true);

-- pastas_empresas: shared data
DROP POLICY IF EXISTS "Users can view own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can insert own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can update own pastas" ON public.pastas_empresas;
DROP POLICY IF EXISTS "Users can delete own pastas" ON public.pastas_empresas;

CREATE POLICY "Authenticated can view all pastas" ON public.pastas_empresas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert pastas" ON public.pastas_empresas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update pastas" ON public.pastas_empresas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete pastas" ON public.pastas_empresas FOR DELETE TO authenticated USING (true);

-- pasta_empresa_items: shared data
DROP POLICY IF EXISTS "Users can view own pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Users can insert own pasta items" ON public.pasta_empresa_items;
DROP POLICY IF EXISTS "Users can delete own pasta items" ON public.pasta_empresa_items;

CREATE POLICY "Authenticated can view all pasta items" ON public.pasta_empresa_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert pasta items" ON public.pasta_empresa_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can delete pasta items" ON public.pasta_empresa_items FOR DELETE TO authenticated USING (true);

-- audit_logs: all can view, but insert only own
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;

CREATE POLICY "Authenticated can view all audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
