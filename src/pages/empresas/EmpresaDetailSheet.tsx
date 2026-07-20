import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  Pencil,
  Trash2,
  Building2,
  FileText,
  Gavel,
  Calendar,
  MapPin,
  Users,
  Folder,
  History,
  ListTodo,
  CheckCircle2,
  ExternalLink,
  ScanSearch,
  Contact,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Empresa } from "@/hooks/useEmpresas";
import {
  formatCNPJ,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelativeDate,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { humanizeRegime, regimeColor } from "@/lib/regimeTributario";
import { BuscarCNPJDialog } from "@/components/BuscarCNPJDialog";
import type { CandidatoCNPJ } from "@/hooks/useBuscarCNPJ";
import { EmpresaContatosSection } from "@/pages/empresas/EmpresaContatosSection";

interface EmpresaDetailSheetProps {
  empresa: Empresa | null;
  onClose: () => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
  onDelete: (emp: Empresa) => void;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <Label>{label}</Label>
      <div
        className={cn(
          "text-sm",
          mono && "font-mono text-xs",
          !value && "italic text-muted-foreground"
        )}
      >
        {value || "—"}
      </div>
    </div>
  );
}

interface ElegRow {
  id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
  valor_potencial_estimado: number | null;
  ja_ajuizada: boolean;
  ajuizada_por_nos: boolean | null;
  ajuizamento_notas: string | null;
  acoes_tributarias: { nome: string; tipo: string } | null;
}
interface TarefaRow {
  id: string;
  titulo: string;
  status: string | null;
  prazo: string | null;
  prioridade: string | null;
  created_at: string;
}
interface ReuniaoRow {
  id: string;
  titulo: string | null;
  data_inicio: string;
  status: string | null;
}
interface AuditRow {
  id: string;
  acao: string;
  created_at: string;
  detalhes: unknown;
}
interface ProspeccaoTimelineRow {
  id: string;
  status_prospeccao: string | null;
  created_at: string;
  acoes_tributarias: { nome: string } | null;
}
interface ProcTribRow {
  id: string;
  numero: string;
  grau: string | null;
  classe: string | null;
  orgao: string | null;
  situacao: string | null;
  assunto: string | null;
  acao_id: string | null;
  detectado_em: string;
}
interface PastaLinkRow {
  pasta_id: string;
  pastas_empresas: { nome: string } | null;
}

function useEmpresaRelations(empresaId: string | undefined) {
  return useQuery({
    queryKey: ["empresa-relations", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      if (!empresaId)
        return {
          eleg: [],
          tarefas: [],
          reunioes: [],
          pastas: [],
          audit: [],
          prospeccoes: [],
          procTrib: [],
        } as {
          eleg: ElegRow[];
          tarefas: TarefaRow[];
          reunioes: ReuniaoRow[];
          pastas: string[];
          audit: AuditRow[];
          prospeccoes: ProspeccaoTimelineRow[];
          procTrib: ProcTribRow[];
        };
      const [elegRes, tarRes, reunRes, pastasRes, auditRes, prospRes, procTribRes] =
        await Promise.all([
          supabase
            .from("elegibilidade")
            .select(
              "id, acao_id, elegivel, justificativa, valor_potencial_estimado, ja_ajuizada, ajuizada_por_nos, ajuizamento_notas, acoes_tributarias(nome, tipo)"
            )
            .eq("empresa_id", empresaId),
          supabase
            .from("tarefas")
            .select("id, titulo, status, prazo, prioridade, created_at")
            .eq("empresa_id", empresaId)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("reunioes")
            .select("id, titulo, data_inicio, status")
            .eq("empresa_id", empresaId)
            .order("data_inicio", { ascending: false })
            .limit(20),
          supabase
            .from("pasta_empresa_items")
            .select("pasta_id, pastas_empresas(nome)")
            .eq("empresa_id", empresaId),
          supabase
            .from("audit_logs")
            .select("id, acao, created_at, detalhes")
            .eq("tabela", "empresas")
            .eq("registro_id", empresaId)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .from("prospeccoes")
            .select("id, status_prospeccao, created_at, acoes_tributarias(nome)")
            .eq("empresa_id", empresaId)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("empresa_processos_tributarios")
            .select("id, numero, grau, classe, orgao, situacao, assunto, acao_id, detectado_em")
            .eq("empresa_id", empresaId)
            .order("detectado_em", { ascending: false }),
        ]);
      const pastaLinks = (pastasRes.data || []) as unknown as PastaLinkRow[];
      return {
        eleg: (elegRes.data || []) as unknown as ElegRow[],
        tarefas: (tarRes.data || []) as unknown as TarefaRow[],
        reunioes: (reunRes.data || []) as unknown as ReuniaoRow[],
        pastas: pastaLinks.map((r) => r.pastas_empresas?.nome).filter((v): v is string => !!v),
        audit: (auditRes.data || []) as unknown as AuditRow[],
        prospeccoes: (prospRes.data || []) as unknown as ProspeccaoTimelineRow[],
        procTrib: (procTribRes.data || []) as unknown as ProcTribRow[],
      };
    },
  });
}

