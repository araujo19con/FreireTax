import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Paperclip, Download, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";
import { format } from "date-fns";

type Tarefa = Database["public"]["Tables"]["tarefas"]["Row"];
type Subtarefa = Database["public"]["Tables"]["subtarefas"]["Row"];
type Comentario = Database["public"]["Tables"]["tarefa_comentarios"]["Row"] & {
  author_nome?: string;
};
type Anexo = Database["public"]["Tables"]["tarefa_anexos"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileSlim = Pick<Profile, "id" | "nome" | "email">;
type Prioridade = Database["public"]["Enums"]["tarefa_prioridade"];
type Status = Database["public"]["Enums"]["tarefa_status"];

const PRIORIDADES: { value: Prioridade; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

const STATUSES: { value: Status; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

const MAX_ANEXO_BYTES = 10 * 1024 * 1024; // 10 MB

interface TarefaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tarefa?: Tarefa | null;
  defaultAssignedTo?: string;
  defaultEmpresaId?: string;
  defaultProspeccaoId?: string;
  defaultAcaoId?: string;
  onSaved?: () => void;
}

export function TarefaDialog({
  open, onOpenChange, tarefa,
  defaultAssignedTo, defaultEmpresaId, defaultProspeccaoId, defaultAcaoId,
  onSaved,
}: TarefaDialogProps) {
  const { user, profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("media");
  const [status, setStatus] = useState<Status>("pendente");
  const [empresaId, setEmpresaId] = useState<string>("");
  const [prospeccaoId, setProspeccaoId] = useState<string>("");
  const [acaoId, setAcaoId] = useState<string>("");

  const [profiles, setProfiles] = useState<ProfileSlim[]>([]);
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([]);
  const [prospeccoes, setProspeccoes] = useState<{ id: string; contato_nome: string | null }[]>([]);
  const [acoes, setAcoes] = useState<{ id: string; nome: string }[]>([]);

  const [subtarefas, setSubtarefas] = useState<Subtarefa[]>([]);
  const [novaSubtarefa, setNovaSubtarefa] = useState("");

  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [novoComentario, setNovoComentario] = useState("");

  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [uploading, setUploading] = useState(false);

  const [saving, setSaving] = useState(false);

  const tarefaId = tarefa?.id ?? null;

  const loadRelations = useCallback(async () => {
    // busca apenas colunas necessárias: enxuga payload e acelera queries
    const [{ data: p }, { data: e }, { data: pr }, { data: a }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email").eq("ativo", true).order("nome"),
      supabase.from("empresas").select("id, nome").order("nome"),
      supabase.from("prospeccoes").select("id, contato_nome").order("created_at", { ascending: false }),
      supabase.from("acoes_tributarias").select("id, nome").order("nome"),
    ]);
    setProfiles((p ?? []) as ProfileSlim[]);
    setEmpresas(e ?? []);
    setProspeccoes(pr ?? []);
    setAcoes(a ?? []);
  }, []);

  const loadChildren = useCallback(async (id: string) => {
    const [{ data: sub }, { data: com }, { data: anx }] = await Promise.all([
      supabase.from("subtarefas").select("*").eq("tarefa_id", id).order("ordem"),
      supabase.from("tarefa_comentarios").select("*").eq("tarefa_id", id).order("created_at"),
      supabase.from("tarefa_anexos").select("*").eq("tarefa_id", id).order("created_at"),
    ]);
    setSubtarefas(sub ?? []);

    // carregar nomes dos autores dos comentários
    const comList = com ?? [];
    const userIds = [...new Set(comList.map((c) => c.user_id))];
    if (userIds.length) {
      const { data: authors } = await supabase
        .from("profiles")
        .select("id, nome")
        .in("id", userIds);
      const map = new Map<string, string>((authors ?? []).map((a) => [a.id, a.nome ?? "Usuário"]));
      setComentarios(comList.map((c) => ({ ...c, author_nome: map.get(c.user_id) ?? "Usuário" })));
    } else {
      setComentarios([]);
    }
    setAnexos(anx ?? []);
  }, []);

  useEffect(() => {
    if (!open) return;

    // resetar estado ao abrir/mudar a tarefa
    setTitulo(tarefa?.titulo ?? "");
    setDescricao(tarefa?.descricao ?? "");
    setAssignedTo(tarefa?.assigned_to ?? defaultAssignedTo ?? user?.id ?? "");
    setPrazo(tarefa?.prazo ? format(new Date(tarefa.prazo), "yyyy-MM-dd'T'HH:mm") : "");
    setPrioridade(tarefa?.prioridade ?? "media");
    setStatus(tarefa?.status ?? "pendente");
    setEmpresaId(tarefa?.empresa_id ?? defaultEmpresaId ?? "");
    setProspeccaoId(tarefa?.prospeccao_id ?? defaultProspeccaoId ?? "");
    setAcaoId(tarefa?.acao_id ?? defaultAcaoId ?? "");
    setNovoComentario("");
    setNovaSubtarefa("");

    loadRelations();
    if (tarefaId) {
      loadChildren(tarefaId);
    } else {
      setSubtarefas([]);
      setComentarios([]);
      setAnexos([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    tarefaId,
    // propriedades default intencionalmente omitidas: o reset deve disparar
    // apenas quando o diálogo abre ou quando a tarefa muda, não quando o
    // pai re-renderiza com valores default diferentes (isso descartaria
    // edições em andamento).
  ]);

  const handleSave = async () => {
    if (!titulo.trim()) return toast.error("Título é obrigatório");
    if (!user || !profile) return toast.error("Sessão expirada");

    setSaving(true);

    const payload = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      assigned_to: assignedTo || null,
      prazo: prazo ? new Date(prazo).toISOString() : null,
      prioridade,
      status,
      empresa_id: empresaId || null,
      prospeccao_id: prospeccaoId || null,
      acao_id: acaoId || null,
      concluida_em: status === "concluida" ? new Date().toISOString() : null,
    };

    let ok = false;
    try {
      if (tarefaId) {
        const { error } = await supabase.from("tarefas").update(payload).eq("id", tarefaId);
        if (error) {
          toast.error("Erro ao atualizar tarefa: " + error.message);
          return;
        }
        logAudit({ tabela: "tarefas", acao: "Editou tarefa", registro_id: tarefaId, detalhes: { titulo } });
      } else {
        const { data, error } = await supabase
          .from("tarefas")
          .insert({ ...payload, created_by: user.id })
          .select()
          .single();
        if (error) {
          toast.error("Erro ao criar tarefa: " + error.message);
          return;
        }
        logAudit({ tabela: "tarefas", acao: "Criou tarefa", registro_id: data.id, detalhes: { titulo } });
      }
      ok = true;
    } finally {
      setSaving(false);
    }
    if (ok) {
      toast.success(tarefaId ? "Tarefa atualizada" : "Tarefa criada");
      onSaved?.();
      onOpenChange(false);
    }
  };

  const addSubtarefa = async () => {
    if (!tarefaId) return toast.error("Salve a tarefa primeiro para adicionar subtarefas");
    const titulo = novaSubtarefa.trim();
    if (!titulo) return;
    const { data, error } = await supabase.from("subtarefas").insert({
      tarefa_id: tarefaId,
      titulo,
      ordem: subtarefas.length,
    }).select().single();
    if (error) return toast.error("Erro ao adicionar subtarefa");
    setSubtarefas((curr) => [...curr, data]);
    setNovaSubtarefa("");
  };

  const toggleSubtarefa = async (sub: Subtarefa) => {
    const next = !sub.concluida;
    const { error } = await supabase.from("subtarefas").update({ concluida: next }).eq("id", sub.id);
    if (error) return toast.error("Erro ao atualizar");
    setSubtarefas((curr) => curr.map((s) => (s.id === sub.id ? { ...s, concluida: next } : s)));
  };

  const removeSubtarefa = async (id: string) => {
    const { error } = await supabase.from("subtarefas").delete().eq("id", id);
    if (error) return toast.error("Erro ao remover");
    setSubtarefas((curr) => curr.filter((s) => s.id !== id));
  };

  const addComentario = async () => {
    if (!tarefaId) return toast.error("Salve a tarefa primeiro");
    const texto = novoComentario.trim();
    if (!texto || !user) return;
    const { data, error } = await supabase.from("tarefa_comentarios").insert({
      tarefa_id: tarefaId,
      user_id: user.id,
      texto,
    }).select().single();
    if (error) return toast.error("Erro ao comentar");
    setComentarios((curr) => [...curr, { ...data, author_nome: profile?.nome ?? "Você" }]);
    setNovoComentario("");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tarefaId || !user) {
      if (!tarefaId) toast.error("Salve a tarefa primeiro");
      return;
    }
    if (file.size > MAX_ANEXO_BYTES) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return toast.error(`Arquivo muito grande (max ${MAX_ANEXO_BYTES / 1024 / 1024} MB)`);
    }

    setUploading(true);
    // sanitiza nome do arquivo: caracteres não-ASCII/especiais podem quebrar
    // paths de storage em alguns providers
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const path = `${user.id}/${tarefaId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from("tarefa-anexos").upload(path, file);
    if (upErr) {
      setUploading(false);
      return toast.error("Erro ao fazer upload: " + upErr.message);
    }
    const { data, error } = await supabase.from("tarefa_anexos").insert({
      tarefa_id: tarefaId,
      user_id: user.id,
      nome: file.name,
      storage_path: path,
      tamanho_bytes: file.size,
      mime_type: file.type,
    }).select().single();
    setUploading(false);
    if (error) {
      // tenta limpar o arquivo órfão no storage
      await supabase.storage.from("tarefa-anexos").remove([path]).catch(() => undefined);
      return toast.error("Erro ao salvar anexo");
    }
    setAnexos((curr) => [...curr, data]);
    toast.success("Arquivo anexado");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadAnexo = async (anexo: Anexo) => {
    const { data, error } = await supabase.storage.from("tarefa-anexos").createSignedUrl(anexo.storage_path, 60);
    if (error || !data) return toast.error("Erro ao gerar link");
    window.open(data.signedUrl, "_blank");
  };

  const removeAnexo = async (anexo: Anexo) => {
    await supabase.storage.from("tarefa-anexos").remove([anexo.storage_path]);
    const { error } = await supabase.from("tarefa_anexos").delete().eq("id", anexo.id);
    if (error) return toast.error("Erro ao remover");
    setAnexos((curr) => curr.filter((a) => a.id !== anexo.id));
  };

  const initials = (nome: string) => nome.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();

  const progressoSub = subtarefas.length
    ? Math.round((subtarefas.filter((s) => s.concluida).length / subtarefas.length) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{tarefaId ? "Editar Tarefa" : "Nova Tarefa"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="dados" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
            <TabsTrigger value="subtarefas" className="flex-1" disabled={!tarefaId}>
              Subtarefas {subtarefas.length > 0 && `(${progressoSub}%)`}
            </TabsTrigger>
            <TabsTrigger value="comentarios" className="flex-1" disabled={!tarefaId}>
              Comentários {comentarios.length > 0 && `(${comentarios.length})`}
            </TabsTrigger>
            <TabsTrigger value="anexos" className="flex-1" disabled={!tarefaId}>
              Anexos {anexos.length > 0 && `(${anexos.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dados" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Título *</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Revisar contrato da Empresa X" />
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Detalhes, contexto, links..." />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Responsável</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nome || p.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Prazo</Label>
                <Input type="datetime-local" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tarefa-prioridade">Prioridade</Label>
                <Select value={prioridade} onValueChange={(v) => setPrioridade(v as Prioridade)}>
                  <SelectTrigger id="tarefa-prioridade"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORIDADES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tarefa-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger id="tarefa-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label>Vincular a empresa (opcional)</Label>
                <Select value={empresaId || "none"} onValueChange={(v) => setEmpresaId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nenhuma —</SelectItem>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Vincular a prospecção (opcional)</Label>
                <Select value={prospeccaoId || "none"} onValueChange={(v) => setProspeccaoId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nenhuma —</SelectItem>
                    {prospeccoes.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.contato_nome ?? p.id.slice(0, 8)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Vincular a ação tributária (opcional)</Label>
                <Select value={acaoId || "none"} onValueChange={(v) => setAcaoId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nenhuma —</SelectItem>
                    {acoes.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="subtarefas" className="space-y-3 mt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nova subtarefa..."
                value={novaSubtarefa}
                onChange={(e) => setNovaSubtarefa(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addSubtarefa();
                  }
                }}
                aria-label="Nova subtarefa"
              />
              <Button size="sm" type="button" onClick={addSubtarefa} aria-label="Adicionar subtarefa">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {subtarefas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma subtarefa ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {subtarefas.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/40">
                    <Checkbox checked={s.concluida} onCheckedChange={() => toggleSubtarefa(s)} />
                    <span className={`flex-1 text-sm ${s.concluida ? "line-through text-muted-foreground" : ""}`}>{s.titulo}</span>
                    <Button variant="ghost" size="icon" type="button" className="h-7 w-7" onClick={() => removeSubtarefa(s.id)} aria-label={`Remover subtarefa "${s.titulo}"`}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comentarios" className="space-y-3 mt-4">
            <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
              {comentarios.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum comentário ainda.</p>
              ) : comentarios.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-[10px]">{initials(c.author_nome ?? "?")}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 bg-muted/50 rounded-md p-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium">{c.author_nome}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.texto}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Textarea
                rows={2}
                placeholder="Escreva um comentário..."
                value={novoComentario}
                onChange={(e) => setNovoComentario(e.target.value)}
              />
              <Button size="sm" type="button" onClick={addComentario} className="self-end" aria-label="Enviar comentário">
                <Send className="h-3 w-3" />
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="anexos" className="space-y-3 mt-4">
            <div>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Paperclip className="mr-2 h-3 w-3" />
                {uploading ? "Enviando..." : "Anexar arquivo"}
              </Button>
            </div>
            {anexos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum anexo.</p>
            ) : (
              <div className="space-y-1.5">
                {anexos.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-md border">
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 text-sm truncate">{a.nome}</span>
                    <span className="text-[10px] text-muted-foreground">{a.tamanho_bytes ? `${Math.round(a.tamanho_bytes / 1024)} KB` : ""}</span>
                    <Button variant="ghost" size="icon" type="button" className="h-7 w-7" onClick={() => downloadAnexo(a)} aria-label={`Baixar ${a.nome}`}>
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" type="button" className="h-7 w-7" onClick={() => removeAnexo(a)} aria-label={`Remover ${a.nome}`}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : tarefaId ? "Salvar" : "Criar tarefa"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
