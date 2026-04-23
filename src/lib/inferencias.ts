// Inferências determinísticas para empresas a partir de dados RFB já enriquecidos.
// Zero custo, sem APIs externas — usa porte, opcao_simples, opcao_mei, capital_social,
// cnae_principal pra preencher faixa_funcionarios, faixa_faturamento e regime_tributario.
//
// Restrição-chave: NUNCA sobrescreve dados manuais. As funções `inferir*` retornam
// sugestões; cabe ao chamador decidir se aplica (verificando se o campo está vazio).

import type { Empresa } from "@/hooks/useEmpresas";

// =========================================================================
// FAIXA DE FUNCIONÁRIOS
// =========================================================================
const FAIXA_FUNC_POR_PORTE: Record<string, string> = {
  MEI:    "1 funcionário (sócio único + máx 1 colaborador)",
  ME:     "1–9 funcionários",
  EPP:    "10–49 funcionários",
  DEMAIS: "50+ funcionários",
};

/**
 * Proxy numérico (midpoint de cada faixa) para popular `quantidade_funcionarios`.
 * Permite que filtros numéricos por range funcionem com dados inferidos.
 */
const FUNC_NUMERICO_POR_PORTE: Record<string, number> = {
  MEI:    1,
  ME:     5,    // midpoint de 1-9
  EPP:    30,   // midpoint de 10-49
  DEMAIS: 100,  // lower bound (não há limite superior)
};

export function inferirFaixaFuncionarios(emp: Pick<Empresa, "porte">): string | null {
  const porte = emp.porte;
  if (!porte || porte === "NAO_INFORMADO") return null;
  return FAIXA_FUNC_POR_PORTE[porte] ?? null;
}

export function inferirNumeroFuncionarios(emp: Pick<Empresa, "porte">): number | null {
  const porte = emp.porte;
  if (!porte || porte === "NAO_INFORMADO") return null;
  return FUNC_NUMERICO_POR_PORTE[porte] ?? null;
}

// =========================================================================
// FAIXA DE FATURAMENTO ANUAL
// Baseada nos limites oficiais do Simples Nacional / Lucro Presumido.
// =========================================================================
const FAIXA_FAT_POR_PORTE: Record<string, string> = {
  MEI:    "Até R$ 81.000/ano (limite MEI)",
  ME:     "Até R$ 360.000/ano (limite ME no SN)",
  EPP:    "R$ 360.000–4.800.000/ano (faixa EPP no SN)",
  DEMAIS: "Acima de R$ 4.800.000/ano (fora do Simples)",
};

/**
 * Proxy numérico (midpoint/upper-bound) pra popular `faturamento_anual`
 * — permite filtros por range funcionarem com dados inferidos.
 */
const FAT_NUMERICO_POR_PORTE: Record<string, number> = {
  MEI:    81_000,         // limite máximo
  ME:     360_000,        // limite máximo
  EPP:    2_580_000,      // midpoint de 360k–4,8M
  DEMAIS: 5_000_000,      // lower bound (sem teto)
};

export function inferirNumeroFaturamento(emp: Pick<Empresa, "porte" | "capital_social">): number | null {
  if (emp.porte && emp.porte !== "NAO_INFORMADO" && FAT_NUMERICO_POR_PORTE[emp.porte]) {
    return FAT_NUMERICO_POR_PORTE[emp.porte];
  }
  // Fallback por capital social
  const cap = Number(emp.capital_social ?? 0);
  if (cap >= 5_000_000) return 5_000_000;
  if (cap >= 500_000) return 2_580_000;
  if (cap >= 50_000) return 360_000;
  if (cap > 0) return 81_000;
  return null;
}

export function inferirFaixaFaturamento(emp: Pick<Empresa, "porte" | "capital_social">): string | null {
  const porte = emp.porte;
  if (porte && porte !== "NAO_INFORMADO" && FAIXA_FAT_POR_PORTE[porte]) {
    return FAIXA_FAT_POR_PORTE[porte];
  }
  // Fallback por capital social — proxy fraco mas melhor que nada
  const cap = Number(emp.capital_social ?? 0);
  if (cap > 0) {
    if (cap >= 5_000_000) return "Acima de R$ 4.800.000/ano (estimado por capital social alto)";
    if (cap >= 500_000)   return "R$ 360.000–4.800.000/ano (estimado por capital social)";
    if (cap >= 50_000)    return "Até R$ 360.000/ano (estimado por capital social)";
    return "Até R$ 81.000/ano (estimado por capital social baixo)";
  }
  return null;
}

// =========================================================================
// REGIME TRIBUTÁRIO
// Cascata: MEI → Simples → CNAE-obriga-Real → DEMAIS=Real → EPP=Presumido
// =========================================================================

/** Prefixos de CNAE em que Lucro Real é OBRIGATÓRIO por lei (art. 14 Lei 9.718/98). */
const CNAE_LUCRO_REAL_OBRIGATORIO = [
  "6410", // Bancos comerciais
  "6411", // Banco central
  "6421", // Bancos múltiplos com carteira comercial
  "6422", // Bancos múltiplos sem carteira comercial
  "6423", // Caixas econômicas
  "6424", // Crédito cooperativo
  "643",  // Bancos de investimento
  "6431", // Bancos de investimento (subgrupo)
  "6432", // Bancos de desenvolvimento
  "6435", // Caixas autárquicas
  "6436", // Sociedades de crédito
  "6438", // Outras instituições intermediárias
  "6440", // Arrendamento mercantil (leasing)
  "6450", // Sociedades de capitalização
  "6463", // Fundos de investimento
  "6470", // Atividades de fundos de investimento
  "6491", // Sociedades de fomento mercantil (factoring)
  "6492", // Securitização de créditos
  "6493", // Administradoras de cartões
  "6499", // Outras atividades financeiras n.e.
  "6511", // Seguros de vida
  "6512", // Seguros não-vida
  "6520", // Resseguros
  "6530", // Previdência complementar
  "6541", // Planos de saúde
  "6611", // Bolsas de valores
  "6612", // Corretoras
  "6613", // Depositárias
  "6619", // Outras atividades auxiliares de serviços financeiros
  "6621", // Avaliação de riscos e perdas
  "6622", // Corretores de seguros
  "6629", // Outras atividades auxiliares de seguros
  "6630", // Atividades de administração de fundos
];

