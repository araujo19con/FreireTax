import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, CheckCircle2, MapPin, Users, FileText, Calendar, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Payload que vai pro banco — inclui campos RFB (todos opcionais)
export interface EmpresaFormData {
  nome: string;
  cnpj: string;
  status: string;
  obs: string;
  // campos RFB (preenchidos quando o usuário busca na Receita)
  razao_social?: string | null;
  nome_fantasia?: string | null;
  data_abertura?: string | null;
  situacao_cadastral?: string | null;
  situacao_cadastral_data?: string | null;
  motivo_situacao?: string | null;
  natureza_juridica?: string | null;
  capital_social?: number | null;
  porte?: string | null;
  opcao_simples?: boolean | null;
  data_opcao_simples?: string | null;
  opcao_mei?: boolean | null;
  cnae_principal?: string | null;
  cnae_principal_desc?: string | null;
  cnaes_secundarios?: any[];
  logradouro?: string | null;
  numero_endereco?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  telefone_receita?: string | null;
  email_receita?: string | null;
  qsa?: any[];
  receita_atualizada_em?: string | null;
}

interface EmpresaDialogProps {
  onSave: (data: EmpresaFormData) => void;
  trigger?: React.ReactNode;
  initialData?: Partial<EmpresaFormData>;
  title?: string;
}

function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  return digits.length === 14;
}

