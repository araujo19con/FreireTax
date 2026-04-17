import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, ChevronDown, ChevronUp, Folder, Users, FileText, DollarSign, Pencil, Phone, Mail, UserCheck, Handshake } from "lucide-react";
import { AcaoDialog } from "@/components/AcaoDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Scale } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Acao {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  vinculo: string;
  created_at: string;
}

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
}

interface Pasta {
  id: string;
  nome: string;
}

interface PastaItem {
  pasta_id: string;
  empresa_id: string;
}

interface Processo {
  id: string;
  elegibilidade_id: string;
  numero_processo: string;
  fase: string;
  valor_estimado: number;
  valor_ganho: number;
  status: string;
  observacoes: string;
  data_processo: string;
  tribunal: string;
}

interface Prospeccao {
  id: string;
  elegibilidade_id: string;
  contato_nome: string;
  contato_telefone: string;
  contato_email: string;
  contato_cargo: string;
  status_prospeccao: string;
  notas_prospeccao: string;
  valor_contrato: number;
  tipo_contrato: string;
  data_contrato: string | null;
  data_assinatura: string | null;
  observacoes_contrato: string;
}

const faseOptions = ["Inicial", "Recurso", "Sentença", "Acórdão", "Trânsito em Julgado", "Execução", "Finalizado"];
const statusProcessoOptions = ["Em andamento", "Favorável", "Desfavorável", "Suspenso", "Finalizado"];
const statusProspeccaoOptions = ["Não iniciado", "Contato feito", "Proposta enviada", "Em negociação", "Contrato assinado", "Perdido"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default function Acoes() {
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [pastaItems, setPastaItems] = useState<PastaItem[]>([]);
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [prospeccoes, setProspeccoes] = useState<Prospeccao[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAcao, setExpandedAcao] = useState<string | null>(null);
  const { user } = useAuth();

  // Elegibilidade dialog
  const [elegDialogOpen, setElegDialogOpen] = useState(false);
  const [elegAcaoId, setElegAcaoId] = useState("");
  const [elegMode, setElegMode] = useState<"individual" | "pasta">("individual");
  const [elegSelectedEmpresas, setElegSelectedEmpresas] = useState<Set<string>>(new Set());
  const [elegSelectedPasta, setElegSelectedPasta] = useState("");
  const [elegElegivel, setElegElegivel] = useState("true");
  const [elegJustificativa, setElegJustificativa] = useState("");

  // Processo dialog
  const [procDialogOpen, setProcDialogOpen] = useState(false);
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const [procElegId, setProcElegId] = useState("");
  const [procNumero, setProcNumero] = useState("");
  const [procFase, setProcFase] = useState("Inicial");
  const [procValorEstimado, setProcValorEstimado] = useState("");
  const [procValorGanho, setProcValorGanho] = useState("");
  const [procStatus, setProcStatus] = useState("Em andamento");
  const [procObs, setProcObs] = useState("");
  const [procDataProcesso, setProcDataProcesso] = useState("");
  const [procTribunal, setProcTribunal] = useState("");
  const [procTribunalOutro, setProcTribunalOutro] = useState("");

  // Prospecção dialog
  const [prospDialogOpen, setProspDialogOpen] = useState(false);
  const [editingProsp, setEditingProsp] = useState<Prospeccao | null>(null);
  const [prospElegId, setProspElegId] = useState("");
  const [prospContatoNome, setProspContatoNome] = useState("");
  const [prospContatoTel, setProspContatoTel] = useState("");
  const [prospContatoEmail, setProspContatoEmail] = useState("");
  const [prospContatoCargo, setProspContatoCargo] = useState("");
  const [prospStatus, setProspStatus] = useState("Não iniciado");
  const [prospNotas, setProspNotas] = useState("");
  const [prospValorContrato, setProspValorContrato] = useState("");
  const [prospTipoContrato, setProspTipoContrato] = useState("");
  const [prospDataContrato, setProspDataContrato] = useState("");
  const [prospDataAssinatura, setProspDataAssinatura] = useState("");
  const [prospObsContrato, setProspObsContrato] = useState("");

  const fetchAll = async () => {
    const [acoesRes, empRes, elegRes, pastasRes, itemsRes, procRes, prospRes] = await Promise.all([
      supabase.from("acoes_tributarias").select("*").order("created_at", { ascending: false }),
      supabase.from("empresas").select("id, nome, cnpj"),
      supabase.from("elegibilidade").select("id, empresa_id, acao_id, elegivel, justificativa"),
      supabase.from("pastas_empresas").select("id, nome"),
      supabase.from("pasta_empresa_items").select("pasta_id, empresa_id"),
      supabase.from("processos").select("*") as any,
      supabase.from("prospeccoes").select("*") as any,
    ]);
    setAcoes(acoesRes.data || []);
    setEmpresas(empRes.data || []);
    setElegibilidades(elegRes.data || []);
    setPastas(pastasRes.data || []);
    setPastaItems(itemsRes.data || []);
    setProcessos(procRes.data || []);
    setProspeccoes(prospRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const acoesIniciais = acoes.filter((a) => a.tipo === "INICIAL").map((a) => ({ id: a.id, nome: a.nome }));

  // CRUD Ação
  const handleCreate = async (data: { nome: string; tipo: string; status: string; vinculo: string }) => {
    const { error } = await supabase.from("acoes_tributarias").insert({ ...data, vinculo: data.vinculo || "", user_id: user?.id });
    if (error) { toast.error("Erro ao criar ação"); } else {
      logAudit({ tabela: "acoes_tributarias", acao: "Criou ação", detalhes: { nome: data.nome, tipo: data.tipo } });
      fetchAll();
    }
  };

  const handleEdit = async (id: string, data: { nome: string; tipo: string; status: string; vinculo: string }) => {
    const { error } = await supabase.from("acoes_tributarias").update({ ...data, vinculo: data.vinculo || "" }).eq("id", id);
    if (error) { toast.error("Erro ao atualizar ação"); } else {
      toast.success("Ação atualizada!");
      logAudit({ tabela: "acoes_tributarias", acao: "Editou ação", registro_id: id, detalhes: { nome: data.nome } });
      fetchAll();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("acoes_tributarias").delete().eq("id", id);
    const acao = acoes.find((a) => a.id === id);
    if (error) { toast.error("Erro ao remover ação"); } else {
      toast.success("Ação removida");
      logAudit({ tabela: "acoes_tributarias", acao: "Removeu ação", registro_id: id, detalhes: { nome: acao?.nome } });
      fetchAll();
    }
  };

  const getElegibilidadesForAcao = (acaoId: string) => elegibilidades.filter((e) => e.acao_id === acaoId);
  const getEmpresaNome = (empresaId: string) => empresas.find((e) => e.id === empresaId)?.nome || "Desconhecida";
  const getProcessoForEleg = (elegId: string) => processos.find((p) => p.elegibilidade_id === elegId);
  const getProspeccaoForEleg = (elegId: string) => prospeccoes.find((p) => p.elegibilidade_id === elegId);

  const handleDeleteEleg = async (id: string) => {
    const { error } = await supabase.from("elegibilidade").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover"); } else {
      toast.success("Removido!");
      logAudit({ tabela: "elegibilidade", acao: "Removeu elegibilidade", registro_id: id });
      fetchAll();
    }
  };

  // Elegibilidade dialog
  const openElegDialog = (acaoId: string) => {
    setElegAcaoId(acaoId);
    setElegMode("individual");
    setElegSelectedEmpresas(new Set());
    setElegSelectedPasta("");
    setElegElegivel("true");
    setElegJustificativa("");
    setElegDialogOpen(true);
  };

  const empresaIdsInPasta = (pastaId: string) => new Set(pastaItems.filter((i) => i.pasta_id === pastaId).map((i) => i.empresa_id));

  const handleSaveElegibilidade = async () => {
    let empresaIds: string[] = [];
    if (elegMode === "individual") { empresaIds = Array.from(elegSelectedEmpresas); }
    else if (elegMode === "pasta" && elegSelectedPasta) { empresaIds = Array.from(empresaIdsInPasta(elegSelectedPasta)); }
    if (empresaIds.length === 0) { toast.error("Selecione ao menos uma empresa"); return; }

    const existingPairs = new Set(elegibilidades.filter((e) => e.acao_id === elegAcaoId).map((e) => e.empresa_id));
    const newIds = empresaIds.filter((id) => !existingPairs.has(id));
    if (newIds.length === 0) { toast.error("Todas as empresas já possuem elegibilidade nesta ação"); return; }

    const items = newIds.map((empresa_id) => ({
      empresa_id, acao_id: elegAcaoId, elegivel: elegElegivel === "true", justificativa: elegJustificativa || "", user_id: user!.id,
    }));

    const { error } = await supabase.from("elegibilidade").insert(items);
    if (error) { toast.error("Erro ao salvar"); console.error(error); return; }
    toast.success(`${newIds.length} elegibilidade(s) adicionada(s)!`);
    setElegDialogOpen(false);
    fetchAll();
  };

  const toggleEmpresa = (id: string) => {
    setElegSelectedEmpresas((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  // Processo handlers
  const openProcessoDialog = (elegId: string, existing?: Processo) => {
    setProcElegId(elegId);
    if (existing) {
      setEditingProcesso(existing);
      setProcNumero(existing.numero_processo || "");
      setProcFase(existing.fase);
      setProcValorEstimado(String(existing.valor_estimado || 0));
      setProcValorGanho(String(existing.valor_ganho || 0));
      setProcStatus(existing.status);
      setProcObs(existing.observacoes || "");
      setProcDataProcesso(existing.data_processo || "");
      const knownTribunais = ["JFAC","JFAL","JFAM","JFAP","JFBA","JFCE","JFDF","JFES","JFGO","JFMA","JFMG","JFMS","JFMT","JFPA","JFPB","JFPE","JFPI","JFPR","JFRJ","JFRN","JFRO","JFRR","JFRS","JFSC","JFSE","JFSP","JFTO","TJAC","TJAL","TJAM","TJAP","TJBA","TJCE","TJDFT","TJES","TJGO","TJMA","TJMG","TJMS","TJMT","TJPA","TJPB","TJPE","TJPI","TJPR","TJRJ","TJRN","TJRO","TJRR","TJRS","TJSC","TJSE","TJSP","TJTO","TRF1","TRF2","TRF3","TRF4","TRF5","TRF6","STJ","STF",""];
      const t = existing.tribunal || "";
      if (knownTribunais.includes(t)) { setProcTribunal(t); setProcTribunalOutro(""); }
      else { setProcTribunal("Outro"); setProcTribunalOutro(t); }
    } else {
      setEditingProcesso(null);
      setProcNumero(""); setProcFase("Inicial"); setProcValorEstimado(""); setProcValorGanho(""); setProcStatus("Em andamento"); setProcObs("");
      setProcDataProcesso(""); setProcTribunal(""); setProcTribunalOutro("");
    }
    setProcDialogOpen(true);
  };

  const handleSaveProcesso = async () => {
    const payload = {
      numero_processo: procNumero, fase: procFase,
      valor_estimado: parseFloat(procValorEstimado) || 0, valor_ganho: parseFloat(procValorGanho) || 0,
      status: procStatus, observacoes: procObs,
      data_processo: procDataProcesso || null, tribunal: procTribunal === "Outro" ? procTribunalOutro : procTribunal,
    };
    if (editingProcesso) {
      const { error } = await (supabase.from("processos") as any).update(payload).eq("id", editingProcesso.id);
      if (error) { toast.error("Erro ao atualizar processo"); return; }
      toast.success("Processo atualizado!");
      logAudit({ tabela: "processos", acao: "Editou processo", registro_id: editingProcesso.id, detalhes: payload });
    } else {
      const { error } = await (supabase.from("processos") as any).insert({ ...payload, elegibilidade_id: procElegId, user_id: user!.id });
      if (error) { toast.error("Erro ao criar processo"); return; }
      toast.success("Processo registrado!");
      logAudit({ tabela: "processos", acao: "Criou processo", detalhes: { ...payload, elegibilidade_id: procElegId } });
    }
    setProcDialogOpen(false);
    fetchAll();
  };

  const handleDeleteProcesso = async (id: string) => {
    const { error } = await (supabase.from("processos") as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao remover processo"); } else { toast.success("Processo removido!"); fetchAll(); }
  };

  // Prospecção handlers
  const openProspDialog = (elegId: string, existing?: Prospeccao) => {
    setProspElegId(elegId);
    if (existing) {
      setEditingProsp(existing);
      setProspContatoNome(existing.contato_nome || "");
      setProspContatoTel(existing.contato_telefone || "");
      setProspContatoEmail(existing.contato_email || "");
      setProspContatoCargo(existing.contato_cargo || "");
      setProspStatus(existing.status_prospeccao);
      setProspNotas(existing.notas_prospeccao || "");
      setProspValorContrato(String(existing.valor_contrato || 0));
      setProspTipoContrato(existing.tipo_contrato || "");
      setProspDataContrato(existing.data_contrato || "");
      setProspDataAssinatura(existing.data_assinatura || "");
      setProspObsContrato(existing.observacoes_contrato || "");
    } else {
      setEditingProsp(null);
      setProspContatoNome(""); setProspContatoTel(""); setProspContatoEmail(""); setProspContatoCargo("");
      setProspStatus("Não iniciado"); setProspNotas("");
      setProspValorContrato(""); setProspTipoContrato(""); setProspDataContrato(""); setProspDataAssinatura(""); setProspObsContrato("");
    }
    setProspDialogOpen(true);
  };

  const handleSaveProsp = async () => {
    const payload = {
      contato_nome: prospContatoNome,
      contato_telefone: prospContatoTel,
      contato_email: prospContatoEmail,
      contato_cargo: prospContatoCargo,
      status_prospeccao: prospStatus,
      notas_prospeccao: prospNotas,
      valor_contrato: parseFloat(prospValorContrato) || 0,
      tipo_contrato: prospTipoContrato,
      data_contrato: prospDataContrato || null,
      data_assinatura: prospDataAssinatura || null,
      observacoes_contrato: prospObsContrato,
    };
    if (editingProsp) {
      const { error } = await (supabase.from("prospeccoes") as any).update(payload).eq("id", editingProsp.id);
      if (error) { toast.error("Erro ao atualizar prospecção"); console.error(error); return; }
      toast.success("Prospecção atualizada!");
      logAudit({ tabela: "prospeccoes", acao: "Editou prospecção", registro_id: editingProsp.id, detalhes: { status: prospStatus } });
    } else {
      const { error } = await (supabase.from("prospeccoes") as any).insert({ ...payload, elegibilidade_id: prospElegId, user_id: user!.id });
      if (error) { toast.error("Erro ao criar prospecção"); console.error(error); return; }
      toast.success("Prospecção registrada!");
      logAudit({ tabela: "prospeccoes", acao: "Criou prospecção", detalhes: { elegibilidade_id: prospElegId, status: prospStatus } });
    }
    setProspDialogOpen(false);
    fetchAll();
  };

  const handleDeleteProsp = async (id: string) => {
    const { error } = await (supabase.from("prospeccoes") as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao remover prospecção"); } else { toast.success("Prospecção removida!"); fetchAll(); }
  };

  // Totals
  const getTotalsForAcao = (acaoId: string) => {
    const elegIds = new Set(elegibilidades.filter((e) => e.acao_id === acaoId).map((e) => e.id));
    const acaoProcessos = processos.filter((p) => elegIds.has(p.elegibilidade_id));
    return {
      estimado: acaoProcessos.reduce((s, p) => s + (Number(p.valor_estimado) || 0), 0),
      ganho: acaoProcessos.reduce((s, p) => s + (Number(p.valor_ganho) || 0), 0),
      count: acaoProcessos.length,
    };
  };

  const getProspStatusColor = (status: string) => {
    switch (status) {
      case "Contato feito": return "bg-info/10 text-info";
      case "Proposta enviada": return "bg-warning/10 text-warning";
      case "Em negociação": return "bg-primary/10 text-primary";
      case "Contrato assinado": return "bg-success/10 text-success";
      case "Perdido": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  if (loading) {
    return <LoadingState variant="page" />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Ações Tributárias"
        description="Gestão de ações iniciais e rescisórias"
        icon={<Scale className="h-7 w-7" />}
        actions={<AcaoDialog onSave={handleCreate} acoesIniciais={acoesIniciais} />}
      />

      {acoes.length === 0 && (
        <EmptyState
          icon={Scale}
          title="Nenhuma ação cadastrada"
          description="Cadastre ações tributárias (iniciais e rescisórias) para começar a vincular empresas via elegibilidade."
        />
      )}

      <div className="grid gap-4">
        {acoes.map((a) => {
          const acaoElegs = getElegibilidadesForAcao(a.id);
          const isExpanded = expandedAcao === a.id;
          const totals = getTotalsForAcao(a.id);
          const elegiveisCount = acaoElegs.filter((e) => e.elegivel).length;

          return (
            <Card key={a.id} className="shadow-card hover:shadow-elevated transition-shadow">
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{a.nome}</h3>
                      <Badge variant={a.tipo === "INICIAL" ? "default" : "secondary"} className="text-[10px]">{a.tipo}</Badge>
                    </div>
                    {a.tipo === "RESCISÓRIA" && a.vinculo && (
                      <p className="text-xs text-muted-foreground">Vinculada a: <span className="text-foreground">{a.vinculo}</span></p>
                    )}
                    {totals.count > 0 && (
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <DollarSign className="h-3 w-3" />Estimado: <span className="text-foreground font-medium">{formatCurrency(totals.estimado)}</span>
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          Ganho: <span className="text-success font-medium">{formatCurrency(totals.ganho)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      a.status === "Ativa" ? "bg-success/10 text-success" : a.status === "Inativa" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning"
                    }`}>{a.status}</span>
                    <Badge variant="outline" className="text-[10px]">
                      <Users className="mr-1 h-3 w-3" />{acaoElegs.length} empresas
                    </Badge>
                    {elegiveisCount > 0 && (
                      <Badge variant="outline" className="text-[10px] border-success/30 text-success">
                        <UserCheck className="mr-1 h-3 w-3" />{elegiveisCount} elegíveis
                      </Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openElegDialog(a.id)}>
                      <Plus className="mr-1 h-3 w-3" />Elegibilidade
                    </Button>
                    <AcaoDialog
                      onSave={(data) => handleEdit(a.id, data)}
                      initialData={a}
                      title="Editar Ação"
                      acoesIniciais={acoesIniciais}
                      trigger={<Button variant="ghost" size="sm">Editar</Button>}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                          <AlertDialogDescription>Remover "{a.nome}"?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(a.id)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedAcao(isExpanded ? null : a.id)}>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border px-5 py-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">Empresas vinculadas ({acaoElegs.length})</h4>
                  {acaoElegs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma empresa vinculada.</p>
                  ) : (
                    <div className="space-y-3">
                      {acaoElegs.map((el) => {
                        const proc = getProcessoForEleg(el.id);
                        const prosp = getProspeccaoForEleg(el.id);
                        return (
                          <div key={el.id} className="rounded-lg border border-border overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between p-3 bg-muted/30">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium">{getEmpresaNome(el.empresa_id)}</span>
                                <Badge variant="outline" className={`border-0 text-[10px] ${el.elegivel ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                                  {el.elegivel ? "Elegível" : "Não elegível"}
                                </Badge>
                                {prosp && (
                                  <Badge variant="outline" className={`border-0 text-[10px] ${getProspStatusColor(prosp.status_prospeccao)}`}>
                                    <Handshake className="mr-1 h-2.5 w-2.5" />{prosp.status_prospeccao}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openProcessoDialog(el.id, proc)}>
                                  <FileText className="mr-1 h-3 w-3" />{proc ? "Processo" : "+ Processo"}
                                </Button>
                                {el.elegivel && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openProspDialog(el.id, prosp)}>
                                    <Handshake className="mr-1 h-3 w-3" />{prosp ? "Prospecção" : "+ Prospecção"}
                                  </Button>
                                )}
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remover elegibilidade?</AlertDialogTitle>
                                      <AlertDialogDescription>Remover {getEmpresaNome(el.empresa_id)} desta ação?</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteEleg(el.id)}>Excluir</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </div>

                            {/* Processo info */}
                            {proc && (
                              <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs border-t border-border bg-background">
                                <div>
                                  <span className="text-muted-foreground">Nº Processo</span>
                                  <p className="font-medium font-mono">{proc.numero_processo || "—"}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Tribunal</span>
                                  <p className="font-medium">{proc.tribunal || "—"}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Data</span>
                                  <p className="font-medium">{proc.data_processo ? new Date(proc.data_processo + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Valor Estimado</span>
                                  <p className="font-medium">{formatCurrency(Number(proc.valor_estimado) || 0)}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Valor Ganho</span>
                                  <p className="font-medium text-success">{formatCurrency(Number(proc.valor_ganho) || 0)}</p>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-muted-foreground">Status</span>
                                  <p>
                                    <Badge variant="outline" className={`text-[10px] border-0 ${
                                      proc.status === "Favorável" ? "bg-success/10 text-success" :
                                      proc.status === "Desfavorável" ? "bg-destructive/10 text-destructive" :
                                      proc.status === "Suspenso" ? "bg-warning/10 text-warning" :
                                      proc.status === "Finalizado" ? "bg-muted text-muted-foreground" :
                                      "bg-primary/10 text-primary"
                                    }`}>{proc.status}</Badge>
                                  </p>
                                </div>
                                {proc.observacoes && (
                                  <div className="col-span-2">
                                    <span className="text-muted-foreground">Observações</span>
                                    <p className="font-medium">{proc.observacoes}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Prospecção info — only for eligible */}
                            {el.elegivel && prosp && (
                              <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs border-t border-border bg-accent/5">
                                <div className="col-span-full flex items-center gap-2 mb-1">
                                  <Handshake className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prospecção</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Contato</span>
                                  <p className="font-medium">{prosp.contato_nome || "—"}</p>
                                  {prosp.contato_cargo && <p className="text-muted-foreground">{prosp.contato_cargo}</p>}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Telefone / Email</span>
                                  {prosp.contato_telefone && <p className="font-medium flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{prosp.contato_telefone}</p>}
                                  {prosp.contato_email && <p className="font-medium flex items-center gap-1"><Mail className="h-2.5 w-2.5" />{prosp.contato_email}</p>}
                                  {!prosp.contato_telefone && !prosp.contato_email && <p>—</p>}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Status</span>
                                  <p><Badge variant="outline" className={`text-[10px] border-0 ${getProspStatusColor(prosp.status_prospeccao)}`}>{prosp.status_prospeccao}</Badge></p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Valor Contrato</span>
                                  <p className="font-medium">{Number(prosp.valor_contrato) ? formatCurrency(Number(prosp.valor_contrato)) : "—"}</p>
                                </div>
                                {prosp.tipo_contrato && (
                                  <div>
                                    <span className="text-muted-foreground">Tipo</span>
                                    <p className="font-medium">{prosp.tipo_contrato}</p>
                                  </div>
                                )}
                                {prosp.data_contrato && (
                                  <div>
                                    <span className="text-muted-foreground">Data Contrato</span>
                                    <p className="font-medium">{new Date(prosp.data_contrato).toLocaleDateString("pt-BR")}</p>
                                  </div>
                                )}
                                {prosp.data_assinatura && (
                                  <div>
                                    <span className="text-muted-foreground">Assinatura</span>
                                    <p className="font-medium">{new Date(prosp.data_assinatura).toLocaleDateString("pt-BR")}</p>
                                  </div>
                                )}
                                {prosp.notas_prospeccao && (
                                  <div className="col-span-2">
                                    <span className="text-muted-foreground">Notas</span>
                                    <p className="font-medium">{prosp.notas_prospeccao}</p>
                                  </div>
                                )}
                                {prosp.observacoes_contrato && (
                                  <div className="col-span-2">
                                    <span className="text-muted-foreground">Obs. Contrato</span>
                                    <p className="font-medium">{prosp.observacoes_contrato}</p>
                                  </div>
                                )}
                                <div className="col-span-full flex justify-end gap-2">
                                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => openProspDialog(el.id, prosp)}>
                                    <Pencil className="mr-1 h-2.5 w-2.5" />Editar
                                  </Button>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive">
                                        <Trash2 className="mr-1 h-2.5 w-2.5" />Remover
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Remover prospecção?</AlertDialogTitle>
                                        <AlertDialogDescription>Dados de contato e contrato serão removidos.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteProsp(prosp.id)}>Excluir</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Elegibilidade Dialog */}
      <Dialog open={elegDialogOpen} onOpenChange={setElegDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="font-heading">Adicionar Elegibilidade — {acoes.find((a) => a.id === elegAcaoId)?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={elegMode === "individual" ? "default" : "outline"} size="sm" onClick={() => setElegMode("individual")}>
                <Users className="mr-2 h-3 w-3" />Individual
              </Button>
              <Button variant={elegMode === "pasta" ? "default" : "outline"} size="sm" onClick={() => setElegMode("pasta")}>
                <Folder className="mr-2 h-3 w-3" />Por Pasta
              </Button>
            </div>
            {elegMode === "individual" ? (
              <div className="space-y-2 overflow-y-auto max-h-[30vh]">
                <Label>Selecione as empresas</Label>
                {empresas.map((e) => (
                  <label key={e.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={elegSelectedEmpresas.has(e.id)} onCheckedChange={() => toggleEmpresa(e.id)} />
                    <div>
                      <div className="text-sm font-medium">{e.nome}</div>
                      <div className="text-xs text-muted-foreground font-mono">{e.cnpj}</div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Selecione a pasta</Label>
                <Select value={elegSelectedPasta} onValueChange={setElegSelectedPasta}>
                  <SelectTrigger><SelectValue placeholder="Escolha uma pasta..." /></SelectTrigger>
                  <SelectContent>
                    {pastas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nome} ({empresaIdsInPasta(p.id).size} empresas)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Elegível?</Label>
              <Select value={elegElegivel} onValueChange={setElegElegivel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim — Elegível</SelectItem>
                  <SelectItem value="false">Não — Não elegível</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Justificativa</Label>
              <Textarea value={elegJustificativa} onChange={(e) => setElegJustificativa(e.target.value)} placeholder="Motivo (opcional)" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setElegDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveElegibilidade}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Processo Dialog */}
      <Dialog open={procDialogOpen} onOpenChange={setProcDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">{editingProcesso ? "Editar Processo" : "Novo Processo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Número do Processo</Label>
                <Input value={procNumero} onChange={(e) => setProcNumero(e.target.value)} placeholder="Ex: 0001234-56.2024.8.26.0100" />
              </div>
              <div className="space-y-2">
                <Label>Tribunal</Label>
                <Select value={procTribunal} onValueChange={(v) => { setProcTribunal(v); if (v !== "Outro") setProcTribunalOutro(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {[
                      { label: "— Justiça Federal —", items: ["JFAC","JFAL","JFAM","JFAP","JFBA","JFCE","JFDF","JFES","JFGO","JFMA","JFMG","JFMS","JFMT","JFPA","JFPB","JFPE","JFPI","JFPR","JFRJ","JFRN","JFRO","JFRR","JFRS","JFSC","JFSE","JFSP","JFTO"] },
                      { label: "— Tribunais Estaduais —", items: ["TJAC","TJAL","TJAM","TJAP","TJBA","TJCE","TJDFT","TJES","TJGO","TJMA","TJMG","TJMS","TJMT","TJPA","TJPB","TJPE","TJPI","TJPR","TJRJ","TJRN","TJRO","TJRR","TJRS","TJSC","TJSE","TJSP","TJTO"] },
                      { label: "— Tribunais Regionais Federais —", items: ["TRF1","TRF2","TRF3","TRF4","TRF5","TRF6"] },
                      { label: "— Tribunais Superiores —", items: ["STJ","STF"] },
                    ].map((group) => (
                      <div key={group.label}>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">{group.label}</div>
                        {group.items.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </div>
                    ))}
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                {procTribunal === "Outro" && (
                  <Input className="mt-2" value={procTribunalOutro} onChange={(e) => setProcTribunalOutro(e.target.value)} placeholder="Informe o tribunal..." />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Data do Processo</Label>
              <Input type="date" value={procDataProcesso} onChange={(e) => setProcDataProcesso(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fase</Label>
                <Select value={procFase} onValueChange={setProcFase}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{faseOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={procStatus} onValueChange={setProcStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusProcessoOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valor Estimado (R$)</Label>
                <Input type="number" step="0.01" min="0" value={procValorEstimado} onChange={(e) => setProcValorEstimado(e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-2">
                <Label>Valor Ganho (R$)</Label>
                <Input type="number" step="0.01" min="0" value={procValorGanho} onChange={(e) => setProcValorGanho(e.target.value)} placeholder="0,00" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={procObs} onChange={(e) => setProcObs(e.target.value)} placeholder="Detalhes (opcional)" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveProcesso}>{editingProcesso ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prospecção Dialog */}
      <Dialog open={prospDialogOpen} onOpenChange={setProspDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editingProsp ? "Editar Prospecção" : "Nova Prospecção"}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="contato" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="contato">Contato</TabsTrigger>
              <TabsTrigger value="prospeccao">Prospecção</TabsTrigger>
              <TabsTrigger value="contrato">Contrato</TabsTrigger>
            </TabsList>

            <TabsContent value="contato" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Contato</Label>
                  <Input value={prospContatoNome} onChange={(e) => setProspContatoNome(e.target.value)} placeholder="Nome completo" />
                </div>
                <div className="space-y-2">
                  <Label>Cargo</Label>
                  <Input value={prospContatoCargo} onChange={(e) => setProspContatoCargo(e.target.value)} placeholder="Ex: Diretor Financeiro" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={prospContatoTel} onChange={(e) => setProspContatoTel(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={prospContatoEmail} onChange={(e) => setProspContatoEmail(e.target.value)} placeholder="email@empresa.com" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="prospeccao" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Status da Prospecção</Label>
                <Select value={prospStatus} onValueChange={setProspStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusProspeccaoOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notas da Prospecção</Label>
                <Textarea value={prospNotas} onChange={(e) => setProspNotas(e.target.value)} placeholder="Histórico de contatos, observações..." rows={4} />
              </div>
            </TabsContent>

            <TabsContent value="contrato" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de Contrato</Label>
                  <Input value={prospTipoContrato} onChange={(e) => setProspTipoContrato(e.target.value)} placeholder="Ex: Êxito, Mensal, Misto" />
                </div>
                <div className="space-y-2">
                  <Label>Valor do Contrato (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={prospValorContrato} onChange={(e) => setProspValorContrato(e.target.value)} placeholder="0,00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data do Contrato</Label>
                  <Input type="date" value={prospDataContrato} onChange={(e) => setProspDataContrato(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data da Assinatura</Label>
                  <Input type="date" value={prospDataAssinatura} onChange={(e) => setProspDataAssinatura(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Observações do Contrato</Label>
                <Textarea value={prospObsContrato} onChange={(e) => setProspObsContrato(e.target.value)} placeholder="Cláusulas especiais, condições..." rows={3} />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProspDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveProsp}>{editingProsp ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
