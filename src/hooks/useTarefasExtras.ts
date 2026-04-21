import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

// As tabelas novas não estão ainda nos types gerados; usamos cast pontual.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyTable = (name: string) => (supabase.from as any)(name);

// =========================================================================
// TEMPLATES DE TAREFA
// =========================================================================
export interface TarefaTemplate {
  id: string;
  nome: string;
  categoria: string | null;
  titulo_padrao: string;
  descricao_padrao: string | null;
  prioridade_padrao: "urgente" | "alta" | "media" | "baixa" | null;
  prazo_relativo_dias: number | null;
  subtarefas_padrao: Array<{ titulo: string; ordem: number }> | null;
  acao_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type TemplateInput = Omit<TarefaTemplate, "id" | "user_id" | "created_at" | "updated_at">;

export function useTarefasTemplates() {
  return useQuery({
    queryKey: ["tarefas_templates"],
    queryFn: async () => {
      const { data, error } = await anyTable("tarefas_templates")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data || []) as TarefaTemplate[];
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<TemplateInput>) => {
      const { data, error } = await anyTable("tarefas_templates")
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      await logAudit({ tabela: "tarefas_templates", acao: "Criou template", registro_id: data.id, detalhes: { nome: input.nome } });
      return data;
    },
    onSuccess: () => {
      toast.success("Template criado");
      qc.invalidateQueries({ queryKey: ["tarefas_templates"] });
    },
    onError: (err) => toast.error("Erro ao criar template: " + (err?.message ?? "falha")),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyTable("tarefas_templates").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "tarefas_templates", acao: "Removeu template", registro_id: id });
    },
    onSuccess: () => {
      toast.success("Template removido");
      qc.invalidateQueries({ queryKey: ["tarefas_templates"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}


// =========================================================================
// DEPENDÊNCIAS ENTRE TAREFAS
// =========================================================================
export interface Dependencia {
  id: string;
  tarefa_id: string;
  depende_de_id: string;
  created_at: string;
}

export function useDependencias(tarefaId: string | undefined) {
  return useQuery({
    queryKey: ["dependencias", tarefaId],
    enabled: !!tarefaId,
    queryFn: async () => {
      if (!tarefaId) return [] as Dependencia[];
      const { data, error } = await anyTable("tarefas_dependencias")
        .select("*")
        .eq("tarefa_id", tarefaId);
      if (error) throw error;
      return (data || []) as Dependencia[];
    },
  });
}

export function useAddDependencia() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ tarefaId, dependeDeId }: { tarefaId: string; dependeDeId: string }) => {
      const { error } = await anyTable("tarefas_dependencias").insert({
        tarefa_id: tarefaId,
        depende_de_id: dependeDeId,
        user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, { tarefaId }) => {
      toast.success("Dependência adicionada");
      qc.invalidateQueries({ queryKey: ["dependencias", tarefaId] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}

export function useRemoveDependencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, tarefaId }: { id: string; tarefaId: string }) => {
      void tarefaId;
      const { error } = await anyTable("tarefas_dependencias").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { tarefaId }) => {
      qc.invalidateQueries({ queryKey: ["dependencias", tarefaId] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}


// =========================================================================
// TIME TRACKING
// =========================================================================
export interface TempoEntry {
  id: string;
  tarefa_id: string;
  user_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_sec: number | null;
  nota: string | null;
}

export function useTempo(tarefaId: string | undefined) {
  return useQuery({
    queryKey: ["tarefas_tempo", tarefaId],
    enabled: !!tarefaId,
    queryFn: async () => {
      if (!tarefaId) return [] as TempoEntry[];
      const { data, error } = await anyTable("tarefas_tempo")
        .select("*")
        .eq("tarefa_id", tarefaId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data || []) as TempoEntry[];
    },
  });
}

/** Retorna entrada em aberto do usuário atual (se houver timer rodando globalmente). */
export function useTempoEmAndamento() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tarefas_tempo", "running", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await anyTable("tarefas_tempo")
        .select("*")
        .eq("user_id", user.id)
        .is("stopped_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const arr = (data || []) as TempoEntry[];
      return arr[0] ?? null;
    },
  });
}

export function useStartTempo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (tarefaId: string) => {
      // Fecha qualquer timer pendente do mesmo usuário
      await anyTable("tarefas_tempo")
        .update({ stopped_at: new Date().toISOString() })
        .eq("user_id", user!.id)
        .is("stopped_at", null);

      const { data, error } = await anyTable("tarefas_tempo")
        .insert({
          tarefa_id: tarefaId,
          user_id: user!.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data as TempoEntry;
    },
    onSuccess: (_, tarefaId) => {
      toast.success("Timer iniciado");
      qc.invalidateQueries({ queryKey: ["tarefas_tempo", tarefaId] });
      qc.invalidateQueries({ queryKey: ["tarefas_tempo", "running"] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}

export function useStopTempo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nota }: { id: string; nota?: string }) => {
      const { error } = await anyTable("tarefas_tempo")
        .update({
          stopped_at: new Date().toISOString(),
          nota: nota ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Timer parado");
      qc.invalidateQueries({ queryKey: ["tarefas_tempo"] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}


// =========================================================================
// VIEWS SALVAS
// =========================================================================
export interface ViewSalva {
  id: string;
  nome: string;
  filtros: Record<string, unknown>;
  eh_padrao: boolean;
  created_at: string;
}

export function useViewsSalvas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tarefas_views_salvas", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as ViewSalva[];
      const { data, error } = await anyTable("tarefas_views_salvas")
        .select("*")
        .eq("user_id", user.id)
        .order("nome");
      if (error) throw error;
      return (data || []) as ViewSalva[];
    },
  });
}

export function useCreateViewSalva() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ nome, filtros }: { nome: string; filtros: Record<string, unknown> }) => {
      const { error } = await anyTable("tarefas_views_salvas")
        .insert({ nome, filtros, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("View salva");
      qc.invalidateQueries({ queryKey: ["tarefas_views_salvas"] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}

export function useDeleteViewSalva() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await anyTable("tarefas_views_salvas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("View removida");
      qc.invalidateQueries({ queryKey: ["tarefas_views_salvas"] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}
