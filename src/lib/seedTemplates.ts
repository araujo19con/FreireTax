import type { TemplateInput } from "@/hooks/useTarefasExtras";

/**
 * Templates de tarefa de exemplo — servem como ponto de partida pro time
 * e mostram o padrão (título, descrição, prioridade, prazo relativo, subtarefas).
 */
export const SEED_TEMPLATES: Array<Partial<TemplateInput>> = [
  {
    nome: "Análise — Tema 985 (terço de férias)",
    categoria: "tema_985",
    titulo_padrao: "Analisar viabilidade rescisória — Tema 985",
    descricao_padrao:
      "Verificar se o processo do cliente preenche os requisitos para ação rescisória relacionada à contribuição previdenciária sobre o terço constitucional de férias (Tema 985 STF, modulação de efeitos).",
    prioridade_padrao: "alta",
    prazo_relativo_dias: 7,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Conferir trânsito em julgado da decisão originária", ordem: 0 },
      { titulo: "Verificar prazo bienal da rescisória", ordem: 1 },
      { titulo: "Analisar modulação dos efeitos (15/09/2020)", ordem: 2 },
      { titulo: "Calcular valor potencial de restituição", ordem: 3 },
      { titulo: "Apresentar parecer ao cliente", ordem: 4 },
    ],
  },
  {
    nome: "Diagnóstico — Tema 324 (IR dependente PCD)",
    categoria: "tema_324",
    titulo_padrao: "Diagnóstico IR dependente com deficiência — Tema 324/TNU",
    descricao_padrao:
      "Avaliar viabilidade de ação para dedução integral no IRPF das despesas com instrução de dependente com deficiência. Coletar laudos médicos, DIRPFs e comprovantes escolares.",
    prioridade_padrao: "media",
    prazo_relativo_dias: 10,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Solicitar laudo médico do dependente", ordem: 0 },
      { titulo: "Solicitar DIRPF dos últimos 5 anos", ordem: 1 },
      { titulo: "Solicitar contratos e recibos escolares", ordem: 2 },
      { titulo: "Validar checklist dos 6 requisitos", ordem: 3 },
      { titulo: "Calcular valor da causa", ordem: 4 },
      { titulo: "Definir competência (JEF ou vara comum)", ordem: 5 },
    ],
  },
  {
    nome: "Onboarding — novo cliente",
    categoria: "onboarding",
    titulo_padrao: "Onboarding novo cliente",
    descricao_padrao:
      "Recepção formal do cliente: contrato, procuração, coleta de documentos iniciais e cadastro completo no CRM.",
    prioridade_padrao: "alta",
    prazo_relativo_dias: 5,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Enviar contrato de honorários", ordem: 0 },
      { titulo: "Coletar procuração ad judicia assinada", ordem: 1 },
      { titulo: "Solicitar contrato social + alterações", ordem: 2 },
      { titulo: "Solicitar últimos 3 balanços e DRE", ordem: 3 },
      { titulo: "Cadastrar dados completos da empresa no CRM", ordem: 4 },
      { titulo: "Disparar enriquecimento RFB", ordem: 5 },
      { titulo: "Apresentar gerente da conta", ordem: 6 },
    ],
  },
  {
    nome: "Diligência cadastral RFB",
    categoria: "rfb",
    titulo_padrao: "Conferência cadastral RFB",
    descricao_padrao:
      "Verificar consistência dos dados RFB enriquecidos e atualizar campos pendentes. Sinalizar divergências para o responsável.",
    prioridade_padrao: "baixa",
    prazo_relativo_dias: 3,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Validar situação cadastral atual", ordem: 0 },
      { titulo: "Conferir CNAE principal e secundários", ordem: 1 },
      { titulo: "Atualizar capital social e porte", ordem: 2 },
      { titulo: "Confirmar regime tributário (Simples/Presumido/Real)", ordem: 3 },
    ],
  },
  {
    nome: "Follow-up de prospecção",
    categoria: "comercial",
    titulo_padrao: "Follow-up — retomar contato",
    descricao_padrao:
      "Sequência padrão de follow-up para prospecção parada há mais de 7 dias. Use o template de mensagem correspondente ao canal.",
    prioridade_padrao: "media",
    prazo_relativo_dias: 2,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Revisar último contato e CRM", ordem: 0 },
      { titulo: "Enviar mensagem de retomada (WhatsApp ou e-mail)", ordem: 1 },
      { titulo: "Agendar próxima reunião se houver retorno", ordem: 2 },
      { titulo: "Atualizar status da prospecção", ordem: 3 },
    ],
  },
  {
    nome: "Fechamento mensal de cliente",
    categoria: "operacional",
    titulo_padrao: "Fechamento mensal — relatório de andamento",
    descricao_padrao:
      "Rotina mensal de prestação de contas: status dos processos, próximos passos e cobrança/honorários do período.",
    prioridade_padrao: "media",
    prazo_relativo_dias: 30,
    acao_id: null,
    subtarefas_padrao: [
      { titulo: "Compilar status de todos os processos ativos", ordem: 0 },
      { titulo: "Listar audiências e prazos do próximo mês", ordem: 1 },
      { titulo: "Emitir nota fiscal de honorários", ordem: 2 },
      { titulo: "Enviar relatório executivo ao cliente", ordem: 3 },
      { titulo: "Agendar reunião de alinhamento", ordem: 4 },
    ],
  },
];
