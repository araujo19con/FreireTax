-- ============================================================
-- Dedup empresas por CNPJ normalizado + barreira definitiva
-- ============================================================
-- Problema: a UNIQUE em empresas.cnpj compara strings literais.
-- Importações antigas salvaram CNPJ cru (XXXXXXXXXXXXXX) enquanto
-- o EmpresaDialog/Importacao novos salvam mascarado (XX.XXX.XXX/XXXX-XX).
-- Resultado: mesma empresa em 2 IDs, aparecendo duplicada nos painéis
-- de ações tributárias.
--
-- Esta migration:
--   1. Cria função normalize_cnpj_text() — padroniza formato mascarado
--   2. Mergeia pares de empresas com mesmo CNPJ digits
--      - Canônica = mais antiga (preserva enrichment RFB / histórico)
--      - Reaponta TODAS as FKs (lookup dinâmico em information_schema)
--      - Trata UNIQUE constraints conflitantes (elegibilidade,
--        pasta_empresa_items) deletando duplicatas conflitantes ANTES
--      - Se o nome da duplicata é mais longo E sem encoding quebrado,
--        atualiza o nome da canônica (caso "ATICINIO" → "LATICINIO")
--      - Preenche campos NULL da canônica com valores não-NULL da dup
--      - Deleta as duplicatas
--   3. Normaliza TODOS os CNPJs restantes pra formato mascarado
--   4. Cria trigger BEFORE INSERT/UPDATE que normaliza automaticamente
--   5. Cria UNIQUE INDEX em CNPJ-digits (impede mesmo CNPJ em formatos
--      diferentes burlar a constraint)
--
-- Idempotente: pode rodar 2x sem efeito colateral.
-- ============================================================

