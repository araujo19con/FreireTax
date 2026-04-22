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

// Banda decorativa que simula o timbrado dos PDFs originais —
// tan/cream nas extremidades, dark gray-blue no meio, accent rust à direita.
function DecorativeBand() {
  return (
    <div
      className="h-7 w-full"
      style={{
        background: `linear-gradient(to right,
          #d6b485 0%, #d6b485 22%,
          #3a3f4a 22%, #3a3f4a 70%,
          #b87544 70%, #b87544 78%,
          #d6b485 78%, #d6b485 100%)`,
      }}
      aria-hidden="true"
    />
  );
}

function PropostaPreview(p: PreviewProps) {
  const { ctx } = p;
  return (
    <div
      className="max-w-3xl mx-auto bg-white text-black shadow-md rounded-md overflow-hidden print:shadow-none print:rounded-none"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      <DecorativeBand />

      <div className="px-12 py-8">
        {/* Header — logo à esquerda + contato à direita (estilo Unimed) */}
        <header className="flex items-center justify-between gap-6 pb-4 border-b border-gray-300">
          <div className="flex items-center gap-3">
            <img src="/logo-fp.svg" alt="Freire Pignataro" className="h-16 w-16 shrink-0" />
            <div className="leading-tight">
              <div className="text-2xl font-serif text-gray-800" style={{ letterSpacing: "0.5px" }}>
                Freire Pignataro
              </div>
              <div className="text-[8px] text-gray-600 tracking-[0.15em] uppercase mt-0.5">
                — Dantas, Freire, Pignataro, Maciel e Costa —
              </div>
              <div className="text-[10px] italic text-gray-600 text-center">
                Advogados Associados
              </div>
            </div>
          </div>
          <div className="border-l border-gray-300 pl-4 text-[10px] text-gray-700 leading-snug">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">📞</span>
              <span>{ESCRITORIO_DEFAULT.telefone}</span>
            </div>
            <div className="flex items-start gap-1.5 mt-0.5 max-w-[170px]">
              <span className="text-gray-500">📍</span>
              <span>{ESCRITORIO_DEFAULT.endereco}</span>
            </div>
          </div>
        </header>

        {/* Título */}
        <h1 className="text-center font-bold uppercase mt-8 mb-7 leading-snug" style={{ fontSize: "20pt", letterSpacing: "0.5px" }}>
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
        <div className="mt-12">
          <p className="mb-1" style={{ fontSize: "11pt" }}>Atenciosamente,</p>
          <p className="font-bold mt-3" style={{ fontSize: "11pt" }}>{p.signatarioNome}</p>
          {p.signatarioCargo && (
            <p className="text-gray-600" style={{ fontSize: "10pt" }}>{p.signatarioCargo}</p>
          )}
        </div>

        {/* Footer textual */}
        <footer className="mt-10 pt-3 border-t border-gray-300 flex items-end justify-between text-[9pt] text-gray-700">
          <div className="leading-snug">
            <div>{ESCRITORIO_DEFAULT.nome}</div>
            <div className="text-gray-500">{ESCRITORIO_DEFAULT.advogado}</div>
          </div>
          <div className="text-gray-500">pág. 1</div>
        </footer>
      </div>

      <DecorativeBand />
    </div>
  );
}

