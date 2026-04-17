import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Handshake, Phone, Mail, Building2, Scale, Pencil, DollarSign,
  ArrowRight, Search, Filter, Plus, MessageSquare, AlertTriangle,
  TrendingUp, Clock, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ProspeccaoContatosDialog } from "@/components/ProspeccaoContatosDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import type { Database } from "@/integrations/supabase/types";
import { differenceInDays, parseISO } from "date-fns";

type MotivoPerdido = Database["public"]["Enums"]["motivo_perdido"];

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
  motivo_perdido: MotivoPerdido | null;
  motivo_perdido_detalhes: string | null;
  numero_contatos: number;
  ultimo_contato_em: string | null;
  proximo_contato_em: string | null;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  valor_potencial_estimado: number | null;
}

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
}

interface Acao {
  id: string;
  nome: string;
  data_limite_prescricao: string | null;
  tipo_prazo: string | null;
}

const statusColumns = [
  { key: "Não iniciado", label: "Não Iniciado", color: "bg-muted text-muted-foreground", dotColor: "bg-muted-foreground" },
  { key: "Contato feito", label: "Contato Feito", color: "bg-info/10 text-info", dotColor: "bg-info" },
  { key: "Proposta enviada", label: "Proposta Enviada", color: "bg-warning/10 text-warning", dotColor: "bg-warning" },
  { key: "Em negociação", label: "Em Negociação", color: "bg-primary/10 text-primary", dotColor: "bg-primary" },
  { key: "Contrato assinado", label: "Contrato Assinado", color: "bg-success/10 text-success", dotColor: "bg-success" },
  { key: "Perdido", label: "Perdido", color: "bg-destructive/10 text-destructive", dotColor: "bg-destructive" },
];