function cnaePrefixoMatch(cnae: string | null | undefined, prefixos: string[]): boolean {
  if (!cnae) return false;
  // Normaliza: remove pontos/hifens, pega só dígitos
  const limpo = cnae.replace(/\D/g, "");
  return prefixos.some((p) => limpo.startsWith(p));
}

export type Confianca = "alta" | "media" | "baixa";

export function inferirRegime(emp: Pick<Empresa, "opcao_mei" | "opcao_simples" | "porte" | "cnae_principal">): {
  valor: string;
  confianca: Confianca;
  motivo: string;
} | null {
  // 1) MEI explícito da Receita
  if (emp.opcao_mei === true) {
    return { valor: "mei", confianca: "alta", motivo: "opcao_mei=true (RFB)" };
  }
  // 2) Simples explícito da Receita (e não MEI)
  if (emp.opcao_simples === true) {
    return { valor: "simples", confianca: "alta", motivo: "opcao_simples=true (RFB)" };
  }
  // 3) CNAE obriga Lucro Real
  if (cnaePrefixoMatch(emp.cnae_principal, CNAE_LUCRO_REAL_OBRIGATORIO)) {
    return {
      valor: "lucro_real",
      confianca: "media",
      motivo: `CNAE ${emp.cnae_principal} obriga Lucro Real (art. 14 Lei 9.718/98)`,
    };
  }
  // 4) Empresas grandes (DEMAIS) raramente Presumido — vai pra Real
  if (emp.porte === "DEMAIS") {
    return { valor: "lucro_real", confianca: "media", motivo: "porte=DEMAIS (acima do limite SN)" };
  }
  // 5) EPP fora do Simples → presumido (default conservador)
  if (emp.porte === "EPP") {
    return { valor: "lucro_presumido", confianca: "baixa", motivo: "porte=EPP fora do SN (presumido como default)" };
  }
  // 6) Sem dados suficientes
  return null;
}

// =========================================================================
// ORQUESTRADOR
// =========================================================================
export interface InferenciaResultado {
  /** Patch para aplicar no banco (só campos a serem atualizados; vazios não sobrescritos). */
  patch: {
    regime_tributario?: string | null;
    quantidade_funcionarios?: number | null;
    faturamento_anual?: number | null;
    metadados?: Record<string, string>;
  };
  /** Lista humana de fontes pra mostrar em toast. */
  fontes: string[];
  confianca: Confianca | null;
}

/**
 * Roda todas as inferências mas só sugere preencher o que está VAZIO na empresa.
 * Retorna patch pronto pra `update`. Vazio (sem campos sugeridos) → patch = {}.
 */
export function aplicarInferencias(emp: Empresa): InferenciaResultado {
  const patch: InferenciaResultado["patch"] = {};
  const fontes: string[] = [];
  let menorConfianca: Confianca | null = null;
  const piorar = (c: Confianca) => {
    if (!menorConfianca) { menorConfianca = c; return; }
    const ordem: Record<Confianca, number> = { alta: 3, media: 2, baixa: 1 };
    if (ordem[c] < ordem[menorConfianca]) menorConfianca = c;
  };

  // Regime tributário
  if (!emp.regime_tributario) {
    const r = inferirRegime(emp);
    if (r) {
      patch.regime_tributario = r.valor;
      fontes.push(`regime: ${r.valor} (${r.motivo})`);
      piorar(r.confianca);
    }
  }

  // Faixas em metadados (preserva campos manuais existentes)
  const metaAtual = emp.metadados ?? {};
  const novoMeta: Record<string, string> = {};

  if (!metaAtual["Faixa de Funcionários"]) {
    const f = inferirFaixaFuncionarios(emp);
    if (f) {
      novoMeta["Faixa de Funcionários"] = f;
      fontes.push(`funcionários: ${f}`);
      piorar("alta"); // alta porque vem direto do porte RFB
    }
  }

  if (!metaAtual["Faixa de Faturamento"]) {
    const f = inferirFaixaFaturamento(emp);
    if (f) {
      novoMeta["Faixa de Faturamento"] = f;
      fontes.push(`faturamento: ${f}`);
      piorar("media");
    }
  }

  if (Object.keys(novoMeta).length > 0) {
    patch.metadados = { ...metaAtual, ...novoMeta };
  }

  // Numéricos proxy — necessários pros filtros por range (gte/lte) funcionarem.
  // Só preenche se ainda estiver vazio. Detail sheet/dialog mostra a faixa
  // textual original em metadados (preserva nuance), enquanto o número é o
  // midpoint pra possibilitar filtragem.
  if (emp.quantidade_funcionarios == null) {
    const n = inferirNumeroFuncionarios(emp);
    if (n != null) {
      patch.quantidade_funcionarios = n;
      // Não duplica em fontes (já registramos a faixa textual acima)
    }
  }

  if (emp.faturamento_anual == null) {
    const v = inferirNumeroFaturamento(emp);
    if (v != null) {
      patch.faturamento_anual = v;
    }
  }

  return { patch, fontes, confianca: menorConfianca };
}
