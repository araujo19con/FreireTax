-- Remove duplicatas em elegibilidade(empresa_id, acao_id) e adiciona UNIQUE constraint
-- pra evitar reincidência em futuros imports.

-- 1. Tabela temp com a row "canonical" de cada par (empresa_id, acao_id).
-- Prioridade: tem prospeccao > tem processo > eleg=true > mais antiga.
CREATE TEMP TABLE _eleg_canonical AS
SELECT id AS canonical_id, empresa_id, acao_id
FROM (
  SELECT
    e.id,
    e.empresa_id,
    e.acao_id,
    ROW_NUMBER() OVER (
      PARTITION BY e.empresa_id, e.acao_id
      ORDER BY
        (EXISTS(SELECT 1 FROM public.prospeccoes p WHERE p.elegibilidade_id = e.id))::int DESC,
        (EXISTS(SELECT 1 FROM public.processos pr WHERE pr.elegibilidade_id = e.id))::int DESC,
        (e.elegivel)::int DESC,
        e.created_at ASC
    ) AS rn
  FROM public.elegibilidade e
) ranked
WHERE rn = 1;

-- 2. Reaponta prospeccoes pra elegibilidade canonical antes de deletar duplicatas
UPDATE public.prospeccoes p
SET elegibilidade_id = c.canonical_id
FROM public.elegibilidade e
JOIN _eleg_canonical c
  ON c.empresa_id = e.empresa_id AND c.acao_id = e.acao_id
WHERE p.elegibilidade_id = e.id
  AND e.id <> c.canonical_id;

-- 3. Reaponta processos pra elegibilidade canonical
UPDATE public.processos pr
SET elegibilidade_id = c.canonical_id
FROM public.elegibilidade e
JOIN _eleg_canonical c
  ON c.empresa_id = e.empresa_id AND c.acao_id = e.acao_id
WHERE pr.elegibilidade_id = e.id
  AND e.id <> c.canonical_id;

-- 4. Deleta as elegibilidades duplicadas
DELETE FROM public.elegibilidade e
USING _eleg_canonical c
WHERE c.empresa_id = e.empresa_id
  AND c.acao_id = e.acao_id
  AND e.id <> c.canonical_id;

DROP TABLE _eleg_canonical;

-- 5. Adiciona UNIQUE constraint (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'elegibilidade_empresa_acao_unique'
      AND conrelid = 'public.elegibilidade'::regclass
  ) THEN
    ALTER TABLE public.elegibilidade
      ADD CONSTRAINT elegibilidade_empresa_acao_unique
      UNIQUE (empresa_id, acao_id);
  END IF;
END $$;
