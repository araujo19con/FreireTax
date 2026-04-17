-- =========================================================================
-- Sprint 2 Hormozi — CLOSER framework, templates, funil de conversão,
-- upsell automatizado (expande QW5 do Sprint 1).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. ENUMS novos
-- -------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.cargo_categoria AS ENUM (
    'ceo', 'cfo', 'socio', 'diretor', 'controller',
    'gerente_fiscal', 'contador', 'coordenador', 'analista', 'outros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.categoria_template AS ENUM (
    'abertura',        -- 1º contato frio
    'follow_up',       -- toques 2-5
    'proposta',        -- enviando proposta
    'negociacao',      -- em negociação (objeções)
    'breakup',         -- último toque
    'pos_venda',       -- após fechar (upsell, boas-vindas)
    'objecao_preco',
    'objecao_tese',
    'objecao_timing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------------------
-- 2. CLOSER framework — campos em prospeccoes
-- -------------------------------------------------------------------------
ALTER TABLE public.prospeccoes
  ADD COLUMN IF NOT EXISTS dor_identificada text,
  ADD COLUMN IF NOT EXISTS tentativas_anteriores text,
  ADD COLUMN IF NOT EXISTS decisor_confirmado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_emocional_articulado text,
  ADD COLUMN IF NOT EXISTS objecoes_principais text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cargo_categoria public.cargo_categoria,
  ADD COLUMN IF NOT EXISTS eh_decisor boolean NOT NULL DEFAULT false;

-- -------------------------------------------------------------------------
-- 3. TEMPLATES DE MENSAGEM
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.templates_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria public.categoria_template NOT NULL,
  canal public.canal_contato NOT NULL DEFAULT 'email',
  assunto text,
  corpo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  descricao text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_categoria ON public.templates_mensagem(categoria) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_templates_canal ON public.templates_mensagem(canal) WHERE ativo = true;

ALTER TABLE public.templates_mensagem ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view templates" ON public.templates_mensagem;
DROP POLICY IF EXISTS "Authenticated manage templates" ON public.templates_mensagem;

CREATE POLICY "Authenticated view templates"
  ON public.templates_mensagem FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated manage templates"
  ON public.templates_mensagem FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS templates_set_updated_at ON public.templates_mensagem;
CREATE TRIGGER templates_set_updated_at
  BEFORE UPDATE ON public.templates_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------
-- 4. SEED de templates iniciais (pontos de partida práticos)
-- -------------------------------------------------------------------------
INSERT INTO public.templates_mensagem (nome, categoria, canal, assunto, corpo, descricao)
VALUES
(
  'Abertura fria — CFO (valor potencial)',
  'abertura', 'email',
  '{{empresa}} pode ter R$ {{valor_potencial}} a recuperar — tese STF',
  'Prezado(a) {{contato_nome}},

Identificamos que {{empresa}} é potencialmente elegível para a {{tese}} — tese com decisão favorável do STF e que pode significar recuperação estimada de {{valor_potencial}} em honorários/tributos indevidos.

O prazo para ajuizamento é de {{dias_prescricao}} dias antes da prescrição. Podemos fazer uma análise de viabilidade gratuita em 7 dias, sem custo e sem compromisso.

Posso marcar 20 min na sua agenda esta semana?

Atenciosamente,
Freire Pignataro Advogados',
  'Mensagem de abordagem fria. Usa valor potencial como ancora e urgencia real de prescricao.'
),
(
  'Follow-up — sem resposta (toque 2-3)',
  'follow_up', 'email',
  'Re: {{empresa}} — reforçando contato',
  'Prezado(a) {{contato_nome}},

Acompanho se minha mensagem anterior chegou. Sei que a agenda de um CFO é cheia.

Resumindo em 30 segundos:
• {{empresa}} é elegível para {{tese}}
• Recuperação estimada: {{valor_potencial}}
• Janela de prescrição: {{dias_prescricao}} dias
• Análise de viabilidade é gratuita e em 7 dias

Se não for prioridade agora, me diz e arquivo o caso. Se for, respondo com link da agenda.

Atenciosamente,
Freire Pignataro Advogados',
  'Follow-up educado. Inclui opt-out para evitar insistencia toxica.'
),
(
  'Follow-up — WhatsApp curto',
  'follow_up', 'whatsapp',
  NULL,
  'Olá {{contato_nome}}, tudo bem? Sou da Freire Pignataro Advogados.

Mandei um email hoje de manhã sobre uma tese tributária ({{tese}}) que pode significar recuperação de {{valor_potencial}} para a {{empresa}}.

Tem 5 min esta semana pra uma conversa rápida?',
  'Toque WhatsApp apos email sem resposta. Mensagem curta, uma pergunta clara.'
),
(
  'Proposta enviada — resumo executivo',
  'proposta', 'email',
  'Proposta — Análise {{tese}} para {{empresa}}',
  'Prezado(a) {{contato_nome}},

Conforme conversado, segue a proposta:

• Tese: {{tese}}
• Recuperação estimada: {{valor_potencial}}
• Modalidade: success fee (só cobramos se ganhar)
• Prazo estimado do processo: 18-36 meses
• Garantia: parecer de viabilidade em 7 dias — se desfavorável, sem custo

A janela de prescrição é de {{dias_prescricao}} dias. Quanto antes começarmos, maior a chance de preservar o direito.

Aguardo seu retorno para agendarmos assinatura.

Atenciosamente,
Freire Pignataro Advogados',
  'Recapitula proposta por email apos call. Reforca garantia e urgencia.'
),
(
  'Breakup — último toque',
  'breakup', 'email',
  'Arquivando o caso — {{empresa}}',
  'Prezado(a) {{contato_nome}},

Após várias tentativas sem resposta, vou arquivar nosso caso para não incomodar mais.

Se {{empresa}} mudar de ideia sobre a {{tese}} (recuperação potencial de {{valor_potencial}}), fique à vontade para me responder este email diretamente — mantenho o caso disponível pelos próximos 30 dias.

Depois disso, a janela de prescrição se fecha.

Obrigado pela atenção.
Atenciosamente,
Freire Pignataro Advogados',
  'Hormozi breakup: dá saída graciosa + reforça valor perdido + mantém porta aberta.'
),
(
  'Objeção preço — 20% é caro',
  'objecao_preco', 'email',
  NULL,
  'Entendo a preocupação com o percentual de honorários.

Um ponto: o success fee só é cobrado SE ganharmos — ou seja, 100% do risco está conosco. Se perdermos, {{empresa}} não paga nada.

Comparando: 80% de {{valor_potencial}} = R$ {{valor_80_potencial}} líquidos para {{empresa}}. Sem nosso trabalho, são 100% de R$ 0 (nada recuperado).

Posso oferecer flexibilidade na estrutura: parcela fixa menor + percentual de êxito reduzido. Faz sentido conversarmos sobre isso?',
  'Resposta a objecao de preco. Reframe: risco 100% nosso + comparativo percentual.'
),
(
  'Objeção tese — e se não ganharmos?',
  'objecao_tese', 'email',
  NULL,
  '{{contato_nome}}, entendo a hesitação. A dúvida sobre viabilidade da tese é a mais comum e merece resposta direta.

Por isso oferecemos o parecer de viabilidade em 7 dias, SEM custo:
• Se o parecer for desfavorável → não há contrato, não há custo, nada a pagar
• Se for favorável e você assinar → taxa de entrada é 100% creditada no êxito final

Em outras palavras, você sai dessa análise sem risco financeiro algum. O único "custo" são 7 dias de espera pra uma decisão informada.

Posso começar o parecer hoje?',
  'Resposta a objecao de tese. Oferece garantia de risco zero antes do compromisso.'
),
(
  'Pós-venda — boas vindas + upsell de outras teses',
  'pos_venda', 'email',
  'Bem-vindo(a) — próximos passos + outras oportunidades',
  'Prezado(a) {{contato_nome}},

Seja muito bem-vindo(a) à Freire Pignataro. Contrato assinado para {{tese}}.

Aproveito para compartilhar algo importante: identificamos que {{empresa}} também pode ser elegível para outras teses tributárias ativas. Fazemos uma análise completa gratuita em 15 dias e apresentamos o "Relatório de Oportunidades Tributárias" com tudo que mapeamos.

Vale 30 min de conversa? Pode ser que a gente destrave mais recuperação além desta primeira ação.

Atenciosamente,
Freire Pignataro Advogados',
  'Kickoff pos-fechamento + abertura de upsell para outras teses da mesma empresa.'
)
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------------------
-- 5. EXPANDIR trigger de upsell (Sprint 1 QW5)
-- Agora além de criar uma TASK, cria automaticamente PROSPECÇÕES nas
-- outras elegibilidades ATIVAS da mesma empresa — transforma 1 cliente
-- em 3-4 ações sistematicamente.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_upsell_apos_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_empresa_nome text;
  v_acao_atual_id uuid;
  v_acao_atual_nome text;
  v_responsavel uuid;
  v_acoes_nao_avaliadas integer;
  v_prosp_criadas integer := 0;
  v_desc text;
  r record;
BEGIN
  -- só dispara na TRANSIÇÃO para "Contrato assinado"
  IF NEW.status_prospeccao = 'Contrato assinado'
     AND (OLD.status_prospeccao IS DISTINCT FROM NEW.status_prospeccao)
  THEN
    -- pega empresa e ação atual
    SELECT e.empresa_id, emp.nome, e.acao_id, a.nome
      INTO v_empresa_id, v_empresa_nome, v_acao_atual_id, v_acao_atual_nome
      FROM public.elegibilidade e
      JOIN public.empresas emp ON emp.id = e.empresa_id
      JOIN public.acoes_tributarias a ON a.id = e.acao_id
     WHERE e.id = NEW.elegibilidade_id;

    IF v_empresa_id IS NULL THEN RETURN NEW; END IF;
    v_responsavel := NEW.responsavel_id;

    -- (a) CRIA PROSPECÇÕES nas elegibilidades JÁ EXISTENTES (elegivel=true)
    --     que ainda NÃO têm prospecção aberta.
    FOR r IN
      SELECT el.id AS eleg_id, a.nome AS acao_nome
        FROM public.elegibilidade el
        JOIN public.acoes_tributarias a ON a.id = el.acao_id
       WHERE el.empresa_id = v_empresa_id
         AND el.elegivel = true
         AND el.id <> NEW.elegibilidade_id  -- exclui a que acabou de fechar
         AND a.status = 'Ativa'
         AND NOT EXISTS (
           SELECT 1 FROM public.prospeccoes p
            WHERE p.elegibilidade_id = el.id
         )
    LOOP
      INSERT INTO public.prospeccoes (
        elegibilidade_id, user_id, status_prospeccao,
        contato_nome, contato_telefone, contato_email, contato_cargo,
        responsavel_id, notas_prospeccao
      )
      VALUES (
        r.eleg_id, NEW.user_id, 'Não iniciado',
        NEW.contato_nome, NEW.contato_telefone, NEW.contato_email, NEW.contato_cargo,
        v_responsavel,
        format(
          '[UPSELL automático] Cliente fechou %s em %s. Avaliar esta tese no kick-off.',
          v_acao_atual_nome,
          to_char(now(), 'DD/MM/YYYY')
        )
      );
      v_prosp_criadas := v_prosp_criadas + 1;
    END LOOP;

    -- (b) CONTA ações ATIVAS que ainda NÃO foram avaliadas
    --     (nem existe elegibilidade registrada).
    SELECT count(*)
      INTO v_acoes_nao_avaliadas
      FROM public.acoes_tributarias a
     WHERE a.status = 'Ativa'
       AND NOT EXISTS (
         SELECT 1 FROM public.elegibilidade el
          WHERE el.empresa_id = v_empresa_id AND el.acao_id = a.id
       );

    v_desc := format(
      'Empresa "%s" fechou contrato para "%s".%s• %s prospeccao(oes) de upsell %s criada(s) automaticamente (elegibilidades ja mapeadas).%s• %s tese(s) adicional(is) ainda nao avaliada(s) — vale fazer analise de elegibilidade completa pra expandir LTV.',
      v_empresa_nome,
      v_acao_atual_nome,
      E'\n\n',
      v_prosp_criadas,
      CASE WHEN v_prosp_criadas = 1 THEN 'foi' ELSE 'foram' END,
      E'\n',
      COALESCE(v_acoes_nao_avaliadas, 0)
    );

    -- (c) CRIA TASK para o responsável (igual Sprint 1, agora com mais info)
    INSERT INTO public.tarefas (
      titulo, descricao, assigned_to, created_by,
      empresa_id, prospeccao_id, prioridade, status, prazo
    ) VALUES (
      format('[Upsell] Expandir %s — %s prospeccao(oes) criada(s)', v_empresa_nome, v_prosp_criadas),
      v_desc,
      v_responsavel,
      COALESCE(v_responsavel, NEW.user_id),
      v_empresa_id,
      NEW.id,
      'alta'::public.tarefa_prioridade,
      'pendente'::public.tarefa_status,
      now() + interval '3 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger já existe (do Sprint 1) — a função foi sobrescrita acima.

-- -------------------------------------------------------------------------
-- 6. VIEW de funil — para o Dashboard
-- -------------------------------------------------------------------------
-- Agrega métricas por etapa do funil. Usada pelo Dashboard Hormozi.
CREATE OR REPLACE VIEW public.v_funil_conversao AS
WITH stage_counts AS (
  SELECT
    status_prospeccao AS etapa,
    count(*)           AS qtd,
    sum(COALESCE(valor_contrato, 0))::numeric AS valor_contrato_total,
    avg(EXTRACT(EPOCH FROM (COALESCE(updated_at, now()) - created_at)) / 86400)::numeric AS dias_medios_na_etapa
  FROM public.prospeccoes
  GROUP BY status_prospeccao
)
SELECT
  etapa,
  qtd,
  round(valor_contrato_total, 2) AS valor_contrato_total,
  round(dias_medios_na_etapa::numeric, 1) AS dias_medios_na_etapa
FROM stage_counts;

GRANT SELECT ON public.v_funil_conversao TO authenticated;

-- -------------------------------------------------------------------------
-- 7. Função auxiliar — valor potencial agregado do pipeline por etapa
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_funil_valor_potencial AS
SELECT
  p.status_prospeccao AS etapa,
  count(*) AS qtd,
  round(sum(COALESCE(e.valor_potencial_estimado, 0))::numeric, 2) AS valor_potencial_total
FROM public.prospeccoes p
LEFT JOIN public.elegibilidade e ON e.id = p.elegibilidade_id
GROUP BY p.status_prospeccao;

GRANT SELECT ON public.v_funil_valor_potencial TO authenticated;
