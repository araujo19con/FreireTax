import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";
import type { ProposalSection } from "@/lib/proposta";

const tplTable = () => supabase.from("propostas_templates");
const propTable = () => supabase.from("propostas");

// =========================================================================
// TEMPLATES
// =========================================================================
export interface PropostaTemplate {
  id: string;
  nome: string;
  descricao: string | null;
  acao_id: string | null;
  tipo_servico: string | null;
  secoes: ProposalSection[];
  valor_entrada_default: number | null;
  percentual_exito_default: number | null;
  texto_destinatario_default: string | null;
  /** URL/path do .docx oficial (default: /template-proposta-padrao.docx em /public) */
  docx_template_path: string | null;
  ativo: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type TemplateInput = Omit<PropostaTemplate, "id" | "user_id" | "created_at" | "updated_at">;

export function usePropostaTemplates(opts?: { acaoId?: string | null; apenasAtivos?: boolean }) {
  const { acaoId, apenasAtivos = true } = opts ?? {};
  return useQuery({
    queryKey: ["propostas_templates", acaoId ?? "all", apenasAtivos],
    queryFn: async () => {
      let q = tplTable().select("*").order("nome");
      if (apenasAtivos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      const all = (data || []) as PropostaTemplate[];
      // Filtragem cliente por ação: aceita templates da ação OU genéricos (acao_id null)
      if (acaoId === undefined) return all;
      return all.filter((t) => t.acao_id === null || t.acao_id === acaoId);
    },
  });
}

export function useCreatePropostaTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<TemplateInput>) => {
      const payload = { ...input, user_id: user.id };
      const { data, error } = await tplTable().insert(payload).select().single();
      if (error) throw error;
      await logAudit({
        tabela: "propostas_templates",
        acao: "Criou template de proposta",
        registro_id: data.id,
        detalhes: { nome: input.nome },
      });
      return data as PropostaTemplate;
    },
    onSuccess: () => {
      toast.success("Template criado");
      qc.invalidateQueries({ queryKey: ["propostas_templates"] });
    },
    onError: (err) => toast.error("Erro ao criar template: " + (err?.message ?? "falha")),
  });
}

export function useUpdatePropostaTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TemplateInput> }) => {
      const { error } = await tplTable().update(data).eq("id", id);
      if (error) throw error;
      await logAudit({
        tabela: "propostas_templates",
        acao: "Editou template de proposta",
        registro_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Template atualizado");
      qc.invalidateQueries({ queryKey: ["propostas_templates"] });
    },
    onError: (err) => toast.error("Erro ao atualizar: " + (err?.message ?? "falha")),
  });
}

export function useDeletePropostaTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tplTable().delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        tabela: "propostas_templates",
        acao: "Removeu template de proposta",
        registro_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Template removido");
      qc.invalidateQueries({ queryKey: ["propostas_templates"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}

// =========================================================================
// PROPOSTAS (1 por prospecção)
// =========================================================================
export interface Proposta {
  id: string;
  prospeccao_id: string;
  template_id: string | null;
  empresa_id: string | null;
  acao_id: string | null;
  titulo: string;
  destinatario_empresa: string | null;
  destinatario_att: string | null;
  texto_introducao: string | null;
  secoes: ProposalSection[];
  valor_entrada: number | null;
  percentual_exito: number | null;
  signatario_nome: string | null;
  signatario_cargo: string | null;
  status: "rascunho" | "enviada" | "aceita" | "rejeitada";
  enviada_em: string | null;
  aceita_em: string | null;
  rejeitada_em: string | null;
  motivo_rejeicao: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type PropostaInput = Omit<
  Proposta,
  "id" | "created_by" | "created_at" | "updated_at" | "enviada_em" | "aceita_em" | "rejeitada_em"
>;

/** Busca proposta de uma prospecção (única). Retorna null se não houver. */
export function usePropostaByProspeccao(prospeccaoId: string | undefined | null) {
  return useQuery({
    queryKey: ["proposta", prospeccaoId ?? "none"],
    enabled: !!prospeccaoId,
    queryFn: async () => {
      if (!prospeccaoId) return null;
      const { data, error } = await propTable()
        .select("*")
        .eq("prospeccao_id", prospeccaoId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Proposta | null;
    },
  });
}

export function useUpsertProposta() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Partial<PropostaInput>) => {
      const { prospeccao_id } = input;
      if (!prospeccao_id) throw new Error("prospeccao_id obrigatório");

      // Verifica existência (1 proposta por prospecção)
      const { data: existing } = await propTable()
        .select("id")
        .eq("prospeccao_id", prospeccao_id)
        .maybeSingle();

      const payload = { ...input, created_by: user.id };

      if (existing?.id) {
        const { data, error } = await propTable()
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        await logAudit({
          tabela: "propostas",
          acao: "Atualizou proposta",
          registro_id: existing.id,
        });
        return data as Proposta;
      }
      const { data, error } = await propTable().insert(payload).select().single();
      if (error) throw error;
      await logAudit({
        tabela: "propostas",
        acao: "Criou proposta",
        registro_id: data.id,
        detalhes: { prospeccao_id },
      });
      return data as Proposta;
    },
    onSuccess: (p) => {
      toast.success("Proposta salva");
      qc.invalidateQueries({ queryKey: ["proposta", p.prospeccao_id] });
      qc.invalidateQueries({ queryKey: ["propostas"] });
    },
    onError: (err) => toast.error("Erro ao salvar proposta: " + (err?.message ?? "falha")),
  });
}

export function useMarcarPropostaEnviada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await propTable()
        .update({ status: "enviada", enviada_em: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        tabela: "propostas",
        acao: "Marcou proposta como enviada",
        registro_id: id,
      });
    },
    onSuccess: () => {
      toast.success("Proposta marcada como enviada");
      qc.invalidateQueries({ queryKey: ["proposta"] });
    },
    onError: (err) => toast.error("Erro: " + (err?.message ?? "falha")),
  });
}

export function useDeleteProposta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await propTable().delete().eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "propostas", acao: "Removeu proposta", registro_id: id });
    },
    onSuccess: () => {
      toast.success("Proposta removida");
      qc.invalidateQueries({ queryKey: ["proposta"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}
