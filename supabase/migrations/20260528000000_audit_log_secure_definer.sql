-- Substitui INSERT direto em audit_logs por uma função SECURITY DEFINER.
-- O user_id é injetado pelo servidor via auth.uid() — o cliente não pode
-- mais forjar registros em nome de outro usuário.

CREATE OR REPLACE FUNCTION public.log_audit_secure(
  p_tabela    text,
  p_acao      text,
  p_registro_id uuid DEFAULT NULL,
  p_detalhes  jsonb DEFAULT '{}'::jsonb
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

-- Apenas usuários autenticados podem chamar a função.
REVOKE ALL ON FUNCTION public.log_audit_secure FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_secure TO authenticated;

-- Remove INSERT direto de authenticated — inserts agora só via RPC.
-- SELECT e atualizações de RLS continuam inalterados.
REVOKE INSERT ON TABLE public.audit_logs FROM authenticated;

COMMENT ON FUNCTION public.log_audit_secure IS
  'Insere entrada no audit_log com user_id = auth.uid() (server-side). '
  'Chamado via supabase.rpc("log_audit_secure", {...}) — clientes não podem forjar user_id.';
