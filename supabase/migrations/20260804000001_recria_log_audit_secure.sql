-- =========================================================================
-- CORREÇÃO — auditoria parada desde ~28/05/2026.
--
-- A migration 20260528000000_audit_log_secure_definer foi marcada como APLICADA
-- (repair do histórico do CLI) mas o SQL dela NUNCA rodou no banco: a função
-- `log_audit_secure` não existe. Como o `logAudit` do front chama essa RPC e
-- IGNORA o erro, toda auditoria falhava em SILÊNCIO (0 registros novos desde então).
--
-- Recria a função (idempotente) + grants + revoke do INSERT direto (inserts só via
-- RPC, que injeta user_id = auth.uid() server-side; cliente não forja). Aplicar via
-- `supabase db push` (esta migration é nova, então roda de fato).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.log_audit_secure(
  p_tabela      text,
  p_acao        text,
  p_registro_id uuid  DEFAULT NULL,
  p_detalhes    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, tabela, acao, registro_id, detalhes)
  VALUES (auth.uid(), p_tabela, p_acao, p_registro_id, COALESCE(p_detalhes, '{}'));
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_secure FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_secure TO authenticated;

-- inserts só via RPC (server injeta user_id; cliente não pode forjar)
REVOKE INSERT ON TABLE public.audit_logs FROM authenticated;

COMMENT ON FUNCTION public.log_audit_secure IS
  'Insere entrada no audit_log com user_id = auth.uid() (server-side). Chamado via logAudit.';
