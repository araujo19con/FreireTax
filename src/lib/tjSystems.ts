/**
 * Registry de sistemas de processo eletrônico por estado (UF).
 *
 * FONTE ÚNICA DE VERDADE p/ o enriquecimento de sócios via tribunais. Cada UF tem
 * um sistema (PJe / eproc / Projudi / e-SAJ) — o parser de qualificação é reusado
 * entre todos (opera sobre o texto da petição), mas o SCRAPER (seletores/fluxo)
 * difere por sistema. As contagens de sócios vêm AO VIVO do banco (não ficam aqui).
 *
 * Verificado em 15/06/2026 (busca + inspeção de HTML). Ver tools/eproc_skiptrace.py,
 * tools/pje_rn_skiptrace.py, tools/projudi_skiptrace.py.
 */

export type TJSystem = "pje" | "eproc" | "projudi" | "esaj";

export type TJStatus =
  | "active" // scraper rodando/validado
  | "ready" // scraper pronto, falta 1 calibração (--inspect)
  | "scaffold" // estrutura criada, seletores a descobrir
  | "todo" // sistema mapeado, scraper não construído
  | "blocked"; // inviável (ex: Cloudflare/CAPTCHA)

export type TJAccess = "a3" | "public" | "public+a3";

export interface TJInfo {
  uf: string;
  system: TJSystem;
  status: TJStatus;
  access: TJAccess;
  scraper: string | null; // comando do tool, ou null
  base: string | null; // URL base do sistema
  note?: string;
}

/** Labels e cores por sistema (p/ badges no dashboard). */
export const SYSTEM_META: Record<TJSystem, { label: string; color: string }> = {
  pje: { label: "PJe", color: "text-blue-600" },
  eproc: { label: "eproc", color: "text-purple-600" },
  projudi: { label: "Projudi", color: "text-teal-600" },
  esaj: { label: "e-SAJ", color: "text-pink-600" },
};

export const STATUS_META: Record<TJStatus, { label: string; color: string }> = {
  active: { label: "rodando", color: "text-green-600" },
  ready: { label: "pronto (calibrar)", color: "text-amber-600" },
  scaffold: { label: "scaffold", color: "text-orange-600" },
  todo: { label: "a fazer", color: "text-muted-foreground" },
  blocked: { label: "bloqueado", color: "text-red-600" },
};

/**
 * Mapa UF → sistema. Os 5 grandes (RN/PR/RS/SC/PB) têm tratamento dedicado; os
 * estados pequenos (<30 sócios) majoritariamente usam PJe (CNJ) e ficam como
 * "todo" de baixa prioridade. e-SAJ (SP) e PJe-com-consulta-pública (DF/MG) idem.
 */
export const TJ_SYSTEMS: Record<string, TJInfo> = {
  RN: {
    uf: "RN",
    system: "pje",
    status: "active",
    access: "a3",
    scraper: "pje_rn_skiptrace.py",
    base: "https://pje1g.tjrn.jus.br/pje/",
    note: "Funciona; limite ~100 sócios/dia no TJRN.",
  },
  PR: {
    uf: "PR",
    system: "projudi",
    status: "scaffold",
    access: "a3",
    scraper: "projudi_skiptrace.py",
    base: "https://projudi.tjpr.jus.br/projudi/",
    note: "PJe foi DESATIVADO no PR; processos migrados p/ Projudi (e eproc em curso).",
  },
  RS: {
    uf: "RS",
    system: "eproc",
    status: "ready",
    access: "a3",
    scraper: "eproc_skiptrace.py --tj rs",
    base: "https://eproc1g.tjrs.jus.br/eproc/",
    note: "Seletores reais já no script; falta 1 passada --inspect logado.",
  },
  SC: {
    uf: "SC",
    system: "eproc",
    status: "ready",
    access: "a3",
    scraper: "eproc_skiptrace.py --tj sc",
    base: "https://eproc1g.tjsc.jus.br/eproc/",
    note: "Mesmo codebase do RS; consulta pública é gated por CAPTCHA (usar A3).",
  },
  PB: {
    uf: "PB",
    system: "pje",
    status: "blocked",
    access: "a3",
    scraper: null,
    base: "https://pje1g.tjpb.jus.br/pje/",
    note: "PJe, mas Cloudflare bloqueia o domínio todo. Via DRIVA é mais viável.",
  },
  SP: {
    uf: "SP",
    system: "esaj",
    status: "blocked",
    access: "public+a3",
    scraper: "esaj_skiptrace.py (inviável)",
    base: "https://esaj.tjsp.jus.br/cpopg/open.do",
    note: "INVIÁVEL p/ skip-trace: busca acha os processos, mas o e-SAJ só libera os autos (com CPF/endereço) a advogado HABILITADO no processo. eproc-SP ~0 cobertura. Sem caminho judicial p/ SP.",
  },
  DF: {
    uf: "DF",
    system: "pje",
    status: "todo",
    access: "public+a3",
    scraper: null,
    base: "https://pje-consultapublica.tjdft.jus.br/",
    note: "PJe com consulta pública; parser do RN reusável (parametrizar UF).",
  },
  MG: {
    uf: "MG",
    system: "pje",
    status: "todo",
    access: "public+a3",
    scraper: null,
    base: "https://pje-consulta-publica.tjmg.jus.br/",
    note: "PJe (migrando p/ eproc); tem consulta pública.",
  },
  GO: { uf: "GO", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  PE: { uf: "PE", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  RJ: { uf: "RJ", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  MT: { uf: "MT", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  MA: { uf: "MA", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  AL: { uf: "AL", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  PA: { uf: "PA", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  CE: { uf: "CE", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  ES: { uf: "ES", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  SE: { uf: "SE", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  BA: { uf: "BA", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  PI: { uf: "PI", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  MS: { uf: "MS", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
  RO: { uf: "RO", system: "pje", status: "todo", access: "a3", scraper: null, base: null },
};

/** Fallback p/ UF não mapeada: assume PJe (maioria CNJ), status todo. */
export function tjInfo(uf: string): TJInfo {
  return (
    TJ_SYSTEMS[uf] ?? {
      uf,
      system: "pje",
      status: "todo",
      access: "a3",
      scraper: null,
      base: null,
      note: "UF não mapeada — assume PJe (verificar).",
    }
  );
}