-- ============================================================
-- 1. Função de normalização
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_cnpj_text(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN NULL;
  END IF;
  digits := regexp_replace(raw, '\D', '', 'g');
  -- Preserva strings que não tem 14 dígitos (legados / parcial) sem mascarar
  IF length(digits) <> 14 THEN
    RETURN raw;
  END IF;
  RETURN format(
    '%s.%s.%s/%s-%s',
    substr(digits, 1, 2),
    substr(digits, 3, 3),
    substr(digits, 6, 3),
    substr(digits, 9, 4),
    substr(digits, 13, 2)
  );
END $$;

COMMENT ON FUNCTION public.normalize_cnpj_text(text) IS
  'Normaliza CNPJ pra formato mascarado XX.XXX.XXX/XXXX-XX. NULL se vazio. '
  'Preserva strings que não tenham exatamente 14 dígitos (preserva legados).';


-- ============================================================
-- 2. Merge das empresas duplicadas
-- ============================================================
DO $$
DECLARE
  v_fk record;
  v_pairs int;
  v_affected int;
  v_total_fk_updates int := 0;
BEGIN
  -- Tabela temp com pares (canonical, duplicate) usando regexp_replace direto
  -- (pois normalize_cnpj_text retorna formato MASCARADO, mas pra comparar
  -- precisamos só dos dígitos).
  CREATE TEMP TABLE _empresa_dups ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      id,
      cnpj,
      nome,
      created_at,
      regexp_replace(cnpj, '\D', '', 'g') AS cnpj_digits,
      ROW_NUMBER() OVER (
        PARTITION BY regexp_replace(cnpj, '\D', '', 'g')
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.empresas
    WHERE cnpj IS NOT NULL
      AND length(regexp_replace(cnpj, '\D', '', 'g')) = 14
  ),
  canonicals AS (
    SELECT id, cnpj_digits, nome FROM ranked WHERE rn = 1
  ),
  duplicates AS (
    SELECT id, cnpj_digits, nome FROM ranked WHERE rn > 1
  )
  SELECT
    c.id           AS canonical_id,
    d.id           AS duplicate_id,
    c.nome         AS canonical_nome,
    d.nome         AS duplicate_nome,
    c.cnpj_digits  AS cnpj_digits
  FROM canonicals c
  JOIN duplicates d ON c.cnpj_digits = d.cnpj_digits;

  SELECT COUNT(*) INTO v_pairs FROM _empresa_dups;
  RAISE NOTICE '[dedupe] Pares (canonical, duplicate) encontrados: %', v_pairs;

  IF v_pairs = 0 THEN
    RAISE NOTICE '[dedupe] Nada a fazer. Pulando merge.';
  ELSE
    -- ----------------------------------------------------------
    -- 2a. PREVENTIVO: deleta linhas que causariam violação de UNIQUE
    --     se a gente tentasse reapontar FK pra canonical.
    -- ----------------------------------------------------------

    -- ANTES de deletar elegibilidades conflitantes, reaponta prospeccoes
    -- (e processos, se existir) pra elegibilidade canônica equivalente.
    -- Mesma estratégia da mig 20260506000002.
    UPDATE public.prospeccoes p
    SET elegibilidade_id = canon_eleg.id
    FROM _empresa_dups d
    JOIN public.elegibilidade dup_eleg
      ON dup_eleg.empresa_id = d.duplicate_id
    JOIN public.elegibilidade canon_eleg
      ON canon_eleg.empresa_id = d.canonical_id
     AND canon_eleg.acao_id    = dup_eleg.acao_id
    WHERE p.elegibilidade_id = dup_eleg.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe]   prospeccoes reapontadas pra eleg canônica: %', v_affected;

    -- processos pode não existir nesse banco — usa to_regclass pra evitar erro
    IF to_regclass('public.processos') IS NOT NULL THEN
      EXECUTE $sql$
        UPDATE public.processos pr
        SET elegibilidade_id = canon_eleg.id
        FROM _empresa_dups d
        JOIN public.elegibilidade dup_eleg
          ON dup_eleg.empresa_id = d.duplicate_id
        JOIN public.elegibilidade canon_eleg
          ON canon_eleg.empresa_id = d.canonical_id
         AND canon_eleg.acao_id    = dup_eleg.acao_id
        WHERE pr.elegibilidade_id = dup_eleg.id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[dedupe]   processos reapontados pra eleg canônica: %', v_affected;
    END IF;

    -- elegibilidade_respostas pode existir (mig 20260421) — também tem FK pra elegibilidade.id
    -- Como UNIQUE(elegibilidade_id, criterio_id), preventivo: deleta respostas da dup
    -- onde já existe equivalente na canon
    IF to_regclass('public.elegibilidade_respostas') IS NOT NULL THEN
      EXECUTE $sql$
        DELETE FROM public.elegibilidade_respostas r
        USING _empresa_dups d, public.elegibilidade dup_eleg, public.elegibilidade canon_eleg,
              public.elegibilidade_respostas rc
        WHERE r.elegibilidade_id = dup_eleg.id
          AND dup_eleg.empresa_id = d.duplicate_id
          AND canon_eleg.empresa_id = d.canonical_id
          AND canon_eleg.acao_id    = dup_eleg.acao_id
          AND rc.elegibilidade_id = canon_eleg.id
          AND rc.criterio_id      = r.criterio_id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[dedupe]   respostas conflitantes removidas: %', v_affected;

      -- Reaponta respostas restantes pra eleg canônica
      EXECUTE $sql$
        UPDATE public.elegibilidade_respostas r
        SET elegibilidade_id = canon_eleg.id
        FROM _empresa_dups d
        JOIN public.elegibilidade dup_eleg
          ON dup_eleg.empresa_id = d.duplicate_id
        JOIN public.elegibilidade canon_eleg
          ON canon_eleg.empresa_id = d.canonical_id
         AND canon_eleg.acao_id    = dup_eleg.acao_id
        WHERE r.elegibilidade_id = dup_eleg.id
      $sql$;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      RAISE NOTICE '[dedupe]   respostas reapontadas: %', v_affected;
    END IF;

    -- AGORA pode deletar elegibilidades conflitantes (já não tem refs penduradas)
    -- elegibilidade(empresa_id, acao_id) UNIQUE: se canon e dup têm
    -- elegibilidade pra mesma ação, deleta a da dup (canon prevalece).
    DELETE FROM public.elegibilidade e
    USING _empresa_dups d, public.elegibilidade ec
    WHERE e.empresa_id = d.duplicate_id
      AND ec.empresa_id = d.canonical_id
      AND ec.acao_id = e.acao_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe]   elegibilidade: % linhas conflitantes removidas', v_affected;

    -- pasta_empresa_items(pasta_id, empresa_id) UNIQUE: se canon e dup
    -- estão na mesma pasta, mantém só a canon.
    DELETE FROM public.pasta_empresa_items p
    USING _empresa_dups d, public.pasta_empresa_items pc
    WHERE p.empresa_id = d.duplicate_id
      AND pc.empresa_id = d.canonical_id
      AND pc.pasta_id = p.pasta_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe]   pasta_empresa_items: % linhas conflitantes removidas', v_affected;

    -- ----------------------------------------------------------
    -- 2b. Reaponta TODAS as FKs apontando pra empresas.id.
    --     Loop dinâmico em information_schema pra pegar até FKs
    --     que não conhecemos (e cobrir futuras adições sem editar
    --     esta migration).
    -- ----------------------------------------------------------
    FOR v_fk IN
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name
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
        'FROM _empresa_dups d WHERE t.%I = d.duplicate_id',
        v_fk.table_schema, v_fk.table_name, v_fk.column_name, v_fk.column_name
      );
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      v_total_fk_updates := v_total_fk_updates + v_affected;
      RAISE NOTICE '[dedupe]   FK %.%.%: % linhas reapontadas',
                   v_fk.table_schema, v_fk.table_name, v_fk.column_name, v_affected;
    END LOOP;
    RAISE NOTICE '[dedupe] Total de FKs reapontadas: %', v_total_fk_updates;

    -- ----------------------------------------------------------
    -- 2c. Atualiza NOME da canônica se o da duplicata é mais longo
    --     E não tem padrão de encoding quebrado (Ã seguido de letra
    --     maiúscula ASCII, ex: "GÃS" — onde 'Á' virou 'Ã').
    -- ----------------------------------------------------------
    UPDATE public.empresas e
    SET nome = d.duplicate_nome
    FROM _empresa_dups d
    WHERE e.id = d.canonical_id
      AND length(d.duplicate_nome) > length(d.canonical_nome)
      AND d.duplicate_nome !~ 'Ã[A-Z]'
      AND d.canonical_nome ~* '(^[A-Z])|encoding';  -- preserva apenas se canônico parece truncado
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe] Nomes atualizados pra versão mais longa: %', v_affected;

    -- Versão mais relaxada (caso a heurística acima seja conservadora demais):
    -- atualiza se dup é simplesmente mais longa SEM encoding quebrado
    UPDATE public.empresas e
    SET nome = d.duplicate_nome
    FROM _empresa_dups d
    WHERE e.id = d.canonical_id
      AND length(d.duplicate_nome) > length(e.nome) + 3
      AND d.duplicate_nome !~ 'Ã[A-Z]'
      AND e.nome ~ '^[A-Z]';  -- canônica começa com maiúscula isolada (provável truncamento)
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe] Nomes truncados corrigidos: %', v_affected;

    -- ----------------------------------------------------------
    -- 2d. Preenche campos NULL da canônica com valores não-NULL
    --     da duplicata (não sobrescreve dados já existentes).
    -- ----------------------------------------------------------
    UPDATE public.empresas c
    SET
      razao_social         = COALESCE(c.razao_social,         dup.razao_social),
      nome_fantasia        = COALESCE(c.nome_fantasia,        dup.nome_fantasia),
      situacao_cadastral   = COALESCE(c.situacao_cadastral,   dup.situacao_cadastral),
      porte                = COALESCE(c.porte,                dup.porte),
      uf                   = COALESCE(c.uf,                   dup.uf),
      municipio            = COALESCE(c.municipio,            dup.municipio),
      cnae_principal       = COALESCE(c.cnae_principal,       dup.cnae_principal),
      cnae_descricao       = COALESCE(c.cnae_descricao,       dup.cnae_descricao),
      capital_social       = COALESCE(c.capital_social,       dup.capital_social),
      opcao_simples        = COALESCE(c.opcao_simples,        dup.opcao_simples),
      opcao_mei            = COALESCE(c.opcao_mei,            dup.opcao_mei),
      data_abertura        = COALESCE(c.data_abertura,        dup.data_abertura),
      natureza_juridica    = COALESCE(c.natureza_juridica,    dup.natureza_juridica),
      email_rfb            = COALESCE(c.email_rfb,            dup.email_rfb),
      telefone_rfb         = COALESCE(c.telefone_rfb,         dup.telefone_rfb),
      receita_atualizada_em = COALESCE(c.receita_atualizada_em, dup.receita_atualizada_em),
      regime_tributario    = COALESCE(c.regime_tributario,    dup.regime_tributario),
      quantidade_funcionarios = COALESCE(c.quantidade_funcionarios, dup.quantidade_funcionarios),
      faturamento_anual    = COALESCE(c.faturamento_anual,    dup.faturamento_anual),
      metadados            = COALESCE(c.metadados,            dup.metadados)
    FROM _empresa_dups d
    JOIN public.empresas dup ON dup.id = d.duplicate_id
    WHERE c.id = d.canonical_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe] Canônicas enriquecidas com dados da duplicata: %', v_affected;

    -- ----------------------------------------------------------
    -- 2e. Deleta as empresas duplicadas. ON DELETE CASCADE em
    --     elegibilidade/pasta_empresa_items dispara — mas como já
    --     reapontamos pra canonical, esses CASCADEs só vão limpar
    --     linhas que ficaram órfãs (não deve haver mais).
    -- ----------------------------------------------------------
    DELETE FROM public.empresas e
    USING _empresa_dups d
    WHERE e.id = d.duplicate_id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RAISE NOTICE '[dedupe] Empresas duplicadas deletadas: %', v_affected;
  END IF;
