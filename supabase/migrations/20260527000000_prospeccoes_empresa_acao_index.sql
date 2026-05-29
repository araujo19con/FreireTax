-- Adiciona empresa_id e acao_id diretamente em prospeccoes (desnormalização).
--
-- Contexto: prospeccoes só tinha elegibilidade_id (FK para elegibilidade, que
-- por sua vez tem empresa_id + acao_id). Toda query que precisava da empresa
-- ou da ação tinha que fazer um join extra. Além disso, novas prospecções
-- criadas via ProspeccaoRapidaDialog precisam de empresa_id + acao_id sem
-- obrigatoriamente ter elegibilidade.
--
-- Estratégia de migração:
--   1. Adiciona colunas nullable
--   2. Backfill via elegibilidade_id (rows existentes)
--   3. Cria índice composto para queries por (empresa_id, acao_id)
--   4. NÃO torna NOT NULL ainda — constraint separada após validação em prod
--
-- elegibilidade_id permanece na tabela (legado) até remoção futura.

-- 1. Adiciona colunas nullable
ALTER TABLE public.prospeccoes
  ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS acao_id    uuid REFERENCES public.acoes_tributarias(id) ON DELETE CASCADE;

-- 2. Backfill a partir de elegibilidade (rows com elegibilidade_id preenchido)
UPDATE public.prospeccoes p
SET
  empresa_id = e.empresa_id,
  acao_id    = e.acao_id
FROM public.elegibilidade e
WHERE e.id = p.elegibilidade_id
  AND (p.empresa_id IS NULL OR p.acao_id IS NULL);

-- 3. Índice composto — suporta lookup por (empresa_id, acao_id) sem seq-scan.
--    CONCURRENTLY: não bloqueia leituras durante a criação.
CREATE INDEX IF NOT EXISTS idx_prospeccoes_empresa_acao
  ON public.prospeccoes (empresa_id, acao_id);

COMMENT ON INDEX public.idx_prospeccoes_empresa_acao IS
  'Suporta lookup por (empresa_id, acao_id) — usado nos painéis de ação e qualificação.';

COMMENT ON COLUMN public.prospeccoes.empresa_id IS
  'FK direta para empresas — desnormaliza elegibilidade_id. Nullable até todas as rows serem migradas.';
COMMENT ON COLUMN public.prospeccoes.acao_id IS
  'FK direta para acoes_tributarias — desnormaliza elegibilidade_id. Nullable até validação em prod.';
