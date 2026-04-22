-- Propostas comerciais: templates reutilizáveis + instâncias por prospecção.
-- Cada template tem seções ordenadas (jsonb) com placeholders {{variaveis}}.
-- Ao criar proposta a partir de prospecção, renderiza variáveis e grava
-- snapshot editável em `propostas.secoes`.

-- =========================================================================
-- TEMPLATES
-- =========================================================================
CREATE TABLE IF NOT EXISTS propostas_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  acao_id uuid REFERENCES acoes_tributarias(id) ON DELETE SET NULL,
  tipo_servico text, -- label livre: "Diagnóstico Fiscal", "Lucro Presumido", etc.
  secoes jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ordem:int, titulo:text, conteudo:html}]
  valor_entrada_default numeric(14,2),
  percentual_exito_default numeric(5,2),
  texto_destinatario_default text, -- ex: "Prezados Senhores,"
  ativo boolean NOT NULL DEFAULT true,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propostas_templates_acao ON propostas_templates(acao_id);
CREATE INDEX IF NOT EXISTS idx_propostas_templates_ativo ON propostas_templates(ativo) WHERE ativo = true;

-- =========================================================================
-- PROPOSTAS (uma por prospecção)
-- =========================================================================
CREATE TABLE IF NOT EXISTS propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospeccao_id uuid NOT NULL REFERENCES prospeccoes(id) ON DELETE CASCADE,
  template_id uuid REFERENCES propostas_templates(id) ON DELETE SET NULL,

  -- Denormalizados pra consulta sem join
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  acao_id uuid REFERENCES acoes_tributarias(id) ON DELETE SET NULL,

  -- Cabeçalho editável
  titulo text NOT NULL, -- "PROPOSTA DE PRESTAÇÃO DE SERVIÇOS TRIBUTÁRIOS"
  destinatario_empresa text, -- "Unimed Santa Bárbara D'Oeste"
  destinatario_att text, -- "Dr. Roberto"
  texto_introducao text, -- "Prezados Senhores," ou "Temos a satisfação..."

  -- Conteúdo
  secoes jsonb NOT NULL DEFAULT '[]'::jsonb, -- snapshot editável

  -- Honorários
  valor_entrada numeric(14,2),
  percentual_exito numeric(5,2),

  -- Assinatura
  signatario_nome text DEFAULT 'Rodrigo Dantas',
  signatario_cargo text DEFAULT 'OAB/RN n.º 4.476',

  -- Status e fluxo
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviada', 'aceita', 'rejeitada')),
  enviada_em timestamptz,
  aceita_em timestamptz,
  rejeitada_em timestamptz,
  motivo_rejeicao text,

  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET DEFAULT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Uma proposta ativa por prospecção (versões sobrescrevem)
  CONSTRAINT uq_propostas_prospeccao UNIQUE (prospeccao_id)
);

CREATE INDEX IF NOT EXISTS idx_propostas_prospeccao ON propostas(prospeccao_id);
CREATE INDEX IF NOT EXISTS idx_propostas_empresa ON propostas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_propostas_status ON propostas(status);

-- =========================================================================
-- TRIGGER de updated_at
-- =========================================================================
CREATE OR REPLACE FUNCTION trg_propostas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_propostas_updated_at ON propostas;
CREATE TRIGGER set_propostas_updated_at
  BEFORE UPDATE ON propostas
  FOR EACH ROW EXECUTE FUNCTION trg_propostas_updated_at();

DROP TRIGGER IF EXISTS set_propostas_templates_updated_at ON propostas_templates;
CREATE TRIGGER set_propostas_templates_updated_at
  BEFORE UPDATE ON propostas_templates
  FOR EACH ROW EXECUTE FUNCTION trg_propostas_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
ALTER TABLE propostas_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE propostas ENABLE ROW LEVEL SECURITY;

-- Templates: todos autenticados veem e gerenciam (são compartilhados no escritório)
DROP POLICY IF EXISTS propostas_templates_all_auth ON propostas_templates;
CREATE POLICY propostas_templates_all_auth ON propostas_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (auth.uid() = user_id);

-- Propostas: autenticados veem/gerenciam (escopo do time)
DROP POLICY IF EXISTS propostas_all_auth ON propostas;
CREATE POLICY propostas_all_auth ON propostas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================================
-- SEED: 2 templates iniciais baseados nos PDFs de referência
-- =========================================================================
-- Usa o primeiro user admin como owner (ajustar se necessário)
DO $$
DECLARE
  admin_uid uuid;
