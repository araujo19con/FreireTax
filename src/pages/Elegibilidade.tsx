import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FileCheck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
}

interface Acao {
  id: string;
  nome: string;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
  valor_potencial_estimado: number | null;
  observacao_valor: string | null;
  empresa_nome?: string;
  acao_nome?: string;
}

const statusColors: Record<string, string> = {
  "Elegível": "bg-success/10 text-success",
  "Não elegível": "bg-destructive/10 text-destructive",
};

function formatCompactCurrency(value: number) {
  if (!value) return "—";
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export default function Elegibilidade() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ElegibilidadeRow | null>(null);
  const [formEmpresa, setFormEmpresa] = useState("");
  const [formAcao, setFormAcao] = useState("");
  const [formElegivel, setFormElegivel] = useState("true");
  const [formJustificativa, setFormJustificativa] = useState("");
  const [formValorPotencial, setFormValorPotencial] = useState("");
  const [formObservacaoValor, setFormObservacaoValor] = useState("");

  const fetchAll = async () => {
    const [elegRes, empRes, acaoRes] = await Promise.all([
      supabase.from("elegibilidade").select("*"),
      supabase.from("empresas").select("id, nome, cnpj"),
      supabase.from("acoes_tributarias").select("id, nome"),
    ]);

    const emps = empRes.data || [];
    const acs = acaoRes.data || [];
    setEmpresas(emps);
    setAcoes(acs);

    const empMap = Object.fromEntries(emps.map((e) => [e.id, e.nome]));
    const acaoMap = Object.fromEntries(acs.map((a) => [a.id, a.nome]));

    // QW2: ordena por valor_potencial DESC — empresas grandes no topo
    const rows = (elegRes.data || []).map((e) => ({
      ...e,
      empresa_nome: empMap[e.empresa_id] || "Desconhecida",
      acao_nome: acaoMap[e.acao_id] || "Desconhecida",
    }));
    rows.sort((a, b) => {
      const va = Number(a.valor_potencial_estimado ?? 0);
      const vb = Number(b.valor_potencial_estimado ?? 0);
      if (vb !== va) return vb - va;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    setElegibilidades(rows);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormEmpresa("");
    setFormAcao("");
    setFormElegivel("true");
    setFormJustificativa("");
    setFormValorPotencial("");
    setFormObservacaoValor("");
    setDialogOpen(true);
  };

  const openEdit = (row: ElegibilidadeRow) => {
    setEditing(row);
    setFormEmpresa(row.empresa_id);
    setFormAcao(row.acao_id);
    setFormElegivel(row.elegivel ? "true" : "false");
    setFormJustificativa(row.justificativa || "");
    setFormValorPotencial(row.valor_potencial_estimado ? String(row.valor_potencial_estimado) : "");
    setFormObservacaoValor(row.observacao_valor || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formEmpresa || !formAcao) {
      toast.error("Selecione empresa e ação");
      return;
    }

    const valorNum = parseFloat(formValorPotencial.replace(",", ".")) || 0;

    if (editing) {
      const { error } = await supabase.from("elegibilidade").update({
        empresa_id: formEmpresa,
        acao_id: formAcao,
        elegivel: formElegivel === "true",
        justificativa: formJustificativa || "",
        valor_potencial_estimado: valorNum,
        observacao_valor: formObservacaoValor || null,
      }).eq("id", editing.id);
      if (error) {
        toast.error("Erro ao atualizar");
        console.error(error);
      } else {
        toast.success("Elegibilidade atualizada!");
        const emp = empresas.find((e) => e.id === formEmpresa);
        const acao = acoes.find((a) => a.id === formAcao);
        logAudit({ tabela: "elegibilidade", acao: "Editou elegibilidade", registro_id: editing.id, detalhes: { empresa: emp?.nome, acao_nome: acao?.nome, elegivel: formElegivel === "true" } });
      }
    } else {
      const { error } = await supabase.from("elegibilidade").insert({
        empresa_id: formEmpresa,
        acao_id: formAcao,
        elegivel: formElegivel === "true",
        justificativa: formJustificativa || "",
        valor_potencial_estimado: valorNum,
        observacao_valor: formObservacaoValor || null,
        user_id: user!.id,
      });
      if (error) {
        toast.error("Erro ao criar elegibilidade");
        console.error(error);
      } else {
        toast.success("Elegibilidade registrada!");
        const emp = empresas.find((e) => e.id === formEmpresa);
        const acao = acoes.find((a) => a.id === formAcao);
        logAudit({ tabela: "elegibilidade", acao: "Criou elegibilidade", detalhes: { empresa: emp?.nome, acao_nome: acao?.nome, elegivel: formElegivel === "true" } });
      }
    }
    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("elegibilidade").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
    } else {
      toast.success("Removido!");
      fetchAll();
    }
  };

  const filtered = elegibilidades.filter(
    (e) =>
      (e.empresa_nome || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.acao_nome || "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <LoadingState variant="page" />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Elegibilidade"
        description="Controle de elegibilidade por empresa e ação — ordenado por valor potencial"
        icon={<FileCheck className="h-7 w-7" />}
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Nova Elegibilidade
          </Button>
        }
      />

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {elegibilidades.length === 0 ? (
        <EmptyState
          icon={FileCheck}
          title="Nenhuma elegibilidade registrada"
          description="Vincule empresas às ações tributárias. Valor potencial ajuda a priorizar os leads de maior impacto."
          action={{ label: "Nova Elegibilidade", onClick: openCreate, icon: Plus }}
        />
      ) : (
      <Card className="shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Empresa</th>
                <th className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Ação</th>
                <th className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="text-right py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Valor Potencial</th>
                <th className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Justificativa</th>
                <th className="text-left py-3 px-4 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Search className="h-6 w-6 opacity-50" aria-hidden="true" />
                    <p className="text-sm">Nenhum resultado. Tente outra busca.</p>
                  </div>
                </td></tr>
              )}
              {filtered.map((d, idx) => {
                const statusLabel = d.elegivel ? "Elegível" : "Não elegível";
                const valorPot = Number(d.valor_potencial_estimado ?? 0);
                return (
                  <tr key={d.id} className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${idx % 2 === 1 ? "bg-muted/[0.15]" : ""}`}>
                    <td className="py-3 px-4 font-medium">{d.empresa_nome}</td>
                    <td className="py-3 px-4 text-muted-foreground">{d.acao_nome}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className={`${statusColors[statusLabel] || ""} border-0`}>{statusLabel}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      {valorPot > 0 ? (
                        <span className="font-semibold text-primary">{formatCompactCurrency(valorPot)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground max-w-[200px] truncate">{d.justificativa || "—"}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(d)} aria-label={`Editar elegibilidade de ${d.empresa_nome}`}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Excluir elegibilidade de ${d.empresa_nome}`}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                              <AlertDialogDescription>Remover esta elegibilidade?</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(d.id)}>Excluir</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? "Editar Elegibilidade" : "Nova Elegibilidade"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={formEmpresa} onValueChange={setFormEmpresa}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome} — {e.cnpj}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ação Tributária</Label>
              <Select value={formAcao} onValueChange={setFormAcao}>
                <SelectTrigger><SelectValue placeholder="Selecione a ação..." /></SelectTrigger>
                <SelectContent>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Elegível?</Label>
              <Select value={formElegivel} onValueChange={setFormElegivel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim — Elegível</SelectItem>
                  <SelectItem value="false">Não — Não elegível</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Justificativa</Label>
              <Textarea value={formJustificativa} onChange={(e) => setFormJustificativa(e.target.value)} placeholder="Motivo da decisão (opcional)" rows={3} />
            </div>

            {/* QW2 — Valor potencial */}
            {formElegivel === "true" && (
              <div className="space-y-2 p-3 rounded-md border border-primary/30 bg-primary/5">
                <Label className="text-primary">
                  Valor potencial estimado (R$)
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Hormozi: sem priorizar por valor, o time queima tempo em leads pequenos. Empresas grandes valem 50× mais no mesmo esforço.
                </p>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formValorPotencial}
                  onChange={(e) => setFormValorPotencial(e.target.value)}
                  placeholder="Ex: 250000.00"
                />
                {formValorPotencial && Number(formValorPotencial) > 0 && (
                  <p className="text-xs text-primary font-medium">
                    = {formatCompactCurrency(Number(formValorPotencial))}
                  </p>
                )}
                <Label className="text-xs mt-2">Como estimou? (opcional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Ex: baseado em faturamento de R$ 80M × 3% típico da tese × 5 anos = ~R$ 250k honorário"
                  value={formObservacaoValor}
                  onChange={(e) => setFormObservacaoValor(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
