import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, differenceInDays } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

type PrazoStatus = "pendente" | "cumprido" | "perdido";

interface Prazo {
  id: string;
  prospeccao_id: string | null;
  empresa_id: string;
  acao_id: string | null;
  tipo: string;
  descricao: string | null;
  data_vencimento: string;
  alerta_antecedencia_dias: number;
  status: PrazoStatus;
  alerta_enviado_em: string | null;
  responsavel_id: string | null;
  observacao: string | null;
  criado_por: string | null;
  created_at: string;
}

interface EmpresaOpt {
  id: string;
  nome: string;
}
interface AcaoOpt {
  id: string;
  nome: string;
}
interface ProfileOpt {
  id: string;
  nome: string;
}

const TIPOS_PRAZO = [
  "Contestação",
  "Recurso",
  "Manifestação",
  "Audiência",
  "Petição",
  "Embargos",
  "Agravo",
  "Apelação",
  "Outro",
];

const STATUS_COLOR: Record<PrazoStatus, string> = {
  pendente: "bg-warning/10 text-warning border-warning/30",
  cumprido: "bg-success/10 text-success border-success/30",
  perdido: "bg-destructive/10 text-destructive border-destructive/30",
};

function urgenciaInfo(dataVenc: string): { label: string; color: string } | null {
  const dias = differenceInDays(parseISO(dataVenc), new Date());
  if (dias < 0) return { label: `Venceu há ${Math.abs(dias)}d`, color: "text-destructive" };
  if (dias === 0) return { label: "Vence hoje!", color: "text-destructive font-bold" };
  if (dias <= 3) return { label: `${dias}d p/ vencer`, color: "text-destructive" };
  if (dias <= 7) return { label: `${dias}d p/ vencer`, color: "text-warning" };
  if (dias <= 14) return { label: `${dias}d p/ vencer`, color: "text-info" };
  return null;
}

function usePrazosData() {
  return useQuery({
    queryKey: ["prazos"],
    staleTime: 30_000,
    queryFn: async () => {
      const [prazosRes, empRes, acaoRes, profRes] = await Promise.all([
        fetchAllRows<Prazo>(
          (supabase.from("prazos_processuais") as any).select("*").order("data_vencimento")
        ),
        fetchAllRows<EmpresaOpt>(supabase.from("empresas").select("id, nome").order("nome")),
        fetchAllRows<AcaoOpt>(
          supabase.from("acoes_tributarias").select("id, nome").eq("ativo", true)
        ),
        fetchAllRows<ProfileOpt>(supabase.from("profiles").select("id, nome").eq("ativo", true)),
      ]);
      return { prazos: prazosRes, empresas: empRes, acoes: acaoRes, profiles: profRes };
    },
  });
}

const EMPTY_FORM = {
  empresa_id: "",
  acao_id: "",
  tipo: "",
  descricao: "",
  data_vencimento: format(new Date(), "yyyy-MM-dd"),
  alerta_antecedencia_dias: "3",
  responsavel_id: "",
  observacao: "",
};

