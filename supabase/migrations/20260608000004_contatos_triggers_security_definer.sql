-- =========================================================================
-- Triggers de denormalização de contatos como SECURITY DEFINER.
--
-- Os triggers de empresa_contatos atualizam `empresas` (snapshot do contato
-- principal) e `empresa_contatos` (principal único). Rodando como invoker,
-- esses writes ficam sujeitos ao RLS de quem disparou — então um comercial
-- inserindo contato numa empresa de OUTRO responsável (via UI ou import DRIVA)
-- teria o UPDATE em empresas barrado pelo RLS, e o INSERT do contato falharia.
--
-- SECURITY DEFINER + search_path fixo resolve: a denormalização sempre roda,
-- independente do RLS do usuário (o RLS de quem PODE inserir o contato continua
-- valendo no insert em si).
-- =========================================================================

ALTER FUNCTION public.recalc_empresa_contatos_cache()  SECURITY DEFINER;
ALTER FUNCTION public.recalc_empresa_contatos_cache()  SET search_path = public;

ALTER FUNCTION public.ensure_single_contato_principal() SECURITY DEFINER;
ALTER FUNCTION public.ensure_single_contato_principal() SET search_path = public;

ALTER FUNCTION public.derive_contatos_from_rfb()        SECURITY DEFINER;
ALTER FUNCTION public.derive_contatos_from_rfb()        SET search_path = public;
