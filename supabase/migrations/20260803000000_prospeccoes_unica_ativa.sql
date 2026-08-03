-- =========================================================================
-- Unicidade de prospecção ATIVA por (empresa_id, acao_id).
--
-- Problema: prospeccoes só tinha índice NÃO-único (20260527000000). Vários
-- caminhos de escrita (ProspeccaoRapidaDialog, useQualificacao, Kanban, import)
-- podiam criar 2+ prospecções da MESMA (empresa, tese) — duplo clique, race,
-- reabertura. Isso duplica cards no funil, tarefas "Contato inicial" e propostas.
--
-- Decisão do produto: no MÁXIMO uma prospecção ATIVA por (empresa, tese); mas
-- PERMITIR reabrir depois de "Perdido" (histórico). -> índice único PARCIAL
-- WHERE status_prospeccao <> 'Perdido'.
--
-- Antes do índice, é preciso desduplicar as ativas já existentes: escolhe a
-- CANÔNICA (mais recente), reaponta filhos (tarefas/reuniões/honorários/propostas/
-- prazos/histórico) e apaga as duplicatas ativas. Rows 'Perdido' não conflitam
-- e ficam intactas. Empacotado num DO block (idempotente; SQL Editor roda
-- statements em conexões separadas).
-- =========================================================================
DO $$
DECLARE
  dups int;
BEGIN
  -- 0. Nada a fazer se o índice já existe (idempotência de re-run).
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uq_prospeccoes_empresa_acao_ativa') THEN
    RETURN;
  END IF;

  -- 1. Canônica de cada par (empresa_id, acao_id) ENTRE AS ATIVAS (<> 'Perdido').
  --    Prioridade: mais recentemente atualizada; desempate por created_at.
  CREATE TEMP TABLE _prosp_canonical ON COMMIT DROP AS
  SELECT id AS canonical_id, empresa_id, acao_id
  FROM (
    SELECT p.id, p.empresa_id, p.acao_id,
      ROW_NUMBER() OVER (
        PARTITION BY p.empresa_id, p.acao_id
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
      ) AS rn
    FROM public.prospeccoes p
    WHERE COALESCE(p.status_prospeccao, '') <> 'Perdido'
      AND p.empresa_id IS NOT NULL AND p.acao_id IS NOT NULL
  ) r
  WHERE rn = 1;

  SELECT count(*) INTO dups
  FROM public.prospeccoes p
  JOIN _prosp_canonical c ON c.empresa_id = p.empresa_id AND c.acao_id = p.acao_id
  WHERE COALESCE(p.status_prospeccao, '') <> 'Perdido' AND p.id <> c.canonical_id;
  RAISE NOTICE 'prospeccoes ativas duplicadas a desduplicar: %', dups;

  -- 2. Reaponta filhos com FK SET NULL (preserva os registros).
  UPDATE public.tarefas t SET prospeccao_id = c.canonical_id
    FROM public.prospeccoes d JOIN _prosp_canonical c
      ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
    WHERE t.prospeccao_id = d.id AND d.id <> c.canonical_id
      AND COALESCE(d.status_prospeccao,'') <> 'Perdido';

  UPDATE public.reunioes rn SET prospeccao_id = c.canonical_id
    FROM public.prospeccoes d JOIN _prosp_canonical c
      ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
    WHERE rn.prospeccao_id = d.id AND d.id <> c.canonical_id
      AND COALESCE(d.status_prospeccao,'') <> 'Perdido';

  IF to_regclass('public.honorarios_lancamentos') IS NOT NULL THEN
    UPDATE public.honorarios_lancamentos h SET prospeccao_id = c.canonical_id
      FROM public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE h.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido';
  END IF;

  -- 3. Filhos com FK CASCADE: reaponta pra não perder no delete.
  --    propostas tem UNIQUE(prospeccao_id) -> se a canônica já tem proposta,
  --    apaga a da duplicata; senão reaponta.
  IF to_regclass('public.propostas') IS NOT NULL THEN
    DELETE FROM public.propostas pr
      USING public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE pr.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido'
        AND EXISTS (SELECT 1 FROM public.propostas pc WHERE pc.prospeccao_id = c.canonical_id);
    UPDATE public.propostas pr SET prospeccao_id = c.canonical_id
      FROM public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE pr.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido';
  END IF;

  IF to_regclass('public.prazos_processuais') IS NOT NULL THEN
    UPDATE public.prazos_processuais pz SET prospeccao_id = c.canonical_id
      FROM public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE pz.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido';
  END IF;

  IF to_regclass('public.prospeccao_historico') IS NOT NULL THEN
    UPDATE public.prospeccao_historico ph SET prospeccao_id = c.canonical_id
      FROM public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE ph.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido';
  END IF;

  IF to_regclass('public.prospeccao_contatos') IS NOT NULL THEN
    UPDATE public.prospeccao_contatos pcn SET prospeccao_id = c.canonical_id
      FROM public.prospeccoes d JOIN _prosp_canonical c
        ON c.empresa_id = d.empresa_id AND c.acao_id = d.acao_id
      WHERE pcn.prospeccao_id = d.id AND d.id <> c.canonical_id
        AND COALESCE(d.status_prospeccao,'') <> 'Perdido';
  END IF;

  -- 4. Apaga as prospecções ATIVAS duplicadas (as 'Perdido' ficam).
  DELETE FROM public.prospeccoes p
    USING _prosp_canonical c
    WHERE c.empresa_id = p.empresa_id AND c.acao_id = p.acao_id
      AND p.id <> c.canonical_id
      AND COALESCE(p.status_prospeccao,'') <> 'Perdido';

  -- 5. Índice único PARCIAL: uma prospecção ATIVA por (empresa, tese).
  CREATE UNIQUE INDEX uq_prospeccoes_empresa_acao_ativa
    ON public.prospeccoes (empresa_id, acao_id)
    WHERE status_prospeccao <> 'Perdido';
END $$;

COMMENT ON INDEX public.uq_prospeccoes_empresa_acao_ativa IS
  'No máximo UMA prospecção ativa por (empresa_id, acao_id). Permite reabrir após Perdido. Use upsert on_conflict=(empresa_id,acao_id) where status<>Perdido nos inserts.';