export default function Prazos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filtroStatus, setFiltroStatus] = useState<"todos" | PrazoStatus>("pendente");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = usePrazosData();
  const prazos = useMemo(() => data?.prazos ?? [], [data]);
  const empresas = useMemo(() => data?.empresas ?? [], [data]);
  const acoes = useMemo(() => data?.acoes ?? [], [data]);
  const profiles = useMemo(() => data?.profiles ?? [], [data]);

  const empresaMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const acaoMap = useMemo(() => new Map(acoes.map((a) => [a.id, a.nome])), [acoes]);
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p.nome])), [profiles]);

  const filtrados = useMemo(
    () => (filtroStatus === "todos" ? prazos : prazos.filter((p) => p.status === filtroStatus)),
    [prazos, filtroStatus]
  );

  // Contadores de badge
  const pendentes = prazos.filter((p) => p.status === "pendente").length;
  const urgentes = prazos.filter((p) => {
    if (p.status !== "pendente") return false;
    const dias = differenceInDays(parseISO(p.data_vencimento), new Date());
    return dias <= 3;
  }).length;

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(p: Prazo) {
    setEditId(p.id);
    setForm({
      empresa_id: p.empresa_id,
      acao_id: p.acao_id ?? "",
      tipo: p.tipo,
      descricao: p.descricao ?? "",
      data_vencimento: p.data_vencimento,
      alerta_antecedencia_dias: String(p.alerta_antecedencia_dias),
      responsavel_id: p.responsavel_id ?? "",
      observacao: p.observacao ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.empresa_id) {
      toast.error("Selecione a empresa");
      return;
    }
    if (!form.tipo.trim()) {
      toast.error("Tipo de prazo obrigatório");
      return;
    }
    if (!form.data_vencimento) {
      toast.error("Data de vencimento obrigatória");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        empresa_id: form.empresa_id,
        acao_id: form.acao_id || null,
        tipo: form.tipo.trim().toLowerCase(),
        descricao: form.descricao || null,
        data_vencimento: form.data_vencimento,
        alerta_antecedencia_dias: parseInt(form.alerta_antecedencia_dias) || 3,
        responsavel_id: form.responsavel_id || null,
        observacao: form.observacao || null,
        criado_por: user?.id ?? null,
      };

      const tb = supabase.from("prazos_processuais") as any;
      const { error } = editId
        ? await tb.update(payload).eq("id", editId)
        : await tb.insert(payload);

      if (error) throw error;
      toast.success(editId ? "Prazo atualizado" : "Prazo criado");
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ["prazos"] });
    } catch (e) {
      toast.error("Erro ao salvar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function marcarCumprido(id: string) {
    const { error } = await (supabase.from("prazos_processuais") as any)
      .update({ status: "cumprido" })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar");
      return;
    }
    toast.success("Prazo marcado como cumprido");
    void qc.invalidateQueries({ queryKey: ["prazos"] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este prazo?")) return;
    const { error } = await (supabase.from("prazos_processuais") as any).delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Prazo removido");
    void qc.invalidateQueries({ queryKey: ["prazos"] });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Prazos Processuais"
        description="Controle de prazos com alertas automáticos por email"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Novo prazo
          </Button>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* KPI chips */}
        <div className="flex flex-wrap gap-3">
          <Card className="flex items-center gap-2 px-4 py-2.5">
            <Clock className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium">{pendentes} pendentes</span>
          </Card>
          {urgentes > 0 && (
            <Card className="flex items-center gap-2 border-destructive/40 px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">
                {urgentes} urgente{urgentes > 1 ? "s" : ""} (≤3 dias)
              </span>
            </Card>
          )}
        </div>

        {/* Filtro de status */}
        <div className="flex gap-2">
          {(["pendente", "cumprido", "perdido", "todos"] as const).map((s) => (
            <Button
              key={s}
              variant={filtroStatus === s ? "default" : "outline"}
              size="sm"
              className="capitalize"
              onClick={() => setFiltroStatus(s)}
            >
              {s}
              {s === "pendente" && pendentes > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">
                  {pendentes}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {/* Tabela */}
        <Card className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {filtroStatus === "pendente"
                ? 'Nenhum prazo pendente. Clique em "Novo prazo" para adicionar.'
                : "Nenhum prazo encontrado para o filtro selecionado."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Empresa</th>
                    <th className="pb-2 pr-4 font-medium">Tipo</th>
                    <th className="pb-2 pr-4 font-medium">Ação</th>
                    <th className="pb-2 pr-4 font-medium">Vencimento</th>
                    <th className="pb-2 pr-4 font-medium">Responsável</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => {
                    const urg = p.status === "pendente" ? urgenciaInfo(p.data_vencimento) : null;
                    return (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">
                          {empresaMap.get(p.empresa_id) ?? "—"}
                        </td>
                        <td className="py-2 pr-4 capitalize text-muted-foreground">{p.tipo}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {p.acao_id ? (acaoMap.get(p.acao_id) ?? "—") : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <div>
                            <span className="tabular-nums">{formatDate(p.data_vencimento)}</span>
                            {urg && <div className={`text-[11px] ${urg.color}`}>{urg.label}</div>}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {p.responsavel_id ? (profileMap.get(p.responsavel_id) ?? "—") : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${STATUS_COLOR[p.status]}`}
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            {p.status === "pendente" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-success hover:bg-success/10"
                                onClick={() => {
                                  void marcarCumprido(p.id);
                                }}
                                title="Marcar como cumprido"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => openEdit(p)}
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                void handleDelete(p.id);
                              }}
                              title="Remover"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Dialog criação/edição */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar prazo" : "Novo prazo processual"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Empresa *</Label>
              <Select
                value={form.empresa_id}
                onValueChange={(v) => setForm((f) => ({ ...f, empresa_id: v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ação tributária</Label>
              <Select
                value={form.acao_id}
                onValueChange={(v) => setForm((f) => ({ ...f, acao_id: v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhuma</SelectItem>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tipo de prazo *</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_PRAZO.map((t) => (
                      <SelectItem key={t} value={t.toLowerCase()}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pz-alert" className="text-xs">
                  Alerta (dias antes)
                </Label>
                <Input
                  id="pz-alert"
                  type="number"
                  min="0"
                  max="30"
                  value={form.alerta_antecedencia_dias}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, alerta_antecedencia_dias: e.target.value }))
                  }
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pz-desc" className="text-xs">
                Descrição
              </Label>
              <Input
                id="pz-desc"
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: Contestação ao auto de infração nº..."
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pz-venc" className="text-xs">
                  Vencimento *
                </Label>
                <input
                  id="pz-venc"
                  type="date"
                  value={form.data_vencimento}
                  onChange={(e) => setForm((f) => ({ ...f, data_vencimento: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  title="Data de vencimento"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Responsável</Label>
                <Select
                  value={form.responsavel_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, responsavel_id: v }))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nenhum</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pz-obs" className="text-xs">
                Observação
              </Label>
              <Textarea
                id="pz-obs"
                value={form.observacao}
                onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))}
                rows={2}
                className="text-sm"
                placeholder="Observações internas..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
            >
              {saving ? "Salvando..." : editId ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
