import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, endOfMonth, isPast, isToday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  Download,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import * as XLSX from "xlsx";
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
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

type HonorarioTipo = "retainer" | "exito" | "avulso";
type HonorarioStatus = "pendente" | "pago" | "atrasado" | "cancelado";

interface Lancamento {
  id: string;
  prospeccao_id: string | null;
  empresa_id: string;
  tipo: HonorarioTipo;
  descricao: string | null;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: HonorarioStatus;
  nota: string | null;
  created_by: string | null;
  created_at: string;
}

interface EmpresaOpt {
  id: string;
  nome: string;
}

const TIPO_LABEL: Record<HonorarioTipo, string> = {
  retainer: "Retainer",
  exito: "Êxito",
  avulso: "Avulso",
};

const STATUS_COLOR: Record<HonorarioStatus, string> = {
  pendente: "bg-warning/10 text-warning border-warning/30",
  pago: "bg-success/10 text-success border-success/30",
  atrasado: "bg-destructive/10 text-destructive border-destructive/30",
  cancelado: "bg-muted text-muted-foreground",
};

function autoStatus(
  lan: Pick<Lancamento, "status" | "data_vencimento" | "data_pagamento">
): HonorarioStatus {
  if (lan.status === "pago" || lan.status === "cancelado") return lan.status;
  if (lan.data_pagamento) return "pago";
  const venc = parseISO(lan.data_vencimento);
  if (isPast(venc) && !isToday(venc)) return "atrasado";
  return "pendente";
}

function useFinanceiroData(mesFiltro: string) {
  const [ano, mes] = mesFiltro.split("-").map(Number);
  const inicio = format(new Date(ano, mes - 1, 1), "yyyy-MM-dd");
  const fim = format(endOfMonth(new Date(ano, mes - 1, 1)), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["financeiro", mesFiltro],
    staleTime: 30_000,
    queryFn: async () => {
      const [lanRes, empRes] = await Promise.all([
        fetchAllRows<Lancamento>(
          (supabase.from("honorarios_lancamentos") as any)
            .select("*")
            .gte("data_vencimento", inicio)
            .lte("data_vencimento", fim)
            .order("data_vencimento")
        ),
        fetchAllRows<EmpresaOpt>(supabase.from("empresas").select("id, nome").order("nome")),
      ]);
      return { lancamentos: lanRes, empresas: empRes };
    },
  });
}

const EMPTY_FORM = {
  empresa_id: "",
  tipo: "avulso" as HonorarioTipo,
  descricao: "",
  valor: "",
  data_vencimento: format(new Date(), "yyyy-MM-dd"),
  data_pagamento: "",
  nota: "",
};

