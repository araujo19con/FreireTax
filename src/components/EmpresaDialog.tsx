import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  CheckCircle2,
  MapPin,
  Users,
  FileText,
  Calendar,
  Building2,
  Loader2,
  Trash2,
  X,
  ScanSearch,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { validateCNPJ as validateCNPJReal, validateCNPJMessage, maskCNPJ } from "@/lib/cnpj";
import { FieldHelp } from "@/components/FieldHelp";
import { BuscarCNPJDialog } from "@/components/BuscarCNPJDialog";
import type { CandidatoCNPJ } from "@/hooks/useBuscarCNPJ";

// Payload que vai pro banco — inclui campos RFB (todos opcionais)
export interface EmpresaFormData {
  /** ID da empresa quando em modo edição (não enviado no insert) */
  id?: string;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  /** true quando email_receita foi setado manualmente — protege da sobrescrita pela RFB */
  email_manual?: boolean | null;
  /** true quando telefone_receita foi setado manualmente — protege da sobrescrita pela RFB */
  telefone_manual?: boolean | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qsa?: any[];
  receita_atualizada_em?: string | null;
  // Campos manuais (importáveis via planilha)
  quantidade_funcionarios?: number | null;
  faturamento_anual?: number | null;
  /** Campos personalizados livres ({ rótulo: valor }) */
  metadados?: Record<string, string> | null;
  /** Regime tributário (simples/mei/lucro_presumido/lucro_real/imune_isento) */
  regime_tributario?: string | null;
}

interface EmpresaDialogProps {
  onSave: (data: EmpresaFormData) => void;
  trigger?: React.ReactNode;
  initialData?: Partial<EmpresaFormData>;
  title?: string;
  /** Modo controlado — quando `open` é fornecido, o componente delega abertura ao pai. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// formatCNPJ e validateCNPJ agora vêm de @/lib/cnpj (módulo 11 real)
const formatCNPJ = maskCNPJ;
const validateCNPJ = validateCNPJReal;

function formatBRL(v: number | null | undefined) {
  if (!v || v <= 0) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(v);
}

export function EmpresaDialog({
  onSave,
  trigger,
  initialData,
  title = "Nova Empresa",
  open: openProp,
  onOpenChange,
}: EmpresaDialogProps) {
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenState(v);
    onOpenChange?.(v);
  };
  const [form, setForm] = useState<EmpresaFormData>({
    nome: initialData?.nome || "",
    cnpj: initialData?.cnpj || "",
    status: initialData?.status || "prospect",
    obs: initialData?.obs || "",
    ...initialData,
  });
  const [fetchingRFB, setFetchingRFB] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rfbPreview, setRfbPreview] = useState<any | null>(null);
  const [buscarNomeOpen, setBuscarNomeOpen] = useState(false);

  /** Quando user escolhe candidato do BuscarCNPJDialog: preenche CNPJ e
   *  dispara enriquecimento RFB automaticamente. */
  const onSelectCandidatoNome = async (c: CandidatoCNPJ) => {
    const cnpjFormatado = formatCNPJ(c.cnpj);
    // Aplica imediatamente o CNPJ e dados básicos do candidato, depois enriquece
    setForm((curr) => ({
      ...curr,
      cnpj: cnpjFormatado,
      nome: curr.nome.trim() || c.razao_social,
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia ?? curr.nome_fantasia,
      uf: c.uf,
      municipio: c.municipio ?? curr.municipio,
    }));
    toast.success(`CNPJ ${cnpjFormatado} selecionado — consultando Receita...`);
    // Aguarda próximo tick pra setForm refletir antes de chamar buscarReceita
    setTimeout(() => {
      buscarReceitaCom(c.cnpj);
    }, 50);
  };

