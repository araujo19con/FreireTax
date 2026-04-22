-- Regra de exclusão configurável por tipo de resposta.
-- Antes, "eh_excludente=true" acionava lógica hard-coded em answerIsPositive().
-- Agora, regra_excludente (jsonb) define a condição específica por tipo.
-- NULL mantém o comportamento legacy pra back-compat.

ALTER TABLE criterios_elegibilidade
  ADD COLUMN IF NOT EXISTS regra_excludente jsonb DEFAULT NULL;

COMMENT ON COLUMN criterios_elegibilidade.regra_excludente IS
  'Regra de exclusão configurável por tipo de resposta. '
  'Shape varia: boolean {excludeWhen}, number {operator,value,value2?}, '
  'date {operator,value?,value2?}, select {excludeOptions[]}, text {operator,value?}. '
  'NULL = usa lógica default legacy.';

-- Backfill: gera regra default equivalente ao comportamento legacy
-- para critérios que já estavam marcados como excludentes.
UPDATE criterios_elegibilidade
SET regra_excludente = CASE tipo_resposta
  WHEN 'boolean' THEN jsonb_build_object('tipo', 'boolean', 'excludeWhen', false)
  WHEN 'number'  THEN jsonb_build_object('tipo', 'number',  'operator', 'lte', 'value', 0)
  WHEN 'date'    THEN jsonb_build_object('tipo', 'date',    'operator', 'empty')
  WHEN 'text'    THEN jsonb_build_object('tipo', 'text',    'operator', 'empty')
  WHEN 'select'  THEN jsonb_build_object('tipo', 'select',  'excludeOptions', jsonb_build_array('nao', 'none'))
END
WHERE eh_excludente = true AND regra_excludente IS NULL;
