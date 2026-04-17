-- =========================================================================
-- Índices compostos para queries quentes das novas telas.
-- (Complementa 20260417000000_sistema_usuarios_tarefas_reunioes.sql)
--
-- Racional:
--   * Kanban de MinhasTarefas filtra por (assigned_to, status).
--   * Dashboard "atrasadas" filtra por (assigned_to, status, prazo).
--   * MinhaAgenda filtra por (advogado_id, data_inicio) em um range.
--   * Dashboard de reuniões por status usa (status, data_inicio).
-- =========================================================================

-- Tarefas: Kanban por responsável + status
CREATE INDEX IF NOT EXISTS idx_tarefas_assigned_status
  ON public.tarefas (assigned_to, status);

-- Tarefas: "minhas tarefas com prazo" — inclui prazo para range-scan
CREATE INDEX IF NOT EXISTS idx_tarefas_assigned_prazo
  ON public.tarefas (assigned_to, prazo)
  WHERE status NOT IN ('concluida', 'cancelada');

-- Reuniões: agenda por advogado + data (principal query da MinhaAgenda)
CREATE INDEX IF NOT EXISTS idx_reunioes_advogado_inicio
  ON public.reunioes (advogado_id, data_inicio);

-- Reuniões: filtro "próximas" por status + data
CREATE INDEX IF NOT EXISTS idx_reunioes_status_inicio
  ON public.reunioes (status, data_inicio);

-- Comentários / anexos: listagem por tarefa em ordem cronológica
CREATE INDEX IF NOT EXISTS idx_tarefa_comentarios_tarefa_created
  ON public.tarefa_comentarios (tarefa_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tarefa_anexos_tarefa_created
  ON public.tarefa_anexos (tarefa_id, created_at);

-- Subtarefas: ordem dentro da tarefa
CREATE INDEX IF NOT EXISTS idx_subtarefas_tarefa_ordem
  ON public.subtarefas (tarefa_id, ordem);

-- Profiles: listagem de ativos ordenada por nome (usada em vários dialogs)
CREATE INDEX IF NOT EXISTS idx_profiles_ativo_nome
  ON public.profiles (ativo, nome)
  WHERE ativo = true;
