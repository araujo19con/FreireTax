-- =========================================================================
-- RESTAURA migrations 20260528-20260529 que foram marcadas como aplicadas
-- (repair do histórico) mas cujo SQL NUNCA rodou. Objetos ausentes no banco:
--   - assign_user_role()            (20260528000001) — usada pela edge criar-usuario
--   - honorarios_lancamentos + enums + trigger + RLS  (20260528000002) — Financeiro.tsx QUEBRADO
--   - prazos_processuais + enum + fn + RLS             (20260528000003) — Prazos.tsx QUEBRADO
--   - marcar_honorarios_atrasados / check_...on_insert (20260529000000)
-- (log_audit_secure já foi restaurada em 20260804000001.)
--
-- Tudo IDEMPOTENTE: as tabelas não existem, então é puramente aditivo (sem risco
-- de perda). Migrations 529000001/002 já haviam rodado (colunas presentes).
-- =========================================================================

-- ---- enums (guardados) --------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='honorario_tipo')   THEN CREATE TYPE honorario_tipo   AS ENUM ('retainer','exito','avulso'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='honorario_status') THEN CREATE TYPE honorario_status AS ENUM ('pendente','pago','atrasado','cancelado'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='prazo_status')     THEN CREATE TYPE prazo_status     AS ENUM ('pendente','cumprido','perdido'); END IF;
END $$;

-- updated_at helper (idempotente)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---- assign_user_role (20260528000001) ---------------------------------
CREATE OR REPLACE FUNCTION public.assign_user_role(p_uid uuid, p_role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.user_roles WHERE user_id = p_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_uid, p_role);
END; $$;
REVOKE ALL ON FUNCTION public.assign_user_role FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_user_role TO service_role;

-- ---- honorarios_lancamentos (20260528000002) ---------------------------
CREATE TABLE IF NOT EXISTS public.honorarios_lancamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id   uuid REFERENCES public.prospeccoes(id) ON DELETE SET NULL,
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tipo            honorario_tipo NOT NULL DEFAULT 'avulso',
  descricao       text,
  valor           numeric(14,2) NOT NULL CHECK (valor > 0),
  data_vencimento date NOT NULL,
  data_pagamento  date,
  status          honorario_status NOT NULL DEFAULT 'pendente',
  nota            text,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS honorarios_updated_at ON public.honorarios_lancamentos;
CREATE TRIGGER honorarios_updated_at BEFORE UPDATE ON public.honorarios_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS honorarios_empresa_id_idx ON public.honorarios_lancamentos (empresa_id);
CREATE INDEX IF NOT EXISTS honorarios_prospeccao_idx ON public.honorarios_lancamentos (prospeccao_id);
CREATE INDEX IF NOT EXISTS honorarios_vencimento_idx ON public.honorarios_lancamentos (data_vencimento);
CREATE INDEX IF NOT EXISTS honorarios_status_idx     ON public.honorarios_lancamentos (status);
ALTER TABLE public.honorarios_lancamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "honorarios_select" ON public.honorarios_lancamentos;
CREATE POLICY "honorarios_select" ON public.honorarios_lancamentos FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','gestor')) OR created_by=auth.uid());
DROP POLICY IF EXISTS "honorarios_insert" ON public.honorarios_lancamentos;
CREATE POLICY "honorarios_insert" ON public.honorarios_lancamentos FOR INSERT WITH CHECK (created_by=auth.uid());
DROP POLICY IF EXISTS "honorarios_update" ON public.honorarios_lancamentos;
CREATE POLICY "honorarios_update" ON public.honorarios_lancamentos FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','gestor')) OR created_by=auth.uid());
DROP POLICY IF EXISTS "honorarios_delete" ON public.honorarios_lancamentos;
CREATE POLICY "honorarios_delete" ON public.honorarios_lancamentos FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='admin'));

-- ---- honorarios automation (20260529000000) ----------------------------
CREATE OR REPLACE FUNCTION public.marcar_honorarios_atrasados()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE honorarios_lancamentos SET status='atrasado', updated_at=now()
   WHERE status='pendente' AND data_vencimento < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END; $$;