const STATUS_COLORS: Record<string, string> = {
  prospect: "bg-info/10 text-info border-info/30",
  cliente: "bg-success/10 text-success border-success/30",
  inativo: "bg-muted text-muted-foreground",
};

const PRIORIDADE_COLOR: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive",
  alta: "bg-warning/10 text-warning",
  media: "bg-info/10 text-info",
  baixa: "bg-muted text-muted-foreground",
};

const TAREFA_STATUS_COLOR: Record<string, string> = {
  pendente: "bg-warning/10 text-warning",
  em_andamento: "bg-info/10 text-info",
  concluida: "bg-success/10 text-success",
  cancelada: "bg-muted text-muted-foreground",
};

export function EmpresaDetailSheet({
  empresa,
  onClose,
  onEnrichir,
  onEdit,
  onDelete,
}: EmpresaDetailSheetProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const open = !!empresa;
  const [tab, setTab] = useState("overview");
  const [buscarNomeOpen, setBuscarNomeOpen] = useState(false);

  /** Quando empresa não tem CNPJ, user pode buscar pelo nome → ao selecionar,
   *  gravamos o CNPJ na empresa e disparamos enriquecimento automático. */
  const onSelectCandidatoNome = async (c: CandidatoCNPJ) => {
    if (!empresa) return;
    try {
      // Antes de gravar, valida que esse CNPJ não está em uso por outra empresa
      const { data: existing } = await supabase
        .from("empresas")
        .select("id, nome")
        .eq("cnpj", c.cnpj)
        .maybeSingle();
      if (existing && existing.id !== empresa.id) {
        toast.error(`CNPJ já cadastrado na empresa "${existing.nome}"`);
        return;
      }

      const { error: upErr } = await supabase
        .from("empresas")
        .update({ cnpj: c.cnpj })
        .eq("id", empresa.id);
      if (upErr) throw upErr;
      toast.success(`CNPJ ${c.cnpj} vinculado — enriquecendo dados...`);

      // Dispara enriquecimento RFB
      const { error: enErr, data: enData } = await supabase.functions.invoke("enriquecer-cnpj", {
        body: { cnpj: c.cnpj, empresa_id: empresa.id, force: true },
      });
      if (enErr || enData?.error) {
        toast.warning("CNPJ salvo, mas falhou enriquecimento RFB. Tente novamente em instantes.");
      } else {
        toast.success("Empresa enriquecida com dados da Receita.");
      }

      // Invalida queries pra refletir
      void qc.invalidateQueries({ queryKey: ["empresas"] });
      void qc.invalidateQueries({ queryKey: ["empresa-relations", empresa.id] });
    } catch (e) {
      toast.error("Erro ao vincular CNPJ: " + ((e as Error).message ?? "falha"));
    }
  };

  // Click numa ação dentro do card → fecha o sheet e leva pra /acoes com a
  // ação expandida e a empresa pré-filtrada no painel (deep-link).
  const openAcaoForEmpresa = (acaoId: string) => {
    if (!empresa) return;
    onClose();
    navigate(`/acoes?acao=${acaoId}&empresa=${empresa.id}`);
  };

  // Reseta aba para "overview" quando a empresa muda

  useEffect(() => {
    if (empresa) setTab("overview");
  }, [empresa?.id]);

  const { data: relations, isLoading: loadingRel } = useEmpresaRelations(empresa?.id);

  // Atualiza ajuizamento de uma elegibilidade (empresa já tem a ação / por nós).
  const updateAjuizamento = async (
    elegId: string,
    patch: { ja_ajuizada?: boolean; ajuizada_por_nos?: boolean | null }
  ) => {
    const { error } = await supabase.from("elegibilidade").update(patch).eq("id", elegId);
    if (error) {
      toast.error("Erro ao atualizar ajuizamento: " + error.message);
      return;
    }
    if (empresa) void qc.invalidateQueries({ queryKey: ["empresa-relations", empresa.id] });
  };

  if (!empresa) return null;

  const endereco = [
    [empresa.logradouro, empresa.numero_endereco].filter(Boolean).join(", "),
    empresa.complemento,
    empresa.bairro,
    [empresa.municipio, empresa.uf].filter(Boolean).join("/"),
    empresa.cep,
  ]
    .filter(Boolean)
    .join(" — ");

  type QSAMember = {
    nome?: string;
    nome_socio?: string;
    qualificacao?: string;
    cargo?: string;
    percentual?: number | string | null;
  };
  type CNAE = string | { codigo?: string; descricao?: string };
  const qsa = (Array.isArray(empresa.qsa) ? empresa.qsa : []) as QSAMember[];
  const cnaesSec = (
    Array.isArray(empresa.cnaes_secundarios) ? empresa.cnaes_secundarios : []
  ) as CNAE[];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-2xl lg:max-w-3xl">
        <SheetHeader className="border-b border-border px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 truncate font-heading text-h2">
                <Building2 className="h-5 w-5 shrink-0 text-primary" />
                <span className="truncate">{empresa.nome}</span>
              </SheetTitle>
              {empresa.razao_social && empresa.razao_social !== empresa.nome && (
                <p className="mt-1 text-xs text-muted-foreground">{empresa.razao_social}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {empresa.cnpj ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatCNPJ(empresa.cnpj)}
                  </span>
                ) : (
                  <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
                    Sem CNPJ
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`capitalize ${STATUS_COLORS[empresa.status] || ""}`}
                >
                  {empresa.status}
                </Badge>
                {empresa.situacao_cadastral && (
                  <Badge
                    variant="outline"
                    className={
                      empresa.situacao_cadastral === "ATIVA"
                        ? "border-success/30 bg-success/10 text-success"
                        : ["BAIXADA", "INAPTA", "NULA"].includes(empresa.situacao_cadastral)
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-warning/30 bg-warning/10 text-warning"
                    }
                  >
                    {empresa.situacao_cadastral}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {empresa.cnpj ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => onEnrichir(empresa)}
                  title="Atualizar RFB"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  RFB
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-warning/30 bg-warning/5 hover:bg-warning/10"
                  onClick={() => setBuscarNomeOpen(true)}
                  title="Empresa sem CNPJ — buscar na Receita pela razão social"
                >
                  <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                  Buscar CNPJ
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8" onClick={() => onEdit(empresa)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Editar
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => onDelete(empresa)}
                aria-label="Excluir"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-6 mt-3 grid h-9 grid-cols-9">
            <TabsTrigger value="overview" className="text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="contatos" className="text-xs">
              <Contact className="mr-1 h-3 w-3" />
              Contatos
            </TabsTrigger>
            <TabsTrigger value="rfb" className="text-xs">
              RFB
            </TabsTrigger>
            <TabsTrigger value="pastas" className="text-xs">
              Pastas
            </TabsTrigger>
            <TabsTrigger value="acoes" className="text-xs">
              Ações
            </TabsTrigger>
            <TabsTrigger value="tarefas" className="text-xs">
              Tarefas
            </TabsTrigger>
            <TabsTrigger value="reunioes" className="text-xs">
              Reuniões
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">
              Histórico
            </TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs">
              Timeline
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 pb-6 pt-4">
              {/* OVERVIEW */}
              <TabsContent value="overview" className="mt-0 space-y-4">
                <Card className="p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Resumo
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Nome" value={empresa.nome} />
                    <Field label="Razão Social" value={empresa.razao_social} />
                    <Field label="Nome Fantasia" value={empresa.nome_fantasia} />
                    <Field label="CNPJ" value={formatCNPJ(empresa.cnpj)} mono />
                    <Field
                      label="Status"
                      value={<span className="capitalize">{empresa.status}</span>}
                    />
                    <Field
                      label="Porte"
                      value={
                        empresa.porte && empresa.porte !== "NAO_INFORMADO" ? empresa.porte : "—"
                      }
                    />
                    <Field label="Situação cadastral" value={empresa.situacao_cadastral} />
                    <Field
                      label="UF / Município"
                      value={[empresa.municipio, empresa.uf].filter(Boolean).join(" / ")}
                    />
                    <Field label="Capital social" value={formatCurrency(empresa.capital_social)} />
                    <Field
                      label="Valor potencial"
                      value={formatCurrency(empresa.valor_potencial_total)}
                    />
                    <Field label="Data abertura" value={formatDate(empresa.data_abertura)} />
                    <Field
                      label="Faixa de Faturamento"
                      value={
                        empresa.metadados?.["Faixa de Faturamento"] ??
                        (empresa.faturamento_anual != null
                          ? formatCurrency(empresa.faturamento_anual)
                          : null)
                      }
                    />
                    <Field
                      label="Faixa de Funcionários"
                      value={
                        empresa.metadados?.["Faixa de Funcionários"] ??
                        (empresa.quantidade_funcionarios != null
                          ? empresa.quantidade_funcionarios.toString()
                          : null)
                      }
                    />
                    <Field
                      label="Regime tributário"
                      value={(() => {
                        // Só exibe se for manual — dados da RFB (opção Simples/MEI) não preenchem este campo automaticamente
                        const val = empresa.regime_tributario;
                        if (!val) return "—";
                        return (
                          <Badge variant="outline" className={`text-[10px] ${regimeColor(val)}`}>
                            {humanizeRegime(val)}
                          </Badge>
                        );
                      })()}
                    />
                  </div>
                  {empresa.obs && (
                    <div className="mt-4 border-t border-border pt-3">
                      <Label>Observações</Label>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{empresa.obs}</p>
                    </div>
                  )}
                </Card>

                {/* Campos personalizados (metadados) — exclui chaves já exibidas no Resumo */}
                {(() => {
                  const extras = Object.entries(empresa.metadados ?? {}).filter(
                    ([k]) => k !== "Faixa de Funcionários" && k !== "Faixa de Faturamento"
                  );
                  if (extras.length === 0) return null;
                  return (
                    <Card className="p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" /> Campos personalizados
                      </h3>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        {extras.map(([k, v]) => (
                          <Field key={k} label={k} value={v} />
                        ))}
                      </div>
                    </Card>
                  );
                })()}

                {/* Botão pra editar (atalho — também tem o botão no topo) */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onEdit(empresa)}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editar todos os campos / adicionar campos personalizados
                </Button>

                <Card className="p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Status RFB
                  </h3>
                  {empresa.receita_erro ? (
                    <div className="text-sm text-destructive">
                      <strong>Erro na última consulta:</strong> {empresa.receita_erro}
                    </div>
                  ) : empresa.receita_atualizada_em ? (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      Atualizada {formatRelativeDate(empresa.receita_atualizada_em)} (
                      {formatDateTime(empresa.receita_atualizada_em)})
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Nunca consultada — clique em "RFB" no topo pra buscar.
                    </div>
                  )}
                </Card>
              </TabsContent>

              {/* CONTATOS */}
              <TabsContent value="contatos" className="mt-0">
                <EmpresaContatosSection
                  empresaId={empresa.id}
                  empresaNome={empresa.nome}
                  onChanged={() => {
                    void qc.invalidateQueries({ queryKey: ["empresas"] });
                    void qc.invalidateQueries({ queryKey: ["empresa-relations", empresa.id] });
                  }}
                />
              </TabsContent>

              {/* DADOS RFB */}
              <TabsContent value="rfb" className="mt-0 space-y-4">
                <Card className="p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Identificação
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Razão social" value={empresa.razao_social} />
                    <Field label="Nome fantasia" value={empresa.nome_fantasia} />
                    <Field label="Natureza jurídica" value={empresa.natureza_juridica} />
                    <Field label="Data abertura" value={formatDate(empresa.data_abertura)} />
                    <Field label="Capital social" value={formatCurrency(empresa.capital_social)} />
                    <Field
                      label="Porte"
                      value={
                        empresa.porte && empresa.porte !== "NAO_INFORMADO" ? empresa.porte : "—"
                      }
                    />
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> Situação fiscal
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Situação cadastral" value={empresa.situacao_cadastral} />
                    <Field
                      label="Data da situação"
                      value={formatDate(empresa.situacao_cadastral_data)}
                    />
                    <Field label="Motivo" value={empresa.motivo_situacao} />
                    <Field label="Simples Nacional" value={empresa.opcao_simples ? "Sim" : "Não"} />
                    <Field
                      label="Data opção Simples"
                      value={formatDate(empresa.data_opcao_simples)}
                    />
                    <Field label="MEI" value={empresa.opcao_mei ? "Sim" : "Não"} />
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    CNAE
                  </h3>
                  <Field
                    label="Principal"
                    value={
                      empresa.cnae_principal
                        ? `${empresa.cnae_principal} — ${empresa.cnae_principal_desc}`
                        : "—"
                    }
                  />
                  {cnaesSec.length > 0 && (
                    <div className="mt-3">
                      <Label>Secundários ({cnaesSec.length})</Label>
                      <ul className="mt-1.5 space-y-1 text-xs">
                        {cnaesSec.map((c, i) => (
                          <li key={i} className="font-mono text-muted-foreground">
                            {typeof c === "string" ? c : `${c.codigo || ""} — ${c.descricao || ""}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>

                <Card className="p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> Endereço e Contato
                  </h3>
                  <Field label="Endereço completo" value={endereco} />
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="CEP" value={empresa.cep} mono />
                    <Field label="Telefone" value={empresa.telefone_receita} />
                    <Field label="E-mail" value={empresa.email_receita} />
                  </div>
                </Card>

                {qsa.length > 0 && (
                  <Card className="p-4">
                    <Accordion type="single" collapsible defaultValue="qsa">
                      <AccordionItem value="qsa" className="border-0">
                        <AccordionTrigger className="py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:no-underline">
                          <span className="flex items-center gap-2">
                            <Users className="h-3.5 w-3.5" /> Quadro societário ({qsa.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="mt-3 space-y-2 text-sm">
                            {qsa.map((s, i) => (
                              <li key={i} className="border-l-2 border-primary/20 py-1 pl-3">
                                <div className="font-medium">{s.nome || s.nome_socio || "—"}</div>
                                <div className="text-xs text-muted-foreground">
                                  {s.qualificacao || s.cargo || ""}
                                  {s.percentual != null && ` — ${s.percentual}%`}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </Card>
                )}
              </TabsContent>

              {/* PASTAS */}
              <TabsContent value="pastas" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.pastas.length ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    <Folder className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Esta empresa não está em nenhuma pasta.
                  </Card>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {relations.pastas.map((name: string) => (
                      <Badge key={name} variant="outline" className="px-3 py-1.5 text-sm">
                        <Folder className="mr-1.5 h-3.5 w-3.5" />
                        {name}
                      </Badge>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* AÇÕES */}
              <TabsContent value="acoes" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.eleg.length ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    <Gavel className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Nenhuma ação tributária vinculada.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.eleg.map((el) => {
                      const acaoRemovida = !el.acoes_tributarias;
                      return (
                        <Card
                          key={el.id}
                          className={cn(
                            "p-3 transition-colors",
                            !acaoRemovida &&
                              "cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          )}
                          role={!acaoRemovida ? "button" : undefined}
                          tabIndex={!acaoRemovida ? 0 : undefined}
                          onClick={acaoRemovida ? undefined : () => openAcaoForEmpresa(el.acao_id)}
                          onKeyDown={
                            acaoRemovida
                              ? undefined
                              : (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openAcaoForEmpresa(el.acao_id);
                                  }
                                }
                          }
                          aria-label={
                            acaoRemovida
                              ? undefined
                              : `Abrir ${el.acoes_tributarias?.nome} no painel de Ações`
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Gavel className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate text-sm font-medium">
                                  {el.acoes_tributarias?.nome || "Ação removida"}
                                </span>
                                {!acaoRemovida && (
                                  <ExternalLink
                                    className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                              </div>
                              {el.acoes_tributarias?.tipo && (
                                <span className="ml-5 text-[11px] text-muted-foreground">
                                  {el.acoes_tributarias.tipo}
                                </span>
                              )}
                              {el.justificativa && (
                                <p className="ml-5 mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {el.justificativa}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge
                                variant="outline"
                                className={
                                  el.elegivel
                                    ? "border-success/30 bg-success/10 text-success"
                                    : "border-destructive/30 bg-destructive/10 text-destructive"
                                }
                              >
                                {el.elegivel ? "Elegível" : "Não elegível"}
                              </Badge>
                              {el.valor_potencial_estimado && (
                                <span className="text-xs font-medium tabular-nums">
                                  {formatCurrency(el.valor_potencial_estimado)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Ajuizamento — a empresa já entrou com esta ação? foi por nós? */}
                          <div
                            className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {el.ja_ajuizada ? (
                              <>
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600"
                                >
                                  <Gavel className="mr-1 h-3 w-3" /> Já ajuizada
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">por:</span>
                                {[
                                  { v: true as boolean | null, label: "Nós" },
                                  { v: false as boolean | null, label: "Terceiro" },
                                  { v: null as boolean | null, label: "A definir" },
                                ].map((opt) => (
                                  <Button
                                    key={String(opt.v)}
                                    size="sm"
                                    variant={el.ajuizada_por_nos === opt.v ? "default" : "outline"}
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() =>
                                      void updateAjuizamento(el.id, { ajuizada_por_nos: opt.v })
                                    }
                                  >
                                    {opt.label}
                                  </Button>
                                ))}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="ml-auto h-6 px-2 text-[10px] text-muted-foreground"
                                  onClick={() =>
                                    void updateAjuizamento(el.id, {
                                      ja_ajuizada: false,
                                      ajuizada_por_nos: null,
                                    })
                                  }
                                >
                                  Desmarcar
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] text-muted-foreground"
                                onClick={() => void updateAjuizamento(el.id, { ja_ajuizada: true })}
                              >
                                <Gavel className="mr-1 h-3 w-3" /> Marcar como já ajuizada
                              </Button>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Processos tributários próprios detectados no PJe (por CNPJ) */}
                {relations && relations.procTrib.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-info/30 bg-info/5 p-3">
                    <div className="flex items-center gap-2">
                      <ScanSearch className="h-4 w-4 text-info" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Processos tributários no PJe ({relations.procTrib.length}) — já ajuizados
                      </h4>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Ações tributárias que a própria empresa já ajuizou (autora, vara fazendária),
                      detectadas por CNPJ. As teses do catálogo não vinculadas acima são a oferta.
                    </p>
                    {relations.procTrib.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-md border border-border bg-background p-2 text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <Gavel className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-mono">{p.numero}</span>
                          {p.grau && (
                            <Badge variant="outline" className="text-[9px]">
                              {p.grau}
                            </Badge>
                          )}
                        </div>
                        {(p.classe || p.orgao) && (
                          <p className="ml-4 mt-0.5 text-[11px] text-muted-foreground">
                            {[p.classe, p.orgao].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {p.assunto && (
                          <p className="ml-4 text-[11px] text-info">Assunto: {p.assunto}</p>
                        )}
                        {p.situacao && (
                          <p className="ml-4 text-[10px] text-muted-foreground">{p.situacao}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* TAREFAS */}
              <TabsContent value="tarefas" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.tarefas.length ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    <ListTodo className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Nenhuma tarefa vinculada a esta empresa.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.tarefas.map((t) => (
                      <Card key={t.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{t.titulo}</p>
                            {t.prazo && (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                Prazo: {formatDate(t.prazo)} ({formatRelativeDate(t.prazo)})
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {t.prioridade && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] ${PRIORIDADE_COLOR[t.prioridade] || ""}`}
                              >
                                {t.prioridade}
                              </Badge>
                            )}
                            {t.status && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] ${TAREFA_STATUS_COLOR[t.status] || ""}`}
                              >
                                {t.status.replace("_", " ")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* REUNIÕES */}
              <TabsContent value="reunioes" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.reunioes.length ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    <Calendar className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Nenhuma reunião registrada.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.reunioes.map((r) => (
                      <Card key={r.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{r.titulo || "Reunião"}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {formatDateTime(r.data_inicio)} · {formatRelativeDate(r.data_inicio)}
                            </p>
                          </div>
                          {r.status && (
                            <Badge variant="outline" className="text-[9px] capitalize">
                              {r.status}
                            </Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* HISTÓRICO */}
              <TabsContent value="audit" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.audit.length ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">
                    <History className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    Sem registros no audit log.
                  </Card>
                ) : (
                  <div className="relative pl-5">
                    <div className="absolute bottom-1 left-1.5 top-1 w-px bg-border" aria-hidden />
                    <ul className="space-y-3">
                      {relations.audit.map((a) => (
                        <li key={a.id} className="relative">
                          <div className="absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
                          <Card className="p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{a.acao}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatDateTime(a.created_at)}
                              </span>
                            </div>
                            {a.detalhes &&
                              typeof a.detalhes === "object" &&
                              Object.keys(a.detalhes).length > 0 && (
                                <pre className="mt-1.5 overflow-x-auto rounded bg-muted/50 p-1.5 text-[10px] text-muted-foreground">
                                  {JSON.stringify(a.detalhes, null, 2)}
                                </pre>
                              )}
                          </Card>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              {/* TIMELINE */}
              <TabsContent value="timeline" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : (
                  (() => {
                    type TLKind = "tarefa" | "reuniao" | "audit" | "prospeccao";
                    interface TLEvent {
                      id: string;
                      kind: TLKind;
                      date: string;
                      titulo: string;
                      subtitulo?: string;
                      meta?: string;
                    }
                    const events: TLEvent[] = [
                      ...(relations?.tarefas ?? []).map((t) => ({
                        id: `t-${t.id}`,
                        kind: "tarefa" as TLKind,
                        date: t.created_at,
                        titulo: t.titulo,
                        subtitulo: t.prazo ? `Prazo: ${formatDate(t.prazo)}` : undefined,
                        meta: t.status ?? undefined,
                      })),
                      ...(relations?.reunioes ?? []).map((r) => ({
                        id: `r-${r.id}`,
                        kind: "reuniao" as TLKind,
                        date: r.data_inicio,
                        titulo: r.titulo ?? "Reunião",
                        meta: r.status ?? undefined,
                      })),
                      ...(relations?.prospeccoes ?? []).map((p) => ({
                        id: `p-${p.id}`,
                        kind: "prospeccao" as TLKind,
                        date: p.created_at,
                        titulo: `Prospecção: ${p.acoes_tributarias?.nome ?? "Ação"}`,
                        meta: p.status_prospeccao ?? undefined,
                      })),
                      ...(relations?.audit ?? []).map((a) => ({
                        id: `a-${a.id}`,
                        kind: "audit" as TLKind,
                        date: a.created_at,
                        titulo: a.acao,
                        subtitulo:
                          a.detalhes &&
                          typeof a.detalhes === "object" &&
                          Object.keys(a.detalhes).length > 0
                            ? JSON.stringify(a.detalhes)
                            : undefined,
                      })),
                    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                    const KIND_ICON: Record<TLKind, React.ReactNode> = {
                      tarefa: <ListTodo className="h-3.5 w-3.5" />,
                      reuniao: <Calendar className="h-3.5 w-3.5" />,
                      prospeccao: <Gavel className="h-3.5 w-3.5" />,
                      audit: <History className="h-3.5 w-3.5" />,
                    };
                    const KIND_COLOR: Record<TLKind, string> = {
                      tarefa: "bg-blue-500",
                      reuniao: "bg-green-500",
                      prospeccao: "bg-purple-500",
                      audit: "bg-muted-foreground",
                    };
                    const KIND_LABEL: Record<TLKind, string> = {
                      tarefa: "Tarefa",
                      reuniao: "Reunião",
                      prospeccao: "Prospecção",
                      audit: "Histórico",
                    };

                    if (!events.length) {
                      return (
                        <Card className="p-8 text-center text-sm text-muted-foreground">
                          <History className="mx-auto mb-2 h-6 w-6 opacity-50" />
                          Nenhum evento registrado para esta empresa.
                        </Card>
                      );
                    }

                    return (
                      <div className="relative pl-5">
                        <div
                          className="absolute bottom-1 left-1.5 top-1 w-px bg-border"
                          aria-hidden
                        />
                        <ul className="space-y-3">
                          {events.map((ev) => (
                            <li key={ev.id} className="relative">
                              <div
                                className={`absolute -left-[17px] top-1 flex h-6 w-6 items-center justify-center rounded-full text-white ring-2 ring-background ${KIND_COLOR[ev.kind]}`}
                              >
                                {KIND_ICON[ev.kind]}
                              </div>
                              <Card className="p-2.5 text-xs">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                        {KIND_LABEL[ev.kind]}
                                      </span>
                                      {ev.meta && (
                                        <Badge variant="outline" className="text-[9px] capitalize">
                                          {ev.meta.replace("_", " ")}
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="mt-0.5 font-medium leading-tight">{ev.titulo}</p>
                                    {ev.subtitulo && (
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {ev.subtitulo}
                                      </p>
                                    )}
                                  </div>
                                  <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {formatRelativeDate(ev.date)}
                                  </span>
                                </div>
                              </Card>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
      <BuscarCNPJDialog
        open={buscarNomeOpen}
        onOpenChange={setBuscarNomeOpen}
        termoInicial={empresa.razao_social || empresa.nome || ""}
        ufInicial={empresa.uf || ""}
        onSelect={(c) => {
          void onSelectCandidatoNome(c);
        }}
      />
    </Sheet>
  );
}
