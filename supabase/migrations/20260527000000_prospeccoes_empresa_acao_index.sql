-- Index composto em prospeccoes(empresa_id, acao_id).
--
-- Várias queries filtram por esse par (AcaoEmpresasPanel:245, useQualificacao:246),
-- mas a tabela só tinha indexes em (elegibilidade_id), (user_id), (responsavel_id).
-- Pares (empresa_id, acao_id) caíam em seq-scan quando a tabela cresce.
--
-- Aplicar com `supabase db push` ou colar no SQL Editor. CONCURRENTLY pra não
-- bloquear o pool de prospecções em uso.

CREATE INDEX IF NOT EXISTS idx_prospeccoes_empresa_acao
  ON public.prospeccoes (empresa_id, acao_id);

COMMENT ON INDEX public.idx_prospeccoes_empresa_acao IS
  'Suporta lookup por (empresa_id, acao_id) — usado nos painéis de ação e qualificação. Substitui o padrão de derivar via elegibilidade_id (legacy).';
