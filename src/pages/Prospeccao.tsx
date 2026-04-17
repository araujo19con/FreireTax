import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Handshake, Phone, Mail, Building2, Scale, Pencil, DollarSign,
  ChevronRight, ArrowRight, Search, Filter, Plus,
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

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
}

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
}

interface Acao {
  id: string;
  nome: string;
}

const statusColumns = [
  { key: "Não iniciado", label: "Não Iniciado", color: "bg-muted text-muted-foreground", dotColor: "bg-muted-foreground" },
  { key: "Contato feito", label: "Contato Feito", color: "bg-info/10 text-info", dotColor: "bg-info" },
  { key: "Proposta enviada", label: "Proposta Enviada", color: "bg-warning/10 text-warning", dotColor: "bg-warning" },
  { key: "Em negociação", label: "Em Negociação", color: "bg-primary/10 text-primary", dotColor: "bg-primary" },
  { key: "Contrato assinado", label: "Contrato Assinado", color: "bg-success/10 text-success", dotColor: "bg-success" },
  { key: "Perdido", label: "Perdido", color: "bg-destructive/10 text-destructive", dotColor: "bg-destructive" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
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

  const fetchAll = async () => {
    const [prospRes, elegRes, empRes, acoesRes] = await Promise.all([
      supabase.from("prospeccoes").select("*") as any,
      supabase.from("elegibilidade").select("id, empresa_id, acao_id, elegivel"),
      supabase.from("empresas").select("id, nome, cnpj"),
      supabase.from("acoes_tributarias").select("id, nome"),
    ]);
    setProspeccoes(prospRes.data || []);
    setElegibilidades(elegRes.data || []);
    setEmpresas(empRes.data || []);
    setAcoes(acoesRes.data || []);
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
    return items;
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
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!editProsp) return;
    const payload = {
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
    };
    const { error } = await (supabase.from("prospeccoes") as any).update(payload).eq("id", editProsp.id);
    if (error) { toast.error("Erro ao atualizar prospecção"); return; }
    toast.success("Prospecção atualizada!");
    logAudit({ tabela: "prospeccoes", acao: "Editou prospecção", registro_id: editProsp.id, detalhes: { status: editStatus } });
    setEditOpen(false);
    fetchAll();
  };

  const handleQuickStatusChange = async (prosp: Prospeccao, newStatus: string) => {
    const { error } = await (supabase.from("prospeccoes") as any)
      .update({ status_prospeccao: newStatus })
      .eq("id", prosp.id);
    if (error) { toast.error("Erro ao atualizar status"); return; }
    toast.success(`Status atualizado para "${newStatus}"`);
    logAudit({ tabela: "prospeccoes", acao: "Alterou status prospecção", registro_id: prosp.id, detalhes: { de: prosp.status_prospeccao, para: newStatus } });
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
      .filter(e => e.acao_id === createAcaoId && e.elegivel && !prospElegIds.has(e.id));
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

  // Stats
  const totalValor = filteredProspeccoes.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
  const assinados = filteredProspeccoes.filter(p => p.status_prospeccao === "Contrato assinado");
  const valorAssinado = assinados.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight">Prospecção</h1>
          <p className="text-muted-foreground mt-1">Visão Kanban do pipeline de prospecção</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />Nova Prospecção
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Prospecções</p>
          <p className="text-2xl font-heading font-bold mt-1">{filteredProspeccoes.length}</p>
        </Card>
        <Card className="shadow-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Total Pipeline</p>
          <p className="text-2xl font-heading font-bold mt-1">{formatCurrency(totalValor)}</p>
        </Card>
        <Card className="shadow-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Contratos Assinados</p>
          <p className="text-2xl font-heading font-bold text-success mt-1">{assinados.length}</p>
        </Card>
        <Card className="shadow-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Assinado</p>
          <p className="text-2xl font-heading font-bold text-success mt-1">{formatCurrency(valorAssinado)}</p>
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

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {statusColumns.map(col => {
          const items = filteredProspeccoes.filter(p => p.status_prospeccao === col.key);
          return (
            <div key={col.key} className="flex-shrink-0 w-[280px]">
              {/* Column Header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} />
                <h3 className="text-sm font-medium">{col.label}</h3>
                <Badge variant="outline" className="text-[10px] ml-auto">{items.length}</Badge>
              </div>

              {/* Cards */}
              <div className="space-y-3 min-h-[120px]">
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Nenhuma prospecção
                  </div>
                )}
                {items.map(p => {
                  const emp = getEmpresa(p.elegibilidade_id);
                  const acao = getAcao(p.elegibilidade_id);
                  const colIdx = statusColumns.findIndex(c => c.key === p.status_prospeccao);
                  const nextCol = colIdx < statusColumns.length - 2 ? statusColumns[colIdx + 1] : null;
                  
                  return (
                    <Card
                      key={p.id}
                      className="shadow-card hover:shadow-elevated transition-all cursor-pointer group"
                      onClick={() => openEdit(p)}
                    >
                      <div className="p-3 space-y-2.5">
                        {/* Company */}
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-1.5 text-sm font-medium truncate">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{emp?.nome || "—"}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
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
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          {p.contato_telefone && (
                            <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{p.contato_telefone}</span>
                          )}
                          {p.contato_email && (
                            <span className="flex items-center gap-1 truncate"><Mail className="h-2.5 w-2.5" />{p.contato_email}</span>
                          )}
                        </div>

                        {/* Value */}
                        {Number(p.valor_contrato) > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <DollarSign className="h-3 w-3 text-success" />
                            <span className="font-medium">{formatCurrency(Number(p.valor_contrato))}</span>
                          </div>
                        )}

                        {/* Quick advance button */}
                        {nextCol && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-7 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickStatusChange(p, nextCol.key);
                            }}
                          >
                            <ArrowRight className="mr-1 h-3 w-3" />
                            Mover para {nextCol.label}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

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
              </div>

              <div>
                <Label>Etapa da Prospecção</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusColumns.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
                <Label>Empresa Elegível</Label>
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
                        return (
                          <SelectItem key={e.id} value={e.id}>{emp?.nome || "—"} ({emp?.cnpj})</SelectItem>
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
    </div>
  );
}
