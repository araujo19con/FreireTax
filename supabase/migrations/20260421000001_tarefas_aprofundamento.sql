-- ===============================================================
-- Fase 3 — Aprofundamento de Tarefas
-- ===============================================================
-- Templates, recorrência, dependências, time tracking, saved views,
-- e automações (criação automática via triggers).
-- ===============================================================

-- 1. Templates de tarefa (reutilizáveis)
CREATE TABLE public.tarefas_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,                                  -- tema_985, generico, onboarding...
  titulo_padrao text NOT NULL,
  descricao_padrao text,
  prioridade_padrao text CHECK (prioridade_padrao IN ('urgente','alta','media','baixa')) DEFAULT 'media',
  prazo_relativo_dias integer,                     -- prazo = hoje + N dias
  subtarefas_padrao jsonb DEFAULT '[]'::jsonb,     -- [{ titulo, ordem }]
  acao_id uuid REFERENCES public.acoes_tributarias(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_templates_acao ON public.tarefas_templates(acao_id);
CREATE INDEX idx_templates_categoria ON public.tarefas_templates(categoria);

ALTER TABLE public.tarefas_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos autenticados leem templates"
  ON public.tarefas_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados criam próprios templates"
  ON public.tarefas_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins/gestores ou autor editam templates"
  ON public.tarefas_templates FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );

CREATE POLICY "Admins/gestores ou autor deletam templates"
  ON public.tarefas_templates FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );


-- 2. Recorrência + dependências via colunas adicionais em tarefas
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS recurrence_rule text,              -- RRULE RFC 5545 ou string simples (daily/weekly/monthly)
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES public.tarefas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recurrence_next_run date,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.tarefas_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tarefas_recurrence_next_run
  ON public.tarefas(recurrence_next_run)
  WHERE recurrence_next_run IS NOT NULL;


-- 3. Dependências entre tarefas (one blocks another)
CREATE TABLE public.tarefas_dependencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  depende_de_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tarefa_id, depende_de_id),
  CHECK (tarefa_id != depende_de_id)
);

CREATE INDEX idx_deps_tarefa ON public.tarefas_dependencias(tarefa_id);
CREATE INDEX idx_deps_depende ON public.tarefas_dependencias(depende_de_id);

ALTER TABLE public.tarefas_dependencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem dependências"
  ON public.tarefas_dependencias FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados criam dependências"
  ON public.tarefas_dependencias FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Autenticados removem próprias dependências"
  ON public.tarefas_dependencias FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );


-- 4. Time tracking
CREATE TABLE public.tarefas_tempo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  stopped_at timestamptz,
  duration_sec integer GENERATED ALWAYS AS (
    CASE WHEN stopped_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (stopped_at - started_at))::integer
    END
  ) STORED,
  nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tempo_tarefa ON public.tarefas_tempo(tarefa_id);
CREATE INDEX idx_tempo_user ON public.tarefas_tempo(user_id);
CREATE INDEX idx_tempo_running ON public.tarefas_tempo(user_id) WHERE stopped_at IS NULL;

ALTER TABLE public.tarefas_tempo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados veem próprio time-tracking ou admin/gestor"
  ON public.tarefas_tempo FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );

CREATE POLICY "Autenticados criam próprio time-tracking"
  ON public.tarefas_tempo FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Autenticados atualizam próprio time-tracking"
  ON public.tarefas_tempo FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Autenticados deletam próprio time-tracking"
  ON public.tarefas_tempo FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- 5. Views salvas (filtros persistidos por usuário)
CREATE TABLE public.tarefas_views_salvas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL,
  filtros jsonb NOT NULL DEFAULT '{}'::jsonb,
  eh_padrao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_views_user ON public.tarefas_views_salvas(user_id);

ALTER TABLE public.tarefas_views_salvas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário vê próprias views"
  ON public.tarefas_views_salvas FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário cria próprias views"
  ON public.tarefas_views_salvas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário atualiza próprias views"
  ON public.tarefas_views_salvas FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário deleta próprias views"
  ON public.tarefas_views_salvas FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- 6. Função: verifica se tarefa pode iniciar (todas dependências concluídas)
CREATE OR REPLACE FUNCTION public.pode_iniciar_tarefa(tarefa_uuid uuid)
RETURNS boolean AS $$
DECLARE
  total integer;
  concluidas integer;
BEGIN
  SELECT count(*) INTO total
  FROM public.tarefas_dependencias
  WHERE tarefa_id = tarefa_uuid;

  IF total = 0 THEN RETURN true; END IF;

  SELECT count(*) INTO concluidas
  FROM public.tarefas_dependencias td
  JOIN public.tarefas t ON t.id = td.depende_de_id
  WHERE td.tarefa_id = tarefa_uuid
    AND t.status = 'concluida';

  RETURN concluidas = total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Trigger: ao criar prospecção com status "Não iniciado", cria tarefa inicial
CREATE OR REPLACE FUNCTION public.create_initial_tarefa_on_prospeccao()
RETURNS TRIGGER AS $$
DECLARE
  empresa_nome text;
BEGIN
  IF NEW.status_prospeccao = 'Não iniciado' THEN
    SELECT e.nome INTO empresa_nome
    FROM public.elegibilidade el
    JOIN public.empresas e ON e.id = el.empresa_id
    WHERE el.id = NEW.elegibilidade_id;

    INSERT INTO public.tarefas (
      titulo, descricao, status, prioridade,
      prospeccao_id, user_id, created_by, assigned_to,
      prazo
    ) VALUES (
      'Contato inicial — ' || COALESCE(empresa_nome, 'Empresa'),
      'Prospecção recém-criada. Fazer primeiro contato e registrar cadência.',
      'pendente', 'alta',
      NEW.id, NEW.user_id, NEW.user_id, COALESCE(NEW.responsavel_id, NEW.user_id),
      (CURRENT_DATE + INTERVAL '1 day')::date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_tarefa_on_prospeccao ON public.prospeccoes;
CREATE TRIGGER trigger_tarefa_on_prospeccao
  AFTER INSERT ON public.prospeccoes
  FOR EACH ROW
  EXECUTE FUNCTION public.create_initial_tarefa_on_prospeccao();


-- 8. Trigger updated_at para templates
CREATE OR REPLACE FUNCTION public.update_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_templates_updated_at ON public.tarefas_templates;
CREATE TRIGGER trigger_templates_updated_at
  BEFORE UPDATE ON public.tarefas_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_templates_updated_at();