export default function Financeiro() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mesFiltro, setMesFiltro] = useState(() => format(new Date(), "yyyy-MM"));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useFinanceiroData(mesFiltro);
  const lancamentos = useMemo(() => data?.lancamentos ?? [], [data]);
  const empresas = useMemo(() => data?.empresas ?? [], [data]);

  const empresaMap = useMemo(() => {
    const m = new Map<string, string>();
    empresas.forEach((e) => m.set(e.id, e.nome));
    return m;
  }, [empresas]);

  // Corrige status dinamicamente (atrasado quando passou da data)
  const enriched = useMemo(
    () => lancamentos.map((l) => ({ ...l, statusEfetivo: autoStatus(l) })),
    [lancamentos]
  );

  // KPIs do mês
  const aReceber = enriched
    .filter((l) => ["pendente", "atrasado"].includes(l.statusEfetivo))
    .reduce((s, l) => s + l.valor, 0);
  const recebido = enriched
    .filter((l) => l.statusEfetivo === "pago")
    .reduce((s, l) => s + l.valor, 0);
  const atrasado = enriched
    .filter((l) => l.statusEfetivo === "atrasado")
    .reduce((s, l) => s + l.valor, 0);
  const cancelado = enriched
    .filter((l) => l.statusEfetivo === "cancelado")
    .reduce((s, l) => s + l.valor, 0);

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(l: Lancamento) {
    setEditId(l.id);
    setForm({
      empresa_id: l.empresa_id,
      tipo: l.tipo,
      descricao: l.descricao ?? "",
      valor: String(l.valor),
      data_vencimento: l.data_vencimento,
      data_pagamento: l.data_pagamento ?? "",
      nota: l.nota ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.empresa_id) {
      toast.error("Selecione a empresa");
      return;
    }
    const valorNum = parseFloat(form.valor.replace(",", "."));
    if (!valorNum || valorNum <= 0) {
      toast.error("Valor inválido");
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
        tipo: form.tipo,
        descricao: form.descricao || null,
        valor: valorNum,
        data_vencimento: form.data_vencimento,
        data_pagamento: form.data_pagamento || null,
        nota: form.nota || null,
        created_by: user?.id ?? null,
      };

      const tb = supabase.from("honorarios_lancamentos") as any;
      const { error } = editId
        ? await tb.update(payload).eq("id", editId)
        : await tb.insert(payload);

      if (error) throw error;
      toast.success(editId ? "Lançamento atualizado" : "Lançamento criado");
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ["financeiro"] });
    } catch (e) {
      toast.error("Erro ao salvar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este lançamento?")) return;
    const { error } = await (supabase.from("honorarios_lancamentos") as any).delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
      return;
    }
    toast.success("Lançamento removido");
    void qc.invalidateQueries({ queryKey: ["financeiro"] });
  }

  async function marcarPago(l: Lancamento) {
    const { error } = await (supabase.from("honorarios_lancamentos") as any)
      .update({ status: "pago", data_pagamento: format(new Date(), "yyyy-MM-dd") })
      .eq("id", l.id);
    if (error) {
      toast.error("Erro ao marcar como pago");
      return;
    }
    toast.success("Lançamento marcado como pago");
    void qc.invalidateQueries({ queryKey: ["financeiro"] });
  }

  function exportXLSX() {
    const rows = enriched.map((l) => ({
      Empresa: empresaMap.get(l.empresa_id) ?? "—",
      Tipo: TIPO_LABEL[l.tipo],
      Descrição: l.descricao ?? "",
      "Valor (R$)": l.valor,
      Vencimento: l.data_vencimento,
      Pagamento: l.data_pagamento ?? "",
      Status: l.statusEfetivo,
      Nota: l.nota ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Honorários");
    XLSX.writeFile(wb, `honorarios-${mesFiltro}.xlsx`);
  }

  const mesLabel = format(
    new Date(parseInt(mesFiltro.split("-")[0]), parseInt(mesFiltro.split("-")[1]) - 1, 1),
    "MMMM 'de' yyyy",
    { locale: ptBR }
  );

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Financeiro"
        description={`Honorários — ${mesLabel}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportXLSX} disabled={!enriched.length}>
              <Download className="mr-1.5 h-4 w-4" />
              Exportar
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              Novo lançamento
            </Button>
          </div>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Filtro de mês — dois selects para compatibilidade cross-browser */}
        <div className="flex items-center gap-2">
          <Label className="text-sm">Mês de referência</Label>
          <Select
            value={mesFiltro.split("-")[1]}
            onValueChange={(m) => setMesFiltro(`${mesFiltro.split("-")[0]}-${m}`)}
          >
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => (
                <SelectItem key={m} value={m}>
                  {format(new Date(2000, parseInt(m) - 1, 1), "MMMM", { locale: ptBR })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={mesFiltro.split("-")[0]}
            onValueChange={(y) => setMesFiltro(`${y}-${mesFiltro.split("-")[1]}`)}
          >
            <SelectTrigger className="h-9 w-[90px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map(
                (y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>

        {/* KPIs */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              icon={<Clock className="h-5 w-5 text-warning" />}
              label="A receber"
              value={formatCurrency(aReceber)}
              sub="pendente + atrasado"
            />
            <KpiCard
              icon={<CheckCircle2 className="h-5 w-5 text-success" />}
              label="Recebido"
              value={formatCurrency(recebido)}
              sub="no mês"
            />
            <KpiCard
              icon={<AlertCircle className="h-5 w-5 text-destructive" />}
              label="Atrasado"
              value={formatCurrency(atrasado)}
              sub="vencimento ultrapassado"
            />
            <KpiCard
              icon={<DollarSign className="h-5 w-5 text-muted-foreground" />}
              label="Cancelado"
              value={formatCurrency(cancelado)}
              sub="no mês"
            />
          </div>
        )}

        {/* Tabela de lançamentos */}
        <Card className="p-4">
          <h2 className="mb-4 text-sm font-semibold">
            Lançamentos do mês
            {enriched.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {enriched.length}
              </Badge>
            )}
          </h2>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : enriched.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum lançamento no mês. Clique em "Novo lançamento" para adicionar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Empresa</th>
                    <th className="pb-2 pr-4 font-medium">Tipo</th>
                    <th className="pb-2 pr-4 font-medium">Descrição</th>
                    <th className="pb-2 pr-4 font-medium">Valor</th>
                    <th className="pb-2 pr-4 font-medium">Vencimento</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4 font-medium">
                        {empresaMap.get(l.empresa_id) ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{TIPO_LABEL[l.tipo]}</td>
                      <td className="max-w-[200px] truncate py-2 pr-4 text-muted-foreground">
                        {l.descricao ?? "—"}
                      </td>
                      <td className="py-2 pr-4 font-medium tabular-nums">
                        {formatCurrency(l.valor)}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{l.data_vencimento}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_COLOR[l.statusEfetivo]}`}
                        >
                          {l.statusEfetivo}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          {l.statusEfetivo !== "pago" && l.statusEfetivo !== "cancelado" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-success hover:bg-success/10"
                              onClick={() => {
                                void marcarPago(l);
                              }}
                              title="Marcar como pago"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => openEdit(l)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              void handleDelete(l.id);
                            }}
                            title="Remover"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
            <DialogTitle>{editId ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tipo *</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as HonorarioTipo }))}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retainer">Retainer</SelectItem>
                    <SelectItem value="exito">Êxito</SelectItem>
                    <SelectItem value="avulso">Avulso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-valor" className="text-xs">
                  Valor (R$) *
                </Label>
                <Input
                  id="fin-valor"
                  value={form.valor}
                  onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                  placeholder="0,00"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="fin-desc" className="text-xs">
                Descrição
              </Label>
              <Input
                id="fin-desc"
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: Retainer — jun/2026"
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fin-venc" className="text-xs">
                  Vencimento *
                </Label>
                <input
                  id="fin-venc"
                  type="date"
                  value={form.data_vencimento}
                  onChange={(e) => setForm((f) => ({ ...f, data_vencimento: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  title="Data de vencimento"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-pgto" className="text-xs">
                  Data pagamento
                </Label>
                <input
                  id="fin-pgto"
                  type="date"
                  value={form.data_pagamento}
                  onChange={(e) => setForm((f) => ({ ...f, data_pagamento: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  title="Data de pagamento"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="fin-nota" className="text-xs">
                Nota interna
              </Label>
              <Textarea
                id="fin-nota"
                value={form.nota}
                onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
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

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums leading-tight">{value}</p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-muted/50 p-2">{icon}</div>
      </div>
    </Card>
  );
}
