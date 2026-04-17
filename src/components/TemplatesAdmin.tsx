import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Variable, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";
import { TEMPLATE_VARS } from "@/lib/templateEngine";

type Template = Database["public"]["Tables"]["templates_mensagem"]["Row"];
type Categoria = Database["public"]["Enums"]["categoria_template"];
type Canal = Database["public"]["Enums"]["canal_contato"];

const CATEGORIAS: { value: Categoria; label: string; color: string }[] = [
  { value: "abertura",       label: "Abertura (1º contato)",   color: "bg-info/10 text-info" },
  { value: "follow_up",      label: "Follow-up",               color: "bg-primary/10 text-primary" },
  { value: "proposta",       label: "Proposta",                color: "bg-warning/10 text-warning" },
  { value: "negociacao",     label: "Negociação",              color: "bg-primary/10 text-primary" },
  { value: "objecao_preco",  label: "Objeção — preço",         color: "bg-destructive/10 text-destructive" },
  { value: "objecao_tese",   label: "Objeção — tese",          color: "bg-destructive/10 text-destructive" },
  { value: "objecao_timing", label: "Objeção — timing",        color: "bg-destructive/10 text-destructive" },
  { value: "breakup",        label: "Breakup (último toque)",  color: "bg-muted text-muted-foreground" },
  { value: "pos_venda",      label: "Pós-venda / Upsell",      color: "bg-success/10 text-success" },
];

const CANAIS: { value: Canal; label: string }[] = [
  { value: "email",              label: "Email" },
  { value: "telefone",           label: "Telefone (script)" },
  { value: "whatsapp",           label: "WhatsApp" },
  { value: "linkedin",           label: "LinkedIn" },
  { value: "reuniao_online",     label: "Reunião Online" },
  { value: "reuniao_presencial", label: "Reunião Presencial" },
  { value: "outro",              label: "Outro" },
];

const categoriaLabel = (c: Categoria) => CATEGORIAS.find((x) => x.value === c)?.label ?? c;
const categoriaColor = (c: Categoria) => CATEGORIAS.find((x) => x.value === c)?.color ?? "";
const canalLabel = (c: Canal) => CANAIS.find((x) => x.value === c)?.label ?? c;

