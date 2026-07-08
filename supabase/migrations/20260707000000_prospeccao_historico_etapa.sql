-- =========================================================================
-- Histórico de transição de etapa da prospecção.
--
-- Registra CADA mudança de status_prospeccao (e a criação inicial), com quem
-- mudou e quando. Habilita métricas reais de:
--   - dias médios em cada etapa (v_ciclo_medio_etapa)
--   - ciclo total de fechamento por negócio (v_prospeccao_ciclo)
--   - quanto tempo um negócio está PARADO na etapa atual
--
-- Até aqui o funil só tinha data_assinatura; a duração por etapa era estimada.
-- Agora é medida. Não altera nenhuma lógica existente — só observa.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Tabela append-only de transições
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospeccao_historico_etapa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id   uuid NOT NULL REFERENCES public.prospeccoes(id) ON DELETE CASCADE,
  status_anterior text,                       -- null na criação
  status_novo     text NOT NULL,
  changed_by      uuid REFERENCES public.profiles(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_etapa_prosp_data
  ON public.prospeccao_historico_etapa (prospeccao_id, changed_at);

-- -------------------------------------------------------------------------
-- Trigger: loga criação e cada troca de status_prospeccao
-- SECURITY DEFINER para inserir no histórico independente da RLS da tabela.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_prospeccao_etapa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.prospeccao_historico_etapa
      (prospeccao_id, status_anterior, status_novo, changed_by, changed_at)
    VALUES
      (NEW.id, NULL, NEW.status_prospeccao, auth.uid(), COALESCE(NEW.created_at, now()));
    RETURN NEW;
  END IF;

  -- UPDATE: só registra se o status realmente mudou
  IF NEW.status_prospeccao IS DISTINCT FROM OLD.status_prospeccao THEN
    INSERT INTO public.prospeccao_historico_etapa
      (prospeccao_id, status_anterior, status_novo, changed_by, changed_at)
    VALUES
      (NEW.id, OLD.status_prospeccao, NEW.status_prospeccao, auth.uid(), now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_prospeccao_etapa ON public.prospeccoes;
CREATE TRIGGER trg_log_prospeccao_etapa
  AFTER INSERT OR UPDATE OF status_prospeccao
  ON public.prospeccoes
  FOR EACH ROW EXECUTE FUNCTION public.log_prospeccao_etapa();

-- -------------------------------------------------------------------------
-- Backfill: semeia uma linha inicial por prospecção existente, usando
-- created_at como marco de entrada. Assim as views já têm um ponto de partida
-- (ciclo será exato daqui pra frente; o passado é aproximado por created_at).
-- -------------------------------------------------------------------------
INSERT INTO public.prospeccao_historico_etapa
  (prospeccao_id, status_anterior, status_novo, changed_at)
SELECT p.id, NULL, p.status_prospeccao, COALESCE(p.created_at, now())
FROM public.prospeccoes p
WHERE NOT EXISTS (
  SELECT 1 FROM public.prospeccao_historico_etapa h WHERE h.prospeccao_id = p.id
);

-- -------------------------------------------------------------------------
-- RLS: leitura para autenticados (mesma política do prospeccoes_select =
-- USING(true); o recorte "meu trabalho" é feito no client). Inserção só via
-- trigger SECURITY DEFINER — nenhuma policy de INSERT para usuários.
-- -------------------------------------------------------------------------
ALTER TABLE public.prospeccao_historico_etapa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hist_etapa_select" ON public.prospeccao_historico_etapa;
CREATE POLICY "hist_etapa_select" ON public.prospeccao_historico_etapa
  FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------
-- View: estado de ciclo por prospecção (dias na etapa atual + ciclo total)
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_prospeccao_ciclo AS
WITH marcos AS (
  SELECT prospeccao_id,
         min(changed_at) AS primeiro_em,   -- entrada no funil
         max(changed_at) AS entrou_etapa_em -- entrada na etapa atual
  FROM public.prospeccao_historico_etapa
  GROUP BY prospeccao_id
)
SELECT p.id AS prospeccao_id,
       p.empresa_id,
       p.acao_id,
       p.status_prospeccao,
       m.primeiro_em,
       m.entrou_etapa_em,
       round(EXTRACT(epoch FROM (now() - m.entrou_etapa_em)) / 86400.0, 1) AS dias_na_etapa_atual,
       CASE
         WHEN p.status_prospeccao IN ('Contrato assinado', 'Serviço iniciado')
         THEN round(
                EXTRACT(epoch FROM (
                  COALESCE(p.data_assinatura::timestamptz, m.entrou_etapa_em) - m.primeiro_em
                )) / 86400.0, 1)
       END AS dias_ciclo_total
FROM public.prospeccoes p
JOIN marcos m ON m.prospeccao_id = p.id;

-- -------------------------------------------------------------------------
-- View: dias médios gastos em cada etapa antes de avançar (usa lead())
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ciclo_medio_etapa AS
WITH seq AS (
  SELECT prospeccao_id,
         status_novo,
         changed_at,
         lead(changed_at) OVER (PARTITION BY prospeccao_id ORDER BY changed_at) AS proximo_em
  FROM public.prospeccao_historico_etapa
)
SELECT status_novo AS etapa,
       count(*) FILTER (WHERE proximo_em IS NOT NULL) AS transicoes,
       round(
         avg(EXTRACT(epoch FROM (proximo_em - changed_at)) / 86400.0)
           FILTER (WHERE proximo_em IS NOT NULL)::numeric, 1
       ) AS dias_medios_na_etapa
FROM seq
GROUP BY status_novo;
