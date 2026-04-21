-- ===============================================================
-- Fase 2 — Workflow de Elegibilidade (Critérios + Wizard + Bulk)
-- ===============================================================
-- Adiciona estrutura para qualificar empresas X ações tributárias via wizard
-- baseado em critérios cadastrados pelo admin, com respostas persistidas.
-- Elegibilidades antigas continuam funcionando (campos novos são nullable).
-- ===============================================================

-- 1. Critérios por ação tributária
CREATE TABLE public.criterios_elegibilidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acao_id uuid NOT NULL REFERENCES public.acoes_tributarias(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  pergunta text NOT NULL,
  descricao text,
  tipo_resposta text NOT NULL CHECK (tipo_resposta IN ('boolean','date','number','text','select')),
  opcoes jsonb,                                -- array de strings pra tipo 'select'
  eh_excludente boolean NOT NULL DEFAULT false,-- se true + resposta falha → elegibilidade=false
  peso integer NOT NULL DEFAULT 1,             -- ponderação para score de elegibilidade
  formula_valor text,                          -- expressão JS safe para estimar valor (ex: "answers.faturamento * 0.08")
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_criterios_acao ON public.criterios_elegibilidade(acao_id);
CREATE INDEX idx_criterios_ordem ON public.criterios_elegibilidade(acao_id, ordem);

ALTER TABLE public.criterios_elegibilidade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ler critérios"
  ON public.criterios_elegibilidade FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins/gestores podem inserir critérios"
  ON public.criterios_elegibilidade FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );

CREATE POLICY "Admins/gestores podem atualizar critérios"
  ON public.criterios_elegibilidade FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );

CREATE POLICY "Admins/gestores podem deletar critérios"
  ON public.criterios_elegibilidade FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );


-- 2. Respostas do usuário ao wizard (1 por critério × elegibilidade)
CREATE TABLE public.elegibilidade_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elegibilidade_id uuid NOT NULL REFERENCES public.elegibilidade(id) ON DELETE CASCADE,
  criterio_id uuid NOT NULL REFERENCES public.criterios_elegibilidade(id) ON DELETE CASCADE,
  resposta_bool boolean,
  resposta_date date,
  resposta_number numeric,
  resposta_text text,
  resposta_select text,
  answered_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE (elegibilidade_id, criterio_id)
);

CREATE INDEX idx_respostas_elegibilidade ON public.elegibilidade_respostas(elegibilidade_id);
CREATE INDEX idx_respostas_criterio ON public.elegibilidade_respostas(criterio_id);

ALTER TABLE public.elegibilidade_respostas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ler respostas"
  ON public.elegibilidade_respostas FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Usuários podem inserir próprias respostas"
  ON public.elegibilidade_respostas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuários podem atualizar próprias respostas ou admin/gestor"
  ON public.elegibilidade_respostas FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );

CREATE POLICY "Usuários podem deletar próprias respostas ou admin/gestor"
  ON public.elegibilidade_respostas FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gestor'::app_role)
  );


-- 3. Extensão da tabela elegibilidade com campos de qualificação
ALTER TABLE public.elegibilidade
  ADD COLUMN IF NOT EXISTS score_elegibilidade integer,
  ADD COLUMN IF NOT EXISTS valor_calculado numeric,
  ADD COLUMN IF NOT EXISTS qualificada_em timestamptz,
  ADD COLUMN IF NOT EXISTS qualificada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_qualificacao text
    CHECK (status_qualificacao IN ('nao_qualificada','incompleta','qualificada','legado'))
    DEFAULT 'legado';


-- 4. Trigger de updated_at para criterios_elegibilidade
CREATE OR REPLACE FUNCTION public.update_criterios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_criterios_updated_at ON public.criterios_elegibilidade;
CREATE TRIGGER trigger_criterios_updated_at
  BEFORE UPDATE ON public.criterios_elegibilidade
  FOR EACH ROW
  EXECUTE FUNCTION public.update_criterios_updated_at();


-- 5. Índice extra pra busca rápida de elegibilidades não qualificadas
CREATE INDEX IF NOT EXISTS idx_elegibilidade_status_qualificacao
  ON public.elegibilidade(status_qualificacao);
