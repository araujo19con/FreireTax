-- Classifica tipo_telefone (fixo/movel) a partir do número, pra permitir
-- filtrar "só celular pessoal" na tela de Contatos.
--
-- Hoje a coluna empresa_contatos.tipo_telefone fica 'desconhecido' (o
-- skiptrace PJe e os imports não setam). Regra espelha src/lib/contatos.ts
-- (pareceCelular/formatPhoneBR): no BR, 11 dígitos (DDD + 9) = celular,
-- 10 dígitos = fixo. Tira o código de país 55 só quando claramente presente
-- (>= 12 dígitos), pra não quebrar DDD 55.

CREATE OR REPLACE FUNCTION public.infere_tipo_telefone(tel text)
RETURNS public.tipo_telefone
LANGUAGE sql IMMUTABLE AS $$
  WITH r AS (
    SELECT regexp_replace(COALESCE(tel, ''), '\D', '', 'g') AS d
  ), n AS (
    SELECT CASE WHEN length(d) >= 12 AND left(d, 2) = '55' THEN substr(d, 3) ELSE d END AS d
    FROM r
  )
  SELECT CASE
    WHEN length(d) = 11 THEN 'movel'::public.tipo_telefone            -- DDD + 9 dígitos
    WHEN length(d) = 10 THEN 'fixo'::public.tipo_telefone             -- DDD + 8 dígitos
    WHEN length(d) = 9 AND left(d, 1) = '9' THEN 'movel'::public.tipo_telefone
    WHEN length(d) = 8 THEN 'fixo'::public.tipo_telefone
    ELSE 'desconhecido'::public.tipo_telefone
  END
  FROM n
$$;

-- BEFORE trigger: classifica em toda escrita que mexe no telefone (ou quando
-- tipo ainda é 'desconhecido'), sem precisar o app/skiptrace setarem nada.
-- Respeita tipo setado explicitamente (não sobrescreve um 'movel'/'fixo' manual
-- se o telefone não mudou).
CREATE OR REPLACE FUNCTION public.set_tipo_telefone_auto()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.telefone IS NOT NULL AND NEW.telefone <> '' THEN
    IF TG_OP = 'INSERT'
       OR NEW.telefone IS DISTINCT FROM OLD.telefone
       OR NEW.tipo_telefone = 'desconhecido' THEN
      NEW.tipo_telefone := public.infere_tipo_telefone(NEW.telefone);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_tipo_telefone ON public.empresa_contatos;
CREATE TRIGGER trg_set_tipo_telefone
  BEFORE INSERT OR UPDATE OF telefone, tipo_telefone ON public.empresa_contatos
  FOR EACH ROW EXECUTE FUNCTION public.set_tipo_telefone_auto();

-- Índice pro filtro server-side (só celular) não escanear a tabela toda.
CREATE INDEX IF NOT EXISTS idx_empresa_contatos_tipo_telefone
  ON public.empresa_contatos (tipo_telefone)
  WHERE telefone IS NOT NULL;

-- Backfill. tipo_telefone NÃO faz parte do snapshot em empresas, então o
-- trigger AFTER de recalc é puro desperdício aqui (re-escreveria o mesmo
-- snapshot ~5k vezes). Desligo só durante o UPDATE — transacional: se a
-- migration falhar, o rollback restaura o trigger ligado.
ALTER TABLE public.empresa_contatos DISABLE TRIGGER trg_recalc_empresa_contatos;

UPDATE public.empresa_contatos
   SET tipo_telefone = public.infere_tipo_telefone(telefone)
 WHERE telefone IS NOT NULL AND telefone <> ''
   AND tipo_telefone IS DISTINCT FROM public.infere_tipo_telefone(telefone);

ALTER TABLE public.empresa_contatos ENABLE TRIGGER trg_recalc_empresa_contatos;
