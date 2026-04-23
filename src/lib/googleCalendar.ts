/**
 * Quick-Add URL do Google Calendar — abre o editor de evento preenchido.
 * Zero autenticação necessária (o usuário final cria o evento com a própria
 * conta Google, e pode ativar "Adicionar Google Meet" com 1 clique pra gerar
 * link Meet automaticamente).
 *
 * Docs: https://support.google.com/calendar/thread/81344786
 */

interface GoogleCalendarEventInput {
  title: string;
  description?: string | null;
  /** Início em Date ou string ISO */
  start: Date | string;
  /** Fim em Date ou string ISO */
  end: Date | string;
  location?: string | null;
  /** Emails pra pré-adicionar como convidados */
  attendees?: Array<string | null | undefined>;
}

/**
 * Formato de data exigido pelo Calendar: YYYYMMDDTHHmmssZ (UTC, basic ISO 8601).
 */
function formatCalendarDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildGoogleCalendarUrl(input: GoogleCalendarEventInput): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", input.title);

  const startStr = formatCalendarDate(input.start);
  const endStr = formatCalendarDate(input.end);
  params.set("dates", `${startStr}/${endStr}`);

  if (input.description) params.set("details", input.description);
  if (input.location) params.set("location", input.location);

  const attendees = (input.attendees ?? [])
    .map((e) => (e ?? "").trim())
    .filter((e) => e.length > 0 && e.includes("@"));
  if (attendees.length > 0) {
    // O Calendar aceita vírgula OU múltiplos `add=`; vírgula é mais curta
    params.set("add", attendees.join(","));
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
