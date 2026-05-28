// Supabase Edge Function: verificar-prazos
// Executa diariamente (cron: "0 8 * * *") e envia emails de alerta
// para prazos processuais vencendo nos próximos N dias.
//
// Configurar no Supabase Dashboard → Edge Functions → Cron Schedules.
// Variáveis de ambiente necessárias:
//   RESEND_API_KEY  — chave da API Resend para envio de email
//   FROM_EMAIL      — endereço remetente (ex: alertas@freirepignataro.com.br)
//
// Invocação manual para teste: POST sem body (não requer Auth).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

interface PrazoAlerta {
  prazo_id: string;
  empresa_nome: string;
  acao_nome: string | null;
  tipo: string;
  descricao: string | null;
  data_vencimento: string;
  responsavel_id: string | null;
  responsavel_email: string | null;
}

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

async function sendEmail(apiKey: string, payload: ResendPayload): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[verificar-prazos] Resend error ${res.status}: ${body}`);
    return false;
  }
  return true;
}

function buildEmailHtml(prazo: PrazoAlerta): string {
  const diasRestantes = Math.ceil(
    (new Date(prazo.data_vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  const urgencia =
    diasRestantes === 0
      ? "⛔ VENCE HOJE"
      : diasRestantes === 1
        ? "🔥 Vence amanhã"
        : `⚠️ Vence em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}`;

  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #dc2626; margin-bottom: 4px;">Alerta de Prazo Processual</h2>
      <p style="font-size: 18px; font-weight: bold; margin: 0;">${urgencia}</p>
      <hr style="border: 1px solid #e5e7eb; margin: 16px 0;" />
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #6b7280; width: 140px;">Empresa</td>
            <td style="padding: 6px 0; font-weight: 600;">${prazo.empresa_nome}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Ação tributária</td>
            <td style="padding: 6px 0;">${prazo.acao_nome ?? "—"}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b7280;">Tipo de prazo</td>
            <td style="padding: 6px 0; text-transform: capitalize;">${prazo.tipo}</td></tr>
        ${
          prazo.descricao
            ? `<tr><td style="padding: 6px 0; color: #6b7280;">Descrição</td>
            <td style="padding: 6px 0;">${prazo.descricao}</td></tr>`
            : ""
        }
        <tr><td style="padding: 6px 0; color: #6b7280;">Vencimento</td>
            <td style="padding: 6px 0; font-weight: 600; color: #dc2626;">${prazo.data_vencimento}</td></tr>
      </table>
      <hr style="border: 1px solid #e5e7eb; margin: 16px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">
        Este alerta foi enviado automaticamente pelo Tax Trakker — Freire Pignataro Advogados.
        Acesse o sistema para marcar o prazo como cumprido após a ação.
      </p>
    </div>
  `;
}

Deno.serve(async (_req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "alertas@freirepignataro.com.br";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Busca prazos a alertar hoje via RPC (service_role apenas)
    const { data: prazos, error } = await admin.rpc("prazos_a_alertar_hoje");
    if (error) {
      console.error("[verificar-prazos] RPC error:", error.message);
      return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }

    const lista = (prazos ?? []) as PrazoAlerta[];

    if (!lista.length) {
      console.log("[verificar-prazos] Nenhum prazo para alertar hoje.");
      return new Response(JSON.stringify({ ok: true, alertas: 0 }), { status: 200 });
    }

    let enviados = 0;
    let falhas = 0;

    for (const prazo of lista) {
      const email = prazo.responsavel_email;
      if (!email) {
        console.warn(
          `[verificar-prazos] Prazo ${prazo.prazo_id} sem email de responsável — pulando`
        );
        continue;
      }

      const diasRestantes = Math.ceil(
        (new Date(prazo.data_vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      const subjectPrefix =
        diasRestantes <= 0 ? "⛔ HOJE" : diasRestantes === 1 ? "🔥 AMANHÃ" : `⚠️ ${diasRestantes}d`;

      const payload: ResendPayload = {
        from: FROM_EMAIL,
        to: [email],
        subject: `[${subjectPrefix}] Prazo: ${prazo.tipo} — ${prazo.empresa_nome}`,
        html: buildEmailHtml(prazo),
      };

      let ok = false;
      if (RESEND_API_KEY) {
        ok = await sendEmail(RESEND_API_KEY, payload);
      } else {
        // Sem API key: log para desenvolvimento, não falha
        console.log(
          "[verificar-prazos] (sem RESEND_API_KEY) Email simulado para:",
          email,
          payload.subject
        );
        ok = true;
      }

      if (ok) {
        // Marca alerta como enviado para não reenviar amanhã
        const { error: updErr } = await admin
          .from("prazos_processuais")
          .update({ alerta_enviado_em: new Date().toISOString() })
          .eq("id", prazo.prazo_id);
        if (updErr) {
          console.error("[verificar-prazos] Falha ao marcar alerta_enviado_em:", updErr.message);
        }
        enviados++;
      } else {
        falhas++;
      }
    }

    console.log(`[verificar-prazos] Alertas enviados: ${enviados}, falhas: ${falhas}`);
    return new Response(JSON.stringify({ ok: true, alertas: enviados, falhas }), { status: 200 });
  } catch (e) {
    console.error("[verificar-prazos] Erro inesperado:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
    });
  }
});
