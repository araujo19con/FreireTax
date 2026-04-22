import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileText, Eye, Pencil, Send, Save, Plus, Trash2, ArrowUp, ArrowDown,
  Printer, Sparkles, Copy, Mail, Trash,
} from "lucide-react";
import { RichTextEditor } from "./RichTextEditor";
import {
  usePropostaTemplates, usePropostaByProspeccao, useUpsertProposta,
  useMarcarPropostaEnviada, useDeleteProposta, type PropostaTemplate,
} from "@/hooks/usePropostas";
import {
  type ProposalSection, type ProposalContext, ESCRITORIO_DEFAULT,
  renderVariaveis, VARIAVEIS_DISPONIVEIS,
} from "@/lib/proposta";
import { toast } from "sonner";

interface PropostaDialogProps {
  open: boolean;
  onClose: () => void;
  prospeccaoId: string;
  /** Dados pra renderizar variáveis */
  context: {
    empresaNome: string;
    empresaCnpj: string;
    empresaRazaoSocial?: string | null;
    contatoNome?: string | null;
    contatoCargo?: string | null;
    contatoEmail?: string | null;
    contatoTelefone?: string | null;
    acaoId?: string | null;
    acaoNome?: string | null;
    acaoDescricao?: string | null;
    valorPotencial?: number | null;
  };
  /** Quando informado, dispara após salvar/enviar (ex: avançar status do kanban) */
  onSaved?: (status: "rascunho" | "enviada") => void;
}

