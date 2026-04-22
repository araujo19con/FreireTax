import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

export type TipoResposta = "boolean" | "date" | "number" | "text" | "select";

// Re-export do shape de regra de exclusão (definido em src/lib/criterios.ts
// pra evitar ciclo de imports)
import type { RegraExcludente } from "@/lib/criterios";
export type { RegraExcludente };

export interface Criterio {
  id: string;
  acao_id: string;
  ordem: number;
  pergunta: string;
  descricao: string | null;
  tipo_resposta: TipoResposta;
  opcoes: string[] | null;
  eh_excludente: boolean;
  /** Regra granular de exclusão por tipo. NULL = legacy (answerIsPositive). */
  regra_excludente: RegraExcludente | null;
  peso: number;
  formula_valor: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type CriterioInput = Omit<Criterio, "id" | "user_id" | "created_at" | "updated_at">;

// Tabela ainda não está nos types gerados — usamos escape via any em supabase.from().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase.from as any)("criterios_elegibilidade");

export function useCriterios(acaoId?: string) {
  return useQuery({
    queryKey: ["criterios", acaoId ?? "all"],
    queryFn: async () => {
      const base = table().select("*").order("ordem", { ascending: true });
      const { data, error } = await (acaoId ? base.eq("acao_id", acaoId) : base);
      if (error) throw error;
      return (data || []) as Criterio[];
    },
  });
}

export function useCreateCriterio() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<CriterioInput>) => {
      const payload = { ...input, user_id: user!.id };
      const { data, error } = await table().insert(payload).select().single();
      if (error) throw error;
      await logAudit({ tabela: "criterios_elegibilidade", acao: "Criou critério", registro_id: data.id, detalhes: { pergunta: input.pergunta } });
      return data as Criterio;
    },
    onSuccess: () => {
      toast.success("Critério criado");
      qc.invalidateQueries({ queryKey: ["criterios"] });
    },
    onError: (err) => toast.error("Erro ao criar critério: " + (err?.message ?? "falha")),
  });
}

export function useUpdateCriterio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CriterioInput> }) => {
      const { error } = await table().update(data).eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "criterios_elegibilidade", acao: "Editou critério", registro_id: id, detalhes: { pergunta: data.pergunta } });
    },
    onSuccess: () => {
      toast.success("Critério atualizado");
      qc.invalidateQueries({ queryKey: ["criterios"] });
    },
    onError: (err) => toast.error("Erro ao atualizar: " + (err?.message ?? "falha")),
  });
}

export function useDeleteCriterio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await table().delete().eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "criterios_elegibilidade", acao: "Removeu critério", registro_id: id });
    },
    onSuccess: () => {
      toast.success("Critério removido");
      qc.invalidateQueries({ queryKey: ["criterios"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}

export function useReorderCriterios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Array<{ id: string; ordem: number }>) => {
      // Upsert em lote: cada critério mantém todos os campos, só muda ordem.
      // Mais simples: fazer updates individuais serializados.
      for (const u of updates) {
        const { error } = await table().update({ ordem: u.ordem }).eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["criterios"] }),
    onError: (err) => toast.error("Erro ao reordenar: " + (err?.message ?? "falha")),
  });
}
