import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy,
  CheckCircle2,
  MessageSquareText,
  Mail,
  Phone,
  MessageCircle,
  Linkedin,
  Video,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { applyTemplate, type TemplateVars } from "@/lib/templateEngine";

type Template = Database["public"]["Tables"]["templates_mensagem"]["Row"];
type Categoria = Database["public"]["Enums"]["categoria_template"];
type Canal = Database["public"]["Enums"]["canal_contato"];

const CATEGORIAS: { value: Categoria | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "abertura", label: "Abertura" },
  { value: "follow_up", label: "Follow-up" },
  { value: "proposta", label: "Proposta" },
  { value: "negociacao", label: "Negociação" },
  { value: "objecao_preco", label: "Obj: preço" },
  { value: "objecao_tese", label: "Obj: tese" },
  { value: "objecao_timing", label: "Obj: timing" },
  { value: "breakup", label: "Breakup" },
  { value: "pos_venda", label: "Pós-venda" },
];

const CANAIS_ICONS: Record<Canal, typeof Mail> = {
  email: Mail,
  telefone: Phone,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
  reuniao_online: Video,
  reuniao_presencial: MapPin,
  outro: MessageSquareText,
};

const CANAL_LABELS: Record<Canal, string> = {
  email: "Email",
  telefone: "Telefone",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  reuniao_online: "Reunião Online",
  reuniao_presencial: "Reunião Presencial",
  outro: "Outro",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vars: TemplateVars; // variáveis disponíveis no contexto atual
  initialCategoria?: Categoria;
  /** Restringe a lista a um canal específico (ex: "linkedin"). Sem isso, mostra todos. */
  canalFiltro?: Canal;
  /** Quando setado, mostra o botão "Copiar e abrir LinkedIn" — copia a mensagem
   *  e abre o perfil numa aba nova. O envio em si continua manual (colar +
   *  enviar dentro do LinkedIn): a plataforma não permite pré-preencher a
   *  mensagem via link, e automatizar o clique de enviar violaria os termos
   *  de uso do LinkedIn (risco real de suspensão de conta). */
  linkedinProfileUrl?: string | null;
}

export function TemplateSelectorDialog({
  open,
  onOpenChange,
  vars,
  initialCategoria,
  canalFiltro,
  linkedinProfileUrl,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoria, setCategoria] = useState<Categoria | "all">("all");
  const [selected, setSelected] = useState<Template | null>(null);
  const [previewCorpo, setPreviewCorpo] = useState("");
  const [previewAssunto, setPreviewAssunto] = useState("");
  const [copiedField, setCopiedField] = useState<"assunto" | "corpo" | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoria(initialCategoria ?? "all");
    setSelected(null);
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("templates_mensagem")
        .select("*")
        .eq("ativo", true)
        .order("categoria")
        .order("nome");
      if (error) toast.error("Erro ao carregar templates");
      setTemplates(data ?? []);
      setLoading(false);
    })();
  }, [open, initialCategoria]);

  const porCanal = useMemo(
    () => (canalFiltro ? templates.filter((t) => t.canal === canalFiltro) : templates),
    [templates, canalFiltro]
  );
  const filtered = useMemo(() => {
    if (categoria === "all") return porCanal;
    return porCanal.filter((t) => t.categoria === categoria);
  }, [porCanal, categoria]);

  // quando seleciona um template, aplica variáveis ao corpo e assunto
  useEffect(() => {
    if (!selected) {
      setPreviewCorpo("");
      setPreviewAssunto("");
      return;
    }
    setPreviewCorpo(applyTemplate(selected.corpo, vars));
    setPreviewAssunto(selected.assunto ? applyTemplate(selected.assunto, vars) : "");
  }, [selected, vars]);

  const copiar = async (field: "assunto" | "corpo") => {
    const text = field === "corpo" ? previewCorpo : previewAssunto;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field === "corpo" ? "Corpo" : "Assunto"} copiado`);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      toast.error("Não foi possível copiar (verifique permissões)");
    }
  };

  const copiarTudo = async () => {
    if (!selected) return;
    const txt = previewAssunto ? `Assunto: ${previewAssunto}\n\n${previewCorpo}` : previewCorpo;
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Template completo copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const countByCat = useMemo(() => {
    const m: Record<string, number> = { all: porCanal.length };
    for (const t of porCanal) m[t.categoria] = (m[t.categoria] ?? 0) + 1;
    return m;
  }, [porCanal]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <MessageSquareText className="h-5 w-5" />
            Templates de Mensagem
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Selecione o template, aplique as variáveis da prospecção e copie pro email/WhatsApp.
          </p>
        </DialogHeader>

        {/* Filtro de categoria */}
        <Tabs value={categoria} onValueChange={(v) => setCategoria(v as Categoria | "all")}>
          <TabsList className="h-auto flex-wrap">
            {CATEGORIAS.map((c) => (
              <TabsTrigger key={c.value} value={c.value} className="text-xs">
                {c.label}
                {countByCat[c.value] ? (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                    {countByCat[c.value]}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Lista de templates */}
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {loading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Carregando...</p>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum template nessa categoria. Crie um em Admin → Templates.
              </p>
            ) : (
              filtered.map((t) => {
                const Icon = CANAIS_ICONS[t.canal] ?? MessageSquareText;
                const isSel = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelected(t)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      isSel
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-muted/40"
                    }`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium">{t.nome}</span>
                      <Badge
                        variant="outline"
                        className="flex flex-shrink-0 items-center gap-1 text-[9px]"
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {CANAL_LABELS[t.canal]}
                      </Badge>
                    </div>
                    {t.descricao && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        {t.descricao}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Preview + copy */}
          <div className="space-y-3">
            {!selected ? (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                Selecione um template à esquerda para ver o preview com as variáveis preenchidas.
              </div>
            ) : (
              <>
                {selected.assunto && (
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium">
                      Assunto
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-5 w-5"
                        onClick={() => void copiar("assunto")}
                        title="Copiar assunto"
                      >
                        {copiedField === "assunto" ? (
                          <CheckCircle2 className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </label>
                    <Input value={previewAssunto} readOnly className="text-xs" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    Corpo
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-5 w-5"
                      onClick={() => void copiar("corpo")}
                      title="Copiar corpo"
                    >
                      {copiedField === "corpo" ? (
                        <CheckCircle2 className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </label>
                  <Textarea value={previewCorpo} readOnly rows={14} className="font-mono text-xs" />
                </div>
                <Button onClick={() => void copiarTudo()} size="sm" className="w-full">
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copiar tudo (assunto + corpo)
                </Button>
                {linkedinProfileUrl && (
                  <Button
                    onClick={() => {
                      void copiarTudo();
                      window.open(linkedinProfileUrl, "_blank", "noopener,noreferrer");
                    }}
                    size="sm"
                    variant="outline"
                    className="w-full border-[#0a66c2] text-[#0a66c2] hover:bg-[#0a66c2]/10 hover:text-[#0a66c2]"
                    title="Copia a mensagem e abre o perfil — colar e enviar é manual (o LinkedIn não permite pré-preencher DM nem automatizar o envio)"
                  >
                    <Linkedin className="mr-2 h-3.5 w-3.5" />
                    Copiar e abrir LinkedIn
                    <ExternalLink className="ml-2 h-3 w-3 opacity-60" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
