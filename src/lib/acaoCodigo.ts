import { supabase } from "@/integrations/supabase/client";

// `codigo` estável da tese (contrato da detecção — tools/pje_teses_empresa.py).
// O nome pode ser renomeado; o codigo NÃO muda. Ver tools/seed_codigos_teses.py.

/** Slug base a partir do nome: MAIÚSCULO, sem acento, `_` no lugar de não-alfanum. */
export function slugTese(nome: string): string {
  return (
    (nome || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 55) || "TESE"
  );
}

/** Gera um codigo ESTÁVEL único (slug do nome + sufixo numérico se colidir). */
export async function gerarCodigoUnico(nome: string): Promise<string> {
  const base = slugTese(nome);
  const { data } = await supabase
    .from("acoes_tributarias")
    .select("codigo")
    .ilike("codigo", `${base}%`);
  const usados = new Set((data ?? []).map((r) => (r.codigo || "").toUpperCase()));
  let codigo = base;
  for (let i = 2; usados.has(codigo); i++) codigo = `${base}_${i}`;
  return codigo;
}

/** true se já existe uma tese com esse nome (case-insensitive) — nome duplicado
 *  quebra o mapeamento tese→id da detecção. */
export async function nomeTeseExiste(nome: string): Promise<boolean> {
  const { data } = await supabase
    .from("acoes_tributarias")
    .select("id")
    .ilike("nome", nome.trim())
    .limit(1);
  return !!(data && data.length > 0);
}
