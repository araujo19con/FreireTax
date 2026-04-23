import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/PageHeader";
import {
  BookOpen,
  Building2,
  Upload,
  Scale,
  FileCheck,
  Handshake,
  FileText,
  CalendarDays,
  ArrowRight,
  Lightbulb,
  Users,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  MessageSquareQuote,
} from "lucide-react";

/**
 * Página de tutorial/onboarding. Abas:
 *   - Bem-vindo: o que é o sistema, pra quem é
 *   - Fluxo Principal: passo a passo do caminho feliz
 *   - Glossário: termos técnicos traduzidos
 *   - Perfis & Permissões: o que cada papel pode fazer
 *   - Dicas: atalhos e boas práticas
 * URL sincronizada via ?tab=... pra permitir deep-link.
 */
type TabKey = "bem-vindo" | "fluxo" | "glossario" | "perfis" | "dicas";
const VALID_TABS: TabKey[] = ["bem-vindo", "fluxo", "glossario", "perfis", "dicas"];

export default function Tutorial() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = VALID_TABS.includes(raw as TabKey) ? (raw as TabKey) : "bem-vindo";

  useEffect(() => {
    if (raw !== tab) {
      const next = new URLSearchParams(params);
      next.set("tab", tab);
      setParams(next, { replace: true });
    }
  }, [raw, tab, params, setParams]);

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Tutorial"
        description="Entenda o Tax Trakker em 10 minutos — o que é, como funciona e por onde começar."
        icon={<BookOpen className="h-7 w-7" />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1 p-1">
          <TabsTrigger value="bem-vindo" className="flex-1 min-w-[100px]">Bem-vindo</TabsTrigger>
          <TabsTrigger value="fluxo" className="flex-1 min-w-[130px]">Fluxo principal</TabsTrigger>
          <TabsTrigger value="glossario" className="flex-1 min-w-[100px]">Glossário</TabsTrigger>
          <TabsTrigger value="perfis" className="flex-1 min-w-[80px]">Perfis</TabsTrigger>
          <TabsTrigger value="dicas" className="flex-1 min-w-[80px]">Dicas</TabsTrigger>
        </TabsList>

        <TabsContent value="bem-vindo" className="mt-6">
          <BemVindoSection />
        </TabsContent>
        <TabsContent value="fluxo" className="mt-6">
          <FluxoSection />
        </TabsContent>
        <TabsContent value="glossario" className="mt-6">
          <GlossarioSection />
        </TabsContent>
        <TabsContent value="perfis" className="mt-6">
          <PerfisSection />
        </TabsContent>
        <TabsContent value="dicas" className="mt-6">
          <DicasSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Seção: Bem-vindo
// ============================================================
function BemVindoSection() {
  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h2 className="font-heading text-xl font-semibold mb-3">O que é o Tax Trakker</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          CRM jurídico-tributário do escritório Freire Pignataro. Ele conecta{" "}
          <strong className="text-foreground">empresas</strong> (clientes e prospects) a{" "}
          <strong className="text-foreground">ações tributárias</strong> (teses jurídicas) e organiza a
          prospecção comercial ponta a ponta — da primeira consulta à RFB até o contrato assinado e as
          tarefas de execução.
        </p>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Empresas</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Cadastro enriquecido com dados da Receita Federal. Individuais ou em lote via planilha.
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Ações Tributárias</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Teses jurídicas com regras que filtram automaticamente quais empresas do banco são elegíveis.
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Handshake className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Prospecção</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Kanban comercial em 7 estágios, do primeiro contato ao início do serviço.
          </p>
        </Card>
      </div>

      <Card className="p-6 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sm mb-1">Primeira vez aqui?</h3>
            <p className="text-xs text-muted-foreground">
              Vá para a aba <strong>Fluxo principal</strong> acima — ela mostra o passo-a-passo do caminho
              recomendado, do cadastro da primeira empresa até fechar o primeiro contrato.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Seção: Fluxo principal
// ============================================================
type Step = {
  n: number;
  titulo: string;
  icon: React.ComponentType<{ className?: string }>;
  resumo: string;
  detalhe: string;
  link: { to: string; label: string };
  dicas?: string[];
};

const STEPS: Step[] = [
  {
    n: 1,
    titulo: "Cadastrar empresas",
    icon: Building2,
    resumo: "Popule a base com os CNPJs que você quer trabalhar.",
    detalhe:
      "Você pode cadastrar uma empresa de cada vez pelo botão 'Nova Empresa' (só CNPJ + nome já bastam) ou importar dezenas em massa pela tela de Importação. Em qualquer um dos caminhos, o sistema consulta a Receita Federal e traz razão social, porte, situação cadastral, endereço, CNAE etc.",
    link: { to: "/empresas", label: "Abrir Empresas" },
    dicas: [
      "CNPJ é único — duplicatas são bloqueadas.",
      "Campos Faixa de Funcionários, Faixa de Faturamento e Regime Tributário vêm só de entrada manual ou planilha — o sistema não tenta adivinhar.",
    ],
  },
  {
    n: 2,
    titulo: "Importar em massa (opcional)",
    icon: Upload,
    resumo: "Tem uma lista com centenas de CNPJs? Importe e enriqueça de uma vez.",
    detalhe:
      "A tela de Importação aceita planilha (.xlsx/.csv) com pelo menos CNPJ e nome. Colunas extras como 'Faixa de Faturamento' ou 'Regime Tributário' são preservadas. Após o upload, o sistema enriquece cada CNPJ via BrasilAPI — cache de 90 dias evita reconsultas.",
    link: { to: "/importacao", label: "Abrir Importação" },
    dicas: [
      "Valores em colunas de faixa podem vir como texto livre ('500 A 999') — o filtro de empresas reconhece.",
      "Importação detecta duplicatas dentro do arquivo e no banco.",
    ],
  },
  {
    n: 3,
    titulo: "Criar ações tributárias",
    icon: Scale,
    resumo: "Cadastre as teses jurídicas que o escritório trabalha.",
    detalhe:
      "Cada ação representa uma tese (ex.: exclusão do ICMS da base do PIS/COFINS). Você define regras de elegibilidade (porte, UF, CNAE, regime tributário…) e o sistema automaticamente calcula o 'pool' — a lista de empresas no banco que batem com as regras.",
    link: { to: "/acoes", label: "Abrir Ações" },
    dicas: [
      "Comece com regras largas; refine depois olhando o pool gerado.",
      "Valor estimado por empresa multiplicado pelo pool = valor potencial total da tese.",
    ],
  },
  {
    n: 4,
    titulo: "Qualificar elegibilidade",
    icon: FileCheck,
    resumo: "Confirme uma a uma quais empresas do pool têm de fato a tese aplicável.",
    detalhe:
      "O Pool é automático pelas regras. A Elegibilidade é a validação humana: o advogado revisa cada candidata e marca como Qualificada (vale prospectar), Desqualificada (não se aplica) ou Em Prospecção (passou pro pipeline comercial). A matriz mostra todas as combinações empresa × ação.",
    link: { to: "/elegibilidade", label: "Abrir Elegibilidade" },
    dicas: [
      "Desqualificação pede motivo — alimenta relatórios de 'por que a gente não pega essas'.",
      "Ao qualificar, você pode ajustar o valor potencial específico daquela empresa.",
    ],
  },
  {
    n: 5,
    titulo: "Conduzir a prospecção",
    icon: Handshake,
    resumo: "Pipeline Kanban com 7 estágios até fechar ou perder o deal.",
    detalhe:
      "Ao qualificar uma empresa numa ação, ela vira uma prospecção automaticamente. Arraste pelo Kanban: Não iniciado → Contato inicial → Qualificação → Proposta enviada → Negociação → Contrato assinado → Serviço iniciado (ou Perdido). Cada mudança é auditada.",
    link: { to: "/prospeccao", label: "Abrir Prospecção" },
    dicas: [
      "Ao criar uma prospecção, uma tarefa 'Contato inicial' é criada automaticamente no Meu Espaço.",
      "Prospecções sem contato há 7+ dias aparecem com badge vermelho — 'prosp_parados'.",
    ],
  },
  {
    n: 6,
    titulo: "Enviar proposta",
    icon: FileText,
    resumo: "Templates com timbrado oficial e variáveis automáticas.",
    detalhe:
      "Use um template de proposta existente ou crie um novo. O sistema substitui variáveis ({{razao_social}}, {{cnpj}}, {{valor_potencial}}) e gera um PDF com timbrado do escritório. Cada prospecção tem no máximo uma proposta atrelada.",
    link: { to: "/propostas/templates", label: "Ver templates" },
    dicas: [
      "Templates são reutilizáveis — crie um por tipo de tese.",
      "O print/PDF usa <table> com thead/tfoot pra repetir o timbrado em todas as páginas.",
    ],
  },
  {
    n: 7,
    titulo: "Acompanhar com tarefas e reuniões",
    icon: CalendarDays,
    resumo: "Meu Espaço é o hub diário: semana, tarefas e agenda num lugar só.",
    detalhe:
      "Cada prospecção e proposta gera tarefas. Reuniões agendadas aparecem na agenda pessoal e podem ser exportadas via .ics. Tarefas atrasadas disparam badge vermelho na sidebar — a prioridade da sua semana fica visível ao abrir o app.",
    link: { to: "/meu-espaco", label: "Abrir Meu Espaço" },
    dicas: [
      "Use templates de tarefa pra não reinventar os mesmos checklists.",
      "Gestor e admin veem a aba Equipe com as tarefas de todo mundo.",
    ],
  },
];

function FluxoSection() {
  return (
    <div className="space-y-4">
      <Card className="p-5 bg-muted/40">
        <p className="text-sm text-muted-foreground">
          O Tax Trakker segue uma lógica de funil: <strong className="text-foreground">Empresa</strong> →{" "}
          <strong className="text-foreground">Ação</strong> →{" "}
          <strong className="text-foreground">Elegibilidade</strong> →{" "}
          <strong className="text-foreground">Prospecção</strong> →{" "}
          <strong className="text-foreground">Proposta</strong> →{" "}
          <strong className="text-foreground">Execução</strong>. Cada etapa abaixo é uma página do menu.
        </p>
      </Card>

      <ol className="space-y-4">
        {STEPS.map((step) => (
          <StepCard key={step.n} step={step} />
        ))}
      </ol>
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const Icon = step.icon;
  return (
    <li>
    <Card className="p-5 flex gap-4">
      <div className="shrink-0">
        <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center font-heading font-bold text-primary">
          {step.n}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="font-heading font-semibold text-base">{step.titulo}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{step.resumo}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.detalhe}</p>
        {step.dicas && step.dicas.length > 0 && (
          <ul className="space-y-1 mb-3">
            {step.dicas.map((d, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <Lightbulb className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
        <Button asChild size="sm" variant="outline">
          <Link to={step.link.to}>
            {step.link.label}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
    </li>
  );
}

// ============================================================
// Seção: Glossário
// ============================================================
type Termo = { termo: string; o_que_e: string; quando_usar: string };

const TERMOS: Termo[] = [
  {
    termo: "RFB / Enriquecimento",
    o_que_e:
      "RFB = Receita Federal do Brasil. 'Enriquecer' significa consultar a BrasilAPI com o CNPJ e trazer dados oficiais (razão, porte, CNAE, situação, endereço, QSA).",
    quando_usar: "Ao cadastrar ou importar empresas — é automático. Cache de 90 dias evita reconsultas.",
  },
  {
    termo: "Porte (MEI / ME / EPP / DEMAIS)",
    o_que_e:
      "Classificação oficial da Receita. MEI = microempreendedor, ME = micro, EPP = pequena, DEMAIS = médio/grande.",
    quando_usar: "Usado nas regras de elegibilidade e nos filtros de Empresas.",
  },
  {
    termo: "Pool (de uma ação)",
    o_que_e:
      "Lista de empresas que batem automaticamente com as regras de elegibilidade da ação. É dinâmico — muda se as regras mudam ou se empresas entram/saem do banco.",
    quando_usar: "Pra ver o universo teórico de uma tese antes de qualificar caso a caso.",
  },
  {
    termo: "Elegibilidade",
    o_que_e:
      "Registro manual que diz: 'para esta empresa nesta ação, o estado é X'. Estados: não avaliada, qualificada, desqualificada, em prospecção, fechada, perdida.",
    quando_usar: "Pra validar humanamente o que o pool sugeriu. Só qualificada vai pro pipeline comercial.",
  },
  {
    termo: "Prospecção",
    o_que_e:
      "Deal comercial de uma empresa numa ação específica, num dos 7 estágios do kanban. Criada quando você qualifica uma elegibilidade e move pra 'em prospecção'.",
    quando_usar: "É a página-dia-a-dia da equipe comercial.",
  },
  {
    termo: "Status da Empresa (CRM)",
    o_que_e: "Prospect / Cliente / Inativo. Define onde ela está no relacionamento geral com o escritório.",
    quando_usar:
      "Independente do estado de elegibilidade. Uma empresa pode ser 'cliente' numa tese e 'prospect' em outra — o status CRM reflete o geral.",
  },
  {
    termo: "Valor potencial",
    o_que_e:
      "Estimativa financeira da ação para aquela empresa (honorários ou recuperação tributária — depende da tese). Soma dos valores potenciais = funil de valor.",
    quando_usar: "Pra priorizar esforço comercial e reportar potencial de pipeline.",
  },
  {
    termo: "Regras de elegibilidade",
    o_que_e:
      "Filtros salvos numa ação (porte, UF, opção pelo Simples, CNAE, capital mínimo...) que definem automaticamente o pool.",
    quando_usar: "Na tela de Ações, ao criar/editar uma tese.",
  },
  {
    termo: "Regime Tributário",
    o_que_e: "Simples / MEI / Lucro Presumido / Lucro Real / Imune-Isento.",
    quando_usar:
      "Campo manual ou importado. O sistema não infere automaticamente — se não estiver preenchido, aparece '—' no resumo.",
  },
  {
    termo: "QSA",
    o_que_e: "Quadro Societário e Administrativo. Sócios e administradores vindos da Receita Federal.",
    quando_usar: "Na aba RFB do detalhe da empresa, útil pra identificar tomador de decisão.",
  },
];

function GlossarioSection() {
  return (
    <div className="space-y-3">
      <Card className="p-5 bg-muted/40">
        <p className="text-sm text-muted-foreground">
          Os termos abaixo aparecem em várias telas. Se um texto do sistema ficou confuso, provavelmente está
          aqui.
        </p>
      </Card>
      <div className="grid md:grid-cols-2 gap-3">
        {TERMOS.map((t) => (
          <Card key={t.termo} className="p-4">
            <h3 className="font-heading font-semibold text-sm mb-2 flex items-center gap-2">
              <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
              {t.termo}
            </h3>
            <p className="text-xs text-muted-foreground mb-2">{t.o_que_e}</p>
            <Separator className="my-2" />
            <p className="text-xs">
              <span className="text-muted-foreground">Quando usar: </span>
              <span>{t.quando_usar}</span>
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Seção: Perfis
// ============================================================
type Perfil = {
  nome: string;
  cor: string;
  icon: React.ComponentType<{ className?: string }>;
  pode: string[];
  nao_pode: string[];
};

const PERFIS: Perfil[] = [
  {
    nome: "Admin",
    cor: "bg-destructive/10 text-destructive border-destructive/30",
    icon: ShieldCheck,
    pode: [
      "Tudo — gerenciar usuários, configurar o sistema, ver auditoria.",
      "Criar/editar/excluir qualquer empresa, ação, prospecção, tarefa.",
      "Ver Administração, Usuários, Auditoria.",
    ],
    nao_pode: [],
  },
  {
    nome: "Gestor",
    cor: "bg-primary/10 text-primary border-primary/30",
    icon: Users,
    pode: [
      "Ver tudo no escopo operacional (empresas, ações, prospecções, tarefas).",
      "Aba Equipe — ver tarefas de todo mundo.",
      "Gerenciar templates de proposta e tarefa.",
    ],
    nao_pode: ["Gerenciar usuários ou roles.", "Alterar configurações globais do sistema."],
  },
  {
    nome: "Advogado",
    cor: "bg-info/10 text-info border-info/30",
    icon: FileCheck,
    pode: [
      "Ver/editar empresas e ações onde é responsável.",
      "Qualificar elegibilidade, conduzir prospecção própria.",
      "Gerenciar próprias tarefas e agenda.",
    ],
    nao_pode: ["Ver tarefas de outros advogados.", "Acessar Administração."],
  },
  {
    nome: "Comercial",
    cor: "bg-success/10 text-success border-success/30",
    icon: Handshake,
    pode: [
      "Conduzir prospecções próprias no Kanban.",
      "Criar propostas a partir de templates.",
      "Gerenciar próprias tarefas e agenda.",
    ],
    nao_pode: ["Editar regras de ação tributária.", "Ver tarefas de outros usuários."],
  },
];

function PerfisSection() {
  return (
    <div className="space-y-4">
      <Card className="p-5 bg-muted/40">
        <p className="text-sm text-muted-foreground">
          Se um item do menu não está visível pra você, provavelmente o seu perfil não tem permissão. Fale com
          o administrador se precisar de acesso.
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {PERFIS.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.nome} className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="font-heading font-semibold text-base">{p.nome}</h3>
                <Badge variant="outline" className={`text-[10px] ${p.cor}`}>
                  {p.nome}
                </Badge>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Pode</p>
                  <ul className="space-y-1">
                    {p.pode.map((item, i) => (
                      <li key={i} className="text-xs flex gap-2">
                        <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {p.nao_pode.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                      Não pode
                    </p>
                    <ul className="space-y-1">
                      {p.nao_pode.map((item, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-2">
                          <span className="text-destructive shrink-0">×</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Seção: Dicas
// ============================================================
type Dica = { titulo: string; texto: string };

const DICAS: Dica[] = [
  {
    titulo: "Seleção em massa nas empresas",
    texto:
      "Marque 2+ linhas na tabela de Empresas e uma barra de ações aparece no topo: mover pra pasta, vincular ação, exportar seleção, excluir em lote.",
  },
  {
    titulo: "Filtros salvos na URL",
    texto:
      "Qualquer filtro aplicado em Empresas, Elegibilidade ou Prospecção fica na URL — compartilhe o link com o time e eles verão a mesma visão.",
  },
  {
    titulo: "Badge vermelho na sidebar",
    texto:
      "Pontos vermelhos no menu indicam ação requerida: tarefas atrasadas, prospecções paradas há 7+ dias, reuniões para hoje.",
  },
  {
    titulo: "CNPJ duplicado é bloqueado",
    texto:
      "Se tentar cadastrar uma empresa cujo CNPJ já existe, o sistema recusa com mensagem clara e aponta qual registro colide.",
  },
  {
    titulo: "Cache RFB de 90 dias",
    texto:
      "Consultas à Receita são cacheadas — se você re-consultar o mesmo CNPJ dentro de 90 dias, vem do cache (gratuito, instantâneo).",
  },
  {
    titulo: "Templates de proposta com variáveis",
    texto:
      "Use {{razao_social}}, {{cnpj}}, {{valor_potencial}} etc. no template. Ao gerar a proposta, o sistema substitui pelos dados reais da empresa.",
  },
  {
    titulo: "Faixas importadas viram filtros",
    texto:
      "Ao importar planilha com 'Faixa de Funcionários' = '500 A 999', o valor vira filtro no popover. Presets numéricos (11-50, 51-200...) auto-incluem as faixas textuais que têm sobreposição.",
  },
  {
    titulo: "Exportar respeita filtros",
    texto:
      "Clicar em exportar (xlsx/csv) exporta exatamente o que o filtro atual mostra — não a base inteira.",
  },
];

function DicasSection() {
  return (
    <div className="space-y-3">
      <Card className="p-5 bg-muted/40 flex items-start gap-3">
        <Lightbulb className="h-5 w-5 text-warning shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          Coisas não-óbvias que economizam tempo no dia a dia. Não é exaustivo — se você descobriu um atalho
          que não está aqui, avise o time pra incluir.
        </p>
      </Card>
      <div className="grid md:grid-cols-2 gap-3">
        {DICAS.map((d) => (
          <Card key={d.titulo} className="p-4">
            <h3 className="font-semibold text-sm mb-1.5 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {d.titulo}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{d.texto}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