// =========================================================================
// HTML pra impressão (window.open + window.print)
// =========================================================================
function renderPropostaHTML(p: PreviewProps): string {
  const { ctx } = p;
  // SVG inline do logo — independe de fetch durante print
  const logoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="64" height="64">
      <circle cx="60" cy="60" r="55" fill="none" stroke="#3a3f4a" stroke-width="2.5"/>
      <text x="60" y="80"
            font-family="Georgia, 'Times New Roman', serif"
            font-size="60"
            font-style="italic"
            font-weight="500"
            fill="#3a3f4a"
            text-anchor="middle"
            letter-spacing="-2">FP</text>
    </svg>
  `;

  // Banda decorativa replicando o timbrado dos PDFs
  const bandaCSS = `
    background: linear-gradient(to right,
      #d6b485 0%, #d6b485 22%,
      #3a3f4a 22%, #3a3f4a 70%,
      #b87544 70%, #b87544 78%,
      #d6b485 78%, #d6b485 100%);
  `.trim();

  const css = `
    @page {
      size: A4;
      margin: 0;
      /* Headers/footers nativos do navegador são desligados via UI;
         o timbrado é renderizado dentro do conteúdo */
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      color: #1f1f1f;
      line-height: 1.55;
      font-size: 11pt;
    }
    .page {
      position: relative;
      width: 210mm;
      min-height: 297mm;
      padding: 16mm 18mm 22mm; /* espaço pro timbrado bottom */
      page-break-after: always;
      box-sizing: border-box;
    }
    .page:last-child { page-break-after: auto; }

    /* Banda decorativa (top + bottom) */
    .deco-top, .deco-bottom {
      position: absolute;
      left: 0; right: 0;
      height: 7mm;
      ${bandaCSS}
    }
    .deco-top    { top: 0; }
    .deco-bottom { bottom: 0; }

    /* Header */
    .header {
      margin-top: 6mm;
      padding-bottom: 4mm;
      border-bottom: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand .logo { flex-shrink: 0; }
    .brand .text { line-height: 1.15; }
    .brand .name { font-size: 22pt; color: #2a2a2a; letter-spacing: 0.5px; }
    .brand .sub { font-size: 6.5pt; letter-spacing: 1.5px; text-transform: uppercase; color: #555; margin-top: 1px; }
    .brand .italic { font-size: 8pt; font-style: italic; color: #555; text-align: center; }
    .meta {
      border-left: 1px solid #ccc;
      padding-left: 12px;
      font-size: 8pt;
      color: #444;
      line-height: 1.5;
      max-width: 60mm;
    }
    .meta .row { display: flex; gap: 6px; }
    .meta .row .ico { color: #888; }

    /* Body */
    h1.titulo {
      text-align: center;
      font-size: 17pt;
      text-transform: uppercase;
      margin: 14mm 0 10mm;
      letter-spacing: 0.5px;
    }
    h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 10mm 0 3mm; letter-spacing: 0.3px; }
    h3 { font-size: 10pt; font-weight: bold; margin: 7mm 0 2mm; }
    p  { margin: 0 0 4mm; text-align: justify; }
    ul, ol { margin: 0 0 4mm 22px; }
    blockquote { border-left: 3px solid #ccc; margin: 0 0 4mm; padding-left: 10px; color: #555; }
    strong { font-weight: 700; }

    .destinatario { margin: 0 0 5mm; }
    .destinatario .empresa { font-weight: bold; text-decoration: underline; font-size: 12pt; }
    .destinatario .att { font-weight: 600; font-size: 11pt; margin-top: 1mm; }

    /* Assinatura */
    .signature { margin-top: 14mm; }
    .signature .nome { font-weight: bold; margin-top: 3mm; }
    .signature .cargo { font-size: 9.5pt; color: #555; }

    /* Footer */
    .footer {
      margin-top: 12mm;
      padding-top: 3mm;
      border-top: 1px solid #ccc;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 8.5pt;
      color: #555;
    }
    .footer .firma { line-height: 1.4; }
    .footer .firma .nome { color: #333; }
    .footer .pag { color: #888; }
  `;

  const secoesHTML = p.secoes.map((s) => `
    <section>
      <h2>${escapeHTML(renderVariaveis(s.titulo, ctx))}</h2>
      <div>${renderVariaveis(s.conteudo, ctx)}</div>
    </section>
  `).join("");

  // Toda a proposta renderiza em uma única "página" lógica — o navegador
  // quebra em páginas físicas conforme o tamanho. As bandas decorativas
  // ficam no topo e fundo da PRIMEIRA página; em propostas de várias páginas
  // o usuário pode usar as bordas do navegador como referência.
  return `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8"><title>${escapeHTML(p.titulo)}</title>
<style>${css}</style></head><body>
  <div class="page">
    <div class="deco-top"></div>

    <header class="header">
      <div class="brand">
        <div class="logo">${logoSvg}</div>
        <div class="text">
          <div class="name">Freire Pignataro</div>
          <div class="sub">— Dantas, Freire, Pignataro, Maciel e Costa —</div>
          <div class="italic">Advogados Associados</div>
        </div>
      </div>
      <div class="meta">
        <div class="row"><span class="ico">📞</span><span>${ESCRITORIO_DEFAULT.telefone}</span></div>
        <div class="row" style="margin-top:2px"><span class="ico">📍</span><span>${escapeHTML(ESCRITORIO_DEFAULT.endereco)}</span></div>
      </div>
    </header>

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

    <footer class="footer">
      <div class="firma">
        <div class="nome">${escapeHTML(ESCRITORIO_DEFAULT.nome)}</div>
        <div>${escapeHTML(ESCRITORIO_DEFAULT.advogado)}</div>
      </div>
      <div class="pag">pág. 1</div>
    </footer>

    <div class="deco-bottom"></div>
  </div>
</body></html>`;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Suprime warning de import não usado quando alguns ícones ficam em rota só pro futuro
void Mail;
