// Supabase Edge Function: gerar-tarefas-recorrentes
// Lê tarefas com recurrence_rule e recurrence_next_run <= hoje,
// cria a próxima instância, e atualiza recurrence_next_run para a próxima ocorrência.
//
// Agendamento: invoque via Scheduled Job diário (Supabase CLI):
//   supabase functions schedule create gerar-tarefas-recorrentes --cron "0 3 * * *"
//
// Regras suportadas em recurrence_rule (formato simples; RRULE RFC 5545 futuro):
//   "daily"          → toda execução
//   "weekly"         → +7 dias
//   "weekly:MON"     → próximo dia da semana (MON,TUE,WED,THU,FRI,SAT,SUN)
//   "monthly"        → +1 mês (mesmo dia)
//   "monthly:15"     → dia 15 do próximo mês

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

interface TarefaRecorrente {
  id: string;
  titulo: string;
  descricao: string | null;
  prioridade: string | null;
  recurrence_rule: string;
  recurrence_parent_id: string | null;
  recurrence_next_run: string;
  empresa_id: string | null;
  acao_id: string | null;
  prospeccao_id: string | null;
  assigned_to: string | null;
  user_id: string;
  created_by: string;
  template_id: string | null;
}

function calcNextRun(from: Date, rule: string): Date {
  const r = rule.trim().toLowerCase();
  const next = new Date(from);

  if (r === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (r === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (r.startsWith("weekly:")) {
    const dayMap: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    const target = dayMap[r.slice(7)];
    if (target == null) { next.setDate(next.getDate() + 7); return next; }
    let delta = (target - next.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    next.setDate(next.getDate() + delta);
    return next;
  }
  if (r === "monthly") {
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  if (r.startsWith("monthly:")) {
    const day = parseInt(r.slice(8), 10);
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      next.setMonth(next.getMonth() + 1);
      return next;
    }
    next.setMonth(next.getMonth() + 1);
    next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
    return next;
  }
  // fallback: adiciona 1 dia pra evitar loop
  next.setDate(next.getDate() + 1);
  return next;
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(year, monthZeroBased + 1, 0).getDate();
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  // Auth simples — requer header com o SERVICE ROLE KEY ou cron com secret
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedKey = Deno.env.get("CRON_SECRET") ?? "";
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const today = todayIsoDate();

  const { data: tarefas, error: listErr } = await supabase
    .from("tarefas")
    .select("*")
    .not("recurrence_rule", "is", null)
    .lte("recurrence_next_run", today);

  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), { status: 500 });
  }

  const criadas: string[] = [];
  const erros: Array<{ id: string; msg: string }> = [];

  for (const t of (tarefas ?? []) as TarefaRecorrente[]) {
    try {
      // Calcula próximo prazo
      const next = calcNextRun(new Date(t.recurrence_next_run + "T00:00:00Z"), t.recurrence_rule);
      const nextDate = next.toISOString().slice(0, 10);

      // Cria instância nova (clone com status pendente, apontando pai original)
      const parentId = t.recurrence_parent_id ?? t.id;
      const { data: created, error: insErr } = await supabase
        .from("tarefas")
        .insert({
          titulo: t.titulo,
          descricao: t.descricao,
          status: "pendente",
          prioridade: t.prioridade ?? "media",
          empresa_id: t.empresa_id,
          acao_id: t.acao_id,
          prospeccao_id: t.prospeccao_id,
          assigned_to: t.assigned_to,
          user_id: t.user_id,
          created_by: t.created_by,
          template_id: t.template_id,
          recurrence_parent_id: parentId,
          prazo: nextDate,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      // Atualiza next_run da tarefa-mãe (ou da própria, se for a primeira)
      const { error: updErr } = await supabase
        .from("tarefas")
        .update({ recurrence_next_run: nextDate })
        .eq("id", t.id);
      if (updErr) throw updErr;

      criadas.push(created.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      erros.push({ id: t.id, msg });
    }
  }

  return new Response(JSON.stringify({
    processed: tarefas?.length ?? 0,
    criadas: criadas.length,
    erros,
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
