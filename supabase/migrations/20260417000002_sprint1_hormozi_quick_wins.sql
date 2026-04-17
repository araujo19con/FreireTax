-- =========================================================================
-- Sprint 1 Hormozi Quick Wins:
--   QW1 — motivo de perda obrigatório ao marcar prospecção como "Perdido"
--   QW2 — valor potencial estimado em elegibilidade
--   QW3 — tabela prospeccao_contatos (cadência 7 toques) + contador
--   QW4 — data_limite_prescricao e tipo_prazo em acoes_tributarias
--   QW5 — trigger de upsell: cria tarefa automática ao fechar contrato
-- =========================================================================

-- -------------------------------------------------------------------------
-- QW1 — Motivo de perda estruturado
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.motivo_perdido AS ENUM (
    'preco',
    'desconfianca_tese',
    'timing',
    'concorrente',
    'decisor_errado',
    'sem_interesse',
    'sem_resposta',
    'outros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.prospeccoes
  ADD COLUMN IF NOT EXISTS motivo_perdido public.motivo_perdido,
  ADD COLUMN IF NOT EXISTS motivo_perdido_detalhes text;

-- Backfill dados historicos: registros "Perdido" sem motivo ficam como "outros"
UPDATE public.prospeccoes
   SET motivo_perdido = 'outros',
       motivo_perdido_detalhes = COALESCE(motivo_perdido_detalhes,
         'Dado migrado do sistema antigo — motivo nao informado')
 WHERE status_prospeccao = 'Perdido' AND motivo_perdido IS NULL;

-- constraint: se status = Perdido, motivo_perdido e obrigatorio
DO $$ BEGIN
  ALTER TABLE public.prospeccoes
    ADD CONSTRAINT prospeccoes_motivo_se_perdido
    CHECK (status_prospeccao <> 'Perdido' OR motivo_perdido IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- QW2 — Valor potencial em elegibilidade + cache em prospeccoes
-- -------------------------------------------------------------------------
ALTER TABLE public.elegibilidade
  ADD COLUMN IF NOT EXISTS valor_potencial_estimado numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS observacao_valor text;

CREATE INDEX IF NOT EXISTS idx_elegibilidade_valor_potencial
  ON public.elegibilidade(valor_potencial_estimado DESC)
  WHERE elegivel = true;

-- Campo denormalizado em empresas para ranking rápido (soma dos valores
-- elegíveis). Atualizado via trigger.
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS valor_potencial_total numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faturamento_estimado numeric(15,2);

CREATE INDEX IF NOT EXISTS idx_empresas_valor_potencial
  ON public.empresas(valor_potencial_total DESC);

-- Trigger: mantém empresas.valor_potencial_total = SUM(elegibilidade.valor elegíveis)
CREATE OR REPLACE FUNCTION public.recalc_empresa_valor_potencial()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  v_empresa_id := COALESCE(NEW.empresa_id, OLD.empresa_id);
  UPDATE public.empresas
     SET valor_potencial_total = COALESCE((
       SELECT SUM(valor_potencial_estimado)
         FROM public.elegibilidade
        WHERE empresa_id = v_empresa_id AND elegivel = true
     ), 0)
   WHERE id = v_empresa_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_empresa_valor ON public.elegibilidade;
CREATE TRIGGER trg_recalc_empresa_valor
  AFTER INSERT OR UPDATE OF valor_potencial_estimado, elegivel, empresa_id
      OR DELETE
  ON public.elegibilidade
  FOR EACH ROW EXECUTE FUNCTION public.recalc_empresa_valor_potencial();

-- Recalcula para dados históricos
UPDATE public.empresas e
   SET valor_potencial_total = COALESCE((
     SELECT SUM(valor_potencial_estimado)
       FROM public.elegibilidade
      WHERE empresa_id = e.id AND elegivel = true
   ), 0);

-- -------------------------------------------------------------------------
-- QW3 — Cadência de 7 toques
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.canal_contato AS ENUM (
    'email', 'telefone', 'whatsapp', 'linkedin',
    'reuniao_presencial', 'reuniao_online', 'outro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tipo_contato AS ENUM (
    'outbound',          -- nós falamos com o lead
    'resposta_lead',     -- lead respondeu
    'reuniao',           -- teve reunião agendada
    'breakup'            -- último toque antes de desistir
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.prospeccao_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id uuid NOT NULL REFERENCES public.prospeccoes(id) ON DELETE CASCADE,
  user_id uuid,  -- quem registrou (profiles.id)
  data_contato timestamptz NOT NULL DEFAULT now(),
  canal public.canal_contato NOT NULL,
  tipo public.tipo_contato NOT NULL DEFAULT 'outbound',
  resultado text,      -- ex: "respondeu interessado", "pediu retorno semana que vem"
  notas text,
  proximo_contato_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_contatos_prospeccao
  ON public.prospeccao_contatos(prospeccao_id, data_contato DESC);

ALTER TABLE public.prospeccao_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view prospeccao_contatos" ON public.prospeccao_contatos;
DROP POLICY IF EXISTS "Authenticated insert prospeccao_contatos" ON public.prospeccao_contatos;
DROP POLICY IF EXISTS "Author or admin update prospeccao_contatos" ON public.prospeccao_contatos;
DROP POLICY IF EXISTS "Author or admin delete prospeccao_contatos" ON public.prospeccao_contatos;

CREATE POLICY "Authenticated view prospeccao_contatos"
  ON public.prospeccao_contatos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated insert prospeccao_contatos"
  ON public.prospeccao_contatos FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Author or admin update prospeccao_contatos"
  ON public.prospeccao_contatos FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (true);

CREATE POLICY "Author or admin delete prospeccao_contatos"
  ON public.prospeccao_contatos FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));

-- Campos denormalizados em prospeccoes (cache de contatos)
ALTER TABLE public.prospeccoes
  ADD COLUMN IF NOT EXISTS numero_contatos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_contato_em timestamptz,
  ADD COLUMN IF NOT EXISTS proximo_contato_em timestamptz;

-- Trigger: mantém numero_contatos e datas atualizados
CREATE OR REPLACE FUNCTION public.recalc_prospeccao_contatos_cache()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prospeccao_id uuid;
BEGIN
  v_prospeccao_id := COALESCE(NEW.prospeccao_id, OLD.prospeccao_id);
  UPDATE public.prospeccoes p
     SET numero_contatos = (
           SELECT count(*) FROM public.prospeccao_contatos
            WHERE prospeccao_id = v_prospeccao_id
         ),
         ultimo_contato_em = (
           SELECT max(data_contato) FROM public.prospeccao_contatos
            WHERE prospeccao_id = v_prospeccao_id
         ),
         proximo_contato_em = (
           SELECT max(proximo_contato_em) FROM public.prospeccao_contatos
            WHERE prospeccao_id = v_prospeccao_id
              AND proximo_contato_em > now()
         )
   WHERE p.id = v_prospeccao_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_prospeccao_contatos ON public.prospeccao_contatos;
CREATE TRIGGER trg_recalc_prospeccao_contatos
  AFTER INSERT OR UPDATE OR DELETE
  ON public.prospeccao_contatos
  FOR EACH ROW EXECUTE FUNCTION public.recalc_prospeccao_contatos_cache();

-- -------------------------------------------------------------------------
-- QW4 — Data limite de prescrição nas ações tributárias
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.tipo_prazo AS ENUM (
    'rescisoria_24m',      -- 2 anos rescisória (CPC 975)
    'prescricional_5a',    -- 5 anos prescricional tributário
    'decadencial_5a',      -- 5 anos decadencial
    'personalizado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.acoes_tributarias
  ADD COLUMN IF NOT EXISTS data_limite_prescricao date,
  ADD COLUMN IF NOT EXISTS tipo_prazo public.tipo_prazo,
  ADD COLUMN IF NOT EXISTS observacao_prazo text;

-- -------------------------------------------------------------------------
-- QW5 — Trigger de upsell: ao fechar contrato, cria tarefa de análise
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_upsell_apos_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_empresa_nome text;
  v_acao_atual_id uuid;
  v_acao_atual_nome text;
  v_responsavel uuid;
  v_acoes_nao_avaliadas integer;
  v_desc text;
BEGIN
  -- só dispara na TRANSIÇÃO para "Contrato assinado"
  IF NEW.status_prospeccao = 'Contrato assinado'
     AND (OLD.status_prospeccao IS DISTINCT FROM NEW.status_prospeccao)
  THEN
    -- pega empresa e ação atual
    SELECT e.empresa_id, emp.nome, e.acao_id, a.nome
      INTO v_empresa_id, v_empresa_nome, v_acao_atual_id, v_acao_atual_nome
      FROM public.elegibilidade e
      JOIN public.empresas emp ON emp.id = e.empresa_id
      JOIN public.acoes_tributarias a ON a.id = e.acao_id
     WHERE e.id = NEW.elegibilidade_id;

    IF v_empresa_id IS NULL THEN RETURN NEW; END IF;

    -- Quantas ações ATIVAS não foram avaliadas ainda para essa empresa?
    SELECT count(*)
      INTO v_acoes_nao_avaliadas
      FROM public.acoes_tributarias a
     WHERE a.status = 'Ativa'
       AND NOT EXISTS (
         SELECT 1 FROM public.elegibilidade el
          WHERE el.empresa_id = v_empresa_id AND el.acao_id = a.id
       );

    -- Define responsável: advogado/comercial responsável pela prospecção
    v_responsavel := NEW.responsavel_id;

    v_desc := format(
      'Empresa "%s" acabou de fechar contrato para "%s".%sHá %s outras ações tributárias ativas ainda não avaliadas para esta empresa. Verifique elegibilidade para potenciais upsells (LTV expansion).',
      v_empresa_nome,
      v_acao_atual_nome,
      E'\n\n',
      COALESCE(v_acoes_nao_avaliadas::text, '0')
    );

    -- Cria a tarefa
    INSERT INTO public.tarefas (
      titulo, descricao, assigned_to, created_by,
      empresa_id, prospeccao_id, prioridade, status, prazo
    ) VALUES (
      format('[Upsell] Avaliar outras teses para %s', v_empresa_nome),
      v_desc,
      v_responsavel,
      COALESCE(v_responsavel, NEW.user_id),
      v_empresa_id,
      NEW.id,
      'alta'::public.tarefa_prioridade,
      'pendente'::public.tarefa_status,
      now() + interval '7 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsell_apos_assinatura ON public.prospeccoes;
CREATE TRIGGER trg_upsell_apos_assinatura
  AFTER UPDATE OF status_prospeccao ON public.prospeccoes
  FOR EACH ROW EXECUTE FUNCTION public.trigger_upsell_apos_assinatura();

-- -------------------------------------------------------------------------
-- Índices auxiliares para queries do dashboard de funil (Sprint 2 preparado)
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prospeccoes_status_updated
  ON public.prospeccoes(status_prospeccao, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospeccoes_proximo_contato
  ON public.prospeccoes(proximo_contato_em)
  WHERE proximo_contato_em IS NOT NULL;

-- -------------------------------------------------------------------------
-- Seed: data de prescrição exemplo para ações conhecidas do STF
-- (Tema 985 foi julgado em 2020 e modulado — a janela rescisória expirou para
-- a maioria. Mas pode haver teses ativas. Deixamos NULL para o escritório
-- preencher manualmente no Admin.)
-- -------------------------------------------------------------------------
-- nada seeded — o usuário preenche via UI.