BEGIN
  SELECT id INTO admin_uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF admin_uid IS NULL THEN RETURN; END IF;

  -- TEMPLATE 1: Lucro Presumido — LC 224/2025
  INSERT INTO propostas_templates (nome, descricao, tipo_servico, texto_destinatario_default, valor_entrada_default, percentual_exito_default, secoes, user_id)
  VALUES (
    'Lucro Presumido (LC 224/2025) — IRPJ/CSLL +10%',
    'Ação para suspender majoração de 10% nos percentuais de presunção do Lucro Presumido.',
    'Tributário — Mandado de Segurança',
    'Temos a satisfação de submeter à apreciação de V.Sas. nossa proposta de prestação de serviços para a realização de serviço fiscal e tributário.',
    10000.00,
    20.00,
    '[
      {
        "ordem": 0,
        "titulo": "I. O ESCRITÓRIO",
        "conteudo": "<p>Dantas, Freire, Pignataro, Maciel e Costa Advogados é um escritório de advocacia com atuação em todo território nacional e com sede nas cidades de Natal/RN, Brasília/DF e São Paulo/SP, especializado em Direito Tributário, Empresarial e Civil.</p><p>Somos uma firma jurídica especializada, construída sobre três pilares inegociáveis: confiabilidade, eficiência e segurança jurídica. Cada mandato que assumimos é tratado com a critério de quem entende que o direito é, antes de tudo, um instrumento de geração de valor para as empresas que o utilizam com inteligência.</p>"
      },
      {
        "ordem": 1,
        "titulo": "II. INTRODUÇÃO",
        "conteudo": "<p>A LC nº 224/2025, publicada em dezembro de 2025, nos termos do art. 4º, § 4º, inciso VII, e § 5º, bem como o Decreto nº 12.808/2025 e a Instrução Normativa RFB nº 2.305/2025, instituíram a exigência de recolhimento do Imposto de Renda da Pessoa Jurídica (IRPJ) e da Contribuição Social sobre o Lucro Líquido (CSLL) com base nos percentuais de presunção majorados em 10% (dez por cento).</p><p>O regime do lucro presumido não ostenta natureza jurídica de benefício fiscal ou renúncia de receita, mas constitui técnica legal de apuração da base de cálculo do IRPJ e da CSLL, prevista no art. 44 do Código Tributário Nacional. Afirma que a equiparação do lucro presumido a incentivo fiscal, para fins de majoração da base de cálculo, revela-se juridicamente inadequada, configurando aumento indireto da carga tributária, em afronta aos princípios constitucionais da legalidade estrita, da capacidade contributiva, da isonomia tributária, da segurança jurídica e da proteção da confiança legítima.</p><p>Assim, a equiparação do regime do lucro presumido a benefício fiscal, para fins de majoração da base de cálculo, mostra-se, juridicamente questionável.</p>"
      },
      {
        "ordem": 2,
        "titulo": "III. PROPOSTA DE TRABALHO",
        "conteudo": "<p>Por meio de um mandado de segurança, pediremos ao Judiciário que suspenda a exigibilidade da majoração de 10% nos percentuais de presunção do Lucro Presumido, assegurando à <strong>{{empresa.nome}}</strong> o direito de continuar apurando e recolhendo o IRPJ e a CSLL com base nos percentuais originalmente previstos na legislação, sem sofrer autuações, cobranças ou restrições cadastrais decorrentes do não recolhimento da parcela controvertida.</p>"
      },
      {
        "ordem": 3,
        "titulo": "IV. HONORÁRIOS",
        "conteudo": "<p>Em razão da natureza do trabalho ora proposto, nossa remuneração será composta de uma parte inicial para ajuizamento da ação de <strong>R$ {{honorarios.entrada}}</strong> por empresa, e uma parte no êxito da demanda. Essa corresponderá ao percentual de <strong>{{honorarios.exito_percentual}}% (vinte por cento)</strong> sobre os valores dos créditos tributários efetivamente aproveitados pela EMPRESA, por meio de restituição, compensação ou lançamento nos livros fiscais, devidamente corrigidos, exigíveis no momento do respectivo aproveitamento.</p>"
      }
    ]'::jsonb,
    admin_uid
  );

  -- TEMPLATE 2: Diagnóstico Fiscal e Tributário
  INSERT INTO propostas_templates (nome, descricao, tipo_servico, texto_destinatario_default, valor_entrada_default, percentual_exito_default, secoes, user_id)
  VALUES (
    'Diagnóstico Fiscal e Tributário',
    'Revisão das apurações de IRPJ, CSLL, PIS, COFINS e Contribuições Previdenciárias dos últimos 5 anos.',
    'Diagnóstico — Êxito',
    'Temos a satisfação de submeter à apreciação de V.Sas. nossa proposta de prestação de serviços para a realização de diagnóstico fiscal e tributário.',
    NULL,
    20.00,
    '[
      {
        "ordem": 0,
        "titulo": "1. O ESCRITÓRIO",
        "conteudo": "<p>Dantas, Freire, Pignataro, Maciel e Costa Advogados é um escritório de advocacia com atuação em todo território nacional e com sede nas cidades de Natal/RN, Brasília/DF e São Paulo/SP, especializado em Direito Tributário, Empresarial e Civil.</p><p>Somos uma firma jurídica especializada, construída sobre três pilares inegociáveis: confiabilidade, eficiência e segurança jurídica. Cada mandato que assumimos é tratado com a critério de quem entende que o direito é, antes de tudo, um instrumento de geração de valor para as empresas que o utilizam com inteligência.</p>"
      },
      {
        "ordem": 1,
        "titulo": "2. ESCOPO DOS SERVIÇOS",
        "conteudo": "<p>O diagnóstico abrangerá a revisão das apurações dos tributos federais IRPJ, CSLL, PIS, COFINS e Contribuições Previdenciárias, na esfera administrativa, dos últimos 05 (Cinco) anos, compreendendo a identificação de créditos e débitos tributários, bem como, em caso de apuração de créditos tributários, a retificação de DCTFs, SPEDs ECFs e EFD-Contribuições, além da elaboração de Per/Dcomps para o aproveitamento dos créditos tributários federais.</p>"
      },
      {
        "ordem": 2,
        "titulo": "3. METODOLOGIA E ETAPAS DO TRABALHO",
        "conteudo": "<p>O trabalho será desenvolvido nas seguintes etapas:</p><p>a) Disponibilização, pela EMPRESA, de procuração digital perante a RFB e dos arquivos das declarações e escriturações fiscais, conforme checklist fornecido por nossa equipe;</p><p>b) Revisão sistematizada das apurações de cada tributo, com identificação de inconsistências, pagamentos indevidos e créditos não aproveitados;</p><p>c) Elaboração da memória de cálculo e dos demonstrativos de crédito, com indicação dos fundamentos legais de cada ponto identificado;</p><p>d) Emissão do relatório final, seguida do início dos procedimentos de constituição e aproveitamento dos créditos aprovados;</p><p>e) Elaboração de esclarecimentos e defesas perante a Receita Federal, quando a empresa for instada a fazer.</p>"
      },
      {
        "ordem": 3,
        "titulo": "4. RESULTADOS ESPERADOS",
        "conteudo": "<p>Ao término dos trabalhos, a <strong>{{empresa.nome}}</strong> receberá em até 90 (noventa dias) um relatório técnico completo, com todos os aspectos tributários analisados, os demonstrativos quantitativos dos créditos identificados, com memória de cálculo e fundamentação legal.</p>"
      },
      {
        "ordem": 4,
        "titulo": "5. HONORÁRIOS",
        "conteudo": "<p>Em razão da natureza do trabalho ora proposto, nossa remuneração está integralmente vinculada ao resultado obtido. Não há qualquer cobrança antecipada, taxa de diagnóstico ou valor fixo.</p><p>Os honorários corresponderão ao percentual de <strong>{{honorarios.exito_percentual}}% (vinte por cento)</strong> sobre os valores dos créditos tributários e previdenciários efetivamente aproveitados pela EMPRESA, por meio de restituição, compensação ou lançamento nos livros fiscais, devidamente corrigidos, exigíveis no momento do respectivo aproveitamento.</p>"
      },
      {
        "ordem": 5,
        "titulo": "6. ACEITE E FORMALIZAÇÃO",
        "conteudo": "<p>Caso V.Sas. concordem com o conteúdo desta proposta, solicitamos que nos retornem sua anuência por escrito ou por meio eletrônico, para que possamos encaminhar o instrumento contratual para assinatura.</p>"
      }
    ]'::jsonb,
    admin_uid
  );
END $$;