export function PropostaDialog({ open, onClose, prospeccaoId, context, onSaved }: PropostaDialogProps) {
  const propQ = usePropostaByProspeccao(open ? prospeccaoId : null);
  const tplsQ = usePropostaTemplates({ acaoId: context.acaoId, apenasAtivos: true });
  const upsertProp = useUpsertProposta();
  const marcarEnviada = useMarcarPropostaEnviada();
  const deleteProp = useDeleteProposta();

  // Estado local da proposta sendo editada
  const [titulo, setTitulo] = useState("PROPOSTA DE PRESTAÇÃO DE SERVIÇOS");
  const [destinatarioEmpresa, setDestinatarioEmpresa] = useState("");
  const [destinatarioAtt, setDestinatarioAtt] = useState("");
  const [textoIntroducao, setTextoIntroducao] = useState("");
  const [secoes, setSecoes] = useState<ProposalSection[]>([]);
  const [valorEntrada, setValorEntrada] = useState<string>("");
  const [percentualExito, setPercentualExito] = useState<string>("");
  const [signatarioNome, setSignatarioNome] = useState("Rodrigo Dantas");
  const [signatarioCargo, setSignatarioCargo] = useState("OAB/RN n.º 4.476");
  const [templateId, setTemplateId] = useState<string>("");
  const [activeSecaoIdx, setActiveSecaoIdx] = useState(0);
  const [tab, setTab] = useState<"editar" | "preview">("editar");

  // Hidrata estado quando abre
  useEffect(() => {
    if (!open) return;
    if (propQ.data) {
      const p = propQ.data;
      setTitulo(p.titulo);
      setDestinatarioEmpresa(p.destinatario_empresa ?? context.empresaNome);
      setDestinatarioAtt(p.destinatario_att ?? context.contatoNome ?? "");
      setTextoIntroducao(p.texto_introducao ?? "");
      setSecoes(p.secoes ?? []);
      setValorEntrada(p.valor_entrada?.toString() ?? "");
      setPercentualExito(p.percentual_exito?.toString() ?? "");
      setSignatarioNome(p.signatario_nome ?? "Rodrigo Dantas");
      setSignatarioCargo(p.signatario_cargo ?? "OAB/RN n.º 4.476");
      setTemplateId(p.template_id ?? "");
      setActiveSecaoIdx(0);
    } else {
      // Sem proposta — preset com dados da prospecção
      setTitulo("PROPOSTA DE PRESTAÇÃO DE SERVIÇOS");
      setDestinatarioEmpresa(context.empresaNome);
      setDestinatarioAtt(context.contatoNome ?? "");
      setTextoIntroducao("Temos a satisfação de submeter à apreciação de V.Sas. nossa proposta de prestação de serviços.");
      setSecoes([]);
      setValorEntrada("");
      setPercentualExito("");
      setTemplateId("");
      setActiveSecaoIdx(0);
    }
    setTab("editar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, propQ.data?.id]);

  // Aplica template selecionado (sobrescreve seções, hon, intro, título)
  const applyTemplate = (t: PropostaTemplate) => {
    setTitulo(`PROPOSTA DE PRESTAÇÃO DE SERVIÇOS — ${t.tipo_servico ?? t.nome}`.toUpperCase());
    setSecoes(t.secoes ?? []);
    setTextoIntroducao(t.texto_destinatario_default ?? "");
    setValorEntrada(t.valor_entrada_default?.toString() ?? "");
    setPercentualExito(t.percentual_exito_default?.toString() ?? "");
    setTemplateId(t.id);
    setActiveSecaoIdx(0);
    toast.success(`Template "${t.nome}" aplicado. Edite à vontade.`);
  };

  // Contexto pra renderizar variáveis no preview
  const ctx: ProposalContext = useMemo(() => ({
    empresa: {
      nome: context.empresaNome,
      cnpj: context.empresaCnpj,
      razao_social: context.empresaRazaoSocial,
    },
    contato: {
      nome: context.contatoNome ?? "",
      cargo: context.contatoCargo,
      email: context.contatoEmail,
      telefone: context.contatoTelefone,
    },
    acao: {
      nome: context.acaoNome ?? "",
      descricao: context.acaoDescricao,
    },
    prospeccao: {
      valor_potencial: context.valorPotencial,
    },
    honorarios: {
      entrada: valorEntrada ? Number(valorEntrada) : null,
      exito_percentual: percentualExito ? Number(percentualExito) : null,
    },
    escritorio: ESCRITORIO_DEFAULT,
  }), [context, valorEntrada, percentualExito]);

  // Operações sobre seções
  const addSecao = () => {
    setSecoes((curr) => [...curr, {
      ordem: curr.length,
      titulo: `${curr.length + 1}. NOVA SEÇÃO`,
      conteudo: "<p></p>",
    }]);
    setActiveSecaoIdx(secoes.length);
  };
  const removeSecao = (idx: number) => {
    setSecoes((curr) => {
      const next = curr.filter((_, i) => i !== idx).map((s, i) => ({ ...s, ordem: i }));
      return next;
    });
    setActiveSecaoIdx(Math.max(0, idx - 1));
  };
  const moveSecao = (idx: number, dir: -1 | 1) => {
    setSecoes((curr) => {
      const next = [...curr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return curr;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((s, i) => ({ ...s, ordem: i }));
    });
    setActiveSecaoIdx(idx + dir);
  };

  const updateSecao = (idx: number, patch: Partial<ProposalSection>) => {
    setSecoes((curr) => curr.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  // Salvar (rascunho) ou marcar como enviada
  const handleSave = async (asEnviada: boolean) => {
    const saved = await upsertProp.mutateAsync({
      prospeccao_id: prospeccaoId,
      template_id: templateId || null,
      empresa_id: undefined, // mantém valor atual se já existe
      acao_id: context.acaoId ?? null,
      titulo: titulo.trim(),
      destinatario_empresa: destinatarioEmpresa.trim() || null,
      destinatario_att: destinatarioAtt.trim() || null,
      texto_introducao: textoIntroducao.trim() || null,
      secoes,
      valor_entrada: valorEntrada ? Number(valorEntrada) : null,
      percentual_exito: percentualExito ? Number(percentualExito) : null,
      signatario_nome: signatarioNome.trim() || null,
      signatario_cargo: signatarioCargo.trim() || null,
      status: asEnviada ? "enviada" : "rascunho",
      motivo_rejeicao: null,
    });
    if (asEnviada && saved.id) {
      await marcarEnviada.mutateAsync(saved.id);
    }
    onSaved?.(asEnviada ? "enviada" : "rascunho");
    onClose();
  };

  const handleDelete = async () => {
    if (!propQ.data?.id) return;
    await deleteProp.mutateAsync(propQ.data.id);
    onClose();
  };

  const copyVar = (key: string) => {
    navigator.clipboard.writeText(key).then(() => toast.success(`${key} copiado`));
  };

  const printPreview = () => {
    // Abre nova janela só com o HTML renderizado pra impressão limpa
    const html = renderPropostaHTML({
      titulo, destinatarioEmpresa, destinatarioAtt, textoIntroducao,
      secoes, signatarioNome, signatarioCargo, ctx,
    });
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { toast.error("Bloqueador de pop-up impediu a impressão"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[95vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-4 pb-2 border-b border-border">
          <DialogTitle className="font-heading flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {propQ.data ? "Editar proposta" : "Nova proposta"}
            {propQ.data?.status === "enviada" && (
              <Badge className="ml-2 bg-success/10 text-success border-success/30">enviada</Badge>
            )}
            {propQ.data?.status === "rascunho" && (
              <Badge variant="secondary" className="ml-2">rascunho</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "editar" | "preview")} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-2 pb-1 border-b border-border">
            <TabsList>
              <TabsTrigger value="editar" className="gap-1.5"><Pencil className="h-3.5 w-3.5" />Editar</TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5"><Eye className="h-3.5 w-3.5" />Preview</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" onClick={printPreview}>
              <Printer className="mr-1.5 h-3.5 w-3.5" />Imprimir / PDF
            </Button>
          </div>

          {/* ============== EDITAR ============== */}
          <TabsContent value="editar" className="flex-1 overflow-y-auto px-5 py-4 space-y-4 mt-0">
            {/* Template picker */}
            {(tplsQ.data?.length ?? 0) > 0 && (
              <Card className="p-3 bg-primary/5 border-primary/20">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-medium">Aplicar template:</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {tplsQ.data?.map((t) => (
                      <Button
                        key={t.id} type="button" variant="outline" size="sm"
                        className="h-7 text-xs"
                        onClick={() => applyTemplate(t)}
                      >
                        {t.nome}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Aplicar substitui as seções atuais. Edite livremente depois.
                </p>
              </Card>
            )}

            {/* Cabeçalho */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título da proposta</Label>
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Destinatário (empresa)</Label>
                  <Input value={destinatarioEmpresa} onChange={(e) => setDestinatarioEmpresa(e.target.value)} placeholder="Nome da empresa" />
                </div>
                <div className="space-y-1.5">
                  <Label>Att.: (nome do contato)</Label>
                  <Input value={destinatarioAtt} onChange={(e) => setDestinatarioAtt(e.target.value)} placeholder="Dr./Dra. Nome" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Introdução</Label>
                <Textarea
                  rows={2}
                  value={textoIntroducao}
                  onChange={(e) => setTextoIntroducao(e.target.value)}
                  placeholder="Ex: Prezados Senhores, Temos a satisfação de submeter…"
                />
              </div>
            </div>

            {/* Seções */}
            <div className="border border-border rounded-md">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
                <span className="text-sm font-medium">Seções da proposta</span>
                <Button type="button" variant="outline" size="sm" onClick={addSecao}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar seção
                </Button>
              </div>
              {secoes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhuma seção. Aplique um template ou adicione manualmente.
                </p>
              ) : (
                <div className="grid grid-cols-[200px_1fr] divide-x divide-border min-h-[300px]">
                  {/* Lista de seções */}
                  <div className="overflow-y-auto max-h-[400px]">
                    {secoes.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActiveSecaoIdx(i)}
                        className={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-muted/50 transition-colors ${
                          activeSecaoIdx === i ? "bg-primary/10 text-primary font-medium" : ""
                        }`}
                      >
                        <div className="truncate">{s.titulo || `Seção ${i + 1}`}</div>
                      </button>
                    ))}
                  </div>
                  {/* Editor da seção ativa */}
                  {secoes[activeSecaoIdx] && (
                    <div className="p-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={secoes[activeSecaoIdx].titulo}
                          onChange={(e) => updateSecao(activeSecaoIdx, { titulo: e.target.value })}
                          placeholder="Título da seção"
                          className="font-medium"
                        />
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveSecao(activeSecaoIdx, -1)} disabled={activeSecaoIdx === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveSecao(activeSecaoIdx, 1)} disabled={activeSecaoIdx === secoes.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" onClick={() => removeSecao(activeSecaoIdx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <RichTextEditor
                        value={secoes[activeSecaoIdx].conteudo}
                        onChange={(html) => updateSecao(activeSecaoIdx, { conteudo: html })}
                        placeholder="Conteúdo da seção…"
                        minHeight="240px"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Honorários */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Honorários de entrada (R$)</Label>
                <Input type="number" inputMode="decimal" placeholder="Ex: 10000" value={valorEntrada} onChange={(e) => setValorEntrada(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Êxito (%)</Label>
                <Input type="number" inputMode="decimal" placeholder="Ex: 20" value={percentualExito} onChange={(e) => setPercentualExito(e.target.value)} />
              </div>
            </div>

            {/* Assinatura */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Signatário (nome)</Label>
                <Input value={signatarioNome} onChange={(e) => setSignatarioNome(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>OAB / cargo</Label>
                <Input value={signatarioCargo} onChange={(e) => setSignatarioCargo(e.target.value)} />
              </div>
            </div>

            {/* Variáveis disponíveis */}
            <Card className="p-3 bg-muted/20">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Variáveis (clique pra copiar)</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {VARIAVEIS_DISPONIVEIS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => copyVar(v.key)}
                    className="text-left text-[11px] px-2 py-1 rounded border border-border bg-background hover:bg-muted/50 flex items-center justify-between gap-2"
                  >
                    <code className="font-mono text-primary">{v.key}</code>
                    <Copy className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ============== PREVIEW ============== */}
          <TabsContent value="preview" className="flex-1 overflow-y-auto bg-muted/30 px-4 py-4 mt-0">
            <PropostaPreview
              titulo={titulo}
              destinatarioEmpresa={destinatarioEmpresa}
              destinatarioAtt={destinatarioAtt}
              textoIntroducao={textoIntroducao}
              secoes={secoes}
              signatarioNome={signatarioNome}
              signatarioCargo={signatarioCargo}
              ctx={ctx}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="px-5 py-3 border-t border-border sm:justify-between">
          <div>
            {propQ.data?.id && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive border-destructive/30">
                    <Trash className="mr-1.5 h-3.5 w-3.5" />Excluir proposta
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir esta proposta?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação é irreversível. A prospecção continua existindo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Sim, excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button variant="outline" onClick={() => handleSave(false)} disabled={upsertProp.isPending}>
              <Save className="mr-1.5 h-3.5 w-3.5" />Salvar rascunho
            </Button>
            <Button onClick={() => handleSave(true)} disabled={upsertProp.isPending}>
              <Send className="mr-1.5 h-3.5 w-3.5" />Marcar como enviada
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// PREVIEW (HTML formatado tipo PDF)
// =========================================================================
interface PreviewProps {
  titulo: string;
  destinatarioEmpresa: string;
  destinatarioAtt: string;
  textoIntroducao: string;
  secoes: ProposalSection[];
  signatarioNome: string;
  signatarioCargo: string;
  ctx: ProposalContext;
}

// Cabeçalho timbrado (banda decorativa + logo FP + wordmark)
// Mesma estrutura do thead usado no print — garante preview fiel ao PDF.
function TimbradoTopo() {
  return (
    <div className="w-full" aria-hidden="true">
      <img src="/timbrado-top.svg" alt="" className="block w-full select-none" style={{ height: "10mm" }} />
      <div
        className="flex items-center gap-4 border-b border-gray-300"
        style={{ padding: "6mm 18mm 4mm", fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        <img src="/logo-fp.svg" alt="Freire Pignataro" className="shrink-0" style={{ width: "24mm", height: "24mm" }} />
        <div className="leading-tight text-gray-700 flex-1">
          <div style={{ fontSize: "28pt", letterSpacing: "0.5px" }}>Freire Pignataro</div>
          <div className="text-center text-gray-600 mt-0.5"
               style={{ fontSize: "7.5pt", letterSpacing: "2px", textTransform: "uppercase" }}>
            — Dantas, Freire, Pignataro, Maciel e Costa —
          </div>
          <div className="text-center italic text-gray-700" style={{ fontSize: "12pt" }}>
            Advogados Associados
          </div>
        </div>
      </div>
    </div>
  );
}

// Rodapé timbrado: 3 colunas (telefone | URL | cidades) + banda decorativa espelhada
function TimbradoRodape() {
  return (
    <div className="w-full" aria-hidden="true">
      <div
        className="flex items-center justify-around border-t border-gray-300 text-gray-600"
        style={{ padding: "4mm 18mm", fontSize: "10pt", fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        <div className="flex items-center gap-1.5"><PhoneIcon /><span>{ESCRITORIO_DEFAULT.telefone}</span></div>
        <div className="flex items-center gap-1.5"><GlobeIcon /><span>{ESCRITORIO_DEFAULT.site.replace(/^https?:\/\//, "")}</span></div>
        <div className="flex items-center gap-1.5"><PinIcon /><span>Natal | Brasília | São Paulo</span></div>
      </div>
      <img src="/timbrado-bottom.svg" alt="" className="block w-full select-none" style={{ height: "10mm" }} />
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-gray-500" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-gray-500" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-gray-500" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function PropostaPreview(p: PreviewProps) {
  const { ctx } = p;
  return (
    <div
      className="max-w-3xl mx-auto bg-white text-black shadow-md rounded-md overflow-hidden print:shadow-none print:rounded-none"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      <TimbradoTopo />

      <div style={{ padding: "8mm 18mm 6mm" }}>
        {/* Título */}
        <h1 className="text-center font-bold uppercase mt-2 mb-7 leading-snug" style={{ fontSize: "18pt", letterSpacing: "0.5px" }}>
          {renderVariaveis(p.titulo, ctx)}
        </h1>

        {/* Destinatário */}
        <div className="mb-4">
          <div className="font-bold underline" style={{ fontSize: "12pt" }}>
            {renderVariaveis(p.destinatarioEmpresa, ctx)}
          </div>
          {p.destinatarioAtt && (
            <div className="font-semibold mt-0.5" style={{ fontSize: "11pt" }}>
              Att.: {renderVariaveis(p.destinatarioAtt, ctx)}
            </div>
          )}
        </div>

        {/* Introdução */}
        {p.textoIntroducao && (
          <p className="mb-6 text-justify" style={{ fontSize: "11pt", lineHeight: 1.55 }}>
            {renderVariaveis(p.textoIntroducao, ctx)}
          </p>
        )}

        {/* Seções */}
        {p.secoes.map((s, i) => (
          <section key={i} className="mb-5">
            <h2 className="font-bold uppercase mb-2" style={{ fontSize: "11pt", letterSpacing: "0.3px" }}>
              {renderVariaveis(s.titulo, ctx)}
            </h2>
            <div
              className="prose prose-sm max-w-none text-justify proposta-body"
              style={{ fontSize: "11pt", lineHeight: 1.55 }}
              dangerouslySetInnerHTML={{ __html: renderVariaveis(s.conteudo, ctx) }}
            />
          </section>
        ))}

        {/* Assinatura */}
        <div className="mt-12 mb-6">
          <p className="mb-1" style={{ fontSize: "11pt" }}>Atenciosamente,</p>
          <p className="font-bold mt-3" style={{ fontSize: "11pt" }}>{p.signatarioNome}</p>
          {p.signatarioCargo && (
            <p className="text-gray-600" style={{ fontSize: "10pt" }}>{p.signatarioCargo}</p>
          )}
        </div>
      </div>

      <TimbradoRodape />

      {/* Aviso de preview de página única */}
      <div className="text-center text-[10px] text-gray-400 italic py-2 bg-gray-50 border-t border-gray-200 print:hidden">
        Preview da página 1 — o timbrado se repete em todas as páginas no PDF impresso
      </div>
    </div>
  );
}

// =========================================================================
// HTML pra impressão (window.open + window.print)
// =========================================================================
function renderPropostaHTML(p: PreviewProps): string {
  const { ctx } = p;

  // SVGs inline (não dependem de fetch durante print)
  const logoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%">
      <circle cx="60" cy="60" r="55" fill="none" stroke="#3a3f48" stroke-width="2.5"/>
      <text x="60" y="80" font-family="Georgia, 'Times New Roman', serif" font-size="60"
            font-style="italic" font-weight="500" fill="#3a3f48" text-anchor="middle"
            letter-spacing="-2">FP</text>
    </svg>
  `;

  // Banda superior — tan 0-28% | gray 28-50% | tan 50-64% | orange 64-80% | tan 80-100%
  const bandaTopoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 240" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="0" y="0" width="2100" height="240" fill="#d3b58a"/>
      <rect x="588" y="0" width="462" height="240" fill="#3a3f48"/>
      <polygon points="1344,0 1680,0 1620,240 1284,240" fill="#c98253"/>
    </svg>
  `;

  // Banda inferior — tan 0-12% | gray 12-50% | tan 50-58% | orange 58-72% | tan 72-100%
  const bandaRodapeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 240" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="0" y="0" width="2100" height="240" fill="#d3b58a"/>
      <rect x="252" y="0" width="798" height="240" fill="#3a3f48"/>
      <polygon points="1218,0 1512,0 1572,240 1278,240" fill="#c98253"/>
    </svg>
  `;

  const phoneIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" width="12" height="12" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const globeIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const pinIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" width="12" height="12"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

  // Estratégia: <table> com thead/tfoot — browsers re-imprimem nativamente
  // a cada página que a tabela quebra. Muito mais confiável que position:fixed.
  const css = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      color: #1f1f1f;
      line-height: 1.55;
      font-size: 11pt;
    }

    table.folha {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.folha thead { display: table-header-group; }
    table.folha tfoot { display: table-footer-group; }
    table.folha td { padding: 0; vertical-align: top; }

    /* --- TIMBRADO TOPO (thead) --- */
    .banda { display: block; width: 100%; height: 10mm; line-height: 0; }
    .header-area {
      padding: 6mm 18mm 4mm;
      display: flex;
      align-items: center;
      gap: 18px;
      border-bottom: 1px solid #c0c0c0;
    }
    .header-area .logo { width: 24mm; height: 24mm; flex-shrink: 0; }
    .header-area .text { line-height: 1.1; color: #4a4a4a; flex: 1; }
    .header-area .name { font-size: 28pt; letter-spacing: 0.5px; }
    .header-area .sub {
      font-size: 7.5pt; letter-spacing: 2px; text-transform: uppercase;
      color: #666; margin-top: 2px; text-align: center;
    }
    .header-area .italic {
      font-size: 12pt; font-style: italic; color: #4a4a4a; text-align: center;
    }

    /* --- TIMBRADO RODAPÉ (tfoot) --- */
    .footer-area {
      padding: 4mm 18mm 4mm;
      display: flex;
      justify-content: space-around;
      align-items: center;
      font-size: 10pt;
      color: #555;
      border-top: 1px solid #c0c0c0;
    }
    .footer-area .item { display: flex; align-items: center; gap: 5px; }
    .footer-area .item svg { flex-shrink: 0; }

    /* --- BODY (tbody td) --- */
    .body-area { padding: 8mm 18mm 6mm; }

    h1.titulo {
      text-align: center;
      font-size: 18pt;
      text-transform: uppercase;
      margin: 2mm 0 8mm;
      letter-spacing: 0.5px;
    }
    h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 8mm 0 3mm; letter-spacing: 0.3px; }
    h3 { font-size: 10pt; font-weight: bold; margin: 6mm 0 2mm; }
    p  { margin: 0 0 4mm; text-align: justify; }
    ul, ol { margin: 0 0 4mm 22px; }
    blockquote { border-left: 3px solid #ccc; margin: 0 0 4mm; padding-left: 10px; color: #555; }
    strong { font-weight: 700; }

    .destinatario { margin: 0 0 5mm; }
    .destinatario .empresa { font-weight: bold; text-decoration: underline; font-size: 12pt; }
    .destinatario .att { font-weight: 600; font-size: 11pt; margin-top: 1mm; }

    .signature { margin-top: 14mm; }
    .signature .nome { font-weight: bold; margin-top: 3mm; }
    .signature .cargo { font-size: 9.5pt; color: #555; }

    section { page-break-inside: avoid; }
  `;

  const secoesHTML = p.secoes.map((s) => `
    <section>
      <h2>${escapeHTML(renderVariaveis(s.titulo, ctx))}</h2>
      <div>${renderVariaveis(s.conteudo, ctx)}</div>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><title>${escapeHTML(p.titulo)}</title>
<style>${css}</style></head><body>
<table class="folha">
  <thead>
    <tr><td>
      <div class="banda">${bandaTopoSvg}</div>
      <div class="header-area">
        <div class="logo">${logoSvg}</div>
        <div class="text">
          <div class="name">Freire Pignataro</div>
          <div class="sub">— Dantas, Freire, Pignataro, Maciel e Costa —</div>
          <div class="italic">Advogados Associados</div>
        </div>
      </div>
    </td></tr>
  </thead>

  <tbody>
    <tr><td class="body-area">
      <h1 class="titulo">${escapeHTML(renderVariaveis(p.titulo, ctx))}</h1>

      <div class="destinatario">
        <div class="empresa">${escapeHTML(renderVariaveis(p.destinatarioEmpresa, ctx))}</div>
        ${p.destinatarioAtt ? `<div class="att">Att.: ${escapeHTML(renderVariaveis(p.destinatarioAtt, ctx))}</div>` : ""}
      </div>

      ${p.textoIntroducao ? `<p>${escapeHTML(renderVariaveis(p.textoIntroducao, ctx))}</p>` : ""}

      ${secoesHTML}

      <div class="signature">
        <p>Atenciosamente,</p>
        <p class="nome">${escapeHTML(p.signatarioNome)}</p>
        ${p.signatarioCargo ? `<p class="cargo">${escapeHTML(p.signatarioCargo)}</p>` : ""}
      </div>
    </td></tr>
  </tbody>

  <tfoot>
    <tr><td>
      <div class="footer-area">
        <div class="item">${phoneIconSvg}<span>${ESCRITORIO_DEFAULT.telefone}</span></div>
        <div class="item">${globeIconSvg}<span>${escapeHTML(ESCRITORIO_DEFAULT.site.replace(/^https?:\/\//, ""))}</span></div>
        <div class="item">${pinIconSvg}<span>Natal | Brasília | São Paulo</span></div>
      </div>
      <div class="banda">${bandaRodapeSvg}</div>
    </td></tr>
  </tfoot>
</table>
</body></html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Suprime warning de import não usado quando alguns ícones ficam em rota só pro futuro
void Mail;
