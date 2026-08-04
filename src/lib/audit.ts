import { supabase } from "@/integrations/supabase/client";

export async function logAudit(params: {
  tabela: string;
  acao: string;
  registro_id?: string;
  detalhes?: Record<string, unknown>;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RPC com SECURITY DEFINER — user_id injetado pelo servidor; clientes não forjam.
  const { error } = await supabase.rpc("log_audit_secure", {
    p_tabela: params.tabela,
    p_acao: params.acao,
    p_registro_id: params.registro_id ?? null,
    p_detalhes: params.detalhes ?? {},
  });
  // Auditoria NÃO deve quebrar a ação do usuário — mas falha silenciosa esconde bug
  // (foi o que deixou a auditoria parada ~2 meses). Registra no console.
  if (error) console.error("[logAudit] falha ao registrar auditoria:", error.message);
}
