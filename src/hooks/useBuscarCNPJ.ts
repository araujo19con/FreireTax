import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CandidatoCNPJ {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  uf: string;
  municipio: string | null;
  score: number;
}

interface BuscaState {
  loading: boolean;
  error: string | null;
  candidatos: CandidatoCNPJ[];
}

/**
 * Hook pra buscar CNPJ pela razão social — usa edge function buscar-cnpj-por-nome
 * que consulta a tabela slim rfb_estabelecimentos_busca (populada via ETL).
 */
export function useBuscarCNPJ() {
  const [state, setState] = useState<BuscaState>({
    loading: false,
    error: null,
    candidatos: [],
  });

  const buscar = useCallback(async (termo: string, uf?: string, limite = 20) => {
    if (!termo || termo.trim().length < 3) {
      setState({ loading: false, error: "Mínimo 3 caracteres", candidatos: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke("buscar-cnpj-por-nome", {
        body: { termo: termo.trim(), uf: uf?.trim() || undefined, limite },
      });
      if (error) {
        // Extrai body do erro quando possível
        let msg = error.message || "falha";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = (error as any).context;
          if (ctx?.body) {
            const text =
              typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
            try {
              const parsed = JSON.parse(text);
              msg = parsed.error || parsed.detail || text;
            } catch {
              msg = text;
            }
          }
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setState({
        loading: false,
        error: null,
        candidatos: (data?.candidatos ?? []) as CandidatoCNPJ[],
      });
    } catch (e) {
      setState({
        loading: false,
        error: (e as Error).message,
        candidatos: [],
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, candidatos: [] });
  }, []);

  return { ...state, buscar, reset };
}