export function TemplatesAdmin() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategoria, setFilterCategoria] = useState<Categoria | "all">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("abertura");
  const [canal, setCanal] = useState<Canal>("email");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("templates_mensagem")
      .select("*")
      .order("categoria")
      .order("nome");
    if (error) toast.error("Erro ao carregar templates");
    setTemplates(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const openCreate = () => {
    setEditing(null);
    setNome("");
    setCategoria("abertura");
    setCanal("email");
    setAssunto("");
    setCorpo("");
    setDescricao("");
    setAtivo(true);
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setNome(t.nome);
    setCategoria(t.categoria);
    setCanal(t.canal);
    setAssunto(t.assunto ?? "");
    setCorpo(t.corpo);
    setDescricao(t.descricao ?? "");
    setAtivo(t.ativo);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) return toast.error("Nome obrigatório");
    if (!corpo.trim()) return toast.error("Corpo do template obrigatório");

    setSaving(true);
    const payload = {
      nome: nome.trim(),
      categoria,
      canal,
      assunto: assunto.trim() || null,
      corpo: corpo.trim(),
      descricao: descricao.trim() || null,
      ativo,
    };

    if (editing) {
      const { error } = await supabase.from("templates_mensagem")
        .update(payload).eq("id", editing.id);
      if (error) { setSaving(false); return toast.error("Erro ao atualizar: " + error.message); }
      logAudit({ tabela: "templates_mensagem", acao: "Editou template", registro_id: editing.id, detalhes: { nome } });
      toast.success("Template atualizado");
    } else {
      const { error } = await supabase.from("templates_mensagem")
        .insert({ ...payload, created_by: user?.id ?? null });
      if (error) { setSaving(false); return toast.error("Erro ao criar: " + error.message); }
      logAudit({ tabela: "templates_mensagem", acao: "Criou template", detalhes: { nome } });
      toast.success("Template criado");
    }
    setSaving(false);
    setDialogOpen(false);
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    const t = templates.find((x) => x.id === id);
    const { error } = await supabase.from("templates_mensagem").delete().eq("id", id);
    if (error) return toast.error("Erro ao remover");
    logAudit({ tabela: "templates_mensagem", acao: "Removeu template", registro_id: id, detalhes: { nome: t?.nome } });
    toast.success("Removido");
    fetchTemplates();
  };

  const insertVar = (key: string) => {
    const token = `{{${key}}}`;
    setCorpo((curr) => curr + token);
  };

  const filtered = useMemo(() => {
    let items = templates;
    if (filterCategoria !== "all") items = items.filter((t) => t.categoria === filterCategoria);
    if (search.trim()) {
      const s = search.toLowerCase();
      items = items.filter((t) =>
        t.nome.toLowerCase().includes(s) ||
        t.corpo.toLowerCase().includes(s) ||
        (t.descricao?.toLowerCase().includes(s) ?? false)
      );
    }
    return items;
  }, [templates, filterCategoria, search]);

  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of templates) m[t.categoria] = (m[t.categoria] ?? 0) + 1;
    return m;
  }, [templates]);

  return (
    <Card className="shadow-card p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-heading font-semibold">Templates de Mensagem</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scripts prontos para abordagem, follow-up, objeções e pós-venda. Variáveis entre <code className="text-primary">{"{{chaves}}"}</code>.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-2 h-3 w-3" />Novo Template
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, corpo, descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={filterCategoria} onValueChange={(v) => setFilterCategoria(v as Categoria | "all")}>
          <SelectTrigger className="w-60 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias ({templates.length})</SelectItem>
            {CATEGORIAS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label} {countByCat[c.value] ? `(${countByCat[c.value]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {templates.length === 0
            ? "Nenhum template cadastrado. Criar o primeiro destrava o time comercial."
            : "Nenhum template encontrado com esse filtro."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={t.id} className="p-3 rounded-md border border-border hover:bg-muted/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm">{t.nome}</span>
                    <Badge variant="secondary" className={`text-[10px] ${categoriaColor(t.categoria)}`}>
                      {categoriaLabel(t.categoria)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{canalLabel(t.canal)}</Badge>
                    {!t.ativo && (
                      <Badge variant="outline" className="text-[10px] bg-muted">
                        <EyeOff className="h-2.5 w-2.5 mr-1" />inativo
                      </Badge>
                    )}
                  </div>
                  {t.assunto && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">
                      <strong>Assunto:</strong> {t.assunto}
                    </p>
                  )}
                  {t.descricao && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{t.descricao}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)} aria-label="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label="Excluir">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover template?</AlertDialogTitle>
                        <AlertDialogDescription>
                          "{t.nome}" será apagado permanentemente. O time não conseguirá mais usá-lo.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(t.id)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog Create/Edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editing ? "Editar Template" : "Novo Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Nome *</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Abertura fria — CFO com urgência de prescrição" />
              </div>

              <div className="space-y-1.5">
                <Label>Categoria *</Label>
                <Select value={categoria} onValueChange={(v) => setCategoria(v as Categoria)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Canal *</Label>
                <Select value={canal} onValueChange={(v) => setCanal(v as Canal)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CANAIS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assunto (apenas email)</Label>
              <Input
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                placeholder="Ex: {{empresa}} pode ter {{valor_potencial}} a recuperar"
                disabled={canal !== "email"}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Corpo *</Label>
              <Textarea
                rows={10}
                value={corpo}
                onChange={(e) => setCorpo(e.target.value)}
                placeholder="Texto do template. Use {{variavel}} para substituições."
                className="font-mono text-xs"
              />

              {/* Variáveis clicáveis */}
              <div className="flex items-center gap-1 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Variable className="h-3 w-3" />Variáveis:
                </span>
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVar(v.key)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary transition-colors font-mono"
                    title={v.label}
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição interna (opcional)</Label>
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex: Usar quando já teve 2 toques sem resposta"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <Label className="cursor-pointer">Template ativo</Label>
                <p className="text-[10px] text-muted-foreground">Inativos não aparecem no seletor da prospecção.</p>
              </div>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
