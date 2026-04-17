import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState } from "@/components/LoadingState";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Acao {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  vinculo: string | null;
  data_limite_prescricao: string | null;
  tipo_prazo: string | null;
  observacao_prazo: string | null;
}

const TIPOS_PRAZO: { value: string; label: string }[] = [
  { value: "rescisoria_24m",   label: "Rescisória — 24 meses (CPC 975)" },
  { value: "prescricional_5a", label: "Prescricional — 5 anos" },
  { value: "decadencial_5a",   label: "Decadencial — 5 anos" },
  { value: "personalizado",    label: "Personalizado" },
];

export default function Admin() {
  const { user } = useAuth();
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [loading, setLoading] = useState(true);

  // Ação form state
  const [acaoDialogOpen, setAcaoDialogOpen] = useState(false);
  const [editingAcao, setEditingAcao] = useState<Acao | null>(null);
  const [acaoNome, setAcaoNome] = useState("");
  const [acaoTipo, setAcaoTipo] = useState("INICIAL");
  const [acaoStatus, setAcaoStatus] = useState("Ativa");
  const [acaoVinculo, setAcaoVinculo] = useState("");
  const [acaoDataPrescricao, setAcaoDataPrescricao] = useState("");
  const [acaoTipoPrazo, setAcaoTipoPrazo] = useState("");
  const [acaoObsPrazo, setAcaoObsPrazo] = useState("");

  const fetchAcoes = async () => {
    const { data, error } = await supabase
      .from("acoes_tributarias")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar ações");
    } else {
      setAcoes((data as Acao[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAcoes();
  }, []);

  const acoesIniciais = acoes.filter((a) => a.tipo === "INICIAL");

  const openCreateAcao = () => {
    setEditingAcao(null);
    setAcaoNome("");
    setAcaoTipo("INICIAL");
    setAcaoStatus("Ativa");
    setAcaoVinculo("");
    setAcaoDataPrescricao("");
    setAcaoTipoPrazo("");
    setAcaoObsPrazo("");
    setAcaoDialogOpen(true);
  };

  const openEditAcao = (acao: Acao) => {
    setEditingAcao(acao);
    setAcaoNome(acao.nome);
    setAcaoTipo(acao.tipo);
    setAcaoStatus(acao.status);
    setAcaoVinculo(acao.vinculo || "");
    setAcaoDataPrescricao(acao.data_limite_prescricao || "");
    setAcaoTipoPrazo(acao.tipo_prazo || "");
    setAcaoObsPrazo(acao.observacao_prazo || "");
    setAcaoDialogOpen(true);
  };

  const handleSaveAcao = async () => {
    if (!acaoNome.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (acaoTipo === "RESCISÓRIA" && !acaoVinculo) {
      toast.error("Ações rescisórias precisam de vínculo");
      return;
    }

    const prazoPayload = {
      data_limite_prescricao: acaoDataPrescricao || null,
      tipo_prazo: (acaoTipoPrazo || null) as any,
      observacao_prazo: acaoObsPrazo || null,
    };

    if (editingAcao) {
      const { error } = await (supabase.from("acoes_tributarias") as any).update({
        nome: acaoNome,
        tipo: acaoTipo,
        status: acaoStatus,
        vinculo: acaoTipo === "RESCISÓRIA" ? acaoVinculo : "",
        ...prazoPayload,
      }).eq("id", editingAcao.id);
      if (error) {
        toast.error("Erro ao atualizar ação");
      } else {
        toast.success("Ação atualizada!");
        logAudit({ tabela: "acoes_tributarias", acao: "Editou ação", registro_id: editingAcao.id, detalhes: { nome: acaoNome, tipo: acaoTipo, data_prescricao: acaoDataPrescricao } });
      }
    } else {
      const { error } = await (supabase.from("acoes_tributarias") as any).insert({
        nome: acaoNome,
        tipo: acaoTipo,
        status: acaoStatus,
        vinculo: acaoTipo === "RESCISÓRIA" ? acaoVinculo : "",
        user_id: user!.id,
        ...prazoPayload,
      });
      if (error) {
        toast.error("Erro ao criar ação");
      } else {
        toast.success("Ação criada!");
        logAudit({ tabela: "acoes_tributarias", acao: "Criou ação", detalhes: { nome: acaoNome, tipo: acaoTipo } });
      }
    }
    setAcaoDialogOpen(false);
    fetchAcoes();
  };

  const handleDeleteAcao = async (id: string) => {
    const acao = acoes.find((a) => a.id === id);
    const { error } = await supabase.from("acoes_tributarias").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover ação");
    } else {
      toast.success("Ação removida!");
      logAudit({ tabela: "acoes_tributarias", acao: "Removeu ação", registro_id: id, detalhes: { nome: acao?.nome } });
      fetchAcoes();
    }
  };

  if (loading) {
    return <LoadingState variant="page" />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Administração"
        description="Configurações do sistema e gerenciamento"
        icon={<Settings className="h-7 w-7" />}
      />

      <Tabs defaultValue="acoes">
        <TabsList>
          <TabsTrigger value="acoes">Ações</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="criterios">Critérios</TabsTrigger>
        </TabsList>

        {/* === AÇÕES TAB === */}
        <TabsContent value="acoes" className="mt-4">
          <Card className="shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold">Ações Tributárias</h3>
              <Button size="sm" onClick={openCreateAcao}>
                <Plus className="mr-2 h-3 w-3" />Criar Ação
              </Button>
            </div>

            {acoes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ação cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {acoes.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-3 rounded-md border border-border hover:bg-muted/50 transition-colors">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{a.nome}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          a.tipo === "INICIAL" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"
                        }`}>{a.tipo}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          a.status === "Ativa" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                        }`}>{a.status}</span>
                        {a.data_limite_prescricao && (() => {
                          const dias = Math.floor((new Date(a.data_limite_prescricao).getTime() - Date.now()) / 86400000);
                          const cor = dias < 0 ? "bg-destructive/20 text-destructive"
                                   : dias <= 30 ? "bg-destructive/15 text-destructive"
                                   : dias <= 90 ? "bg-warning/15 text-warning"
                                   : "bg-info/15 text-info";
                          return (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cor}`}>
                              {dias < 0 ? `Prescrita há ${Math.abs(dias)}d` : `${dias}d p/ prescrever`}
                            </span>
                          );
                        })()}
                      </div>
                      {a.tipo === "RESCISÓRIA" && a.vinculo && (
                        <p className="text-xs text-muted-foreground">Vinculada a: {a.vinculo}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditAcao(a)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                            <AlertDialogDescription>Remover "{a.nome}"? Esta ação não pode ser desfeita.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteAcao(a.id)}>Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* === STATUS TAB === */}
        <TabsContent value="status" className="mt-4">
          <Card className="shadow-card p-6">
            <h3 className="font-heading font-semibold mb-4">Status Disponíveis</h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Status de Empresas</h4>
                <div className="flex flex-wrap gap-2">
                  {["prospect", "cliente", "inativo"].map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border border-border capitalize">{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Status de Ações</h4>
                <div className="flex flex-wrap gap-2">
                  {["Ativa", "Inativa", "Suspensa"].map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border border-border">{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Status de Elegibilidade</h4>
                <div className="flex flex-wrap gap-2">
                  {["Elegível", "Não elegível", "Em análise", "Ajuizada"].map((s) => (
                    <span key={s} className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border border-border">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* === USUÁRIOS TAB === */}
        <TabsContent value="usuarios" className="mt-4">
          <Card className="shadow-card p-6">
            <h3 className="font-heading font-semibold mb-2">Gerenciamento de Usuários</h3>
            <p className="text-sm text-muted-foreground mb-4">Usuário logado:</p>
            <div className="p-3 rounded-md border border-border">
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-muted-foreground mt-1">ID: {user?.id?.slice(0, 8)}...</p>
            </div>
          </Card>
        </TabsContent>

        {/* === CRITÉRIOS TAB === */}
        <TabsContent value="criterios" className="mt-4">
          <Card className="shadow-card p-6">
            <h3 className="font-heading font-semibold mb-2">Critérios Dinâmicos</h3>
            <p className="text-sm text-muted-foreground">
              Os critérios de elegibilidade são gerenciados na página de Elegibilidade, onde é possível vincular empresas a ações e definir justificativas.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Ação Dialog */}
      <Dialog open={acaoDialogOpen} onOpenChange={setAcaoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">{editingAcao ? "Editar Ação" : "Nova Ação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={acaoNome} onChange={(e) => setAcaoNome(e.target.value)} placeholder="Ex: Exclusão ICMS PIS/COFINS" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={acaoTipo} onValueChange={setAcaoTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INICIAL">Inicial</SelectItem>
                  <SelectItem value="RESCISÓRIA">Rescisória</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {acaoTipo === "RESCISÓRIA" && (
              <div className="space-y-2">
                <Label>Vinculada a (ação inicial)</Label>
                <Select value={acaoVinculo} onValueChange={setAcaoVinculo}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {acoesIniciais.map((a) => (
                      <SelectItem key={a.id} value={a.nome}>{a.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={acaoStatus} onValueChange={setAcaoStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Ativa">Ativa</SelectItem>
                  <SelectItem value="Inativa">Inativa</SelectItem>
                  <SelectItem value="Suspensa">Suspensa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* QW4 — Prescrição como motor de urgência */}
            <div className="space-y-2 p-3 rounded-md border border-warning/30 bg-warning/5">
              <Label className="text-warning flex items-center gap-1">
                ⚠ Prazo / Prescrição
              </Label>
              <p className="text-[10px] text-muted-foreground">
                Hormozi: urgência REAL vende. Preencher isso dispara contador regressivo nas prospecções.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de prazo</Label>
                <Select value={acaoTipoPrazo || "none"} onValueChange={(v) => setAcaoTipoPrazo(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nenhum —</SelectItem>
                    {TIPOS_PRAZO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Data limite (prescrição / decadência)</Label>
                <Input
                  type="date"
                  value={acaoDataPrescricao}
                  onChange={(e) => setAcaoDataPrescricao(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Observações sobre o prazo</Label>
                <Input
                  value={acaoObsPrazo}
                  onChange={(e) => setAcaoObsPrazo(e.target.value)}
                  placeholder="Ex: a contar da decisão do STF de 12/08/2020"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcaoDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveAcao}>{editingAcao ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
