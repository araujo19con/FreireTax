import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FileText, Plus, Pencil, Trash2, ArrowUp, ArrowDown, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useAcoes } from "@/hooks/useAcoes";
import {
  usePropostaTemplates, useCreatePropostaTemplate,
  useUpdatePropostaTemplate, useDeletePropostaTemplate,
  type PropostaTemplate, type TemplateInput,
} from "@/hooks/usePropostas";
import type { ProposalSection } from "@/lib/proposta";
import { toast } from "sonner";

interface PropostasTemplatesProps {
  embedded?: boolean;
}

export default function PropostasTemplates({ embedded = false }: PropostasTemplatesProps = {}) {
  const tplsQ = usePropostaTemplates({ apenasAtivos: false });
  const acoesQ = useAcoes();
  const createT = useCreatePropostaTemplate();
  const updateT = useUpdatePropostaTemplate();
  const deleteT = useDeletePropostaTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PropostaTemplate | null>(null);

  const templates = tplsQ.data ?? [];
  const acoes = acoesQ.data ?? [];

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (t: PropostaTemplate) => { setEditing(t); setDialogOpen(true); };

  const novoBtn = (
    <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Novo template</Button>
  );

  return (
    <div className={embedded ? "space-y-4" : "space-y-6 animate-fade-in"}>
      {!embedded && (
        <PageHeader
          title="Templates de Proposta"
          description="Modelos de proposta comercial reutilizáveis. Use {{variáveis}} para preencher automaticamente com dados da prospecção."
          icon={<FileText className="h-7 w-7" />}
          actions={novoBtn}
        />
      )}
      {embedded && (
        <div className="flex items-center justify-end">{novoBtn}</div>
      )}

      {tplsQ.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum template cadastrado"
          description="Templates aceleram a criação de propostas — defina seções, variáveis e formate uma vez para reutilizar em todas as oportunidades. Os 2 exemplos (Lucro Presumido + Diagnóstico) deveriam vir da migration; se não estão aqui, rode a migration no Supabase."
          action={{ label: "Criar primeiro template", icon: Plus, onClick: openNew }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => {
            const acao = acoes.find((a) => a.id === t.acao_id);
            return (
              <Card key={t.id} className="p-4 shadow-card hover:shadow-elevated transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm truncate">{t.nome}</h3>
                    {t.tipo_servico && (
                      <p className="text-[11px] text-muted-foreground">{t.tipo_servico}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remover template "{t.nome}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Propostas já criadas a partir deste template não são afetadas.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteT.mutate(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remover
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                {t.descricao && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t.descricao}</p>
                )}
                <div className="mt-3 flex items-center flex-wrap gap-1.5 text-[11px] border-t border-border pt-3">
                  {acao
                    ? <Badge variant="outline" className="text-[10px]">{acao.nome}</Badge>
                    : <Badge variant="outline" className="text-[10px] text-muted-foreground">Genérico (qualquer ação)</Badge>}
                  <Badge variant="secondary" className="text-[10px]">
                    {(Array.isArray(t.secoes) ? t.secoes.length : 0)} seções
                  </Badge>
                  {t.valor_entrada_default != null && (
                    <Badge variant="outline" className="text-[10px]">Entrada: R$ {Number(t.valor_entrada_default).toLocaleString("pt-BR")}</Badge>
                  )}
                  {t.percentual_exito_default != null && (
                    <Badge variant="outline" className="text-[10px]">Êxito: {t.percentual_exito_default}%</Badge>
                  )}
                  {!t.ativo && <Badge className="text-[10px] bg-muted text-muted-foreground">inativo</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        template={editing}
        acoes={acoes}
        onCreate={async (data) => { await createT.mutateAsync(data); setDialogOpen(false); }}
        onUpdate={async (id, data) => { await updateT.mutateAsync({ id, data }); setDialogOpen(false); }}
      />
    </div>
  );
}

// =========================================================================
// FORM
// =========================================================================
interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  template: PropostaTemplate | null;
  acoes: Array<{ id: string; nome: string }>;
  onCreate: (d: Partial<TemplateInput>) => Promise<void>;
  onUpdate: (id: string, d: Partial<TemplateInput>) => Promise<void>;
}

function TemplateFormDialog({ open, onClose, template, acoes, onCreate, onUpdate }: FormDialogProps) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipoServico, setTipoServico] = useState("");
  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [valorEntradaDefault, setValorEntradaDefault] = useState("");
  const [percentualExitoDefault, setPercentualExitoDefault] = useState("");
  const [textoDestinatario, setTextoDestinatario] = useState("");
  const [docxTemplatePath, setDocxTemplatePath] = useState("");
  const [secoes, setSecoes] = useState<ProposalSection[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (!open) return;
    setNome(template?.nome ?? "");
    setDescricao(template?.descricao ?? "");
    setTipoServico(template?.tipo_servico ?? "");
    setAcaoId(template?.acao_id ?? null);
    setValorEntradaDefault(template?.valor_entrada_default?.toString() ?? "");
    setPercentualExitoDefault(template?.percentual_exito_default?.toString() ?? "");
    setTextoDestinatario(template?.texto_destinatario_default ?? "");
    setDocxTemplatePath(template?.docx_template_path ?? "/template-proposta-padrao.docx");
    setSecoes(template?.secoes ?? []);
    setAtivo(template?.ativo ?? true);
    setActiveIdx(0);
  }, [open, template?.id]);

  const addSecao = () => {
    setSecoes((curr) => [...curr, {
      ordem: curr.length,
      titulo: `${curr.length + 1}. NOVA SEÇÃO`,
      conteudo: "<p></p>",
    }]);
    setActiveIdx(secoes.length);
  };
  const removeSecao = (idx: number) => {
    setSecoes((curr) => curr.filter((_, i) => i !== idx).map((s, i) => ({ ...s, ordem: i })));
    setActiveIdx((c) => Math.max(0, Math.min(c, secoes.length - 2)));
  };
  const moveSecao = (idx: number, dir: -1 | 1) => {
    setSecoes((curr) => {
      const next = [...curr];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return curr;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((s, i) => ({ ...s, ordem: i }));
    });
    setActiveIdx(idx + dir);
  };
  const updateSecao = (idx: number, patch: Partial<ProposalSection>) => {
    setSecoes((curr) => curr.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const handleSubmit = async () => {
    if (!nome.trim()) { toast.error("Nome é obrigatório"); return; }
    const data: Partial<TemplateInput> = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      tipo_servico: tipoServico.trim() || null,
      acao_id: acaoId,
      secoes,
      valor_entrada_default: valorEntradaDefault ? Number(valorEntradaDefault) : null,
      percentual_exito_default: percentualExitoDefault ? Number(percentualExitoDefault) : null,
      texto_destinatario_default: textoDestinatario.trim() || null,
      docx_template_path: docxTemplatePath.trim() || null,
      ativo,
    };
    if (template) await onUpdate(template.id, data);
    else await onCreate(data);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{template ? "Editar template" : "Novo template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Lucro Presumido (LC 224)" />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de serviço</Label>
              <Input value={tipoServico} onChange={(e) => setTipoServico(e.target.value)} placeholder="Ex: Diagnóstico Fiscal" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição (interna)</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Pra time identificar o uso do template" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Ação vinculada</Label>
              <Select value={acaoId ?? "_none"} onValueChange={(v) => setAcaoId(v === "_none" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— genérico (qualquer ação) —</SelectItem>
                  {acoes.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Entrada default (R$)</Label>
              <Input type="number" inputMode="decimal" value={valorEntradaDefault} onChange={(e) => setValorEntradaDefault(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Êxito default (%)</Label>
              <Input type="number" inputMode="decimal" value={percentualExitoDefault} onChange={(e) => setPercentualExitoDefault(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Introdução padrão</Label>
            <Textarea
              rows={2}
              value={textoDestinatario}
              onChange={(e) => setTextoDestinatario(e.target.value)}
              placeholder="Texto que aparece logo após o destinatário"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Caminho do template Word (.docx)</Label>
            <Input
              value={docxTemplatePath}
              onChange={(e) => setDocxTemplatePath(e.target.value)}
              placeholder="/template-proposta-padrao.docx"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Caminho do .docx oficial (com timbrado e formatação) usado pelo botão "Baixar Word".
              Default: <code>/template-proposta-padrao.docx</code> (em <code>/public</code>).
              Placeholders aceitos: <code>{`{empresa_nome}`}</code>, <code>{`{contato_nome}`}</code>, <code>{`{titulo_proposta}`}</code>, <code>{`{introducao}`}</code>, <code>{`{honorarios_entrada}`}</code>, <code>{`{honorarios_exito}`}</code>, <code>{`{signatario_nome}`}</code>, <code>{`{data_proposta}`}</code>, e loop <code>{`{#secoes}{titulo}\\n{conteudo_texto}{/secoes}`}</code>.
            </p>
          </div>

          {/* Seções */}
          <div className="border border-border rounded-md">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-sm font-medium">Seções do template</span>
              <Button type="button" variant="outline" size="sm" onClick={addSecao}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />Adicionar seção
              </Button>
            </div>
            {secoes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma seção. Clique em "Adicionar seção".
              </p>
            ) : (
              <div className="grid grid-cols-[200px_1fr] divide-x divide-border min-h-[300px]">
                <div className="overflow-y-auto max-h-[400px]">
                  {secoes.map((s, i) => (
                    <button
                      key={i} type="button" onClick={() => setActiveIdx(i)}
                      className={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-muted/50 transition-colors ${
                        activeIdx === i ? "bg-primary/10 text-primary font-medium" : ""
                      }`}
                    >
                      <div className="truncate">{s.titulo || `Seção ${i + 1}`}</div>
                    </button>
                  ))}
                </div>
                {secoes[activeIdx] && (
                  <div className="p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={secoes[activeIdx].titulo}
                        onChange={(e) => updateSecao(activeIdx, { titulo: e.target.value })}
                        placeholder="Título da seção"
                        className="font-medium"
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveSecao(activeIdx, -1)} disabled={activeIdx === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => moveSecao(activeIdx, 1)} disabled={activeIdx === secoes.length - 1}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-destructive hover:text-destructive" onClick={() => removeSecao(activeIdx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <RichTextEditor
                      value={secoes[activeIdx].conteudo}
                      onChange={(html) => updateSecao(activeIdx, { conteudo: html })}
                      minHeight="240px"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Template ativo (aparece nos seletores ao criar proposta)
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit}>{template ? "Salvar" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
