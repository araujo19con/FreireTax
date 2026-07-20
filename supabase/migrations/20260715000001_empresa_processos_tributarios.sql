-- =========================================================================
-- Processos tributários da PRÓPRIA empresa detectados no PJe (por CNPJ), pra
-- saber quais teses ela já ajuizou e — por diferença com o catálogo — quais
-- OFERECER. Alimentado por tools/pje_teses_empresa.py (busca 1º/2º grau,
-- filtra: só empresa AUTORA + classe de tese comercial + vara fazendária;
-- descarta ré, embargos/execução/cumprimento e diversos).
--
-- Guarda só os CANDIDATOS (processos-tese). A tese exata (acao_id) é preenchida
-- quando o assunto CNJ é lido dos autos; até lá fica NULL (candidato a mapear).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.empresa_processos_tributarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero        text NOT NULL,                    -- número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO)
  grau          text,                             -- '1g' | '2g'
  classe        text,                             -- classe judicial (ex: Mandado de Segurança)
  orgao         text,                             -- órgão julgador (ex: 6ª Vara da Fazenda Pública)
  situacao      text,
  polo          text,                             -- 'ativo' (a empresa é AUTORA — tese dela)
  assunto       text,                             -- assunto CNJ (quando lido dos autos)
  acao_id       uuid REFERENCES public.acoes_tributarias(id) ON DELETE SET NULL,  -- tese mapeada
  fonte         text NOT NULL DEFAULT 'pje_tjrn',
  detectado_em  timestamptz NOT NULL DEFAULT now(),
  detectado_por uuid REFERENCES public.profiles(id),
  metadados     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

COMMENT ON TABLE public.empresa_processos_tributarios IS
  'Processos tributários próprios da empresa (autora, vara fazendária) achados no PJe por CNPJ. Base pra "quais teses já ajuizou × quais oferecer". Alimentado por tools/pje_teses_empresa.py.';

CREATE INDEX IF NOT EXISTS idx_emp_proc_trib_empresa
  ON public.empresa_processos_tributarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_emp_proc_trib_acao
  ON public.empresa_processos_tributarios(acao_id) WHERE acao_id IS NOT NULL;

-- updated_at automático
CREATE OR REPLACE FUNCTION public.touch_emp_proc_trib()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_emp_proc_trib ON public.empresa_processos_tributarios;
CREATE TRIGGER trg_touch_emp_proc_trib
  BEFORE UPDATE ON public.empresa_processos_tributarios
  FOR EACH ROW EXECUTE FUNCTION public.touch_emp_proc_trib();

-- RLS: dado colaborativo (todo o time vê/enriquece), padrão das outras tabelas.
ALTER TABLE public.empresa_processos_tributarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emp_proc_trib_select" ON public.empresa_processos_tributarios;
DROP POLICY IF EXISTS "emp_proc_trib_insert" ON public.empresa_processos_tributarios;
DROP POLICY IF EXISTS "emp_proc_trib_update" ON public.empresa_processos_tributarios;
DROP POLICY IF EXISTS "emp_proc_trib_delete" ON public.empresa_processos_tributarios;

CREATE POLICY "emp_proc_trib_select" ON public.empresa_processos_tributarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "emp_proc_trib_insert" ON public.empresa_processos_tributarios
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "emp_proc_trib_update" ON public.empresa_processos_tributarios
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "emp_proc_trib_delete" ON public.empresa_processos_tributarios
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'gestor'));
