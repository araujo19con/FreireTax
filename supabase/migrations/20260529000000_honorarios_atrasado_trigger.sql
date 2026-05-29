-- Garante que honorarios_lancamentos.status reflita a realidade no banco.
-- Antes, status era derivado apenas no frontend (autoStatus em Financeiro.tsx).
-- Agora o DB é fonte de verdade: trigger na insert + função de batch diária.

-- 1. Função batch: marca todos os pendentes cujo vencimento já passou.
--    Chamada pela edge function verificar-prazos (cron 8h) e pode ser
--    invocada manualmente pelo admin via RPC.
CREATE OR REPLACE FUNCTION public.marcar_honorarios_atrasados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE honorarios_lancamentos
  SET    status = 'atrasado',
         updated_at = now()
  WHERE  status = 'pendente'
    AND  data_vencimento < CURRENT_DATE;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.marcar_honorarios_atrasados() IS
  'Marca como atrasado todo lançamento pendente com data_vencimento < hoje. '
  'Chamada diariamente pela edge function verificar-prazos.';

-- 2. Trigger: ao inserir um lançamento já vencido, marca diretamente.
--    Evita que um insert com data_vencimento no passado fique como pendente.
CREATE OR REPLACE FUNCTION public.check_honorario_atrasado_on_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pendente' AND NEW.data_vencimento < CURRENT_DATE THEN
    NEW.status := 'atrasado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER honorario_atrasado_on_insert
  BEFORE INSERT ON public.honorarios_lancamentos
  FOR EACH ROW EXECUTE FUNCTION public.check_honorario_atrasado_on_insert();

-- 3. Roda uma vez agora para corrigir registros já existentes no banco.
SELECT public.marcar_honorarios_atrasados();
