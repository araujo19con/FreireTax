import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Acao {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  data_limite_prescricao?: string | null;
}

export function useAcoes() {
  return useQuery({
    queryKey: ["acoes_tributarias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acoes_tributarias")
        .select("id, nome, tipo, status, data_limite_prescricao")
        .order("nome");
      if (error) throw error;
      return (data || []) as Acao[];
    },
  });
}
