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
  await supabase.rpc("log_audit_secure" as any, {
    p_tabela: params.tabela,
    p_acao: params.acao,
    p_registro_id: params.registro_id ?? null,
    p_detalhes: params.detalhes ?? {},
  });
}