function formatBRL(v: number | null | undefined) {
  if (!v || v <= 0) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

export function EmpresaDialog({ onSave, trigger, initialData, title = "Nova Empresa" }: EmpresaDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EmpresaFormData>({
    nome: initialData?.nome || "",
    cnpj: initialData?.cnpj || "",
    status: initialData?.status || "prospect",
    obs: initialData?.obs || "",
    ...initialData,
  });
  const [fetchingRFB, setFetchingRFB] = useState(false);
  const [rfbPreview, setRfbPreview] = useState<any | null>(null);

  const buscarReceita = async () => {
    if (!validateCNPJ(form.cnpj)) {
      toast.error("Preencha um CNPJ válido (14 dígitos) primeiro");
      return;
    }
    setFetchingRFB(true);
    try {
      const { data, error } = await supabase.functions.invoke("enriquecer-cnpj", {
        body: { cnpj: form.cnpj },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.ok || !data?.data) throw new Error("Sem dados retornados");

      const rfb = data.data;
      // mescla no formulário — preenche nome com razão social se estiver vazio
      setForm((curr) => ({
        ...curr,
        nome: curr.nome.trim() || rfb.razao_social || rfb.nome_fantasia || "",
        razao_social: rfb.razao_social,
        nome_fantasia: rfb.nome_fantasia,
        data_abertura: rfb.data_abertura,
        situacao_cadastral: rfb.situacao_cadastral,
        situacao_cadastral_data: rfb.situacao_cadastral_data,
        motivo_situacao: rfb.motivo_situacao,
        natureza_juridica: rfb.natureza_juridica,
        capital_social: rfb.capital_social,
        porte: rfb.porte,
        opcao_simples: rfb.opcao_simples,
        data_opcao_simples: rfb.data_opcao_simples,
        opcao_mei: rfb.opcao_mei,
        cnae_principal: rfb.cnae_principal,
        cnae_principal_desc: rfb.cnae_principal_desc,
        cnaes_secundarios: rfb.cnaes_secundarios,
        logradouro: rfb.logradouro,
        numero_endereco: rfb.numero_endereco,
        complemento: rfb.complemento,
        bairro: rfb.bairro,
        municipio: rfb.municipio,
        uf: rfb.uf,
        cep: rfb.cep,
        telefone_receita: rfb.telefone_receita,
        email_receita: rfb.email_receita,
        qsa: rfb.qsa,
        receita_atualizada_em: rfb.receita_atualizada_em,
      }));
      setRfbPreview(rfb);
      toast.success(
        data.cached
          ? `Dados carregados do cache (consulta < 90 dias)`
          : `Dados da Receita carregados: ${rfb.razao_social}`
      );
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? "falha ao consultar Receita"));
    } finally {
      setFetchingRFB(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error("Nome empresarial é obrigatório"); return; }
    if (!validateCNPJ(form.cnpj)) { toast.error("CNPJ inválido – deve conter 14 dígitos"); return; }
    onSave(form);
    toast.success(`Empresa "${form.nome}" salva com sucesso!`);
    setOpen(false);
    // não reseta o form — fica persistido pra visualização ao reabrir no edit
  };

  const situacaoColor = (s: string | null | undefined) => {
    if (!s) return "";
    if (s === "ATIVA") return "bg-success/10 text-success";
    if (s === "BAIXADA" || s === "INAPTA" || s === "NULA") return "bg-destructive/10 text-destructive";
    return "bg-warning/10 text-warning";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nova Empresa
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* CNPJ + botão busca */}
          <div className="space-y-2">
            <Label htmlFor="cnpj">CNPJ *</Label>
            <div className="flex gap-2">
              <Input
                id="cnpj"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: formatCNPJ(e.target.value) })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={buscarReceita}
                disabled={fetchingRFB || !validateCNPJ(form.cnpj)}
                title="Busca dados oficiais na Receita Federal"
              >
                {fetchingRFB ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando...</>
                ) : (
                  <><Search className="mr-2 h-4 w-4" />Buscar na Receita</>
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Preenche automaticamente razão social, endereço, porte, CNAE, quadro societário.
            </p>
          </div>

          {/* Preview dos dados da Receita (aparece após busca ou edição) */}
          {(rfbPreview || form.receita_atualizada_em) && (
            <div className="p-3 rounded-md border border-success/30 bg-success/5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Dados da Receita Federal
                </p>
                {form.situacao_cadastral && (
                  <Badge className={`text-[10px] ${situacaoColor(form.situacao_cadastral)}`} variant="secondary">
                    {form.situacao_cadastral}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {form.razao_social && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Razão social:</span>
                    <p className="font-medium">{form.razao_social}</p>
                  </div>
                )}
                {form.nome_fantasia && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Nome fantasia:</span>
                    <p>{form.nome_fantasia}</p>
                  </div>
                )}
                {form.porte && (
                  <div>
                    <span className="text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />Porte:</span>
                    <p className="font-medium">{form.porte}</p>
                  </div>
                )}
                {form.capital_social != null && (
                  <div>
                    <span className="text-muted-foreground">Capital social:</span>
                    <p className="font-medium tabular-nums">{formatBRL(form.capital_social)}</p>
                  </div>
                )}
                {form.data_abertura && (
                  <div>
                    <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Abertura:</span>
                    <p>{new Date(form.data_abertura + "T00:00:00").toLocaleDateString("pt-BR")}</p>
                  </div>
                )}
                {(form.opcao_simples || form.opcao_mei) && (
                  <div>
                    <span className="text-muted-foreground">Regime:</span>
                    <p className="font-medium">
                      {form.opcao_mei ? "MEI" : form.opcao_simples ? "Simples Nacional" : "Lucro presumido/real"}
                    </p>
                  </div>
                )}
                {form.cnae_principal_desc && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />CNAE principal:</span>
                    <p className="line-clamp-2">{form.cnae_principal} — {form.cnae_principal_desc}</p>
                  </div>
                )}
                {(form.logradouro || form.municipio) && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />Endereço:</span>
                    <p className="line-clamp-2">
                      {[form.logradouro, form.numero_endereco, form.complemento, form.bairro].filter(Boolean).join(", ")}
                      {form.municipio && ` — ${form.municipio}/${form.uf}`}
                      {form.cep && ` — CEP ${form.cep}`}
                    </p>
                  </div>
                )}
                {form.qsa && form.qsa.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Quadro societário ({form.qsa.length}):</span>
                    <div className="mt-1 space-y-0.5">
                      {form.qsa.slice(0, 3).map((s: any, i: number) => (
                        <p key={i} className="text-[10px]">
                          <span className="font-medium">{s.nome}</span>
                          {s.qualificacao && <span className="text-muted-foreground"> — {s.qualificacao}</span>}
                        </p>
                      ))}
                      {form.qsa.length > 3 && (
                        <p className="text-[10px] text-muted-foreground">+ {form.qsa.length - 3} outros</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Nome (editável — default = razão social) */}
          <div className="space-y-2">
            <Label htmlFor="nome">Nome Empresarial *</Label>
            <Input
              id="nome"
              placeholder="Ex: Tech Solutions Ltda (pode sobrescrever o da Receita)"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status no CRM</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prospect">Prospect</SelectItem>
                <SelectItem value="cliente">Cliente</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="obs">Observações internas</Label>
            <Textarea
              id="obs"
              placeholder="Observações opcionais (não vêm da Receita)..."
              value={form.obs}
              onChange={(e) => setForm({ ...form, obs: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
