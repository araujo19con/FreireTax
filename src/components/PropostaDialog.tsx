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

function PropostaPreview(p: PreviewProps) {
  const { ctx } = p;
  return (
    <div className="max-w-3xl mx-auto bg-white text-black shadow-md rounded-md p-10 print:shadow-none print:rounded-none">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-300 pb-4 mb-6">
        <div>
          <div className="text-2xl font-serif font-bold text-gray-800">Freire Pignataro</div>
          <div className="text-[9px] text-gray-500 tracking-wider uppercase">— Dantas, Freire, Pignataro, Maciel e Costa —</div>
          <div className="text-xs italic text-gray-600">Advogados Associados</div>
        </div>
        <div className="text-right text-[10px] text-gray-600 leading-tight">
          <div>{ESCRITORIO_DEFAULT.telefone}</div>
          <div>{ESCRITORIO_DEFAULT.endereco}</div>
        </div>
      </div>

      {/* Título */}
      <h1 className="text-center text-xl font-bold uppercase mb-6 leading-snug">
        {renderVariaveis(p.titulo, ctx)}
      </h1>

      {/* Destinatário */}
      <div className="mb-4">
        <div className="font-bold underline">{renderVariaveis(p.destinatarioEmpresa, ctx)}</div>
        {p.destinatarioAtt && (
          <div className="font-semibold">Att.: {renderVariaveis(p.destinatarioAtt, ctx)}</div>
        )}
      </div>

      {/* Introdução */}
      {p.textoIntroducao && (
        <p className="mb-5 text-sm text-justify">{renderVariaveis(p.textoIntroducao, ctx)}</p>
      )}

      {/* Seções */}
      {p.secoes.map((s, i) => (
        <section key={i} className="mb-5">
          <h2 className="text-sm font-bold uppercase mb-2">{renderVariaveis(s.titulo, ctx)}</h2>
          <div
            className="prose prose-sm max-w-none text-justify"
            dangerouslySetInnerHTML={{ __html: renderVariaveis(s.conteudo, ctx) }}
          />
        </section>
      ))}

      {/* Assinatura */}
      <div className="mt-10">
        <p className="mb-1 text-sm">Atenciosamente,</p>
        <p className="font-bold text-sm">{p.signatarioNome}</p>
        {p.signatarioCargo && <p className="text-xs text-gray-600">{p.signatarioCargo}</p>}
      </div>

      {/* Footer */}
      <div className="mt-10 pt-3 border-t border-gray-300 flex items-center justify-between text-[10px] text-gray-500">
        <span>{ESCRITORIO_DEFAULT.telefone}</span>
        <span>{ESCRITORIO_DEFAULT.site}</span>
        <span>Natal | Brasília | São Paulo</span>
      </div>
    </div>
  );
}

// =========================================================================
// HTML pra impressão (window.open + window.print)
// =========================================================================
function renderPropostaHTML(p: PreviewProps): string {
  const { ctx } = p;
  const css = `
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #222; line-height: 1.5; font-size: 11pt; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #ccc; padding-bottom: 12px; margin-bottom: 18px; }
    .brand { font-size: 22pt; font-weight: bold; color: #333; }
    .brand-sub { font-size: 7pt; letter-spacing: 1px; text-transform: uppercase; color: #666; }
    .brand-italic { font-size: 9pt; font-style: italic; color: #555; }
    .meta { text-align: right; font-size: 8pt; color: #555; }
    h1 { text-align: center; font-size: 14pt; text-transform: uppercase; margin: 18px 0 24px; }
    h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 18px 0 8px; }
    h3 { font-size: 10pt; font-weight: bold; margin: 14px 0 6px; }
    p { margin: 0 0 10px; text-align: justify; }
    ul, ol { margin: 0 0 10px 22px; }
    blockquote { border-left: 3px solid #ccc; margin: 0 0 10px; padding-left: 10px; color: #555; }
    .destinatario { margin-bottom: 14px; }
    .destinatario .empresa { font-weight: bold; text-decoration: underline; }
    .destinatario .att { font-weight: 600; }
    .signature { margin-top: 40px; }
    .signature .nome { font-weight: bold; }
    .signature .cargo { font-size: 9pt; color: #555; }
    .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 8pt; color: #777; }
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
  <div class="header">
    <div>
      <div class="brand">Freire Pignataro</div>
      <div class="brand-sub">— Dantas, Freire, Pignataro, Maciel e Costa —</div>
      <div class="brand-italic">Advogados Associados</div>
    </div>
    <div class="meta">
      <div>${ESCRITORIO_DEFAULT.telefone}</div>
      <div>${ESCRITORIO_DEFAULT.endereco}</div>
    </div>
  </div>
  <h1>${escapeHTML(renderVariaveis(p.titulo, ctx))}</h1>
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
  <div class="footer">
    <span>${ESCRITORIO_DEFAULT.telefone}</span>
    <span>${ESCRITORIO_DEFAULT.site}</span>
    <span>Natal | Brasília | São Paulo</span>
  </div>
</body></html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Suprime warning de import não usado quando alguns ícones ficam em rota só pro futuro
void Mail;
