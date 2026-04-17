import { useState, useEffect, DragEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Eye, Pencil, Trash2, FolderPlus, Folder, X, GripVertical, FolderOpen, Gavel, Users } from "lucide-react";
import { EmpresaDialog } from "@/components/EmpresaDialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
  status: string;
  obs: string;
  created_at: string;
}

interface Pasta {
  id: string;
  nome: string;
}

interface PastaItem {
  pasta_id: string;
  empresa_id: string;
}

interface Acao {
  id: string;
  nome: string;
  tipo: string;
  status: string;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
}

const statusColors: Record<string, string> = {
  prospect: "bg-info/10 text-info",
  cliente: "bg-success/10 text-success",
  inativo: "bg-muted text-muted-foreground",
};

export default function Empresas() {
  const [search, setSearch] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [detailEmpresa, setDetailEmpresa] = useState<Empresa | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  // Pastas
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [pastaItems, setPastaItems] = useState<PastaItem[]>([]);
  const [selectedPasta, setSelectedPasta] = useState<string>("all");
  const [pastaDialogOpen, setPastaDialogOpen] = useState(false);
  const [newPastaName, setNewPastaName] = useState("");
  const [managePastaOpen, setManagePastaOpen] = useState(false);
  const [managePastaId, setManagePastaId] = useState<string>("");
  const [selectedEmpresas, setSelectedEmpresas] = useState<Set<string>>(new Set());
  const [dragOverPastaId, setDragOverPastaId] = useState<string | null>(null);
  const [draggingEmpresaId, setDraggingEmpresaId] = useState<string | null>(null);

  // Ações
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [dragOverAcaoId, setDragOverAcaoId] = useState<string | null>(null);
  const [expandedAcaoId, setExpandedAcaoId] = useState<string | null>(null);

  // Elegibilidade dialog (opened on drop)
  const [elegDialogOpen, setElegDialogOpen] = useState(false);
  const [elegEmpresaId, setElegEmpresaId] = useState("");
  const [elegAcaoId, setElegAcaoId] = useState("");
  const [elegElegivel, setElegElegivel] = useState("true");
  const [elegJustificativa, setElegJustificativa] = useState("");

  const fetchAll = async () => {
    const [empRes, pastaRes, itemsRes, acoesRes, elegRes] = await Promise.all([
      supabase.from("empresas").select("*").order("created_at", { ascending: false }),
      supabase.from("pastas_empresas").select("id, nome").order("nome"),
      supabase.from("pasta_empresa_items").select("pasta_id, empresa_id"),
      supabase.from("acoes_tributarias").select("id, nome, tipo, status").order("nome"),
      supabase.from("elegibilidade").select("id, empresa_id, acao_id, elegivel, justificativa"),
    ]);
    setEmpresas(empRes.data || []);
    setPastas(pastaRes.data || []);
    setPastaItems(itemsRes.data || []);
    setAcoes(acoesRes.data || []);
    setElegibilidades(elegRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const empresaIdsInPasta = (pastaId: string) =>
    new Set(pastaItems.filter((i) => i.pasta_id === pastaId).map((i) => i.empresa_id));

  const empresaIdsInAcao = (acaoId: string) =>
    new Set(elegibilidades.filter((e) => e.acao_id === acaoId).map((e) => e.empresa_id));

  const filtered = empresas.filter((e) => {
    const matchesSearch = e.nome.toLowerCase().includes(search.toLowerCase()) || e.cnpj.includes(search);
    if (selectedPasta === "all") return matchesSearch;
    return matchesSearch && empresaIdsInPasta(selectedPasta).has(e.id);
  });

  const handleCreate = async (data: { nome: string; cnpj: string; status: string; obs: string }) => {
    const { error } = await supabase.from("empresas").insert({ ...data, user_id: user?.id });
    if (error) { toast.error("Erro ao criar empresa"); } else {
      logAudit({ tabela: "empresas", acao: "Criou empresa", detalhes: { nome: data.nome, cnpj: data.cnpj } });
      fetchAll();
    }
  };

  const handleEdit = async (id: string, data: { nome: string; cnpj: string; status: string; obs: string }) => {
    const { error } = await supabase.from("empresas").update(data).eq("id", id);
    if (error) { toast.error("Erro ao atualizar empresa"); } else {
      toast.success("Empresa atualizada!");
      logAudit({ tabela: "empresas", acao: "Editou empresa", registro_id: id, detalhes: { nome: data.nome } });
      fetchAll();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("empresas").delete().eq("id", id);
    const empresa = empresas.find((emp) => emp.id === id);
    if (error) { toast.error("Erro ao remover empresa"); } else {
      toast.success("Empresa removida");
      logAudit({ tabela: "empresas", acao: "Removeu empresa", registro_id: id, detalhes: { nome: empresa?.nome } });
      fetchAll();
    }
  };

  // Pasta handlers
  const handleCreatePasta = async () => {
    if (!newPastaName.trim()) { toast.error("Nome da pasta é obrigatório"); return; }
    const { error } = await supabase.from("pastas_empresas").insert({ nome: newPastaName.trim(), user_id: user!.id });
    if (error) { toast.error("Erro ao criar pasta"); } else { toast.success("Pasta criada!"); setNewPastaName(""); setPastaDialogOpen(false); fetchAll(); }
  };

  const handleDeletePasta = async (id: string) => {
    const { error } = await supabase.from("pastas_empresas").delete().eq("id", id);
    if (error) { toast.error("Erro ao remover pasta"); } else {
      toast.success("Pasta removida!");
      if (selectedPasta === id) setSelectedPasta("all");
      fetchAll();
    }
  };

  const openManagePasta = (pastaId: string) => {
    setManagePastaId(pastaId);
    setSelectedEmpresas(empresaIdsInPasta(pastaId));
    setManagePastaOpen(true);
  };

  const handleSavePastaItems = async () => {
    await supabase.from("pasta_empresa_items").delete().eq("pasta_id", managePastaId);
    if (selectedEmpresas.size > 0) {
      const items = Array.from(selectedEmpresas).map((empresa_id) => ({
        pasta_id: managePastaId,
        empresa_id,
        user_id: user!.id,
      }));
      const { error } = await supabase.from("pasta_empresa_items").insert(items);
      if (error) { toast.error("Erro ao salvar"); console.error(error); return; }
    }
    toast.success("Pasta atualizada!");
    setManagePastaOpen(false);
    fetchAll();
  };

  const toggleEmpresa = (id: string) => {
    setSelectedEmpresas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getPastaNames = (empresaId: string) =>
    pastaItems.filter((i) => i.empresa_id === empresaId).map((i) => pastas.find((p) => p.id === i.pasta_id)?.nome).filter(Boolean);

  // Drag & Drop — Pasta handlers
  const handleDragStart = (e: DragEvent, empresaId: string) => {
    e.dataTransfer.setData("empresaId", empresaId);
    e.dataTransfer.effectAllowed = "copy";
    setDraggingEmpresaId(empresaId);
  };

  const handleDragEnd = () => {
    setDraggingEmpresaId(null);
    setDragOverPastaId(null);
    setDragOverAcaoId(null);
  };

  const handleDragOverPasta = (e: DragEvent, pastaId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverPastaId(pastaId);
  };

  const handleDragLeavePasta = () => { setDragOverPastaId(null); };

  const handleDropPasta = async (e: DragEvent, pastaId: string) => {
    e.preventDefault();
    setDragOverPastaId(null);
    setDraggingEmpresaId(null);
    const empresaId = e.dataTransfer.getData("empresaId");
    if (!empresaId) return;

    const alreadyIn = pastaItems.some((i) => i.pasta_id === pastaId && i.empresa_id === empresaId);
    if (alreadyIn) { toast.info("Empresa já está nesta pasta"); return; }

    const { error } = await supabase.from("pasta_empresa_items").insert({
      pasta_id: pastaId, empresa_id: empresaId, user_id: user!.id,
    });
    if (error) { toast.error("Erro ao adicionar à pasta"); } else {
      const empresa = empresas.find((emp) => emp.id === empresaId);
      const pasta = pastas.find((p) => p.id === pastaId);
      toast.success(`"${empresa?.nome}" adicionada à pasta "${pasta?.nome}"`);
      fetchAll();
    }
  };

  const handleRemoveFromPasta = async (empresaId: string, pastaId: string) => {
    const { error } = await supabase.from("pasta_empresa_items").delete().eq("pasta_id", pastaId).eq("empresa_id", empresaId);
    if (error) { toast.error("Erro ao remover da pasta"); } else { toast.success("Empresa removida da pasta"); fetchAll(); }
  };

  // Drag & Drop — Ação handlers
  const handleDragOverAcao = (e: DragEvent, acaoId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverAcaoId(acaoId);
  };

  const handleDragLeaveAcao = () => { setDragOverAcaoId(null); };

  const handleDropAcao = (e: DragEvent, acaoId: string) => {
    e.preventDefault();
    setDragOverAcaoId(null);
    const empresaId = e.dataTransfer.getData("empresaId");
    setDraggingEmpresaId(null);
    if (!empresaId) return;

    const alreadyIn = elegibilidades.some((el) => el.acao_id === acaoId && el.empresa_id === empresaId);
    if (alreadyIn) { toast.info("Empresa já vinculada a esta ação"); return; }

    // Open elegibilidade dialog
    setElegEmpresaId(empresaId);
    setElegAcaoId(acaoId);
    setElegElegivel("true");
    setElegJustificativa("");
    setElegDialogOpen(true);
  };

  const handleSaveElegibilidade = async () => {
    if (!elegEmpresaId || !elegAcaoId) return;

    const { error } = await supabase.from("elegibilidade").insert({
      empresa_id: elegEmpresaId,
      acao_id: elegAcaoId,
      elegivel: elegElegivel === "true",
      justificativa: elegJustificativa || "",
      user_id: user!.id,
    });
    if (error) { toast.error("Erro ao criar elegibilidade"); console.error(error); return; }

    const emp = empresas.find((e) => e.id === elegEmpresaId);
    const acao = acoes.find((a) => a.id === elegAcaoId);
    toast.success(`"${emp?.nome}" vinculada a "${acao?.nome}"`);
    logAudit({ tabela: "elegibilidade", acao: "Criou elegibilidade", detalhes: { empresa: emp?.nome, acao_nome: acao?.nome, elegivel: elegElegivel === "true" } });
    setElegDialogOpen(false);
    fetchAll();
  };

  const handleRemoveEleg = async (elegId: string) => {
    const { error } = await supabase.from("elegibilidade").delete().eq("id", elegId);
    if (error) { toast.error("Erro ao remover"); } else { toast.success("Vínculo removido"); fetchAll(); }
  };

  const getEmpresaNome = (id: string) => empresas.find((e) => e.id === id)?.nome || "—";

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight">Empresas</h1>
          <p className="text-muted-foreground mt-1">Arraste empresas para pastas ou ações</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPastaDialogOpen(true)}>
            <FolderPlus className="mr-2 h-4 w-4" />Nova Pasta
          </Button>
          <EmpresaDialog onSave={handleCreate} />
        </div>
      </div>

      {/* Three-column layout: Pastas | Table | Ações */}
      <div className="flex gap-5 items-start">
        {/* LEFT — Folders sidebar */}
        <div className="w-56 shrink-0 sticky top-4 space-y-1.5 hidden lg:block">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pastas</h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPastaDialogOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
              selectedPasta === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/50 text-muted-foreground"
            }`}
            onClick={() => setSelectedPasta("all")}
          >
            <Folder className="h-4 w-4" />
            <span>Todas ({empresas.length})</span>
          </div>

          {pastas.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
              <FolderPlus className="h-5 w-5 mx-auto mb-1 opacity-50" />
              Crie uma pasta
            </div>
          )}

          {pastas.map((p) => {
            const idsInPasta = empresaIdsInPasta(p.id);
            const isOver = dragOverPastaId === p.id;
            const isSelected = selectedPasta === p.id;
            return (
              <div key={p.id}>
                <div
                  className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 text-sm ${
                    isOver
                      ? "bg-primary/10 ring-2 ring-primary scale-[1.02]"
                      : isSelected
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-muted/50 text-muted-foreground"
                  }`}
                  onClick={() => setSelectedPasta(isSelected ? "all" : p.id)}
                  onDragOver={(e) => handleDragOverPasta(e, p.id)}
                  onDragLeave={handleDragLeavePasta}
                  onDrop={(e) => handleDropPasta(e, p.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isOver ? <FolderOpen className="h-4 w-4 text-primary shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                    <span className="truncate">{p.nome}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{idsInPasta.size}</Badge>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); openManagePasta(p.id); }}>
                      <Pencil className="h-2.5 w-2.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={(e) => e.stopPropagation()}>
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir pasta "{p.nome}"?</AlertDialogTitle>
                          <AlertDialogDescription>As empresas não serão removidas.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeletePasta(p.id)}>Excluir</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {isOver && draggingEmpresaId && (
                  <div className="mx-3 mt-1 text-[10px] text-primary font-medium text-center py-1 border border-dashed border-primary rounded">
                    Solte para adicionar
                  </div>
                )}

                {isSelected && idsInPasta.size > 0 && (
                  <div className="ml-6 mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {empresas.filter((emp) => idsInPasta.has(emp.id)).map((emp) => (
                      <div key={emp.id} className="flex items-center justify-between text-[11px] text-muted-foreground px-2 py-1 rounded hover:bg-muted/50">
                        <span className="truncate">{emp.nome}</span>
                        <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleRemoveFromPasta(emp.id, p.id); }}>
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CENTER — Table */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome ou CNPJ..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="lg:hidden">
              <Select value={selectedPasta} onValueChange={setSelectedPasta}>
                <SelectTrigger className="w-48">
                  <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Pasta..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {pastas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-8"></th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Empresa</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">CNPJ</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Pastas</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma empresa encontrada</td></tr>
                  )}
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/50 transition-colors ${
                        draggingEmpresaId === e.id ? "opacity-50" : ""
                      }`}
                      draggable
                      onDragStart={(ev) => handleDragStart(ev, e.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <td className="py-3 pl-2 pr-0">
                        <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
                      </td>
                      <td className="py-3 px-4 font-medium">{e.nome}</td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{e.cnpj}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[e.status] || ""}`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1 flex-wrap">
                          {getPastaNames(e.id).map((name) => (
                            <Badge key={name} variant="outline" className="text-[10px]">
                              <Folder className="mr-1 h-2.5 w-2.5" />{name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetailEmpresa(e)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <EmpresaDialog
                            onSave={(data) => handleEdit(e.id, data)}
                            initialData={e}
                            title="Editar Empresa"
                            trigger={
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            }
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
                                <AlertDialogDescription>Deseja remover "{e.nome}"?</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(e.id)}>Excluir</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* RIGHT — Ações sidebar */}
        <div className="w-56 shrink-0 sticky top-4 space-y-1.5 hidden lg:block">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ações Tributárias</h3>
          </div>

          {acoes.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
              <Gavel className="h-5 w-5 mx-auto mb-1 opacity-50" />
              Nenhuma ação cadastrada
            </div>
          )}

          {acoes.map((a) => {
            const idsInAcao = empresaIdsInAcao(a.id);
            const isOver = dragOverAcaoId === a.id;
            const isExpanded = expandedAcaoId === a.id;
            const elegsForAcao = elegibilidades.filter((el) => el.acao_id === a.id);

            return (
              <div key={a.id}>
                <div
                  className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 text-sm ${
                    isOver
                      ? "bg-accent/20 ring-2 ring-accent scale-[1.02]"
                      : isExpanded
                      ? "bg-accent/10 text-accent-foreground"
                      : "hover:bg-muted/50 text-muted-foreground"
                  }`}
                  onClick={() => setExpandedAcaoId(isExpanded ? null : a.id)}
                  onDragOver={(e) => handleDragOverAcao(e, a.id)}
                  onDragLeave={handleDragLeaveAcao}
                  onDrop={(e) => handleDropAcao(e, a.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Gavel className={`h-4 w-4 shrink-0 ${isOver ? "text-accent-foreground" : ""}`} />
                    <div className="min-w-0">
                      <span className="truncate block text-xs font-medium">{a.nome}</span>
                      <span className="text-[10px] text-muted-foreground">{a.tipo}</span>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                    <Users className="mr-0.5 h-2.5 w-2.5" />{idsInAcao.size}
                  </Badge>
                </div>

                {isOver && draggingEmpresaId && (
                  <div className="mx-3 mt-1 text-[10px] text-accent-foreground font-medium text-center py-1 border border-dashed border-accent rounded">
                    Solte para vincular
                  </div>
                )}

                {isExpanded && elegsForAcao.length > 0 && (
                  <div className="ml-6 mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                    {elegsForAcao.map((el) => (
                      <div key={el.id} className="flex items-center justify-between text-[11px] px-2 py-1 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="truncate text-muted-foreground">{getEmpresaNome(el.empresa_id)}</span>
                          <span className={`text-[9px] px-1 rounded ${el.elegivel ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                            {el.elegivel ? "E" : "NE"}
                          </span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-4 w-4 shrink-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleRemoveEleg(el.id); }}>
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detailEmpresa} onOpenChange={(open) => !open && setDetailEmpresa(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Detalhes da Empresa</DialogTitle>
          </DialogHeader>
          {detailEmpresa && (
            <div className="space-y-3 text-sm">
              <div><span className="font-medium text-muted-foreground">Nome:</span> {detailEmpresa.nome}</div>
              <div><span className="font-medium text-muted-foreground">CNPJ:</span> <span className="font-mono">{detailEmpresa.cnpj}</span></div>
              <div><span className="font-medium text-muted-foreground">Status:</span> <span className="capitalize">{detailEmpresa.status}</span></div>
              <div><span className="font-medium text-muted-foreground">Observações:</span> {detailEmpresa.obs || "Nenhuma"}</div>
              <div>
                <span className="font-medium text-muted-foreground">Pastas:</span>{" "}
                {getPastaNames(detailEmpresa.id).join(", ") || "Nenhuma"}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create folder dialog */}
      <Dialog open={pastaDialogOpen} onOpenChange={setPastaDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Nova Pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Pasta</Label>
              <Input value={newPastaName} onChange={(e) => setNewPastaName(e.target.value)} placeholder="Ex: Empresas de Serviço" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPastaDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreatePasta}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage folder items dialog */}
      <Dialog open={managePastaOpen} onOpenChange={setManagePastaOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Gerenciar Pasta: {pastas.find((p) => p.id === managePastaId)?.nome}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto max-h-[50vh]">
            {empresas.map((e) => (
              <label key={e.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer">
                <Checkbox checked={selectedEmpresas.has(e.id)} onCheckedChange={() => toggleEmpresa(e.id)} />
                <div>
                  <div className="text-sm font-medium">{e.nome}</div>
                  <div className="text-xs text-muted-foreground font-mono">{e.cnpj}</div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagePastaOpen(false)}>Cancelar</Button>
            <Button onClick={handleSavePastaItems}>Salvar ({selectedEmpresas.size} empresas)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Elegibilidade dialog — opened on drop to ação */}
      <Dialog open={elegDialogOpen} onOpenChange={setElegDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Vincular Empresa à Ação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 space-y-1 text-sm">
              <div><span className="text-muted-foreground">Empresa:</span> <span className="font-medium">{getEmpresaNome(elegEmpresaId)}</span></div>
              <div><span className="text-muted-foreground">Ação:</span> <span className="font-medium">{acoes.find((a) => a.id === elegAcaoId)?.nome}</span></div>
            </div>
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
              <Textarea value={elegJustificativa} onChange={(e) => setElegJustificativa(e.target.value)} placeholder="Motivo da decisão (opcional)" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setElegDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveElegibilidade}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
