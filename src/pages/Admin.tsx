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
import { TemplatesAdmin } from "@/components/TemplatesAdmin";
import TemplatesTarefaAdmin from "./tarefas/TemplatesAdmin";
import { BackupAdmin } from "@/components/BackupAdmin";
import { AuditLogViewer } from "@/components/AuditLogViewer";
import { gerarCodigoUnico, nomeTeseExiste } from "@/lib/acaoCodigo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  { value: "rescisoria_24m", label: "Rescisória — 24 meses (CPC 975)" },
  { value: "prescricional_5a", label: "Prescricional — 5 anos" },
  { value: "decadencial_5a", label: "Decadencial — 5 anos" },
  { value: "personalizado", label: "Personalizado" },
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

    const nomeTrim = acaoNome.trim();
    if (editingAcao) {
      const { error } = await supabase
        .from("acoes_tributarias")
        .update({
          nome: nomeTrim,
          tipo: acaoTipo,
          status: acaoStatus,
          vinculo: acaoTipo === "RESCISÓRIA" ? acaoVinculo : "",
          ...prazoPayload,
        })
        .eq("id", editingAcao.id);
      if (error) {
        toast.error("Erro ao atualizar ação");
      } else {
        toast.success("Ação atualizada!");
        logAudit({
          tabela: "acoes_tributarias",
          acao: "Editou ação",
          registro_id: editingAcao.id,
          detalhes: { nome: nomeTrim, tipo: acaoTipo, data_prescricao: acaoDataPrescricao },
        });
      }
    } else {
      // nome duplicado quebra o mapeamento tese→id da detecção (casa por nome no seed)
      if (await nomeTeseExiste(nomeTrim)) {
        toast.error("Já existe uma tese com esse nome.");
        return;
      }
      // codigo estável (contrato da detecção PJe) — mesma regra do Acoes.tsx
      const codigo = await gerarCodigoUnico(nomeTrim);
      const { error } = await supabase.from("acoes_tributarias").insert({
        nome: nomeTrim,
        tipo: acaoTipo,
        status: acaoStatus,
        vinculo: acaoTipo === "RESCISÓRIA" ? acaoVinculo : "",
        user_id: user?.id,
        codigo,
        ...prazoPayload,
      });
      if (error) {
        toast.error("Erro ao criar ação");
      } else {
        toast.success("Ação criada!");
        logAudit({
          tabela: "acoes_tributarias",
          acao: "Criou ação",
          detalhes: { nome: nomeTrim, tipo: acaoTipo, codigo },
        });
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
      logAudit({
        tabela: "acoes_tributarias",
        acao: "Removeu ação",
        registro_id: id,
        detalhes: { nome: acao?.nome },
      });
      fetchAcoes();
    }
  };

  if (loading) {
    return <LoadingState variant="page" />;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Administração"
        description="Configurações do sistema e gerenciamento"
        icon={<Settings className="h-7 w-7" />}
      />

      <Tabs defaultValue="acoes">
        <TabsList>
          <TabsTrigger value="acoes">Ações</TabsTrigger>
          <TabsTrigger value="templates-msg">Templates de Mensagem</TabsTrigger>
          <TabsTrigger value="templates-tarefa">Templates de Tarefa</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
        </TabsList>

        {/* === TEMPLATES DE MENSAGEM (Hormozi Sprint 2) === */}
        <TabsContent value="templates-msg" className="mt-4">
          <TemplatesAdmin />
        </TabsContent>

        {/* === TEMPLATES DE TAREFA (FASE 3) === */}
        <TabsContent value="templates-tarefa" className="mt-4">
          <TemplatesTarefaAdmin embedded />
        </TabsContent>

        {/* === AÇÕES TAB === */}
        <TabsContent value="acoes" className="mt-4">
          <Card className="p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading font-semibold">Ações Tributárias</h3>
              <Button size="sm" onClick={openCreateAcao}>
                <Plus className="mr-2 h-3 w-3" />
                Criar Ação
              </Button>
            </div>

            {acoes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma ação cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {acoes.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{a.nome}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            a.tipo === "INICIAL"
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary text-secondary-foreground"
                          }`}
                        >
                          {a.tipo}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            a.status === "Ativa"
                              ? "bg-success/10 text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {a.status}
                        </span>
                        {a.data_limite_prescricao &&
                          (() => {
                            const dias = Math.floor(
                              (new Date(a.data_limite_prescricao).getTime() - Date.now()) / 86400000
                            );
                            const cor =
                              dias < 0
                                ? "bg-destructive/20 text-destructive"
                                : dias <= 30
                                  ? "bg-destructive/15 text-destructive"
                                  : dias <= 90
                                    ? "bg-warning/15 text-warning"
                                    : "bg-info/15 text-info";
                            return (
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cor}`}
                              >
                                {dias < 0
                                  ? `Prescrita há ${Math.abs(dias)}d`
                                  : `${dias}d p/ prescrever`}
                              </span>
                            );
                          })()}
                      </div>
                      {a.tipo === "RESCISÓRIA" && a.vinculo && (
                        <p className="text-xs text-muted-foreground">Vinculada a: {a.vinculo}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditAcao(a)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                            <AlertDialogDescription>
                              Remover "{a.nome}"? Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleDeleteAcao(a.id)}>
                              Excluir
                            </AlertDialogAction>
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

        {/* === AUDITORIA TAB === */}
        <TabsContent value="auditoria" className="mt-4">
          <AuditLogViewer />
        </TabsContent>

        {/* === BACKUP TAB === */}
        <TabsContent value="backup" className="mt-4">
          <BackupAdmin />
        </TabsContent>
      </Tabs>

      {/* Ação Dialog */}
      <Dialog open={acaoDialogOpen} onOpenChange={setAcaoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingAcao ? "Editar Ação" : "Nova Ação"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={acaoNome}
                onChange={(e) => setAcaoNome(e.target.value)}
                placeholder="Ex: Exclusão ICMS PIS/COFINS"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={acaoTipo} onValueChange={setAcaoTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {acoesIniciais.map((a) => (
                      <SelectItem key={a.id} value={a.nome}>
                        {a.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={acaoStatus} onValueChange={setAcaoStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Ativa">Ativa</SelectItem>
                  <SelectItem value="Inativa">Inativa</SelectItem>
                  <SelectItem value="Suspensa">Suspensa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* QW4 — Prescrição como motor de urgência */}
            <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <Label className="flex items-center gap-1 text-warning">⚠ Prazo / Prescrição</Label>
              <p className="text-[10px] text-muted-foreground">
                Hormozi: urgência REAL vende. Preencher isso dispara contador regressivo nas
                prospecções.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de prazo</Label>
                <Select
                  value={acaoTipoPrazo || "none"}
                  onValueChange={(v) => setAcaoTipoPrazo(v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nenhum —</SelectItem>
                    {TIPOS_PRAZO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
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
            <Button variant="outline" onClick={() => setAcaoDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveAcao()}>
              {editingAcao ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
