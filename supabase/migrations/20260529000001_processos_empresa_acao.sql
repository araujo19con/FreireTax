-- Adiciona empresa_id e acao_id diretamente em processos.
-- Mesmo padrão da migration 20260527000000 para prospeccoes.
--
-- processos só tinha elegibilidade_id, forçando um JOIN duplo para
-- chegar em empresa/ação em cada query de dashboard e painel de ações.
--
-- Estratégia idêntica: nullable → backfill → NOT NULL → índice.

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS acao_id    uuid REFERENCES public.acoes_tributarias(id) ON DELETE CASCADE;

UPDATE public.processos p
SET
  empresa_id = e.empresa_id,
  acao_id    = e.acao_id
FROM public.elegibilidade e
WHERE e.id = p.elegibilidade_id
  AND (p.empresa_id IS NULL OR p.acao_id IS NULL);

ALTER TABLE public.processos
  ALTER COLUMN empresa_id SET NOT NULL,
  ALTER COLUMN acao_id    SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processos_empresa_acao
  ON public.processos (empresa_id, acao_id);
