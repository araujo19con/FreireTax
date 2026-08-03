import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import type { Criterio, TipoResposta } from "./useCriterios";
import { humanizeRegra, respostaDisparaExclusao } from "@/lib/criterios";
import { Parser } from "expr-eval";

export interface RespostaValor {
  bool?: boolean;
  date?: string;
  number?: number;
  text?: string;
  select?: string;
}

export type AnswersMap = Record<string, RespostaValor>; // key = criterio_id

export interface Resposta {
  id: string;
  elegibilidade_id: string;
  criterio_id: string;
  resposta_bool: boolean | null;
  resposta_date: string | null;
  resposta_number: number | null;
  resposta_text: string | null;
  resposta_select: string | null;
  answered_at: string;
  user_id: string;
}

const respostasTable = () => supabase.from("elegibilidade_respostas");

/** Carrega respostas de uma elegibilidade existente (usado para "editar qualificação"). */
export function useRespostas(elegibilidadeId: string | undefined) {
  return useQuery({
    queryKey: ["respostas", elegibilidadeId],
    enabled: !!elegibilidadeId,
    queryFn: async () => {
      if (!elegibilidadeId) return [] as Resposta[];
      const { data, error } = await respostasTable()
        .select("*")
        .eq("elegibilidade_id", elegibilidadeId);
      if (error) throw error;
      return (data || []) as Resposta[];
    },
  });
}

/**
 * Avalia respostas contra critérios:
 * - Critério excludente com resposta negativa → NÃO elegível, retorna justificativa estruturada
 * - Score ponderado: soma(peso × respostaPositiva) / soma(pesos)
 * - Valor potencial: tenta avaliar fórmula safe (primeiro critério com formula_valor que retorne numérico).
 * - Elegibilidade default: true se score >= 0.5 e nenhum excludente falhou.
 */
export function evaluateAnswers(
  criterios: Criterio[],
  answers: AnswersMap
): {
  elegivel: boolean;
  score: number;
  justificativa: string;
  valor: number | null;
  completo: boolean;
} {
  const justificativas: string[] = [];
  let excludenteFalhou = false;
  let positivos = 0;
  let pesoTotal = 0;
  let pesoPositivo = 0;
  let respondidos = 0;

  for (const c of criterios) {
    const resp = answers[c.id];
    if (!resp) continue;
    respondidos++;
    pesoTotal += c.peso;

    const isPositive = answerIsPositive(c.tipo_resposta, resp);

    if (isPositive) {
      positivos++;
      pesoPositivo += c.peso;
    }

    // Avaliação de exclusão — preferir regra granular; cair no legacy quando ausente
    if (c.eh_excludente) {
      const falhou = c.regra_excludente
        ? respostaDisparaExclusao(c.regra_excludente, resp)
        : !isPositive; // legacy: qualquer resposta "negativa" exclui
      if (falhou) {
        excludenteFalhou = true;
        const motivo = c.regra_excludente ? humanizeRegra(c.regra_excludente) : "resposta negativa";
        justificativas.push(`Excludente: "${c.pergunta}" — ${motivo}.`);
      }
    }
  }

  const completo = respondidos === criterios.length;
  const score = pesoTotal > 0 ? Math.round((pesoPositivo / pesoTotal) * 100) : 0;

  const elegivel = !excludenteFalhou && score >= 50;
  if (!elegivel && !excludenteFalhou) {
    justificativas.push(`Score abaixo do limite (${score}%).`);
  }
  if (elegivel) {
    justificativas.push(`Atende ${positivos}/${criterios.length} critérios (score ${score}%).`);
  }

  const valor = tryComputeValor(criterios, answers);

  return {
    elegivel,
    score,
    justificativa: justificativas.join(" "),
    valor,
    completo,
  };
}

/**
 * Verifica se a resposta de um critério dispara sua regra de exclusão.
 * Usado para feedback inline no wizard — não recalcula score nem justificativa.
 */
export function isExcludenteFalhouAgora(c: Criterio, resp: RespostaValor | undefined): boolean {
  if (!c.eh_excludente || !resp) return false;
  if (c.regra_excludente) return respostaDisparaExclusao(c.regra_excludente, resp);
  return !answerIsPositive(c.tipo_resposta, resp);
}

function answerIsPositive(tipo: TipoResposta, resp: RespostaValor): boolean {
  switch (tipo) {
    case "boolean":
      return resp.bool === true;
    case "number":
      return (resp.number ?? 0) > 0;
    case "text":
      return !!(resp.text && resp.text.trim());
    case "date":
      return !!resp.date;
    case "select":
      return !!resp.select && resp.select !== "nao" && resp.select !== "none";
  }
}

/**
 * Calcula valor potencial a partir da primeira `formula_valor` que produza número finito.
 * Sandbox simples: apenas funções matemáticas e referência a `answers[criterioId].number`.
 */
function tryComputeValor(criterios: Criterio[], answers: AnswersMap): number | null {
  for (const c of criterios) {
    if (!c.formula_valor) continue;
    try {
      const answersByKey: Record<string, number> = {};
      for (const k of Object.keys(answers)) {
        answersByKey[k] = answers[k]?.number ?? 0;
      }
      // "answers.XXX * 0.08" — expr-eval avalia sem new Function (sandbox seguro)
      const v = Parser.evaluate(c.formula_valor, { answers: answersByKey });
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    } catch {
      // ignora fórmulas inválidas e continua
    }
  }
  return null;
}

