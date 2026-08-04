-- =========================================================================
-- Auditoria de segurança (04/08/2026) — correções.
--
-- ACHADO 1 (CRÍTICO): as tabelas `contatos`, `socios_processos` e
-- `empresas_skip_log` estavam com RLS DESLIGADO e grants completos a
-- anon/authenticated (SELECT/INSERT/UPDATE/DELETE/TRUNCATE). Como a anon key é
-- PÚBLICA (embutida no front), qualquer um na internet podia LER ou APAGAR esses
-- dados. `contatos`/`socios_processos` guardam dados (pessoais de contatos/sócios).
--   - REVOKE dos grants (TRUNCATE ignora RLS, então só ligar RLS não bastava).
--   - ENABLE RLS como defesa em profundidade.
--   - service_role (tools admin) e postgres BYPASSAM — nada quebra.
--   - contatos/socios_processos são LEGADO (não usados pelo app — só empresa_contatos
--     é usado); empresas_skip_log é log escrito por tool via service_role.
--
-- ACHADO 2 (MÉDIO): 3 funções SECURITY DEFINER sem search_path fixo (advisor
-- "Function Search Path Mutable" — risco de search_path injection). Fixa em public.
-- =========================================================================

-- ACHADO 1 — tira o acesso público e liga RLS
REVOKE ALL ON public.contatos          FROM anon, authenticated;
REVOKE ALL ON public.socios_processos  FROM anon, authenticated;
REVOKE ALL ON public.empresas_skip_log FROM anon, authenticated;

ALTER TABLE public.contatos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.socios_processos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas_skip_log ENABLE ROW LEVEL SECURITY;

-- ACHADO 2 — pina o search_path das funções SECURITY DEFINER
ALTER FUNCTION public.create_initial_tarefa_on_prospeccao()           SET search_path = public;
ALTER FUNCTION public.pode_iniciar_tarefa(uuid)                       SET search_path = public;
ALTER FUNCTION public.sync_tarefas_assigned_to_on_prospeccao_update() SET search_path = public;
