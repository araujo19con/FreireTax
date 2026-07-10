-- =========================================================================
-- Histórico de mudança de etapa da prospecção (kanban) — registra toda
-- transição de status_prospeccao pra permitir medir tempo em cada etapa,
-- auditoria de quem moveu o card e quando.
--
-- RECONSTRUÍDA (09/07/2026): esta migration foi aplicada direto em produção
-- em 07/07/2026 sem o arquivo local correspondente ter sido commitado
-- (drift descoberto ao tentar `supabase db push` de outra feature). Conteúdo
-- reconstruído a partir da definição real em prod via introspecção
-- (pg_get_constraintdef/pg_get_triggerdef/prosrc) — reflete o que já está
-- rodando, não uma mudança nova.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.prospeccao_historico_etapa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id   uuid NOT NULL REFERENCES public.prospeccoes(id) ON DELETE CASCADE,
  status_anterior text,                     -- NULL no primeiro registro (INSERT da prospecção)
  status_novo     text NOT NULL,
  changed_by      uuid REFERENCES public.profiles(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_etapa_prosp_data
  ON public.prospeccao_historico_etapa(prospeccao_id, changed_at);

ALTER TABLE public.prospeccao_historico_etapa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hist_etapa_select" ON public.prospeccao_historico_etapa;
CREATE POLICY "hist_etapa_select"
  ON public.prospeccao_historico_etapa FOR SELECT TO authenticated USING (true);

-- -------------------------------------------------------------------------
-- Trigger: grava um registro no INSERT da prospecção (status inicial) e a
-- cada UPDATE que efetivamente muda status_prospeccao. SECURITY DEFINER
-- pra gravar independente da RLS de quem disparou (não há policy de INSERT
-- — só o trigger escreve nessa tabela).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_prospeccao_etapa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  AFTER INSERT OR UPDATE OF status_prospeccao ON public.prospeccoes
  FOR EACH ROW EXECUTE FUNCTION public.log_prospeccao_etapa();