END $$;


-- ============================================================
-- 3. Normaliza TODOS os CNPJs restantes pra formato mascarado
-- ============================================================
UPDATE public.empresas
SET cnpj = public.normalize_cnpj_text(cnpj)
WHERE cnpj IS NOT NULL
  AND cnpj <> public.normalize_cnpj_text(cnpj);


-- ============================================================
-- 4. Trigger BEFORE INSERT/UPDATE — garante normalização permanente
-- ============================================================
CREATE OR REPLACE FUNCTION public.empresas_normalize_cnpj_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.cnpj := public.normalize_cnpj_text(NEW.cnpj);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_empresas_normalize_cnpj ON public.empresas;
CREATE TRIGGER trg_empresas_normalize_cnpj
  BEFORE INSERT OR UPDATE OF cnpj ON public.empresas
  FOR EACH ROW
  EXECUTE FUNCTION public.empresas_normalize_cnpj_trigger();


-- ============================================================
-- 5. UNIQUE INDEX em CNPJ-digits — barreira definitiva
--     (independente de formato — pega cru, mascarado, com espaços)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS empresas_cnpj_digits_unique
  ON public.empresas (regexp_replace(cnpj, '\D', '', 'g'))
  WHERE cnpj IS NOT NULL;

COMMENT ON INDEX public.empresas_cnpj_digits_unique IS
  'Garante CNPJ único independente de formato. Combinado com trigger '
  'normalize_cnpj, impede qualquer reincidência de duplicata por máscara.';
