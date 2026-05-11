-- ============================================================
-- Restaura nomes truncados (primeira letra cortada) + re-dedup
-- ============================================================
-- Bug histórico: alguma importação cortou a primeira letra do nome de
-- 144+ empresas (ex: "ORTENG ENGENHARIA" deveria ser "NORTENG...").
-- O enrichment RFB preservou o nome correto em razao_social.
--
-- Esta migration:
--   1. Para empresas com razao_social presente E nome aparenta truncado
--      (length(razao_social) = length(nome) + 1 E o sufixo bate),
--      copia razao_social pro nome. Cobre os 144 casos.
--   2. Fallback: empresas sem razao_social que tem um "par" no banco
--      com 1 letra a mais e mesma "cauda" (ex: 'ORTENG' tem par 'NORTENG').
--      Restaura pelo par.
--   3. Após restauração, empresas que viraram homônimas vão precisar de
--      dedup (caso Norteng: a antiga com CNPJ + a nova sem CNPJ ficam
--      com mesmo nome). Mergea preferindo a que TEM CNPJ como canônica.
--   4. Reaponta FKs dinamicamente via information_schema (mesma técnica
--      da mig 20260512000000).
--
-- Idempotente: roda 2x sem efeito (segundo passe não encontra padrão).
-- ============================================================

-- ============================================================
-- 1. Restaura nome via razao_social (caso dominante: 144 empresas)
-- ============================================================
DO $$
DECLARE
  v_affected int;
BEGIN
  UPDATE public.empresas
  SET nome = razao_social
  WHERE razao_social IS NOT NULL
    AND nome IS NOT NULL
    AND length(razao_social) = length(nome) + 1
    AND upper(substr(razao_social, 2)) = upper(nome);
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE '[restore] Nomes restaurados via razao_social: %', v_affected;
END $$;


-- ============================================================
-- 2. Fallback: restaura nome via "par no banco" pra empresas
--    sem razao_social mas que tem outra empresa com 1 letra a mais
--    no início + mesma cauda
-- ============================================================
DO $$
DECLARE
  v_affected int;
BEGIN
  -- Caso simétrico: existe alguma empresa cujo nome é "1 letra + nome_atual".
  -- Pega a forma "longa" mais frequente (caso houver múltiplos candidatos).
  WITH candidates AS (
    SELECT
      short.id AS short_id,
      long.nome AS long_nome,
      ROW_NUMBER() OVER (PARTITION BY short.id ORDER BY long.created_at) AS rn
    FROM public.empresas short
    JOIN public.empresas long
      ON length(long.nome) = length(short.nome) + 1
     AND upper(substr(long.nome, 2)) = upper(short.nome)
     AND long.id <> short.id
    WHERE short.razao_social IS NULL
      AND short.nome IS NOT NULL
  )
  UPDATE public.empresas e
  SET nome = c.long_nome
  FROM candidates c
  WHERE e.id = c.short_id AND c.rn = 1;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RAISE NOTICE '[restore] Nomes restaurados via par no banco: %', v_affected;
END $$;


-- ============================================================
-- 3. Dedup das homônimas resultantes (empresas com mesmo
--    upper(trim(nome)) após restauração)
-- ============================================================
-- Critério da canônica:
--   1. A que tem CNPJ (preserva enrichment) > sem CNPJ
--   2. Em empate, a mais antiga
-- Segurança: SÓ mergeia pares onde uma delas tem cnpj IS NULL,
-- pra evitar mergear matriz/filial com CNPJs distintos válidos.
-- ============================================================
DO $$
DECLARE
  v_fk record;
  v_pairs int;
  v_affected int;
