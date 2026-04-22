import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw, Pencil, Trash2, Building2, FileText, Gavel, Calendar,
  MapPin, Phone, Mail, Users, Folder, History, ListTodo, CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { Empresa } from "@/hooks/useEmpresas";
import { formatCNPJ, formatCurrency, formatDate, formatDateTime, formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface EmpresaDetailSheetProps {
  empresa: Empresa | null;
  onClose: () => void;
  onEnrichir: (emp: Empresa) => void;
  onEdit: (emp: Empresa) => void;
  onDelete: (emp: Empresa) => void;
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{children}</span>;
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <Label>{label}</Label>
      <div className={cn("text-sm", mono && "font-mono text-xs", !value && "text-muted-foreground italic")}>
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
  acoes_tributarias: { nome: string; tipo: string } | null;
}
interface TarefaRow { id: string; titulo: string; status: string | null; prazo: string | null; prioridade: string | null }
interface ReuniaoRow { id: string; titulo: string | null; data_inicio: string; status: string | null }
interface AuditRow { id: string; acao: string; created_at: string; detalhes: unknown }
interface PastaLinkRow { pasta_id: string; pastas_empresas: { nome: string } | null }

function useEmpresaRelations(empresaId: string | undefined) {
  return useQuery({
    queryKey: ["empresa-relations", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      if (!empresaId) return { eleg: [], tarefas: [], reunioes: [], pastas: [], audit: [] } as {
        eleg: ElegRow[]; tarefas: TarefaRow[]; reunioes: ReuniaoRow[]; pastas: string[]; audit: AuditRow[];
      };
      const [elegRes, tarRes, reunRes, pastasRes, auditRes] = await Promise.all([
        supabase
          .from("elegibilidade")
          .select("id, acao_id, elegivel, justificativa, valor_potencial_estimado, acoes_tributarias(nome, tipo)")
          .eq("empresa_id", empresaId),
        supabase
          .from("tarefas")
          .select("id, titulo, status, prazo, prioridade")
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
      ]);
      const pastaLinks = (pastasRes.data || []) as unknown as PastaLinkRow[];
      return {
        eleg: (elegRes.data || []) as unknown as ElegRow[],
        tarefas: (tarRes.data || []) as unknown as TarefaRow[],
        reunioes: (reunRes.data || []) as unknown as ReuniaoRow[],
        pastas: pastaLinks.map((r) => r.pastas_empresas?.nome).filter((v): v is string => !!v),
        audit: (auditRes.data || []) as unknown as AuditRow[],
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

export function EmpresaDetailSheet({ empresa, onClose, onEnrichir, onEdit, onDelete }: EmpresaDetailSheetProps) {
  const open = !!empresa;
  const [tab, setTab] = useState("overview");

  // Reseta aba para "overview" quando a empresa muda
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (empresa) setTab("overview"); }, [empresa?.id]);

  const { data: relations, isLoading: loadingRel } = useEmpresaRelations(empresa?.id);

  if (!empresa) return null;

  const endereco = [
    [empresa.logradouro, empresa.numero_endereco].filter(Boolean).join(", "),
    empresa.complemento,
    empresa.bairro,
    [empresa.municipio, empresa.uf].filter(Boolean).join("/"),
    empresa.cep,
  ].filter(Boolean).join(" — ");

  type QSAMember = { nome?: string; nome_socio?: string; qualificacao?: string; cargo?: string; percentual?: number | string | null };
  type CNAE = string | { codigo?: string; descricao?: string };
  const qsa = (Array.isArray(empresa.qsa) ? empresa.qsa : []) as QSAMember[];
  const cnaesSec = (Array.isArray(empresa.cnaes_secundarios) ? empresa.cnaes_secundarios : []) as CNAE[];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-heading text-h2 flex items-center gap-2 truncate">
                <Building2 className="h-5 w-5 text-primary shrink-0" />
                <span className="truncate">{empresa.nome}</span>
              </SheetTitle>
              {empresa.razao_social && empresa.razao_social !== empresa.nome && (
                <p className="text-xs text-muted-foreground mt-1">{empresa.razao_social}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground">{formatCNPJ(empresa.cnpj)}</span>
                <Badge variant="outline" className={`capitalize ${STATUS_COLORS[empresa.status] || ""}`}>
                  {empresa.status}
                </Badge>
                {empresa.situacao_cadastral && (
                  <Badge
                    variant="outline"
                    className={
                      empresa.situacao_cadastral === "ATIVA" ? "bg-success/10 text-success border-success/30" :
                      ["BAIXADA","INAPTA","NULA"].includes(empresa.situacao_cadastral) ? "bg-destructive/10 text-destructive border-destructive/30" :
                      "bg-warning/10 text-warning border-warning/30"
                    }
                  >
                    {empresa.situacao_cadastral}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline" size="sm" className="h-8"
                onClick={() => onEnrichir(empresa)}
                title="Atualizar RFB"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />RFB
              </Button>
              <Button
                variant="outline" size="sm" className="h-8"
                onClick={() => onEdit(empresa)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Editar
              </Button>
              <Button
                variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => onDelete(empresa)}
                aria-label="Excluir"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-3 grid grid-cols-7 h-9">
            <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
            <TabsTrigger value="rfb" className="text-xs">RFB</TabsTrigger>
            <TabsTrigger value="pastas" className="text-xs">Pastas</TabsTrigger>
            <TabsTrigger value="acoes" className="text-xs">Ações</TabsTrigger>
            <TabsTrigger value="tarefas" className="text-xs">Tarefas</TabsTrigger>
            <TabsTrigger value="reunioes" className="text-xs">Reuniões</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs">Histórico</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 pt-4 pb-6">
              {/* OVERVIEW */}
              <TabsContent value="overview" className="mt-0 space-y-4">
                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Resumo</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Nome" value={empresa.nome} />
                    <Field label="Razão Social" value={empresa.razao_social} />
                    <Field label="Nome Fantasia" value={empresa.nome_fantasia} />
                    <Field label="CNPJ" value={formatCNPJ(empresa.cnpj)} mono />
                    <Field label="Status" value={<span className="capitalize">{empresa.status}</span>} />
                    <Field label="Porte" value={empresa.porte && empresa.porte !== "NAO_INFORMADO" ? empresa.porte : "—"} />
                    <Field label="Situação cadastral" value={empresa.situacao_cadastral} />
                    <Field label="UF / Município" value={[empresa.municipio, empresa.uf].filter(Boolean).join(" / ")} />
                    <Field label="Capital social" value={formatCurrency(empresa.capital_social)} />
                    <Field label="Valor potencial" value={formatCurrency(empresa.valor_potencial_total)} />
                    <Field label="Data abertura" value={formatDate(empresa.data_abertura)} />
                    <Field label="Simples Nacional" value={empresa.opcao_simples ? "Sim" : empresa.opcao_simples === false ? "Não" : "—"} />
                  </div>
                  {/* Funcionários + Faturamento (campos manuais/importáveis) */}
                  {(empresa.quantidade_funcionarios != null || empresa.faturamento_anual != null) && (
                    <div className="mt-4 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-3">
                      <Field label="Funcionários" value={empresa.quantidade_funcionarios?.toString() ?? null} />
                      <Field label="Faturamento anual" value={formatCurrency(empresa.faturamento_anual)} />
                    </div>
                  )}
                  {empresa.obs && (
                    <div className="mt-4 pt-3 border-t border-border">
                      <Label>Observações</Label>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{empresa.obs}</p>
                    </div>
                  )}
                </Card>

                {/* Campos personalizados (metadados) */}
                {empresa.metadados && Object.keys(empresa.metadados).length > 0 && (
                  <Card className="p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" /> Campos personalizados
                    </h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      {Object.entries(empresa.metadados).map(([k, v]) => (
                        <Field key={k} label={k} value={v} />
                      ))}
                    </div>
                  </Card>
                )}

                {/* Botão pra editar (atalho — também tem o botão no topo) */}
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={() => onEdit(empresa)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editar todos os campos / adicionar campos personalizados
                </Button>

                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Status RFB</h3>
                  {empresa.receita_erro ? (
                    <div className="text-sm text-destructive">
                      <strong>Erro na última consulta:</strong> {empresa.receita_erro}
                    </div>
                  ) : empresa.receita_atualizada_em ? (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      Atualizada {formatRelativeDate(empresa.receita_atualizada_em)} ({formatDateTime(empresa.receita_atualizada_em)})
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Nunca consultada — clique em "RFB" no topo pra buscar.</div>
                  )}
                </Card>
              </TabsContent>

              {/* DADOS RFB */}
              <TabsContent value="rfb" className="mt-0 space-y-4">
                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5" /> Identificação
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Razão social" value={empresa.razao_social} />
                    <Field label="Nome fantasia" value={empresa.nome_fantasia} />
                    <Field label="Natureza jurídica" value={empresa.natureza_juridica} />
                    <Field label="Data abertura" value={formatDate(empresa.data_abertura)} />
                    <Field label="Capital social" value={formatCurrency(empresa.capital_social)} />
                    <Field label="Porte" value={empresa.porte && empresa.porte !== "NAO_INFORMADO" ? empresa.porte : "—"} />
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Situação fiscal
                  </h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Situação cadastral" value={empresa.situacao_cadastral} />
                    <Field label="Data da situação" value={formatDate(empresa.situacao_cadastral_data)} />
                    <Field label="Motivo" value={empresa.motivo_situacao} />
                    <Field label="Simples Nacional" value={empresa.opcao_simples ? "Sim" : "Não"} />
                    <Field label="Data opção Simples" value={formatDate(empresa.data_opcao_simples)} />
                    <Field label="MEI" value={empresa.opcao_mei ? "Sim" : "Não"} />
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">CNAE</h3>
                  <Field
                    label="Principal"
                    value={empresa.cnae_principal ? `${empresa.cnae_principal} — ${empresa.cnae_principal_desc}` : "—"}
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
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" /> Endereço e Contato
                  </h3>
                  <Field label="Endereço completo" value={endereco} />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-3">
                    <Field label="CEP" value={empresa.cep} mono />
                    <Field label="Telefone" value={empresa.telefone_receita} />
                    <Field label="E-mail" value={empresa.email_receita} />
                  </div>
                </Card>

                {qsa.length > 0 && (
                  <Card className="p-4">
                    <Accordion type="single" collapsible defaultValue="qsa">
                      <AccordionItem value="qsa" className="border-0">
                        <AccordionTrigger className="text-xs font-semibold uppercase tracking-wider text-muted-foreground py-0 hover:no-underline">
                          <span className="flex items-center gap-2">
                            <Users className="h-3.5 w-3.5" /> Quadro societário ({qsa.length})
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <ul className="mt-3 space-y-2 text-sm">
                            {qsa.map((s, i) => (
                              <li key={i} className="border-l-2 border-primary/20 pl-3 py-1">
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
                  <Card className="p-8 text-center text-muted-foreground text-sm">
                    <Folder className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Esta empresa não está em nenhuma pasta.
                  </Card>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {relations.pastas.map((name: string) => (
                      <Badge key={name} variant="outline" className="text-sm py-1.5 px-3">
                        <Folder className="mr-1.5 h-3.5 w-3.5" />{name}
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
                  <Card className="p-8 text-center text-muted-foreground text-sm">
                    <Gavel className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Nenhuma ação tributária vinculada.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.eleg.map((el) => (
                      <Card key={el.id} className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Gavel className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium text-sm truncate">
                                {el.acoes_tributarias?.nome || "Ação removida"}
                              </span>
                            </div>
                            {el.acoes_tributarias?.tipo && (
                              <span className="text-[11px] text-muted-foreground ml-5">{el.acoes_tributarias.tipo}</span>
                            )}
                            {el.justificativa && (
                              <p className="text-xs text-muted-foreground mt-1.5 ml-5 whitespace-pre-wrap">{el.justificativa}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className={el.elegivel ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}>
                              {el.elegivel ? "Elegível" : "Não elegível"}
                            </Badge>
                            {el.valor_potencial_estimado && (
                              <span className="text-xs font-medium tabular-nums">{formatCurrency(el.valor_potencial_estimado)}</span>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* TAREFAS */}
              <TabsContent value="tarefas" className="mt-0 space-y-3">
                {loadingRel ? (
                  <Skeleton className="h-20 w-full" />
                ) : !relations?.tarefas.length ? (
                  <Card className="p-8 text-center text-muted-foreground text-sm">
                    <ListTodo className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Nenhuma tarefa vinculada a esta empresa.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.tarefas.map((t) => (
                      <Card key={t.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{t.titulo}</p>
                            {t.prazo && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Prazo: {formatDate(t.prazo)} ({formatRelativeDate(t.prazo)})
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {t.prioridade && (
                              <Badge variant="outline" className={`text-[9px] ${PRIORIDADE_COLOR[t.prioridade] || ""}`}>
                                {t.prioridade}
                              </Badge>
                            )}
                            {t.status && (
                              <Badge variant="outline" className={`text-[9px] ${TAREFA_STATUS_COLOR[t.status] || ""}`}>
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
                  <Card className="p-8 text-center text-muted-foreground text-sm">
                    <Calendar className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Nenhuma reunião registrada.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {relations.reunioes.map((r) => (
                      <Card key={r.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{r.titulo || "Reunião"}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {formatDateTime(r.data_inicio)} · {formatRelativeDate(r.data_inicio)}
                            </p>
                          </div>
                          {r.status && (
                            <Badge variant="outline" className="text-[9px] capitalize">{r.status}</Badge>
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
                  <Card className="p-8 text-center text-muted-foreground text-sm">
                    <History className="h-6 w-6 mx-auto mb-2 opacity-50" />
                    Sem registros no audit log.
                  </Card>
                ) : (
                  <div className="relative pl-5">
                    <div className="absolute left-1.5 top-1 bottom-1 w-px bg-border" aria-hidden />
                    <ul className="space-y-3">
                      {relations.audit.map((a) => (
                        <li key={a.id} className="relative">
                          <div className="absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
                          <Card className="p-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{a.acao}</span>
                              <span className="text-muted-foreground text-[10px]">{formatDateTime(a.created_at)}</span>
                            </div>
                            {a.detalhes && typeof a.detalhes === "object" && Object.keys(a.detalhes).length > 0 && (
                              <pre className="mt-1.5 text-[10px] text-muted-foreground bg-muted/50 p-1.5 rounded overflow-x-auto">
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
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
