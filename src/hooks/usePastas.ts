import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface Pasta {
  id: string;
  nome: string;
}

export interface PastaItem {
  pasta_id: string;
  empresa_id: string;
}

export function usePastas() {
  return useQuery({
    queryKey: ["pastas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pastas_empresas")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data || []) as Pasta[];
    },
  });
}

export function usePastaItems() {
  return useQuery({
    queryKey: ["pasta_empresa_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pasta_empresa_items")
        .select("pasta_id, empresa_id");
      if (error) throw error;
      return (data || []) as PastaItem[];
    },
  });
}

export function useCreatePasta() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await supabase
        .from("pastas_empresas")
        .insert({ nome: nome.trim(), user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pasta criada");
      qc.invalidateQueries({ queryKey: ["pastas"] });
    },
    onError: (err) => toast.error("Erro ao criar pasta: " + (err?.message ?? "falha")),
  });
}

export function useDeletePasta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pastas_empresas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pasta removida");
      qc.invalidateQueries({ queryKey: ["pastas"] });
      qc.invalidateQueries({ queryKey: ["pasta_empresa_items"] });
    },
    onError: (err) => toast.error("Erro ao remover pasta: " + (err?.message ?? "falha")),
  });
}

/** Move/adiciona uma empresa a uma pasta. */
export function useAddEmpresaToPasta() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ empresaId, pastaId }: { empresaId: string; pastaId: string }) => {
      const { error } = await supabase.from("pasta_empresa_items").insert({
        pasta_id: pastaId,
        empresa_id: empresaId,
        user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pasta_empresa_items"] }),
  });
}

export function useRemoveEmpresaFromPasta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ empresaId, pastaId }: { empresaId: string; pastaId: string }) => {
      const { error } = await supabase
        .from("pasta_empresa_items")
        .delete()
        .eq("pasta_id", pastaId)
        .eq("empresa_id", empresaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pasta_empresa_items"] }),
  });
}

/** Bulk: adicionar várias empresas a uma pasta de uma vez. */
export function useBulkAddEmpresasToPasta() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ empresaIds, pastaId }: { empresaIds: string[]; pastaId: string }) => {
      if (!empresaIds.length) return;
      // Busca vínculos existentes para evitar duplicatas
      const { data: existing } = await supabase
        .from("pasta_empresa_items")
        .select("empresa_id")
        .eq("pasta_id", pastaId)
        .in("empresa_id", empresaIds);
      const alreadyIn = new Set((existing || []).map((r: { empresa_id: string }) => r.empresa_id));
      const toInsert = empresaIds
        .filter((id) => !alreadyIn.has(id))
        .map((empresa_id) => ({ pasta_id: pastaId, empresa_id, user_id: user!.id }));
      if (!toInsert.length) return { added: 0, skipped: empresaIds.length };
      const { error } = await supabase.from("pasta_empresa_items").insert(toInsert);
      if (error) throw error;
      return { added: toInsert.length, skipped: empresaIds.length - toInsert.length };
    },
    onSuccess: (result) => {
      if (result) {
        toast.success(
          `${result.added} empresa(s) adicionada(s)${result.skipped ? ` · ${result.skipped} já estavam` : ""}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["pasta_empresa_items"] });
    },
    onError: (err) => toast.error("Erro ao adicionar em lote: " + (err?.message ?? "falha")),
  });
}