BEGIN
  CREATE TEMP TABLE _empresa_dups_nome ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      id,
      cnpj,
      nome,
      razao_social,
      created_at,
      upper(trim(nome)) AS nome_norm,
      ROW_NUMBER() OVER (
        PARTITION BY upper(trim(nome))
        ORDER BY
          -- 1. preferir quem tem CNPJ
          (cnpj IS NULL)::int ASC,
          -- 2. depois, mais antiga
          created_at ASC,
          id ASC
      ) AS rn,
      COUNT(*) OVER (PARTITION BY upper(trim(nome))) AS qty,
      COUNT(*) FILTER (WHERE cnpj IS NULL) OVER (PARTITION BY upper(trim(nome))) AS qty_sem_cnpj
    FROM public.empresas
    WHERE nome IS NOT NULL AND trim(nome) <> ''
  ),
  -- Pares onde pelo menos UMA tem cnpj NULL (não mergea matriz/filial)
  safe_groups AS (
    SELECT DISTINCT nome_norm FROM ranked WHERE qty > 1 AND qty_sem_cnpj >= 1
  )
  SELECT
    c.id   AS canonical_id,
    d.id   AS duplicate_id,
    c.nome AS canonical_nome,
    d.nome AS duplicate_nome,
    c.cnpj AS canonical_cnpj,
    d.cnpj AS duplicate_cnpj
  FROM ranked c
  JOIN ranked d
    ON c.nome_norm = d.nome_norm
   AND c.rn = 1
   AND d.rn > 1
  WHERE c.nome_norm IN (SELECT nome_norm FROM safe_groups);

  SELECT COUNT(*) INTO v_pairs FROM _empresa_dups_nome;
  RAISE NOTICE '[redupe] Pares por nome (canon, duplicate) — só onde alguma tem CNPJ NULL: %', v_pairs;

  IF v_pairs = 0 THEN
    RAISE NOTICE '[redupe] Nada a fazer.';
  ELSE
    -- 3a. PREVENTIVO em FKs com UNIQUE multi-coluna --------------

    -- Reaponta prospeccoes via elegibilidade canon antes de deletar
    -- elegibilidades conflitantes (mesma estratégia da mig 20260512)
    UPDATE public.prospeccoes p
    SET elegibilidade_id = canon_eleg.id
    FROM _empresa_dups_nome d
    JOIN public.elegibilidade dup_eleg ON dup_eleg.empresa_id = d.duplicate_id
    JOIN public.elegibilidade canon_eleg
      ON canon_eleg.empresa_id = d.canonical_id
     AND canon_eleg.acao_id    = dup_eleg.acao_id
    WHERE p.elegibilidade_id = dup_eleg.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[redupe]   prospeccoes reapontadas pra eleg canônica: %', v_affected;

    -- processos (defensivo)
    IF to_regclass('public.processos') IS NOT NULL THEN
      EXECUTE $sql$
        UPDATE public.processos pr
        SET elegibilidade_id = canon_eleg.id
        FROM _empresa_dups_nome d
        JOIN public.elegibilidade dup_eleg ON dup_eleg.empresa_id = d.duplicate_id
        JOIN public.elegibilidade canon_eleg
          ON canon_eleg.empresa_id = d.canonical_id
         AND canon_eleg.acao_id    = dup_eleg.acao_id
        WHERE pr.elegibilidade_id = dup_eleg.id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[redupe]   processos reapontados: %', v_affected;
    END IF;

    -- elegibilidade_respostas (defensivo)
    IF to_regclass('public.elegibilidade_respostas') IS NOT NULL THEN
      EXECUTE $sql$
        DELETE FROM public.elegibilidade_respostas r
        USING _empresa_dups_nome d, public.elegibilidade dup_eleg,
              public.elegibilidade canon_eleg, public.elegibilidade_respostas rc
        WHERE r.elegibilidade_id = dup_eleg.id
          AND dup_eleg.empresa_id = d.duplicate_id
          AND canon_eleg.empresa_id = d.canonical_id
          AND canon_eleg.acao_id    = dup_eleg.acao_id
          AND rc.elegibilidade_id = canon_eleg.id
          AND rc.criterio_id      = r.criterio_id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[redupe]   respostas conflitantes removidas: %', v_affected;

      EXECUTE $sql$
        UPDATE public.elegibilidade_respostas r
        SET elegibilidade_id = canon_eleg.id
        FROM _empresa_dups_nome d
        JOIN public.elegibilidade dup_eleg ON dup_eleg.empresa_id = d.duplicate_id
        JOIN public.elegibilidade canon_eleg
          ON canon_eleg.empresa_id = d.canonical_id
         AND canon_eleg.acao_id    = dup_eleg.acao_id
        WHERE r.elegibilidade_id = dup_eleg.id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[redupe]   respostas reapontadas: %', v_affected;
    END IF;

    -- Deleta elegibilidades conflitantes (mesma (empresa, acao) na canon)
    DELETE FROM public.elegibilidade e
    USING _empresa_dups_nome d, public.elegibilidade ec
    WHERE e.empresa_id = d.duplicate_id
      AND ec.empresa_id = d.canonical_id
      AND ec.acao_id = e.acao_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[redupe]   elegibilidade: % linhas conflitantes removidas', v_affected;

    -- pasta_empresa_items (UNIQUE(pasta_id, empresa_id))
    DELETE FROM public.pasta_empresa_items p
    USING _empresa_dups_nome d, public.pasta_empresa_items pc
    WHERE p.empresa_id = d.duplicate_id
      AND pc.empresa_id = d.canonical_id
      AND pc.pasta_id = p.pasta_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[redupe]   pasta_empresa_items: % linhas conflitantes removidas', v_affected;

    -- 3b. Reaponta FKs dinamicamente
    FOR v_fk IN
      SELECT tc.table_schema, tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type   = 'FOREIGN KEY'
        AND ccu.table_schema     = 'public'
        AND ccu.table_name       = 'empresas'
        AND ccu.column_name      = 'id'
        AND tc.table_schema      = 'public'
    LOOP
      EXECUTE format(
        'UPDATE %I.%I AS t SET %I = d.canonical_id '
        'FROM _empresa_dups_nome d WHERE t.%I = d.duplicate_id',
        v_fk.table_schema, v_fk.table_name, v_fk.column_name, v_fk.column_name
      );
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[redupe]   FK %.%.%: % linhas reapontadas',
                   v_fk.table_schema, v_fk.table_name, v_fk.column_name, v_affected;
    END LOOP;

    -- 3c. Preenche campos NULL da canônica com valores não-NULL da dup
    UPDATE public.empresas c
    SET
      cnpj                  = COALESCE(c.cnpj,                 dup.cnpj),
      razao_social          = COALESCE(c.razao_social,         dup.razao_social),
      nome_fantasia         = COALESCE(c.nome_fantasia,        dup.nome_fantasia),
      situacao_cadastral    = COALESCE(c.situacao_cadastral,   dup.situacao_cadastral),
      porte                 = COALESCE(c.porte,                dup.porte),
      uf                    = COALESCE(c.uf,                   dup.uf),
      municipio             = COALESCE(c.municipio,            dup.municipio),
      cnae_principal        = COALESCE(c.cnae_principal,       dup.cnae_principal),
      cnae_principal_desc   = COALESCE(c.cnae_principal_desc,  dup.cnae_principal_desc),
      capital_social        = COALESCE(c.capital_social,       dup.capital_social),
      opcao_simples         = COALESCE(c.opcao_simples,        dup.opcao_simples),
      opcao_mei             = COALESCE(c.opcao_mei,            dup.opcao_mei),
      data_abertura         = COALESCE(c.data_abertura,        dup.data_abertura),
      natureza_juridica     = COALESCE(c.natureza_juridica,    dup.natureza_juridica),
      email_receita         = COALESCE(c.email_receita,        dup.email_receita),
      telefone_receita      = COALESCE(c.telefone_receita,     dup.telefone_receita),
      receita_atualizada_em = COALESCE(c.receita_atualizada_em, dup.receita_atualizada_em),
      regime_tributario     = COALESCE(c.regime_tributario,    dup.regime_tributario),
      quantidade_funcionarios = COALESCE(c.quantidade_funcionarios, dup.quantidade_funcionarios),
      faturamento_anual     = COALESCE(c.faturamento_anual,    dup.faturamento_anual),
      metadados             = COALESCE(c.metadados,            dup.metadados)
    FROM _empresa_dups_nome d
    JOIN public.empresas dup ON dup.id = d.duplicate_id
    WHERE c.id = d.canonical_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[redupe] Canônicas enriquecidas: %', v_affected;

    -- 3d. Deleta duplicatas
    DELETE FROM public.empresas e
    USING _empresa_dups_nome d
    WHERE e.id = d.duplicate_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[redupe] Empresas duplicadas (por nome) deletadas: %', v_affected;
  END IF;
END $$;
