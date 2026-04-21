import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

export interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
  valor_potencial_estimado: number | null;
  observacao_valor: string | null;
}

export function useElegibilidades(empresaId?: string) {
  return useQuery({
    queryKey: ["elegibilidade", empresaId ?? "all"],
    queryFn: async () => {
      const base = supabase
        .from("elegibilidade")
        .select("id, empresa_id, acao_id, elegivel, justificativa, valor_potencial_estimado, observacao_valor");
      const { data, error } = await (empresaId ? base.eq("empresa_id", empresaId) : base);
      if (error) throw error;
      return (data || []) as ElegibilidadeRow[];
    },
  });
}

export function useCreateElegibilidade() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      empresa_id: string;
      acao_id: string;
      elegivel: boolean;
      justificativa?: string;
      valor_potencial_estimado?: number | null;
      observacao_valor?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("elegibilidade")
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      await logAudit({
        tabela: "elegibilidade",
        acao: "Criou elegibilidade",
        registro_id: data.id,
        detalhes: { empresa_id: input.empresa_id, acao_id: input.acao_id, elegivel: input.elegivel },
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Elegibilidade vinculada");
      qc.invalidateQueries({ queryKey: ["elegibilidade"] });
    },
    onError: (err) => toast.error("Erro ao vincular: " + (err?.message ?? "falha")),
  });
}

export function useDeleteElegibilidade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("elegibilidade").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "elegibilidade", acao: "Removeu vínculo", registro_id: id });
    },
    onSuccess: () => {
      toast.success("Vínculo removido");
      qc.invalidateQueries({ queryKey: ["elegibilidade"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}
