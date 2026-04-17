import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, CheckCircle2, MessageSquareText, Mail, Phone, MessageCircle, Linkedin, Video, MapPin } from "lucide-react";
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
  vars: TemplateVars;           // variáveis disponíveis no contexto atual
  initialCategoria?: Categoria;
}

export function TemplateSelectorDialog({ open, onOpenChange, vars, initialCategoria }: Props) {
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

  const filtered = useMemo(() => {
    if (categoria === "all") return templates;
    return templates.filter((t) => t.categoria === categoria);
  }, [templates, categoria]);

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
    const txt = previewAssunto
      ? `Assunto: ${previewAssunto}\n\n${previewCorpo}`
      : previewCorpo;
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Template completo copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const countByCat = useMemo(() => {
    const m: Record<string, number> = { all: templates.length };
    for (const t of templates) m[t.categoria] = (m[t.categoria] ?? 0) + 1;
    return m;
  }, [templates]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <MessageSquareText className="h-5 w-5" />
            Templates de Mensagem
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Selecione o template, aplique as variáveis da prospecção e copie pro email/WhatsApp.
          </p>
        </DialogHeader>

        {/* Filtro de categoria */}
        <Tabs value={categoria} onValueChange={(v) => setCategoria(v as Categoria | "all")}>
          <TabsList className="flex-wrap h-auto">
            {CATEGORIAS.map((c) => (
              <TabsTrigger key={c.value} value={c.value} className="text-xs">
                {c.label}
                {countByCat[c.value] ? (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">{countByCat[c.value]}</Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lista de templates */}
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
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
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      isSel
                        ? "bg-primary/10 border-primary"
                        : "bg-card border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-medium line-clamp-1">{t.nome}</span>
                      <Badge variant="outline" className="text-[9px] flex items-center gap-1 flex-shrink-0">
                        <Icon className="h-2.5 w-2.5" />
                        {CANAL_LABELS[t.canal]}
                      </Badge>
                    </div>
                    {t.descricao && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{t.descricao}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Preview + copy */}
          <div className="space-y-3">
            {!selected ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground border border-dashed rounded-md p-8 text-center">
                Selecione um template à esquerda para ver o preview com as variáveis preenchidas.
              </div>
            ) : (
              <>
                {selected.assunto && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium flex items-center gap-1.5">
                      Assunto
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-auto"
                        onClick={() => copiar("assunto")}
                        title="Copiar assunto"
                      >
                        {copiedField === "assunto" ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </label>
                    <Input value={previewAssunto} readOnly className="text-xs" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    Corpo
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-auto"
                      onClick={() => copiar("corpo")}
                      title="Copiar corpo"
                    >
                      {copiedField === "corpo" ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </label>
                  <Textarea
                    value={previewCorpo}
                    readOnly
                    rows={14}
                    className="text-xs font-mono"
                  />
                </div>
                <Button onClick={copiarTudo} size="sm" className="w-full">
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copiar tudo (assunto + corpo)
                </Button>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
