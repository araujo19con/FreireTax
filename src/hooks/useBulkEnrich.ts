import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

export interface BulkEnrichTarget {
  id: string;
  nome: string;
  cnpj: string;
}

export type BulkStatus = "idle" | "running" | "done" | "cancelled";

export interface BulkProgress {
  status: BulkStatus;
  total: number;
  processed: number;
  success: number;
  failed: number;
  current: BulkEnrichTarget | null;
  errors: Array<{ empresa: BulkEnrichTarget; erro: string }>;
  startedAt: number | null;
  finishedAt: number | null;
}

const initial: BulkProgress = {
  status: "idle",
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  current: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

/**
 * Scope options:
 * - "missing": apenas empresas SEM receita_atualizada_em OU com receita_erro
 * - "all":     todas as empresas (força refetch)
 * - "ids":     lista manual
 */
export type BulkScope = "missing" | "all" | "ids";

/**
 * Hook para enriquecer RFB em lote com progresso + rate limiting.
 * Delay padrão 600ms entre chamadas pra respeitar BrasilAPI (~3/s).
 */
export function useBulkEnrich() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BulkProgress>(initial);
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setProgress(initial);
  }, []);

  const start = useCallback(async (opts: { scope: BulkScope; ids?: string[]; delayMs?: number }) => {
    const { scope, ids, delayMs = 600 } = opts;
    cancelRef.current = false;

    // 1) Seleciona alvos
    let targets: BulkEnrichTarget[] = [];
    try {
      if (scope === "ids" && ids?.length) {
        const { data, error } = await supabase
          .from("empresas")
          .select("id, nome, cnpj")
          .in("id", ids);
        if (error) throw error;
        targets = (data ?? []) as BulkEnrichTarget[];
      } else if (scope === "all") {
        const { data, error } = await supabase
          .from("empresas")
          .select("id, nome, cnpj")
          .order("nome");
        if (error) throw error;
        targets = (data ?? []) as BulkEnrichTarget[];
      } else {
        // missing: receita_atualizada_em is null OR receita_erro not null
        const [res1, res2] = await Promise.all([
          supabase
            .from("empresas")
            .select("id, nome, cnpj")
            .is("receita_atualizada_em", null),
          supabase
            .from("empresas")
            .select("id, nome, cnpj")
            .not("receita_erro", "is", null),
        ]);
        if (res1.error) throw res1.error;
        if (res2.error) throw res2.error;
        const byId = new Map<string, BulkEnrichTarget>();
        for (const e of (res1.data ?? []) as BulkEnrichTarget[]) byId.set(e.id, e);
        for (const e of (res2.data ?? []) as BulkEnrichTarget[]) byId.set(e.id, e);
        targets = Array.from(byId.values());
      }
    } catch (e) {
      toast.error("Erro ao selecionar empresas: " + ((e as Error)?.message ?? "falha"));
      return;
    }

    if (targets.length === 0) {
      toast.info("Nenhuma empresa precisa de enriquecimento.");
      return;
    }

    setProgress({
      status: "running",
      total: targets.length,
      processed: 0,
      success: 0,
      failed: 0,
      current: null,
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    });

    // 2) Itera sequencialmente com delay (respeita BrasilAPI rate limit)
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) {
        setProgress((p) => ({ ...p, status: "cancelled", finishedAt: Date.now(), current: null }));
        toast.info(`Cancelado. ${i} de ${targets.length} processadas.`);
        qc.invalidateQueries({ queryKey: ["empresas"] });
        return;
      }

      const emp = targets[i];
      setProgress((p) => ({ ...p, current: emp }));

      try {
        const { data, error } = await supabase.functions.invoke("enriquecer-cnpj", {
          body: { cnpj: emp.cnpj, empresa_id: emp.id, force: true },
        });
        if (error) {
          // tenta extrair body
          let msg = error.message || "falha";
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ctx = (error as any).context;
            if (ctx?.body) {
              const text = typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
              try {
                const parsed = JSON.parse(text);
                msg = parsed.error || parsed.detail || text;
              } catch { msg = text; }
            }
          } catch { /* ignore */ }
          throw new Error(msg);
        }
        if (data?.error) throw new Error(data.error);
        setProgress((p) => ({ ...p, processed: p.processed + 1, success: p.success + 1 }));
      } catch (e) {
        setProgress((p) => ({
          ...p,
          processed: p.processed + 1,
          failed: p.failed + 1,
          errors: [...p.errors, { empresa: emp, erro: (e as Error).message }],
        }));
      }

      // delay, exceto na última
      if (i < targets.length - 1 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // 3) Finalização
    setProgress((p) => ({ ...p, status: "done", finishedAt: Date.now(), current: null }));
    qc.invalidateQueries({ queryKey: ["empresas"] });

    await logAudit({
      tabela: "empresas",
      acao: "Enriquecimento RFB em lote",
      detalhes: {
        scope,
        total: targets.length,
      },
    });
  }, [qc]);

  return { progress, start, cancel, reset };
}
