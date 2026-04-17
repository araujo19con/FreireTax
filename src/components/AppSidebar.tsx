import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Scale,
  FileCheck,
  Handshake,
  Upload,
  Settings,
  Shield,
  LogOut,
  ClipboardList,
  Calendar,
  Users,
  Scale3d,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

type ItemDef = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  badgeKey?: "tarefas_atrasadas" | "agenda_hoje" | "prosp_parados";
};

const mainItems: ItemDef[] = [
  { title: "Dashboard",         url: "/",              icon: LayoutDashboard },
  { title: "Empresas",          url: "/empresas",      icon: Building2 },
  { title: "Ações Tributárias", url: "/acoes",         icon: Scale },
  { title: "Elegibilidade",     url: "/elegibilidade", icon: FileCheck },
  { title: "Prospecção",        url: "/prospeccao",    icon: Handshake, badgeKey: "prosp_parados" },
  { title: "Importação",        url: "/importacao",    icon: Upload },
];

const workspaceItems: ItemDef[] = [
  { title: "Minhas Tarefas", url: "/minhas-tarefas", icon: ClipboardList, badgeKey: "tarefas_atrasadas" },
  { title: "Minha Agenda",   url: "/minha-agenda",   icon: Calendar,      badgeKey: "agenda_hoje" },
];

const adminItems: ItemDef[] = [
  { title: "Administração", url: "/admin",     icon: Settings },
  { title: "Usuários",      url: "/usuarios",  icon: Users, adminOnly: true },
  { title: "Auditoria",     url: "/auditoria", icon: Shield },
];

type CountState = {
  tarefas_atrasadas: number;
  agenda_hoje: number;
  prosp_parados: number;
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut, profile, user, isAdmin } = useAuth();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const [counts, setCounts] = useState<CountState>({
    tarefas_atrasadas: 0,
    agenda_hoje: 0,
    prosp_parados: 0,
  });

  // Fetch leve de badges — só conta, sem payload. Não bloqueia render.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadCounts = async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const [tarefasRes, agendaRes, prospRes] = await Promise.all([
        // Tarefas atrasadas minhas (pendente/em_andamento com prazo < hoje)
        supabase
          .from("tarefas")
          .select("id", { count: "exact", head: true })
          .eq("assigned_to", user.id)
          .in("status", ["pendente", "em_andamento"])
          .lt("prazo", todayStart),
        // Reuniões minhas para hoje
        supabase
          .from("reunioes")
          .select("id", { count: "exact", head: true })
          .eq("advogado_id", user.id)
          .gte("data_inicio", todayStart)
          .lt("data_inicio", todayEnd),
        // Prospecções paradas ≥7d (ultimo_contato_em < 7 dias atrás, status ativo)
        supabase
          .from("prospeccoes")
          .select("id", { count: "exact", head: true })
          .not("status_prospeccao", "in", "(Contrato assinado,Perdido)")
          .lt("ultimo_contato_em", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      if (cancelled) return;
      setCounts({
        tarefas_atrasadas: tarefasRes.count ?? 0,
        agenda_hoje: agendaRes.count ?? 0,
        prosp_parados: prospRes.count ?? 0,
      });
    };

    loadCounts();
    // Refresh a cada 2 min — não é realtime, mas suficiente pra CRM.
    const id = setInterval(loadCounts, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  const visibleAdminItems = adminItems.filter((item) => !item.adminOnly || isAdmin);

  const renderItem = (item: ItemDef) => {
    const count = item.badgeKey ? counts[item.badgeKey] : 0;
    const showBadge = count > 0 && !collapsed;
    const isAlert = item.badgeKey === "tarefas_atrasadas" || item.badgeKey === "prosp_parados";

    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={isActive(item.url)}
          tooltip={count > 0 ? `${item.title} (${count})` : item.title}
        >
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="hover:bg-sidebar-accent/60"
            activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
          >
            <item.icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {!collapsed && <span className="flex-1">{item.title}</span>}
            {showBadge && (
              <Badge
                variant="secondary"
                className={`ml-auto h-5 min-w-[20px] px-1.5 text-[10px] font-semibold ${
                  isAlert
                    ? "bg-destructive/20 text-destructive border-destructive/30"
                    : "bg-sidebar-primary/20 text-sidebar-primary border-sidebar-primary/30"
                }`}
                aria-label={`${count} ${isAlert ? "pendentes" : "itens"}`}
              >
                {count > 99 ? "99+" : count}
              </Badge>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 rounded-md bg-sidebar-primary/15 border border-sidebar-primary/30 flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Scale3d className="h-4 w-4 text-sidebar-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="font-heading text-[17px] font-bold tracking-tight text-sidebar-foreground leading-none">
                Tax Trakker
              </h1>
              <p className="text-[10px] text-sidebar-foreground/55 mt-1 uppercase tracking-widest">
                Freire Pignataro
              </p>
            </div>
          </div>
        ) : (
          <div
            className="h-8 w-8 mx-auto rounded-md bg-sidebar-primary/15 border border-sidebar-primary/30 flex items-center justify-center"
            aria-label="Tax Trakker"
          >
            <Scale3d className="h-4 w-4 text-sidebar-primary" />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{mainItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">
            Meu Espaço
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{workspaceItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] uppercase tracking-widest">
            Sistema
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{visibleAdminItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        {!collapsed && profile && (
          <div className="mb-2 px-1">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{profile.nome || profile.email}</p>
            <p className="text-[10px] text-sidebar-foreground/50 truncate">{profile.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
          onClick={signOut}
          aria-label="Sair da conta"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          {!collapsed && <span>Sair</span>}
        </Button>
        {!collapsed && (
          <p className="text-[10px] text-sidebar-foreground/30 mt-2 text-center">
            © 2026 Freire Pignataro
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
