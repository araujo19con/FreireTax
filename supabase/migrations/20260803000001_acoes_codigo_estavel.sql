-- =========================================================================
-- `codigo` ESTÁVEL da tese — contrato entre o catálogo e a DETECÇÃO.
--
-- Problema: tools/pje_teses_empresa.py casava "tese detectada -> acao_id" pelo
-- NOME normalizado da tese. Renomear/fundir/corrigir o nome de uma tese no
-- catálogo quebrava a classificação EM SILÊNCIO (a regra virava "fora do
-- catálogo" e o processo deixava de ser cravado).
--
-- Solução: `codigo` (slug) é o identificador ESTÁVEL. O `nome` vira só rótulo
-- (pode mudar à vontade); a detecção casa por `codigo`, que nunca muda. Semeado
-- uma vez por tools/seed_codigos_teses.py (match por nome atual -> codigo).
--
-- Índice único PARCIAL: `codigo` é único quando preenchido, mas NULL é permitido
-- (teses sem regra de detecção não precisam de codigo).
-- =========================================================================
ALTER TABLE public.acoes_tributarias
  ADD COLUMN IF NOT EXISTS codigo text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_acoes_tributarias_codigo
  ON public.acoes_tributarias (codigo)
  WHERE codigo IS NOT NULL;

COMMENT ON COLUMN public.acoes_tributarias.codigo IS
  'Identificador ESTÁVEL da tese (slug). Contrato com a detecção (pje_teses_empresa.py). O nome pode ser renomeado; o codigo NÃO — não reaproveitar entre teses.';
