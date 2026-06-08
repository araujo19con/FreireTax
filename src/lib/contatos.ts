/**
 * Helpers do domínio de CONTATOS de empresa (empresa_contatos).
 *
 * Centraliza rótulos/cores de papel, normalização de telefone BR e geração de
 * links acionáveis (tel:, wa.me, mailto:, linkedin) usados no card de contatos
 * e em qualquer lugar que precise "ligar / chamar no zap / mandar email".
 */

import type { Database } from "@/integrations/supabase/types";

export type EmpresaContato = Database["public"]["Tables"]["empresa_contatos"]["Row"];
export type EmpresaContatoInsert = Database["public"]["Tables"]["empresa_contatos"]["Insert"];
export type PapelContato = Database["public"]["Enums"]["papel_contato"];
export type OrigemContato = Database["public"]["Enums"]["origem_contato"];
export type TipoTelefone = Database["public"]["Enums"]["tipo_telefone"];

// ---------------------------------------------------------------------------
// Papel (função do contato na empresa)
// ---------------------------------------------------------------------------
export const PAPEL_CONTATO: {
  value: PapelContato;
  label: string;
  /** classes tailwind para badge (mesmo padrão do resto do app) */
  color: string;
}[] = [
  { value: "socio", label: "Sócio", color: "bg-primary/10 text-primary" },
  { value: "decisor", label: "Decisor", color: "bg-success/10 text-success" },
  { value: "financeiro", label: "Financeiro", color: "bg-info/10 text-info" },
  { value: "juridico", label: "Jurídico", color: "bg-violet-500/10 text-violet-600" },
  { value: "comercial", label: "Comercial", color: "bg-amber-500/10 text-amber-600" },
  { value: "operacional", label: "Operacional", color: "bg-muted text-muted-foreground" },
  { value: "contador", label: "Contador", color: "bg-orange-500/10 text-orange-600" },
  { value: "geral", label: "Canal geral", color: "bg-muted text-muted-foreground" },
  { value: "outro", label: "Outro", color: "bg-muted text-muted-foreground" },
];

const PAPEL_MAP = new Map(PAPEL_CONTATO.map((p) => [p.value, p]));

export function humanizePapel(papel: PapelContato | null | undefined): string {
  if (!papel) return "—";
  return PAPEL_MAP.get(papel)?.label ?? papel;
}

export function papelColor(papel: PapelContato | null | undefined): string {
  if (!papel) return "bg-muted text-muted-foreground";
  return PAPEL_MAP.get(papel)?.color ?? "bg-muted text-muted-foreground";
}

/**
 * Deriva o papel a partir do cargo (texto livre da DRIVA / digitado).
 * Contador sempre vence (DRIVA marca "Pertence ao Contador").
 */
export function derivePapel(
  cargo: string | null | undefined,
  isContador = false,
  temNome = true
): PapelContato {
  if (isContador) return "contador";
  const c = (cargo ?? "").toLowerCase();
  if (!c) return temNome ? "outro" : "geral";
  if (/cont(a|á)bil|contador/.test(c)) return "contador";
  if (/administrador|s[oó]cio|titular|propriet/.test(c)) return "socio";
  if (/financ|cfo|controll|controlad|tesour/.test(c)) return "financeiro";
  if (/jur[ií]d|advog|legal/.test(c)) return "juridico";
  if (/comerc|vend|marketing|coml/.test(c)) return "comercial";
  if (/diretor|presid|ceo|propriet|gerente geral|fundador|owner|s[oó]cio/.test(c)) return "decisor";
  if (/gerente|coorden|supervis|analist|assist|auxiliar|oper/.test(c)) return "operacional";
  return "outro";
}