/**
 * Salva qualificação completa: cria/atualiza `elegibilidade` + persiste respostas.
 * Se já existe elegibilidade (empresa_id × acao_id), atualiza; senão cria.
 */
export function useSalvarQualificacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: {
      empresa_id: string;
      acao_id: string;
      criterios: Criterio[];
      answers: AnswersMap;
    }) => {
      const { empresa_id, acao_id, criterios, answers } = params;
      const evaluated = evaluateAnswers(criterios, answers);

      // 1. Upsert elegibilidade
      const { data: existing } = await supabase
        .from("elegibilidade")
        .select("id")
        .eq("empresa_id", empresa_id)
        .eq("acao_id", acao_id)
        .maybeSingle();

      const elegPayload = {
        empresa_id,
        acao_id,
        elegivel: evaluated.elegivel,
        justificativa: evaluated.justificativa,
        valor_potencial_estimado: evaluated.valor,
        user_id: user.id,
        score_elegibilidade: evaluated.score,
        valor_calculado: evaluated.valor,
        qualificada_em: new Date().toISOString(),
        qualificada_por: user.id,
        status_qualificacao: evaluated.completo ? "qualificada" : "incompleta",
      } as Record<string, unknown>;

      let elegibilidadeId: string;
      if (existing?.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from("elegibilidade") as any)
          .update(elegPayload)
          .eq("id", existing.id);
        if (error) throw error;
        elegibilidadeId = existing.id;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from("elegibilidade") as any)
          .insert(elegPayload)
          .select()
          .single();
        if (error) throw error;
        elegibilidadeId = data.id;
      }

      // 2. Apaga respostas antigas desta elegibilidade e insere novas
      await respostasTable().delete().eq("elegibilidade_id", elegibilidadeId);

      const respostasPayload = Object.entries(answers).map(([criterio_id, valor]) => ({
        elegibilidade_id: elegibilidadeId,
        criterio_id,
        user_id: user.id,
        resposta_bool: valor.bool ?? null,
        resposta_date: valor.date ?? null,
        resposta_number: valor.number ?? null,
        resposta_text: valor.text ?? null,
        resposta_select: valor.select ?? null,
      }));

      if (respostasPayload.length > 0) {
        const { error } = await respostasTable().insert(respostasPayload);
        if (error) throw error;
      }

      await logAudit({
        tabela: "elegibilidade",
        acao: existing?.id ? "Requalificou" : "Qualificou",
        registro_id: elegibilidadeId,
        detalhes: {
          empresa_id,
          acao_id,
          elegivel: evaluated.elegivel,
          score: evaluated.score,
          valor: evaluated.valor,
        },
      });

      return { elegibilidadeId, evaluated };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elegibilidade"] });
      qc.invalidateQueries({ queryKey: ["respostas"] });
    },
    onError: (err) => toast.error("Erro ao salvar qualificação: " + (err?.message ?? "falha")),
  });
}

/** Cria prospecção a partir de uma elegibilidade qualificada (CTA no wizard final). */
export function useCriarProspeccaoFromEleg() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (elegibilidadeId: string) => {
      // prospeccoes.empresa_id/acao_id são NOT NULL — puxa da elegibilidade.
      const { data: eleg, error: elegErr } = await supabase
        .from("elegibilidade")
        .select("empresa_id, acao_id")
        .eq("id", elegibilidadeId)
        .single();
      if (elegErr) throw elegErr;

      // Pré-check: se já há prospecção ativa (status <> 'Perdido') para
      // (empresa_id, acao_id), reutiliza em vez de duplicar.
      const { data: existente } = await supabase
        .from("prospeccoes")
        .select("*")
        .eq("empresa_id", eleg.empresa_id)
        .eq("acao_id", eleg.acao_id)
        .neq("status_prospeccao", "Perdido")
        .limit(1)
        .maybeSingle();
      if (existente) return existente;

      const { data, error } = await supabase
        .from("prospeccoes")
        .insert({
          elegibilidade_id: elegibilidadeId,
          empresa_id: eleg.empresa_id,
          acao_id: eleg.acao_id,
          user_id: user.id,
          responsavel_id: user.id,
          status_prospeccao: "Contato feito",
        })
        .select()
        .single();
      if (error) {
        // Índice único parcial (uma prospecção ativa por empresa+ação) —
        // corrida: outro fluxo criou no meio. Reutiliza a existente.
        if (error.code === "23505") {
          const { data: jaExiste } = await supabase
            .from("prospeccoes")
            .select("*")
            .eq("empresa_id", eleg.empresa_id)
            .eq("acao_id", eleg.acao_id)
            .neq("status_prospeccao", "Perdido")
            .limit(1)
            .maybeSingle();
          if (jaExiste) return jaExiste;
        }
        throw error;
      }
      await logAudit({
        tabela: "prospeccoes",
        acao: "Criou prospecção via qualificação",
        registro_id: data.id,
        detalhes: { elegibilidade_id: elegibilidadeId },
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Prospecção criada");
      qc.invalidateQueries({ queryKey: ["prospeccoes"] });
    },
    onError: (err) => toast.error("Erro ao criar prospecção: " + (err?.message ?? "falha")),
  });
}
