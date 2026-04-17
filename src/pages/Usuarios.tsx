import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Users, Plus, Search, Pencil, Mail, Phone, Shield, UserX } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type AppRole = Database["public"]["Enums"]["app_role"];

interface ProfileWithRoles extends Profile {
  roles: AppRole[];
}

const roleLabel: Record<AppRole, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  advogado: "Advogado",
  comercial: "Comercial",
};

const roleColor: Record<AppRole, string> = {
  admin: "bg-destructive/10 text-destructive",
  gestor: "bg-warning/10 text-warning",
  advogado: "bg-primary/10 text-primary",
  comercial: "bg-info/10 text-info",
};

const ALL_ROLES: AppRole[] = ["admin", "gestor", "advogado", "comercial"];

// Validação alinhada com a edge function (8+ chars, letras + números).
const inviteSchema = z.object({
  nome: z.string().trim().min(2, "Nome obrigatório"),
  email: z.string().trim().toLowerCase().email("Email inválido"),
  password: z
    .string()
    .min(8, "Senha precisa de ao menos 8 caracteres")
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Senha precisa conter letras e números"),
  role: z.enum(["admin", "gestor", "advogado", "comercial"]),
});

export default function Usuarios() {
  const { isAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState<ProfileWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteNome, setInviteNome] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("comercial");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileWithRoles | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editCargo, setEditCargo] = useState("");
  const [editAtivo, setEditAtivo] = useState(true);
  const [editRoles, setEditRoles] = useState<AppRole[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data: profiles, error: e1 }, { data: roles, error: e2 }] = await Promise.all([
      supabase.from("profiles").select("*").order("nome"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (e1 || e2) toast.error("Erro ao carregar usuários");

    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }

    setUsers((profiles ?? []).map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] })));
    setLoading(false);
  };

  // total de admins ativos — usado para prevenir que o sistema fique sem admin
  const totalAdminsAtivos = useMemo(
    () => users.filter((u) => u.ativo && u.roles.includes("admin")).length,
    [users]
  );

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return users;
    return users.filter((u) =>
      u.nome.toLowerCase().includes(s) ||
      u.email.toLowerCase().includes(s) ||
      u.cargo?.toLowerCase().includes(s)
    );
  }, [users, search]);

  const openEdit = (u: ProfileWithRoles) => {
    setEditing(u);
    setEditNome(u.nome);
    setEditTelefone(u.telefone ?? "");
    setEditCargo(u.cargo ?? "");
    setEditAtivo(u.ativo);
    setEditRoles([...u.roles]);
    setEditOpen(true);
  };

  const toggleEditRole = (role: AppRole) => {
    setEditRoles((curr) => curr.includes(role) ? curr.filter((r) => r !== role) : [...curr, role]);
  };

  const saveEdit = async () => {
    if (!editing) return;

    const nome = editNome.trim();
    if (nome.length < 2) return toast.error("Nome é obrigatório");

    // Proteção contra lockout: impede que se remova o último admin do sistema
    // (seja por desmarcar a role, seja por inativar o único admin).
    const eraAdmin = editing.roles.includes("admin");
    const continuaAdmin = editRoles.includes("admin");
    const perdendoAdmin = eraAdmin && !continuaAdmin;
    const inativandoAdmin = eraAdmin && editing.ativo && !editAtivo;
    if ((perdendoAdmin || inativandoAdmin) && totalAdminsAtivos <= 1) {
      return toast.error("Não é possível remover o último administrador ativo do sistema");
    }

    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        nome,
        telefone: editTelefone.trim() || null,
        cargo: editCargo.trim() || null,
        ativo: editAtivo,
      })
      .eq("id", editing.id);
    if (profErr) return toast.error("Erro ao atualizar perfil: " + profErr.message);

    // sync roles: adiciona PRIMEIRO, remove DEPOIS — evita janela em que
    // o usuário fica sem role nenhuma (importante se algum dia aplicarmos
    // policy "pelo menos uma role")
    const toRemove = editing.roles.filter((r) => !editRoles.includes(r));
    const toAdd = editRoles.filter((r) => !editing.roles.includes(r));

    if (toAdd.length) {
      const { error } = await supabase
        .from("user_roles")
        .insert(toAdd.map((role) => ({ user_id: editing.id, role })));
      if (error) return toast.error("Erro ao adicionar papéis: " + error.message);
    }
    if (toRemove.length) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", editing.id)
        .in("role", toRemove);
      if (error) return toast.error("Erro ao remover papéis: " + error.message);
    }

    logAudit({
      tabela: "profiles",
      acao: "Editou usuário",
      registro_id: editing.id,
      detalhes: { nome, roles: editRoles, ativo: editAtivo },
    });
    toast.success("Usuário atualizado");
    setEditOpen(false);
    fetchUsers();
  };

  const handleInvite = async () => {
    const parsed = inviteSchema.safeParse({
      nome: inviteNome,
      email: inviteEmail,
      password: invitePassword,
      role: inviteRole,
    });
    if (!parsed.success) {
      return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("criar-usuario", {
        body: parsed.data,
      });

      if (error) {
        return toast.error("Erro ao criar usuário: " + (error.message ?? "desconhecido"));
      }
      if (data?.error) {
        return toast.error("Erro: " + data.error);
      }
      if (data?.warning) {
        toast.warning(data.warning);
      }

      logAudit({
        tabela: "profiles",
        acao: "Criou usuário",
        registro_id: data?.user_id,
        detalhes: { email: parsed.data.email, role: parsed.data.role },
      });
      toast.success("Usuário criado. Ele pode fazer login com a senha fornecida.");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteNome("");
      setInvitePassword("");
      setInviteRole("comercial");
      fetchUsers();
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="animate-fade-in">
        <Card className="p-8 shadow-card text-center">
          <UserX className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h2 className="font-heading font-semibold text-lg">Acesso restrito</h2>
          <p className="text-muted-foreground text-sm mt-1">Apenas administradores podem gerenciar usuários.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7" />Usuários
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie acessos, papéis e responsabilidades</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />Novo Usuário
        </Button>
      </div>

      <Card className="p-4 shadow-card">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, email ou cargo..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">Carregando...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground shadow-card">
          Nenhum usuário encontrado.
        </Card>
      ) : (
        <Card className="shadow-card">
          <div className="divide-y divide-border">
            {filtered.map((u) => (
              <div key={u.id} className="p-4 flex items-start gap-4 hover:bg-muted/30 transition-colors">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {u.nome.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium">{u.nome || "(sem nome)"}</h3>
                    {!u.ativo && <Badge variant="outline" className="text-[10px]">Inativo</Badge>}
                    {u.id === currentUser?.id && <Badge className="text-[10px] bg-primary/10 text-primary" variant="secondary">Você</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{u.email}</span>
                    {u.telefone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{u.telefone}</span>}
                    {u.cargo && <span>• {u.cargo}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {u.roles.length === 0 ? (
                      <span className="text-[10px] text-muted-foreground italic">sem papel atribuído</span>
                    ) : u.roles.map((r) => (
                      <Badge key={r} className={`text-[10px] ${roleColor[r]}`} variant="secondary">
                        <Shield className="mr-1 h-2.5 w-2.5" />{roleLabel[r]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Criar usuário */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Novo Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={inviteNome} onChange={(e) => setInviteNome(e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="usuario@freirepignataro.com.br" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-password">Senha inicial *</Label>
              <Input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder="Mínimo 8 caracteres, com letras e números"
              />
              <p className="text-[10px] text-muted-foreground">
                Mínimo 8 caracteres, contendo letras e números. Compartilhe com o usuário por um canal seguro.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Papel inicial</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_ROLES.map((r) => (
                  <label key={r} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer ${inviteRole === r ? "bg-primary/10 border-primary" : "border-border"}`}>
                    <input type="radio" className="sr-only" checked={inviteRole === r} onChange={() => setInviteRole(r)} />
                    <Shield className="h-3 w-3" />
                    <span className="text-sm">{roleLabel[r]}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Mais papéis podem ser adicionados após criar o usuário.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button onClick={handleInvite} disabled={creating}>{creating ? "Criando..." : "Criar usuário"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar usuário */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Editar Usuário</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={editNome} onChange={(e) => setEditNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email (não editável)</Label>
                <Input value={editing.email} disabled />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={editTelefone} onChange={(e) => setEditTelefone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cargo</Label>
                  <Input value={editCargo} onChange={(e) => setEditCargo(e.target.value)} placeholder="Ex: Sócio, Associado" />
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-md border">
                <div>
                  <Label className="cursor-pointer">Usuário ativo</Label>
                  <p className="text-[10px] text-muted-foreground">Desative para bloquear o acesso sem apagar o cadastro.</p>
                </div>
                <Switch checked={editAtivo} onCheckedChange={setEditAtivo} />
              </div>
              <div className="space-y-2">
                <Label>Papéis</Label>
                <div className="space-y-1.5">
                  {ALL_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/40 cursor-pointer">
                      <Checkbox checked={editRoles.includes(r)} onCheckedChange={() => toggleEditRole(r)} />
                      <Badge className={`text-[10px] ${roleColor[r]}`} variant="secondary">
                        <Shield className="mr-1 h-2.5 w-2.5" />{roleLabel[r]}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