/** Rótulo curto + cor do badge por origem (procedência do canal). */
export const ORIGEM_CONTATO_META: Record<OrigemContato, { label: string; color: string }> = {
  driva: { label: "DRIVA", color: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
  rfb: { label: "Receita", color: "bg-info/10 text-info border-info/20" },
  manual: { label: "Manual", color: "bg-muted text-muted-foreground border-border" },
  importacao: { label: "Importação", color: "bg-muted text-muted-foreground border-border" },
  enriquecimento: {
    label: "Enriquec.",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  outro: { label: "Outro", color: "bg-muted text-muted-foreground border-border" },
};

export const ORIGEM_CONTATO_LABEL: Record<OrigemContato, string> = {
  driva: "DRIVA",
  rfb: "Receita",
  manual: "Manual",
  importacao: "Importação",
  enriquecimento: "Enriquecimento",
  outro: "Outro",
};

export function humanizeOrigem(o: string | null | undefined): string {
  if (!o) return "—";
  return ORIGEM_CONTATO_META[o as OrigemContato]?.label ?? o;
}

export function origemColor(o: string | null | undefined): string {
  const fallback = "bg-muted text-muted-foreground border-border";
  if (!o) return fallback;
  return ORIGEM_CONTATO_META[o as OrigemContato]?.color ?? fallback;
}

// ---------------------------------------------------------------------------
// Telefone BR
// ---------------------------------------------------------------------------

/** Só dígitos. */
export function onlyDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * Normaliza para E.164 brasileiro (55 + DDD + número), quando possível.
 * Retorna "" se não der pra inferir um número discável.
 */
export function toE164BR(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (!d) return "";
  // já veio com 55 + DDD + número (12 = fixo, 13 = celular)
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  // DDD + número (10 = fixo, 11 = celular)
  if (d.length === 10 || d.length === 11) return "55" + d;
  // número sem DDD: não dá pra discar com segurança
  if (d.length === 8 || d.length === 9) return "";
  // fallback: se tiver 55 na frente, confia
  if (d.startsWith("55") && d.length >= 12) return d;
  return "";
}

/** (84) 99999-9999 / (84) 3333-4444 — visual pt-BR. */
export function formatPhoneBR(raw: string | null | undefined): string {
  let d = onlyDigits(raw);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2); // tira país
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return raw ?? "";
}

/** Heurística: celular (DDD + 9 dígitos começando em 9) tende a ter WhatsApp. */
export function pareceCelular(raw: string | null | undefined): boolean {
  let d = onlyDigits(raw);
  if (d.startsWith("55")) d = d.slice(2);
  return d.length === 11 && d[2] === "9";
}

/** tel:+55... — null se não houver número discável. */
export function telLink(raw: string | null | undefined): string | null {
  const e164 = toE164BR(raw);
  if (e164) return `tel:+${e164}`;
  const d = onlyDigits(raw);
  return d ? `tel:${d}` : null;
}

/** https://wa.me/55...?text=... — null se não der pra montar internacional. */
export function waLink(raw: string | null | undefined, mensagem?: string): string | null {
  const e164 = toE164BR(raw);
  if (!e164) return null;
  const base = `https://wa.me/${e164}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}

/** mailto:... — null se vazio. */
export function mailtoLink(email: string | null | undefined, assunto?: string): string | null {
  const e = (email ?? "").trim();
  if (!e) return null;
  return assunto ? `mailto:${e}?subject=${encodeURIComponent(assunto)}` : `mailto:${e}`;
}

/** Garante URL absoluta do LinkedIn. */
export function linkedinUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Ordenação para listagens (decisores primeiro, contador por último)
// ---------------------------------------------------------------------------
const PAPEL_RANK: Record<PapelContato, number> = {
  socio: 0,
  decisor: 1,
  financeiro: 2,
  juridico: 3,
  comercial: 4,
  operacional: 5,
  geral: 6,
  outro: 7,
  contador: 8,
};

export function rankContatos(a: EmpresaContato, b: EmpresaContato): number {
  if (a.principal !== b.principal) return a.principal ? -1 : 1;
  const ra = PAPEL_RANK[a.papel] ?? 9;
  const rb = PAPEL_RANK[b.papel] ?? 9;
  if (ra !== rb) return ra - rb;
  // quem tem nome antes de canal anônimo
  const na = a.nome ? 0 : 1;
  const nb = b.nome ? 0 : 1;
  if (na !== nb) return na - nb;
  return (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR");
}

/** Mensagem inicial padrão pro WhatsApp (editável depois). */
export function mensagemWhatsappPadrao(empresaNome: string, contatoNome?: string | null): string {
  const ola = contatoNome ? `Olá, ${contatoNome.split(" ")[0]}` : "Olá";
  return `${ola}! Aqui é do escritório Freire Pignataro Advogados. Gostaria de falar com o responsável da ${empresaNome} sobre uma oportunidade tributária. Tudo bem?`;
}