CREATE OR REPLACE FUNCTION public.check_honorario_atrasado_on_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='pendente' AND NEW.data_vencimento < CURRENT_DATE THEN NEW.status:='atrasado'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS honorario_atrasado_on_insert ON public.honorarios_lancamentos;
CREATE TRIGGER honorario_atrasado_on_insert BEFORE INSERT ON public.honorarios_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.check_honorario_atrasado_on_insert();

-- ---- prazos_processuais (20260528000003) -------------------------------
CREATE TABLE IF NOT EXISTS public.prazos_processuais (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id            uuid REFERENCES public.prospeccoes(id) ON DELETE CASCADE,
  empresa_id               uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  acao_id                  uuid REFERENCES public.acoes_tributarias(id) ON DELETE SET NULL,
  tipo                     text NOT NULL,
  descricao                text,
  data_vencimento          date NOT NULL,
  alerta_antecedencia_dias int NOT NULL DEFAULT 3 CHECK (alerta_antecedencia_dias >= 0),
  status                   prazo_status NOT NULL DEFAULT 'pendente',
  alerta_enviado_em        timestamptz,
  responsavel_id           uuid REFERENCES public.profiles(id),
  observacao               text,
  criado_por               uuid REFERENCES public.profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS prazos_updated_at ON public.prazos_processuais;
CREATE TRIGGER prazos_updated_at BEFORE UPDATE ON public.prazos_processuais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS prazos_empresa_idx     ON public.prazos_processuais (empresa_id);
CREATE INDEX IF NOT EXISTS prazos_vencimento_idx  ON public.prazos_processuais (data_vencimento);
CREATE INDEX IF NOT EXISTS prazos_responsavel_idx ON public.prazos_processuais (responsavel_id);
CREATE INDEX IF NOT EXISTS prazos_status_idx       ON public.prazos_processuais (status);
ALTER TABLE public.prazos_processuais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prazos_select" ON public.prazos_processuais;
CREATE POLICY "prazos_select" ON public.prazos_processuais FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','gestor'))
  OR responsavel_id=auth.uid() OR criado_por=auth.uid());
DROP POLICY IF EXISTS "prazos_insert" ON public.prazos_processuais;
CREATE POLICY "prazos_insert" ON public.prazos_processuais FOR INSERT WITH CHECK (criado_por=auth.uid());
DROP POLICY IF EXISTS "prazos_update" ON public.prazos_processuais;
CREATE POLICY "prazos_update" ON public.prazos_processuais FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','gestor'))
  OR responsavel_id=auth.uid() OR criado_por=auth.uid());
DROP POLICY IF EXISTS "prazos_delete" ON public.prazos_processuais;
CREATE POLICY "prazos_delete" ON public.prazos_processuais FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role='admin') OR criado_por=auth.uid());

CREATE OR REPLACE FUNCTION public.prazos_a_alertar_hoje()
RETURNS TABLE (prazo_id uuid, empresa_nome text, acao_nome text, tipo text, descricao text,
               data_vencimento date, responsavel_id uuid, responsavel_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pp.id, e.nome, at.nome, pp.tipo, pp.descricao, pp.data_vencimento, pp.responsavel_id, pr.email
  FROM public.prazos_processuais pp
  JOIN public.empresas e ON e.id=pp.empresa_id
  LEFT JOIN public.acoes_tributarias at ON at.id=pp.acao_id
  LEFT JOIN public.profiles pr ON pr.id=pp.responsavel_id
  WHERE pp.status='pendente' AND pp.alerta_enviado_em IS NULL
    AND (pp.data_vencimento - pp.alerta_antecedencia_dias) <= CURRENT_DATE
    AND pp.data_vencimento >= CURRENT_DATE
$$;
REVOKE ALL ON FUNCTION public.prazos_a_alertar_hoje FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prazos_a_alertar_hoje TO service_role;
