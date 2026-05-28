/**
 * Helpers para extrair mensagens de erro de forma resiliente.
 *
 * PostgrestError do supabase-js **não** é `instanceof Error` — usar
 * `e.message` direto perde `details/hint/code`. Esse helper unifica o
 * tratamento em `Error nativo | PostgrestError | string | unknown`.
 *
 * Antes vivia em src/pages/Importacao.tsx e foi reimplementado (com
 * variações) em useEmpresas, Prospeccao, Acoes.
 */

/** Códigos Postgres que vale tratar de forma especial. */
export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
} as const;

/** Extrai mensagem legível de qualquer erro. */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // PostgrestError: { message, details, hint, code }
    const parts: string[] = [];
    if (typeof e.message === "string") parts.push(e.message);
    if (typeof e.details === "string") parts.push(e.details);
    if (typeof e.hint === "string") parts.push(`(${e.hint})`);
    if (typeof e.code === "string") parts.push(`[code ${e.code}]`);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }
  return "erro desconhecido";
}

/** Extrai o `code` de PostgrestError (ou null se não houver). */
export function extractPgErrorCode(err: unknown): string | null {
  if (err && typeof err === "object") {
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** True se o erro é uma violação de unique constraint (CNPJ duplicado, etc). */
export function isUniqueViolation(err: unknown): boolean {
  return extractPgErrorCode(err) === PG_ERROR_CODES.UNIQUE_VIOLATION;
}
