-- ============================================================================
-- Migration: 20260709000000_seed_templates_linkedin
--
-- Seed de templates canal='linkedin' (categoria=abertura) — usados pelo botão
-- "Mensagem LinkedIn" em EmpresaContatosSection (via TemplateSelectorDialog
-- com canalFiltro="linkedin"). O enum canal_contato já suportava 'linkedin'
-- desde a migration original de templates_mensagem, mas nenhum template
-- desse canal existia ainda.
--
-- Duas variantes: nota de conexão (curta — LinkedIn limita nota de convite a
-- ~300 caracteres) e mensagem direta pós-conexão (sem limite de tamanho).
-- ============================================================================

INSERT INTO public.templates_mensagem (nome, categoria, canal, assunto, corpo, descricao)
VALUES
(
  'LinkedIn — Nota de conexão (curta)',
  'abertura', 'linkedin',
  NULL,
  'Olá {{contato_primeiro_nome}}, tudo bem? Sou da Freire Pignataro Advogados. Identificamos uma tese tributária ({{tese}}) com potencial de recuperação para a {{empresa}}. Gostaria de conectar pra trocar uma ideia.',
  'Nota de PEDIDO DE CONEXÃO — o LinkedIn limita a ~300 caracteres. Use quando ainda não é conexão do decisor.'
),
(
  'LinkedIn — Mensagem direta (já conectados)',
  'abertura', 'linkedin',
  NULL,
  'Olá {{contato_primeiro_nome}}, tudo bem?

Sou {{advogado_responsavel}}, da Freire Pignataro Advogados. Identificamos que a {{empresa}} é potencialmente elegível para a {{tese}} — com recuperação estimada de {{valor_potencial}}.

Fazemos uma análise de viabilidade gratuita, sem custo e sem compromisso. Faz sentido conversarmos 15 minutos essa semana?',
  'DM direta — use depois de já estar conectado(a) com o decisor no LinkedIn. Sem limite de tamanho.'
);