  /** Versão direta que recebe o CNPJ ao invés de ler do form (evita race com setState) */
  const buscarReceitaCom = async (cnpj: string) => {
    if (!validateCNPJ(cnpj)) {
      toast.error("CNPJ inválido");
      return;
    }
    setFetchingRFB(true);
    try {
      const { data, error } = await supabase.functions.invoke("enriquecer-cnpj", {
        body: { cnpj },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.ok || !data?.data) throw new Error("Sem dados retornados");
      const rfb = data.data;
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
        email_manual: false,
        telefone_manual: false,
        qsa: rfb.qsa,
        receita_atualizada_em: rfb.receita_atualizada_em,
      }));
      setRfbPreview(rfb);
      toast.success(`Dados da Receita carregados: ${rfb.razao_social}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? "falha ao consultar Receita"));
    } finally {
      setFetchingRFB(false);
    }
  };

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
        // Buscar na RFB sobrescreve email/telefone com o valor oficial — desliga
        // a flag manual pra que próximas sincronizações também atualizem.
        email_manual: false,
        telefone_manual: false,
        qsa: rfb.qsa,
        receita_atualizada_em: rfb.receita_atualizada_em,
      }));
      setRfbPreview(rfb);
      toast.success(
        data.cached
          ? `Dados carregados do cache (consulta < 90 dias)`
          : `Dados da Receita carregados: ${rfb.razao_social}`
      );

      // Faixa de Funcionários, Faixa de Faturamento e Regime Tributário não são
      // inferidos automaticamente — devem ser preenchidos manualmente ou via importação.
    } catch (e) {
      toast.error("Erro: " + ((e as Error)?.message ?? "falha ao consultar Receita"));
    } finally {
      setFetchingRFB(false);
    }
  };

  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.nome.trim()) {
      toast.error("Nome empresarial é obrigatório");
      return;
    }
    const cnpjErr = validateCNPJMessage(form.cnpj);
    if (cnpjErr) {
      toast.error(cnpjErr);
      return;
    }

    // Bloqueia duplicidade de CNPJ — proativo (UX) + UNIQUE constraint no DB (defensivo)
    setSubmitting(true);
    try {
      const cnpjLimpo = form.cnpj.trim();
      if (cnpjLimpo) {
        const { data: existing } = await supabase
          .from("empresas")
          .select("id, nome")
          .eq("cnpj", cnpjLimpo)
          .maybeSingle();
        // Existe outra empresa com este CNPJ (que não é a que estamos editando)
        if (existing && existing.id !== initialData?.id) {
          toast.error(`CNPJ já cadastrado: empresa "${existing.nome}" já existe.`);
          setSubmitting(false);
          return;
        }
      }
      onSave(form);
      toast.success(`Empresa "${form.nome}" salva com sucesso!`);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const situacaoColor = (s: string | null | undefined) => {
    if (!s) return "";
    if (s === "ATIVA") return "bg-success/10 text-success";
    if (s === "BAIXADA" || s === "INAPTA" || s === "NULA")
      return "bg-destructive/10 text-destructive";
    return "bg-warning/10 text-warning";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nova Empresa
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 space-y-4">
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
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Consultando...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Buscar na Receita
                  </>
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Preenche automaticamente razão social, endereço, porte, CNAE, quadro societário.
            </p>
            {/* Atalho: não sabe o CNPJ? busca pelo nome na base RFB indexada */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[10px] text-muted-foreground">
                Não tem o CNPJ? Busque pelo nome da empresa na Receita.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setBuscarNomeOpen(true)}
              >
                <ScanSearch className="mr-1 h-3.5 w-3.5" />
                Buscar pelo nome
              </Button>
            </div>
          </div>

          {/* Dialog de busca por nome — aciona enriquecimento ao selecionar */}
          <BuscarCNPJDialog
            open={buscarNomeOpen}
            onOpenChange={setBuscarNomeOpen}
            termoInicial={form.nome || form.razao_social || ""}
            ufInicial={form.uf || ""}
            onSelect={onSelectCandidatoNome}
          />

          {/* Aviso de origem RFB (quando aplicável) */}
          {form.receita_atualizada_em && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Dados RFB carregados — todos os campos são editáveis
              </span>
              {form.situacao_cadastral && (
                <Badge
                  className={`text-[10px] ${situacaoColor(form.situacao_cadastral)}`}
                  variant="secondary"
                >
                  {form.situacao_cadastral}
                </Badge>
              )}
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
            <Label htmlFor="status">
              Status no CRM
              <FieldHelp>
                Prospect = ainda não é cliente. Cliente = contrato assinado em pelo menos uma tese.
                Inativo = relacionamento encerrado. Independe do estado de elegibilidade em cada
                ação.
              </FieldHelp>
            </Label>
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

          {/* Dados operacionais (manuais ou via importação) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="qtd_func">
                Quantidade de funcionários
                <FieldHelp>
                  Campo manual ou preenchido via importação de planilha. Se sua planilha trouxe uma
                  faixa textual ("500 A 999"), ela fica em "Campos personalizados" — deixe este
                  campo em branco.
                </FieldHelp>
              </Label>
              <Input
                id="qtd_func"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Ex: 50"
                value={form.quantidade_funcionarios ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    quantidade_funcionarios:
                      e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fat_anual">Faturamento anual (R$)</Label>
              <Input
                id="fat_anual"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="Ex: 1500000"
                value={form.faturamento_anual ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    faturamento_anual:
                      e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </div>
          </div>

          {/* ============================================================
              IDENTIFICAÇÃO (RFB) — todos editáveis
          ============================================================ */}
          <Section title="Identificação">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="razao_social">Razão social</Label>
                <Input
                  id="razao_social"
                  value={form.razao_social ?? ""}
                  onChange={(e) => setForm({ ...form, razao_social: e.target.value || null })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="nome_fantasia">Nome fantasia</Label>
                <Input
                  id="nome_fantasia"
                  value={form.nome_fantasia ?? ""}
                  onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="natureza">Natureza jurídica</Label>
                <Input
                  id="natureza"
                  value={form.natureza_juridica ?? ""}
                  onChange={(e) => setForm({ ...form, natureza_juridica: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="data_abertura">Data de abertura</Label>
                <Input
                  id="data_abertura"
                  type="date"
                  value={form.data_abertura ?? ""}
                  onChange={(e) => setForm({ ...form, data_abertura: e.target.value || null })}
                />
              </div>
            </div>
          </Section>

          {/* ============================================================
              FISCAL / RFB — todos editáveis
          ============================================================ */}
          <Section title="Situação fiscal">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Situação cadastral</Label>
                <Select
                  value={form.situacao_cadastral ?? "_none"}
                  onValueChange={(v) =>
                    setForm({ ...form, situacao_cadastral: v === "_none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— não informado —</SelectItem>
                    <SelectItem value="ATIVA">ATIVA</SelectItem>
                    <SelectItem value="SUSPENSA">SUSPENSA</SelectItem>
                    <SelectItem value="INAPTA">INAPTA</SelectItem>
                    <SelectItem value="BAIXADA">BAIXADA</SelectItem>
                    <SelectItem value="NULA">NULA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Porte</Label>
                <Select
                  value={form.porte ?? "_none"}
                  onValueChange={(v) => setForm({ ...form, porte: v === "_none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— não informado —</SelectItem>
                    <SelectItem value="MEI">MEI</SelectItem>
                    <SelectItem value="ME">ME</SelectItem>
                    <SelectItem value="EPP">EPP</SelectItem>
                    <SelectItem value="DEMAIS">DEMAIS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Data da situação</Label>
                <Input
                  type="date"
                  value={form.situacao_cadastral_data ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, situacao_cadastral_data: e.target.value || null })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Motivo da situação</Label>
                <Input
                  value={form.motivo_situacao ?? ""}
                  onChange={(e) => setForm({ ...form, motivo_situacao: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Capital social (R$)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.capital_social ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      capital_social: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Regime tributário
                  <FieldHelp>
                    Preenchimento manual — o sistema não infere. Simples e MEI vêm da opção na
                    Receita, mas Lucro Presumido vs Real precisa ser informado. Se não souber, deixe
                    "não informado".
                  </FieldHelp>
                </Label>
                <Select
                  value={form.regime_tributario ?? "_none"}
                  onValueChange={(v) => {
                    const reg = v === "_none" ? null : v;
                    // Atualiza derivados RFB pra manter consistência (filtros antigos)
                    const opcao_simples =
                      reg === "simples" || reg === "mei"
                        ? true
                        : reg === "lucro_presumido" ||
                            reg === "lucro_real" ||
                            reg === "imune_isento"
                          ? false
                          : (form.opcao_simples ?? null);
                    const opcao_mei =
                      reg === "mei"
                        ? true
                        : reg && reg !== "mei"
                          ? false
                          : (form.opcao_mei ?? null);
                    setForm({ ...form, regime_tributario: reg, opcao_simples, opcao_mei });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— não informado —</SelectItem>
                    <SelectItem value="simples">Simples Nacional</SelectItem>
                    <SelectItem value="mei">MEI</SelectItem>
                    <SelectItem value="lucro_presumido">Lucro Presumido</SelectItem>
                    <SelectItem value="lucro_real">Lucro Real</SelectItem>
                    <SelectItem value="imune_isento">Imune / Isento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CNAE principal (código)</Label>
                <Input
                  placeholder="Ex: 6920-6/01"
                  value={form.cnae_principal ?? ""}
                  onChange={(e) => setForm({ ...form, cnae_principal: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição CNAE</Label>
                <Input
                  value={form.cnae_principal_desc ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, cnae_principal_desc: e.target.value || null })
                  }
                />
              </div>
            </div>
          </Section>

          {/* ============================================================
              ENDEREÇO
          ============================================================ */}
          <Section title="Endereço">
            <div className="grid grid-cols-6 gap-3">
              <div className="col-span-4 space-y-1.5">
                <Label>Logradouro</Label>
                <Input
                  value={form.logradouro ?? ""}
                  onChange={(e) => setForm({ ...form, logradouro: e.target.value || null })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Número</Label>
                <Input
                  value={form.numero_endereco ?? ""}
                  onChange={(e) => setForm({ ...form, numero_endereco: e.target.value || null })}
                />
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Complemento</Label>
                <Input
                  value={form.complemento ?? ""}
                  onChange={(e) => setForm({ ...form, complemento: e.target.value || null })}
                />
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Bairro</Label>
                <Input
                  value={form.bairro ?? ""}
                  onChange={(e) => setForm({ ...form, bairro: e.target.value || null })}
                />
              </div>
              <div className="col-span-3 space-y-1.5">
                <Label>Município</Label>
                <Input
                  value={form.municipio ?? ""}
                  onChange={(e) => setForm({ ...form, municipio: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>UF</Label>
                <Input
                  maxLength={2}
                  className="uppercase"
                  value={form.uf ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, uf: e.target.value.toUpperCase().slice(0, 2) || null })
                  }
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>CEP</Label>
                <Input
                  value={form.cep ?? ""}
                  onChange={(e) => setForm({ ...form, cep: e.target.value || null })}
                />
              </div>
            </div>
          </Section>

          {/* ============================================================
              CONTATO
          ============================================================ */}
          <Section title="Contato">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Telefone
                  {form.telefone_manual && (
                    <Badge
                      variant="secondary"
                      className="h-4 border-0 bg-primary/10 px-1.5 text-[9px] text-primary"
                    >
                      manual
                    </Badge>
                  )}
                </Label>
                <Input
                  value={form.telefone_receita ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    // Sincroniza flag: valor preenchido = manual (RFB não sobrescreve);
                    // valor vazio = libera RFB pra preencher na próxima sincronização.
                    setForm({ ...form, telefone_receita: v, telefone_manual: !!v });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {form.telefone_manual
                    ? "Valor manual — não será sobrescrito pela Receita."
                    : "Vazio ou da Receita — pode ser atualizado por sincronização."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  E-mail
                  {form.email_manual && (
                    <Badge
                      variant="secondary"
                      className="h-4 border-0 bg-primary/10 px-1.5 text-[9px] text-primary"
                    >
                      manual
                    </Badge>
                  )}
                </Label>
                <Input
                  type="email"
                  value={form.email_receita ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setForm({ ...form, email_receita: v, email_manual: !!v });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  {form.email_manual
                    ? "Valor manual — não será sobrescrito pela Receita."
                    : "Vazio ou da Receita — pode ser atualizado por sincronização."}
                </p>
              </div>
            </div>
          </Section>

          {/* ============================================================
              CAMPOS PERSONALIZADOS (metadados jsonb)
          ============================================================ */}
          <CamposPersonalizados
            metadados={form.metadados ?? {}}
            onChange={(m) => setForm({ ...form, metadados: m })}
          />

          {/* ============================================================
              OBSERVAÇÕES
          ============================================================ */}
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

          <div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Verificando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Seção com título (agrupa campos relacionados no form)
// =========================================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

// =========================================================================
// Editor de campos personalizados (metadados jsonb)
// =========================================================================
interface CamposPersonalizadosProps {
  metadados: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

function CamposPersonalizados({ metadados, onChange }: CamposPersonalizadosProps) {
  // Trabalha com lista de pares pra preservar ordem ao editar chaves
  const entries = Object.entries(metadados);

  const setPair = (oldKey: string, newKey: string, newVal: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) {
        if (newKey.trim()) next[newKey.trim()] = newVal;
      } else {
        next[k] = v;
      }
    }
    onChange(next);
  };

  const removePair = (key: string) => {
    const next = { ...metadados };
    delete next[key];
    onChange(next);
  };

  const addPair = () => {
    // Gera chave única "campo 1", "campo 2", etc.
    const base = "Novo campo";
    let i = 1;
    let key = base;
    while (key in metadados) {
      key = `${base} ${i++}`;
    }
    onChange({ ...metadados, [key]: "" });
  };

  return (
    <Section title="Campos personalizados">
      <p className="-mt-1 text-[11px] text-muted-foreground">
        Adicione campos livres (ex: "Indicado por", "Código interno", "Tags"). Aparecem no detalhe
        da empresa e são pesquisáveis.
      </p>
      {entries.length === 0 ? (
        <p className="py-2 text-xs italic text-muted-foreground">
          Nenhum campo personalizado ainda.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Input
                placeholder="Rótulo"
                value={key}
                onChange={(e) => setPair(key, e.target.value, value)}
                className="w-1/3"
              />
              <Input
                placeholder="Valor"
                value={value}
                onChange={(e) => setPair(key, key, e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                onClick={() => removePair(key)}
                aria-label={`Remover ${key}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addPair}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Adicionar campo
      </Button>
    </Section>
  );
}

// Suprime warning de import não-usado quando ícones ficam só em futuros pontos
void X;
