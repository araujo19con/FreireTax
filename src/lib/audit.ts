import { supabase } from "@/integrations/supabase/client";

export async function logAudit(params: {
  tabela: string;
  acao: string;
  registro_id?: string;
  detalhes?: Record<string, unknown>;
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    tabela: params.tabela,
    acao: params.acao,
    registro_id: params.registro_id ?? null,
    detalhes: params.detalhes ?? {},
  } as any);
}
