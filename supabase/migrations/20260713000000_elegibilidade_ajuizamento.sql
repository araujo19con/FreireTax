-- =========================================================================
-- Ajuizamento na elegibilidade — registrar que uma empresa JÁ AJUIZOU a ação
-- (mesmo que por outro escritório) e se foi POR NÓS.
--
-- Motivação: em teses como "exclusão do IRPJ/CSLL sobre créditos presumidos
-- de ICMS" há uma lista de empresas que já entraram com a ação (não são alvo
-- de prospecção pra ajuizar de novo — são alvo de acompanhamento/relacionamento
-- ou já são cliente). Precisamos marcar isso no perfil da empresa (na
-- elegibilidade empresa×ação) e distinguir "ajuizada por nós" de "por terceiro".
--
--   ja_ajuizada      = a empresa já tem a ação ajuizada (qualquer escritório).
--   ajuizada_por_nos = null: desconhecido | true: nosso escritório | false: terceiro.
--   ajuizamento_notas= nº do processo, vara, data, escritório, etc. (texto livre).
-- =========================================================================

ALTER TABLE public.elegibilidade
  ADD COLUMN IF NOT EXISTS ja_ajuizada       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajuizada_por_nos  boolean,
  ADD COLUMN IF NOT EXISTS ajuizamento_notas text;

COMMENT ON COLUMN public.elegibilidade.ja_ajuizada IS
  'Empresa já ajuizou esta ação (por nós ou por terceiro). Sai do funil de prospecção-pra-ajuizar.';
COMMENT ON COLUMN public.elegibilidade.ajuizada_por_nos IS
  'null = desconhecido | true = nosso escritório | false = terceiro.';

-- Consultas do tipo "quem já ajuizou a ação X" e "ajuizadas por nós".
CREATE INDEX IF NOT EXISTS idx_elegibilidade_ajuizada
  ON public.elegibilidade(acao_id, ja_ajuizada)
  WHERE ja_ajuizada = true;
