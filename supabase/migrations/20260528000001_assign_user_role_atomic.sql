-- Atribui um role a um usuário de forma atômica: DELETE todos os roles
-- anteriores e INSERT o novo dentro de uma única transação.
-- Chamado via admin client (service_role) na edge function criar-usuario,
-- evitando a race condition onde INSERT + DELETE em chamadas separadas
-- poderia deixar o usuário com dois roles.

CREATE OR REPLACE FUNCTION public.assign_user_role(
  p_uid  uuid,
  p_role app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_roles WHERE user_id = p_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_uid, p_role);
END;
$$;

-- Apenas service_role pode chamar — usuários autenticados não gerenciam roles diretamente.
REVOKE ALL ON FUNCTION public.assign_user_role FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_user_role TO service_role;

COMMENT ON FUNCTION public.assign_user_role IS
  'Substitui todos os roles de um usuário por p_role em uma transação.  '
  'Chamada exclusivamente pela edge function criar-usuario (service_role).';
