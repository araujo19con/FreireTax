-- Remove elegibilidades órfãs onde a empresa foi deletada mas o CASCADE não disparou.
-- As prospecções vinculadas via elegibilidade_id ON DELETE CASCADE são removidas
-- automaticamente junto.
-- Idempotente — executa 0 deletes se não houver órfãos.
DELETE FROM public.elegibilidade e
WHERE NOT EXISTS (
  SELECT 1 FROM public.empresas emp WHERE emp.id = e.empresa_id
);

-- Garante que elegibilidade.empresa_id tem ON DELETE CASCADE.
-- Recria o constraint caso esteja sem CASCADE (nome gerado pelo Postgres).
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.elegibilidade'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.elegibilidade'::regclass
         AND attname = 'empresa_id')
    ]::smallint[];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.elegibilidade DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.elegibilidade
    ADD CONSTRAINT elegibilidade_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
END $$;