const MOTIVOS_PERDIDO: { value: MotivoPerdido; label: string }[] = [
  { value: "preco", label: "Preço / success fee alto" },
  { value: "desconfianca_tese", label: "Desconfiança da tese jurídica" },
  { value: "timing", label: "Timing — cliente não prioriza agora" },
  { value: "concorrente", label: "Foi para concorrente" },
  { value: "decisor_errado", label: "Falamos com decisor errado" },
  { value: "sem_interesse", label: "Sem interesse real" },
  { value: "sem_resposta", label: "Sem resposta após insistir" },
  { value: "outros", label: "Outros (descrever)" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCompactCurrency(value: number) {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return formatCurrency(value);
}

// Cadência Hormozi: 5-8 toques em B2B. <5 é desperdício.
function cadenciaStatus(n: number): { color: string; label: string } {
  if (n === 0) return { color: "bg-muted text-muted-foreground", label: "0/7" };
  if (n < 5)  return { color: "bg-warning/15 text-warning", label: `${n}/7` };
  if (n < 7)  return { color: "bg-info/15 text-info", label: `${n}/7` };
  return { color: "bg-success/15 text-success", label: `${n}/7 ✓` };
}

// Urgência de prescrição — quanto tempo falta até a data limite
function prescricaoInfo(dataLimite: string | null): { cor: string; texto: string; emoji: string } | null {
  if (!dataLimite) return null;
  const dias = differenceInDays(parseISO(dataLimite), new Date());
  if (dias < 0) return { cor: "bg-destructive/20 text-destructive", texto: `PRESCRITA há ${Math.abs(dias)}d`, emoji: "⛔" };
  if (dias <= 30) return { cor: "bg-destructive/15 text-destructive", texto: `${dias}d p/ prescrever`, emoji: "🔥" };
  if (dias <= 90) return { cor: "bg-warning/15 text-warning", texto: `${dias}d p/ prescrever`, emoji: "⚠" };
  if (dias <= 180) return { cor: "bg-info/15 text-info", texto: `${dias}d p/ prescrever`, emoji: "⏳" };
  return null;
}

export default function Prospeccao() {
  const [prospeccoes, setProspeccoes] = useState<Prospeccao[]>([]);
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAcao, setFilterAcao] = useState("all");
  const { user } = useAuth();

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createAcaoId, setCreateAcaoId] = useState("");
  const [createElegId, setCreateElegId] = useState("");
  const [createContatoNome, setCreateContatoNome] = useState("");
  const [createContatoTel, setCreateContatoTel] = useState("");
  const [createContatoEmail, setCreateContatoEmail] = useState("");
  const [createContatoCargo, setCreateContatoCargo] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editProsp, setEditProsp] = useState<Prospeccao | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editContatoNome, setEditContatoNome] = useState("");
  const [editContatoTel, setEditContatoTel] = useState("");
  const [editContatoEmail, setEditContatoEmail] = useState("");
  const [editContatoCargo, setEditContatoCargo] = useState("");
  const [editNotas, setEditNotas] = useState("");
  const [editValorContrato, setEditValorContrato] = useState("");
  const [editTipoContrato, setEditTipoContrato] = useState("");
  const [editDataContrato, setEditDataContrato] = useState("");
  const [editDataAssinatura, setEditDataAssinatura] = useState("");
  const [editObsContrato, setEditObsContrato] = useState("");
  const [editMotivoPerdido, setEditMotivoPerdido] = useState<MotivoPerdido | "">("");
  const [editMotivoDetalhes, setEditMotivoDetalhes] = useState("");

  // Contatos (cadência) dialog
  const [contatosOpen, setContatosOpen] = useState(false);
  const [contatosProspId, setContatosProspId] = useState<string | null>(null);
  const [contatosLabel, setContatosLabel] = useState<string>("");

  const fetchAll = async () => {
    const [prospRes, elegRes, empRes, acoesRes] = await Promise.all([
      (supabase.from("prospeccoes").select("*") as any),
      supabase.from("elegibilidade").select("id, empresa_id, acao_id, elegivel, valor_potencial_estimado"),
      supabase.from("empresas").select("id, nome, cnpj"),
      supabase.from("acoes_tributarias").select("id, nome, data_limite_prescricao, tipo_prazo"),
    ]);
    setProspeccoes(prospRes.data || []);
    setElegibilidades(elegRes.data || []);
    setEmpresas(empRes.data || []);
    setAcoes((acoesRes.data as Acao[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const getEmpresa = (elegId: string) => {
    const eleg = elegibilidades.find(e => e.id === elegId);
    if (!eleg) return null;
    return empresas.find(emp => emp.id === eleg.empresa_id);
  };

  const getAcao = (elegId: string) => {
    const eleg = elegibilidades.find(e => e.id === elegId);
    if (!eleg) return null;
    return acoes.find(a => a.id === eleg.acao_id);
  };

  const getElegibilidade = (elegId: string) => elegibilidades.find(e => e.id === elegId);
  const getValorPotencial = (elegId: string) =>
    Number(getElegibilidade(elegId)?.valor_potencial_estimado ?? 0);

  const filteredProspeccoes = useMemo(() => {
    let items = prospeccoes;
    if (filterAcao !== "all") {
      const elegIds = new Set(elegibilidades.filter(e => e.acao_id === filterAcao).map(e => e.id));
      items = items.filter(p => elegIds.has(p.elegibilidade_id));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(p => {
        const emp = getEmpresa(p.elegibilidade_id);
        const acao = getAcao(p.elegibilidade_id);
        return (
          emp?.nome.toLowerCase().includes(q) ||
          p.contato_nome?.toLowerCase().includes(q) ||
          acao?.nome.toLowerCase().includes(q)
        );
      });
    }
    // QW2: ordena por valor_potencial DESC (empresas grandes no topo)
    return [...items].sort((a, b) => {
      const va = getValorPotencial(a.elegibilidade_id);
      const vb = getValorPotencial(b.elegibilidade_id);
      return vb - va;
    });
  }, [prospeccoes, elegibilidades, empresas, acoes, filterAcao, search]);

  const openEdit = (p: Prospeccao) => {
    setEditProsp(p);
    setEditStatus(p.status_prospeccao);
    setEditContatoNome(p.contato_nome || "");
    setEditContatoTel(p.contato_telefone || "");
    setEditContatoEmail(p.contato_email || "");
    setEditContatoCargo(p.contato_cargo || "");
    setEditNotas(p.notas_prospeccao || "");
    setEditValorContrato(String(p.valor_contrato || 0));
    setEditTipoContrato(p.tipo_contrato || "");
    setEditDataContrato(p.data_contrato || "");
    setEditDataAssinatura(p.data_assinatura || "");
    setEditObsContrato(p.observacoes_contrato || "");
    setEditMotivoPerdido(p.motivo_perdido ?? "");
    setEditMotivoDetalhes(p.motivo_perdido_detalhes ?? "");
    setEditOpen(true);
  };

  const openContatos = (p: Prospeccao) => {
    const emp = getEmpresa(p.elegibilidade_id);
    const acao = getAcao(p.elegibilidade_id);
    setContatosProspId(p.id);
    setContatosLabel(`${emp?.nome ?? "—"} — ${acao?.nome ?? "—"}`);
    setContatosOpen(true);
  };

  const handleSave = async () => {
    if (!editProsp) return;

    // QW1: obriga motivo ao salvar como Perdido
    if (editStatus === "Perdido" && !editMotivoPerdido) {
      toast.error("Ao marcar como Perdido, selecione o MOTIVO. Sem isso, o escritório não aprende com o que não fecha.");
      return;
    }

    const payload: any = {
      status_prospeccao: editStatus,
      contato_nome: editContatoNome,
      contato_telefone: editContatoTel,
      contato_email: editContatoEmail,
      contato_cargo: editContatoCargo,
      notas_prospeccao: editNotas,
      valor_contrato: parseFloat(editValorContrato) || 0,
      tipo_contrato: editTipoContrato,
      data_contrato: editDataContrato || null,
      data_assinatura: editDataAssinatura || null,
      observacoes_contrato: editObsContrato,
      motivo_perdido: editStatus === "Perdido" ? editMotivoPerdido : null,
      motivo_perdido_detalhes: editStatus === "Perdido" ? (editMotivoDetalhes || null) : null,
    };
    const { error } = await (supabase.from("prospeccoes") as any).update(payload).eq("id", editProsp.id);
    if (error) { toast.error("Erro ao atualizar: " + error.message); return; }
    toast.success("Prospecção atualizada!");
    logAudit({ tabela: "prospeccoes", acao: "Editou prospecção", registro_id: editProsp.id, detalhes: { status: editStatus, motivo: editMotivoPerdido } });

    // QW5: avisa sobre trigger de upsell se fechou contrato
    if (editStatus === "Contrato assinado" && editProsp.status_prospeccao !== "Contrato assinado") {
      toast.success("🎯 Upsell: tarefa automática criada para avaliar outras teses desta empresa!", { duration: 5000 });
    }

    setEditOpen(false);
    fetchAll();
  };

  // QW1: bloqueia quick-move para Perdido (obriga passar pelo dialog)
  const handleQuickStatusChange = async (prosp: Prospeccao, newStatus: string) => {
    if (newStatus === "Perdido") {
      openEdit({ ...prosp, status_prospeccao: "Perdido" });
      toast.info("Para marcar como Perdido, preencha o motivo no formulário.");
      return;
    }
    const { error } = await (supabase.from("prospeccoes") as any)
      .update({ status_prospeccao: newStatus })
      .eq("id", prosp.id);
    if (error) { toast.error("Erro ao atualizar status"); return; }
    toast.success(`Status atualizado para "${newStatus}"`);
    logAudit({ tabela: "prospeccoes", acao: "Alterou status prospecção", registro_id: prosp.id, detalhes: { de: prosp.status_prospeccao, para: newStatus } });

    // QW5: avisa sobre upsell quando fechou contrato
    if (newStatus === "Contrato assinado") {
      toast.success("🎯 Upsell: tarefa automática criada para avaliar outras teses desta empresa!", { duration: 5000 });
    }
    fetchAll();
  };

  // Create handlers
  const openCreateDialog = () => {
    setCreateAcaoId("");
    setCreateElegId("");
    setCreateContatoNome("");
    setCreateContatoTel("");
    setCreateContatoEmail("");
    setCreateContatoCargo("");
    setCreateOpen(true);
  };

  const elegiveisForCreate = useMemo(() => {
    if (!createAcaoId) return [];
    const prospElegIds = new Set(prospeccoes.map(p => p.elegibilidade_id));
    return elegibilidades
      .filter(e => e.acao_id === createAcaoId && e.elegivel && !prospElegIds.has(e.id))
      .sort((a, b) => Number(b.valor_potencial_estimado ?? 0) - Number(a.valor_potencial_estimado ?? 0));
  }, [createAcaoId, elegibilidades, prospeccoes]);

  const handleCreate = async () => {
    if (!createElegId) { toast.error("Selecione uma empresa elegível"); return; }
    const payload = {
      elegibilidade_id: createElegId,
      user_id: user!.id,
      status_prospeccao: "Não iniciado",
      contato_nome: createContatoNome,
      contato_telefone: createContatoTel,
      contato_email: createContatoEmail,
      contato_cargo: createContatoCargo,
    };
    const { error } = await (supabase.from("prospeccoes") as any).insert(payload);
    if (error) { toast.error("Erro ao criar prospecção"); console.error(error); return; }
    toast.success("Prospecção criada!");
    logAudit({ tabela: "prospeccoes", acao: "Criou prospecção", detalhes: { elegibilidade_id: createElegId } });
    setCreateOpen(false);
    fetchAll();
  };

  // KPIs
  const totalValor = filteredProspeccoes.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
  const assinados = filteredProspeccoes.filter(p => p.status_prospeccao === "Contrato assinado");
  const valorAssinado = assinados.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
  const valorPotencialPipeline = useMemo(() =>
    filteredProspeccoes.reduce((s, p) => s + getValorPotencial(p.elegibilidade_id), 0),
    [filteredProspeccoes, elegibilidades]
  );
  const semContato7d = filteredProspeccoes.filter(p => {
    if (p.status_prospeccao === "Contrato assinado" || p.status_prospeccao === "Perdido") return false;
    if (!p.ultimo_contato_em) return p.numero_contatos === 0;
    return differenceInDays(new Date(), parseISO(p.ultimo_contato_em)) >= 7;
  }).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingState variant="kpi-grid" count={5} />
        <LoadingState variant="kanban" count={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prospecção"
        description="Pipeline comercial — cadência 7 toques, foco em alto valor"
        icon={<Handshake className="h-7 w-7" />}
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Nova Prospecção
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="shadow-card p-4 hover:shadow-elevated transition-shadow">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
          <p className="text-2xl font-heading font-bold mt-1 tabular-nums">{filteredProspeccoes.length}</p>
        </Card>
        <Card className="shadow-card p-4 hover:shadow-elevated transition-shadow">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="h-3 w-3" aria-hidden="true" />Valor Potencial
          </p>
          <p className="text-2xl font-heading font-bold text-primary mt-1 tabular-nums">{formatCompactCurrency(valorPotencialPipeline)}</p>
        </Card>
        <Card className="shadow-card p-4 hover:shadow-elevated transition-shadow">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Valor Contrato</p>
          <p className="text-2xl font-heading font-bold mt-1 tabular-nums">{formatCompactCurrency(totalValor)}</p>
        </Card>
        <Card className="shadow-card p-4 hover:shadow-elevated transition-shadow">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Assinados</p>
          <p className="text-2xl font-heading font-bold text-success mt-1 tabular-nums">{assinados.length} <span className="text-xs text-muted-foreground">· {formatCompactCurrency(valorAssinado)}</span></p>
        </Card>
        <Card className="shadow-card p-4 hover:shadow-elevated transition-shadow">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />Parados 7+ dias
          </p>
          <p className={`text-2xl font-heading font-bold mt-1 tabular-nums ${semContato7d > 0 ? "text-destructive" : "text-success"}`}>{semContato7d}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa, contato ou ação..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterAcao} onValueChange={setFilterAcao}>
          <SelectTrigger className="w-[220px]">
            <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Filtrar por ação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as ações</SelectItem>
            {acoes.map(a => (
              <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredProspeccoes.length === 0 && !search && filterAcao === "all" ? (
        <EmptyState
          icon={Handshake}
          title="Nenhuma prospecção cadastrada"
          description="Comece criando uma prospecção a partir das empresas elegíveis. As empresas com maior valor potencial aparecem primeiro."
          action={{ label: "Nova Prospecção", onClick: openCreateDialog, icon: Plus }}
        />
      ) : (
      /* Kanban Board */
      <div className="flex gap-4 overflow-x-auto pb-4 snap-kanban scrollbar-thin" role="list" aria-label="Pipeline de prospecção por etapa">
        {statusColumns.map(col => {
          const items = filteredProspeccoes.filter(p => p.status_prospeccao === col.key);
          return (
            <div key={col.key} className="flex-shrink-0 w-[300px]" role="listitem" aria-label={`Etapa ${col.label}, ${items.length} ${items.length === 1 ? "prospecção" : "prospecções"}`}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} aria-hidden="true" />
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="outline" className="text-[10px] ml-auto tabular-nums">{items.length}</Badge>
              </div>

              <div className="space-y-3 min-h-[120px]">
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
                    Nenhuma prospecção
                  </div>
                )}
                {items.map(p => {
                  const emp = getEmpresa(p.elegibilidade_id);
                  const acao = getAcao(p.elegibilidade_id);
                  const valorPot = getValorPotencial(p.elegibilidade_id);
                  const prescricao = prescricaoInfo(acao?.data_limite_prescricao ?? null);
                  const cadencia = cadenciaStatus(p.numero_contatos);
                  const colIdx = statusColumns.findIndex(c => c.key === p.status_prospeccao);
                  const nextCol = colIdx < statusColumns.length - 2 ? statusColumns[colIdx + 1] : null;
                  const diasSemContato = p.ultimo_contato_em
                    ? differenceInDays(new Date(), parseISO(p.ultimo_contato_em))
                    : null;

                  return (
                    <Card
                      key={p.id}
                      className="shadow-card hover:shadow-elevated transition-all cursor-pointer group"
                      onClick={() => openEdit(p)}
                    >
                      <div className="p-3 space-y-2.5">
                        {/* QW4: banner de prescrição no topo se urgente */}
                        {prescricao && (
                          <div className={`text-[10px] px-2 py-1 rounded flex items-center gap-1 font-medium ${prescricao.cor}`}>
                            <AlertTriangle className="h-3 w-3" />
                            <span>{prescricao.emoji} {prescricao.texto}</span>
                          </div>
                        )}

                        {/* Company + value */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-sm font-medium truncate min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{emp?.nome || "—"}</span>
                          </div>
                          {/* QW2: valor potencial em destaque */}
                          {valorPot > 0 && (
                            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary flex-shrink-0" title="Valor potencial estimado">
                              {formatCompactCurrency(valorPot)}
                            </Badge>
                          )}
                        </div>

                        {/* Ação */}
                        {acao && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Scale className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{acao.nome}</span>
                          </div>
                        )}

                        {/* Contact */}
                        {p.contato_nome && (
                          <div className="text-xs">
                            <span className="font-medium">{p.contato_nome}</span>
                            {p.contato_cargo && <span className="text-muted-foreground"> · {p.contato_cargo}</span>}
                          </div>
                        )}

                        {/* Contact info */}
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                          {p.contato_telefone && (
                            <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{p.contato_telefone}</span>
                          )}
                          {p.contato_email && (
                            <span className="flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5" />{p.contato_email}</span>
                          )}
                        </div>

                        {/* QW3: badge cadência + último contato */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className={`text-[10px] flex items-center gap-1 ${cadencia.color}`}>
                            <Zap className="h-2.5 w-2.5" />Toque {cadencia.label}
                          </Badge>
                          {diasSemContato !== null && diasSemContato >= 7 &&
                           p.status_prospeccao !== "Contrato assinado" && p.status_prospeccao !== "Perdido" && (
                            <span className="text-[10px] text-destructive flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />parado {diasSemContato}d
                            </span>
                          )}
                        </div>

                        {/* Motivo perda se Perdido */}
                        {p.status_prospeccao === "Perdido" && p.motivo_perdido && (
                          <div className="text-[10px] text-destructive">
                            Motivo: {MOTIVOS_PERDIDO.find(m => m.value === p.motivo_perdido)?.label ?? p.motivo_perdido}
                          </div>
                        )}

                        {/* Valor contrato (só depois de fechar) */}
                        {Number(p.valor_contrato) > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <DollarSign className="h-3 w-3 text-success" />
                            <span className="font-medium">{formatCurrency(Number(p.valor_contrato))}</span>
                          </div>
                        )}

                        {/* Action row */}
                        <div className="flex gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline" size="sm"
                            className="h-7 text-[11px] flex-1"
                            onClick={() => openContatos(p)}
                            title="Registrar toque de contato"
                          >
                            <MessageSquare className="mr-1 h-3 w-3" />
                            Contato
                          </Button>
                          {nextCol && (
                            <Button
                              variant="outline" size="sm"
                              className="h-7 text-[11px] flex-1"
                              onClick={() => handleQuickStatusChange(p, nextCol.key)}
                            >
                              <ArrowRight className="mr-1 h-3 w-3" />
                              {nextCol.label.split(" ")[0]}
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(p)}
                            aria-label={`Editar prospecção ${emp?.nome ?? ""}`}
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Handshake className="h-5 w-5" />
              Editar Prospecção
            </DialogTitle>
          </DialogHeader>
          {editProsp && (
            <div className="space-y-4">
              {/* Info header */}
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <p className="font-medium">{getEmpresa(editProsp.elegibilidade_id)?.nome}</p>
                <p className="text-xs text-muted-foreground">{getAcao(editProsp.elegibilidade_id)?.nome}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                  <span>Toques: <strong className="text-foreground">{editProsp.numero_contatos}/7</strong></span>
                  {getValorPotencial(editProsp.elegibilidade_id) > 0 && (
                    <span>Potencial: <strong className="text-primary">{formatCompactCurrency(getValorPotencial(editProsp.elegibilidade_id))}</strong></span>
                  )}
                </div>
              </div>

              {/* Botão de cadência */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => openContatos(editProsp)}
              >
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                Ver histórico de contatos e registrar novo toque
              </Button>

              <div>
                <Label>Etapa da Prospecção</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusColumns.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* QW1: motivo perdido quando status = Perdido */}
              {editStatus === "Perdido" && (
                <div className="space-y-3 p-3 rounded-md border border-destructive/30 bg-destructive/5">
                  <div>
                    <Label className="text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Motivo da perda * (obrigatório)
                    </Label>
                    <p className="text-[10px] text-muted-foreground mb-1.5">
                      Hormozi: sem categorizar por que perdemos, o escritório fica cego e a oferta não evolui.
                    </p>
                    <Select value={editMotivoPerdido} onValueChange={(v) => setEditMotivoPerdido(v as MotivoPerdido)}>
                      <SelectTrigger><SelectValue placeholder="Selecione o motivo..." /></SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_PERDIDO.map(m => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Detalhes (opcional mas recomendado)</Label>
                    <Textarea
                      rows={2}
                      value={editMotivoDetalhes}
                      onChange={(e) => setEditMotivoDetalhes(e.target.value)}
                      placeholder="Ex: 'Acha 20% caro, queria 15%' — detalhe específico vira input pra ajustar oferta"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome do Contato</Label>
                  <Input value={editContatoNome} onChange={e => setEditContatoNome(e.target.value)} />
                </div>
                <div>
                  <Label>Cargo</Label>
                  <Input value={editContatoCargo} onChange={e => setEditContatoCargo(e.target.value)} />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input value={editContatoTel} onChange={e => setEditContatoTel(e.target.value)} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={editContatoEmail} onChange={e => setEditContatoEmail(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Notas de Prospecção</Label>
                <Textarea value={editNotas} onChange={e => setEditNotas(e.target.value)} rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor do Contrato</Label>
                  <Input type="number" value={editValorContrato} onChange={e => setEditValorContrato(e.target.value)} />
                </div>
                <div>
                  <Label>Tipo de Contrato</Label>
                  <Input value={editTipoContrato} onChange={e => setEditTipoContrato(e.target.value)} />
                </div>
                <div>
                  <Label>Data do Contrato</Label>
                  <Input type="date" value={editDataContrato} onChange={e => setEditDataContrato(e.target.value)} />
                </div>
                <div>
                  <Label>Data de Assinatura</Label>
                  <Input type="date" value={editDataAssinatura} onChange={e => setEditDataAssinatura(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>Observações do Contrato</Label>
                <Textarea value={editObsContrato} onChange={e => setEditObsContrato(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Nova Prospecção
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Ação Tributária</Label>
              <Select value={createAcaoId} onValueChange={(v) => { setCreateAcaoId(v); setCreateElegId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a ação..." />
                </SelectTrigger>
                <SelectContent>
                  {acoes.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createAcaoId && (
              <div>
                <Label>Empresa Elegível <span className="text-[10px] text-muted-foreground">(ordenadas por valor potencial)</span></Label>
                {elegiveisForCreate.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-1">Nenhuma empresa elegível disponível nesta ação (todas já possuem prospecção).</p>
                ) : (
                  <Select value={createElegId} onValueChange={setCreateElegId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a empresa..." />
                    </SelectTrigger>
                    <SelectContent>
                      {elegiveisForCreate.map(e => {
                        const emp = empresas.find(emp => emp.id === e.empresa_id);
                        const v = Number(e.valor_potencial_estimado ?? 0);
                        return (
                          <SelectItem key={e.id} value={e.id}>
                            {emp?.nome || "—"} ({emp?.cnpj}){v > 0 ? ` — ${formatCompactCurrency(v)}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome do Contato</Label>
                <Input value={createContatoNome} onChange={e => setCreateContatoNome(e.target.value)} placeholder="Opcional" />
              </div>
              <div>
                <Label>Cargo</Label>
                <Input value={createContatoCargo} onChange={e => setCreateContatoCargo(e.target.value)} placeholder="Opcional" />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={createContatoTel} onChange={e => setCreateContatoTel(e.target.value)} placeholder="Opcional" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={createContatoEmail} onChange={e => setCreateContatoEmail(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!createElegId}>Criar Prospecção</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QW3: Dialog de cadência / contatos */}
      <ProspeccaoContatosDialog
        open={contatosOpen}
        onOpenChange={setContatosOpen}
        prospeccaoId={contatosProspId}
        prospeccaoLabel={contatosLabel}
        onSaved={fetchAll}
      />
    </div>
  );
}
