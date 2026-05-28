/**
 * Paginação completa de queries Supabase.
 *
 * PostgREST tem cap em `max-rows` (~1000) por response, então `.range(0, 9999)`
 * silenciosamente trunca em 1000. Esse helper pagina em chunks de 1000 até
 * esgotar (ou bater a trava de segurança).
 *
 * Duas formas:
 *   1. `fetchAllRows<T>("empresas", "id, nome")` — caso simples (sem filtros)
 *   2. `fetchAllRows<T>((from, to) => supabase.from(...).select(...).eq(...).range(from, to))`
 *      — quando precisa de filtros/joins customizados
 */
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 1000;
const SAFETY_CAP = 200_000;

// Resultado mínimo de uma query Supabase paginada que nos interessa. Usamos
// `unknown` em vez do tipo nominal pra aceitar tanto PostgrestSingleResponse
// quanto outros wrappers — só precisamos do shape {data, error}.
type RangeResult<T> = { data: T[] | null; error: unknown };

// PromiseLike pra aceitar tanto Promise quanto o thenable do PostgrestFilterBuilder.
// Não tipamos o T aqui — só extraímos `{data, error}` via assertion no consumo.
type BuildQuery = (from: number, to: number) => PromiseLike<unknown>;

export interface FetchAllOptions {
  /** Tamanho da página (default 1000, alinhado com max-rows do PostgREST). */
  pageSize?: number;
  /** Limite de segurança para não fazer loop infinito (default 200k linhas). */
  safetyCap?: number;
}

export async function fetchAllRows<T>(
  table: string,
  select: string,
  options?: FetchAllOptions
): Promise<T[]>;
export async function fetchAllRows<T>(
  buildQuery: BuildQuery,
  options?: FetchAllOptions
): Promise<T[]>;
export async function fetchAllRows<T>(
  tableOrBuilder: string | BuildQuery,
  selectOrOptions?: string | FetchAllOptions,
  maybeOptions?: FetchAllOptions
): Promise<T[]> {
  const isBuilder = typeof tableOrBuilder === "function";
  const options: FetchAllOptions =
    (isBuilder ? (selectOrOptions as FetchAllOptions | undefined) : maybeOptions) ?? {};

  const pageSize = options.pageSize ?? PAGE_SIZE;
  const safetyCap = options.safetyCap ?? SAFETY_CAP;

  // Supabase types só aceitam tabelas no union literal. Para o overload
  // simples por string, escapamos via `as never` — caller é responsável por
  // passar nome de tabela válido. Helper interno, sem risco de uso externo
  // com strings dinâmicas suspeitas.
  let builder: BuildQuery;
  if (typeof tableOrBuilder === "function") {
    builder = tableOrBuilder;
  } else {
    const table = tableOrBuilder;
    const select = selectOrOptions as string;
    builder = (from, to) =>
      supabase
        .from(table as never)
        .select(select)
        .range(from, to);
  }

  const out: T[] = [];
  for (let from = 0; from < safetyCap; from += pageSize) {
    const result = (await builder(from, from + pageSize - 1)) as RangeResult<T>;
    if (result.error) throw result.error;
    const batch = result.data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}
