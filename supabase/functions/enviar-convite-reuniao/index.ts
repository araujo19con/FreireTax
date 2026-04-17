// Supabase Edge Function: enviar-convite-reuniao
// Gera arquivo ICS (iCalendar) e envia por email via Gmail SMTP para o
// advogado e o lead. Invocada após criar/editar uma reunião.
//
// Secrets necessários (configure em Supabase Dashboard > Edge Functions > Secrets):
//   GMAIL_USER          ex: agendamentos@freirepignataro.com.br
//   GMAIL_APP_PASSWORD  senha de app (não é a senha normal — requer 2FA + senha de app)
//   GMAIL_FROM_NAME     ex: "Freire Pignataro Advogados"
//
// Como gerar a App Password no Gmail:
//   1. Ativar 2FA na conta Google
//   2. https://myaccount.google.com/apppasswords
//   3. Criar senha → copiar os 16 caracteres

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// CORS — restrito ao(s) frontend(s) conhecido(s). Para testes locais, o
// header ALLOWED_ORIGINS pode conter uma lista separada por vírgula.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface Payload {
  reuniao_id: string;
  metodo?: "REQUEST" | "CANCEL";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatICSDate(d: Date) {
  // UTC format: 20260417T140000Z
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICS(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// HTML escape básico para impedir injeção no corpo do email.
function escapeHTML(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface ReuniaoData {
  id: string;
  titulo: string;
  descricao: string | null;
  lead_nome: string;
  lead_email: string;
  data_inicio: string;
  data_fim: string;
  local: string | null;
  link_reuniao: string | null;
  ics_uid: string;
  advogado: { nome: string; email: string };
}

function buildICS(r: ReuniaoData, metodo: "REQUEST" | "CANCEL", organizerEmail: string, organizerName: string) {
  const start = new Date(r.data_inicio);
  const end = new Date(r.data_fim);
  const now = new Date();

  const description = [
    r.descricao || "",
    r.link_reuniao ? `\n\nLink da reunião: ${r.link_reuniao}` : "",
  ].join("");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FreirePignataro//TaxTrakker//PT-BR",
    "CALSCALE:GREGORIAN",
    `METHOD:${metodo}`,
    "BEGIN:VEVENT",
    `UID:${r.ics_uid}`,
    `DTSTAMP:${formatICSDate(now)}`,
    `DTSTART:${formatICSDate(start)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${escapeICS(r.titulo)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    r.local ? `LOCATION:${escapeICS(r.local)}` : "",
    `ORGANIZER;CN=${escapeICS(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${escapeICS(r.advogado.nome)};RSVP=TRUE;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:${r.advogado.email}`,
    `ATTENDEE;CN=${escapeICS(r.lead_nome)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${r.lead_email}`,
    metodo === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS(r.titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}

function buildEmailBody(r: ReuniaoData, metodo: "REQUEST" | "CANCEL") {
  const start = new Date(r.data_inicio);
  const dataStr = start.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Sao_Paulo" });

  if (metodo === "CANCEL") {
    return {
      text: `Olá,\n\nA reunião "${r.titulo}" agendada para ${dataStr} foi CANCELADA.\n\nAtenciosamente,\nFreire Pignataro Advogados`,
      html: `<p>Olá,</p><p>A reunião <strong>"${escapeHTML(r.titulo)}"</strong> agendada para <strong>${escapeHTML(dataStr)}</strong> foi <strong style="color:#c00">CANCELADA</strong>.</p><p>Atenciosamente,<br/>Freire Pignataro Advogados</p>`,
    };
  }

  const linkLine = r.link_reuniao ? `\nLink: ${r.link_reuniao}` : "";
  const localLine = r.local ? `\nLocal: ${r.local}` : "";
  const descLine = r.descricao ? `\n\n${r.descricao}` : "";

  return {
    text: `Olá,\n\nVocê está sendo convidado para a reunião:\n\n"${r.titulo}"\n\nData: ${dataStr}${localLine}${linkLine}${descLine}\n\nO convite em anexo pode ser adicionado ao seu calendário (Google, Outlook, Apple).\n\nAtenciosamente,\nFreire Pignataro Advogados`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px">
      <h2 style="color:#1a365d">${escapeHTML(r.titulo)}</h2>
      <p><strong>Data:</strong> ${escapeHTML(dataStr)}</p>
      ${r.local ? `<p><strong>Local:</strong> ${escapeHTML(r.local)}</p>` : ""}
      ${r.link_reuniao ? `<p><strong>Link:</strong> <a href="${escapeHTML(r.link_reuniao)}">${escapeHTML(r.link_reuniao)}</a></p>` : ""}
      ${r.descricao ? `<p>${escapeHTML(r.descricao).replace(/\n/g, "<br/>")}</p>` : ""}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
      <p style="font-size:12px;color:#64748b">O arquivo <code>.ics</code> em anexo adiciona automaticamente este evento ao seu calendário (Google, Outlook, Apple).</p>
      <p style="font-size:12px;color:#64748b">Atenciosamente,<br/><strong>Freire Pignataro Advogados</strong></p>
    </div>`,
  };
}

serve(async (req) => {
  const cors = corsFor(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors);
  }

  try {
    // 1. Autenticação — somente usuários logados podem disparar envio de emails.
    //    Antes, qualquer um com a URL podia fazer o Gmail do escritório enviar.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing auth" }, 401, cors);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: errAuth } = await asUser.auth.getUser();
    if (errAuth || !caller) return json({ error: "invalid token" }, 401, cors);

    // 2. Validação da payload
    const body = (await req.json().catch(() => null)) as Payload | null;
    if (!body || typeof body.reuniao_id !== "string" || !UUID_RE.test(body.reuniao_id)) {
      return json({ error: "reuniao_id inválido" }, 400, cors);
    }
    const metodo = body.metodo === "CANCEL" ? "CANCEL" : "REQUEST";

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");
    const fromName = Deno.env.get("GMAIL_FROM_NAME") ?? "Freire Pignataro Advogados";

    if (!gmailUser || !gmailPass) {
      return json({ error: "GMAIL_USER/GMAIL_APP_PASSWORD não configurados" }, 500, cors);
    }

    // 3. Carregar reunião — usando service role para ler profile do advogado,
    //    mas a autorização para disparar já foi validada pelo JWT acima.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: reuniao, error: errReu } = await admin
      .from("reunioes")
      .select("id, titulo, descricao, lead_nome, lead_email, data_inicio, data_fim, local, link_reuniao, ics_uid, advogado_id, created_by")
      .eq("id", body.reuniao_id)
      .single();

    if (errReu || !reuniao) {
      return json({ error: "Reunião não encontrada", detail: errReu?.message }, 404, cors);
    }

    // 4. Autorização fina: apenas advogado da reunião, criador, admin ou gestor
    //    podem disparar o envio de convite.
    const { data: isAdmin } = await asUser.rpc("is_admin", { _user_id: caller.id });
    const { data: isGestor } = await asUser.rpc("has_role", { _user_id: caller.id, _role: "gestor" });
    const autorizado =
      reuniao.advogado_id === caller.id ||
      reuniao.created_by === caller.id ||
      isAdmin === true ||
      isGestor === true;
    if (!autorizado) {
      return json({ error: "sem permissão para enviar convite desta reunião" }, 403, cors);
    }

    const { data: advogado, error: errAdv } = await admin
      .from("profiles")
      .select("nome, email")
      .eq("id", reuniao.advogado_id)
      .single();

    if (errAdv || !advogado) {
      return json({ error: "Advogado não encontrado", detail: errAdv?.message }, 404, cors);
    }

    // Email do lead pode vir malformado do CRM se criaram por outra via
    if (!EMAIL_RE.test(reuniao.lead_email) || !EMAIL_RE.test(advogado.email)) {
      return json({ error: "email inválido em advogado ou lead" }, 400, cors);
    }

    const reuniaoFull: ReuniaoData = {
      id: reuniao.id,
      titulo: reuniao.titulo,
      descricao: reuniao.descricao,
      lead_nome: reuniao.lead_nome,
      lead_email: reuniao.lead_email,
      data_inicio: reuniao.data_inicio,
      data_fim: reuniao.data_fim,
      local: reuniao.local,
      link_reuniao: reuniao.link_reuniao,
      ics_uid: reuniao.ics_uid ?? reuniao.id,
      advogado,
    };

    const ics = buildICS(reuniaoFull, metodo, gmailUser, fromName);
    const bodyContent = buildEmailBody(reuniaoFull, metodo);

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });

    const subjectPrefix = metodo === "CANCEL" ? "[CANCELADA] " : "";
    const subject = `${subjectPrefix}${reuniaoFull.titulo}`;

    const attachments = [
      {
        filename: "convite.ics",
        content: ics,
        contentType: `text/calendar; method=${metodo}; charset=UTF-8`,
        encoding: "base64" as const,
      },
    ];

    const recipients = [
      { name: advogado.nome, address: advogado.email },
      { name: reuniaoFull.lead_nome, address: reuniaoFull.lead_email },
    ];

    // 5. Envio paralelo — antes era serial, o que dobrava a latência percebida.
    //    Se um falhar, agregamos o erro e devolvemos parcial.
    const results = await Promise.allSettled(
      recipients.map((rcpt) =>
        client.send({
          from: `${fromName} <${gmailUser}>`,
          to: `${rcpt.name} <${rcpt.address}>`,
          subject,
          content: bodyContent.text,
          html: bodyContent.html,
          attachments,
        })
      )
    );

    await client.close();

    const failed = results
      .map((r, i) => ({ r, rcpt: recipients[i] }))
      .filter((x) => x.r.status === "rejected");

    if (failed.length === recipients.length) {
      // nenhum email saiu
      return json(
        { error: "falha ao enviar emails", detalhes: failed.map((f) => (f.r as PromiseRejectedResult).reason?.message) },
        502,
        cors
      );
    }

    // Marca como enviado apenas se pelo menos um destinatário recebeu e é REQUEST
    if (metodo === "REQUEST" && failed.length < recipients.length) {
      await admin
        .from("reunioes")
        .update({ ics_enviado_em: new Date().toISOString() })
        .eq("id", body.reuniao_id);
    }

    return json(
      {
        ok: true,
        enviado_para: recipients
          .filter((_, i) => results[i].status === "fulfilled")
          .map((r) => r.address),
        falhou_para: failed.map((f) => f.rcpt.address),
      },
      200,
      cors
    );
  } catch (e) {
    return json({ error: (e as Error).message }, 500, cors);
  }
});
