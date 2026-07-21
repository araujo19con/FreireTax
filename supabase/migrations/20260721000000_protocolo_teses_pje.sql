-- =========================================================================
-- Protocolo padrão de ANÁLISE DE TESES no PJe, disparado pela UI.
--
-- O scraper roda LOCAL (precisa do certificado A3 no Chrome real), então a UI
-- não executa nada: ela ENFILEIRA o pedido. O tool `pje_teses_empresa.py --fila`
-- consome as pendências, roda o protocolo e escreve o resultado de volta em
-- empresa_processos_tributarios + o status aqui.
--
-- Protocolo padrão (graus): 1gf,2gf (TRF5 PJe 2.x) + 1x (PJe 1.x da Seção
-- Judiciária da UF da empresa: jfrn/jfpb/jfpe/jfal/jfse/jfce).
-- =========================================================================

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS teses_status text NOT NULL DEFAULT 'nao_analisado',
  ADD COLUMN IF NOT EXISTS teses_solicitada_em timestamptz,
  ADD COLUMN IF NOT EXISTS teses_solicitada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS teses_analisada_em timestamptz,
  ADD COLUMN IF NOT EXISTS teses_erro text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresas_teses_status_chk') THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT empresas_teses_status_chk
      CHECK (teses_status IN ('nao_analisado','pendente','processando','concluido','erro'));
  END IF;
END $$;

COMMENT ON COLUMN public.empresas.teses_status IS
  'Protocolo de análise de teses no PJe: nao_analisado -> (UI pede) pendente -> processando -> concluido|erro.';

-- fila: só as pendentes, na ordem do pedido
CREATE INDEX IF NOT EXISTS idx_empresas_teses_fila
  ON public.empresas(teses_solicitada_em)
  WHERE teses_status = 'pendente';
