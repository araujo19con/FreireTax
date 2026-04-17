// Motor de substituição de variáveis em templates de mensagem.
// Sintaxe: {{nome_variavel}} — case-sensitive.
//
// Variáveis conhecidas (expandido conforme necessário):
//   {{empresa}}           nome da empresa da prospecção
//   {{cnpj}}              CNPJ da empresa
//   {{contato_nome}}      nome do lead
//   {{contato_primeiro_nome}}  só o primeiro nome
//   {{tese}}              nome da ação tributária
//   {{valor_potencial}}   valor potencial estimado formatado
//   {{valor_80_potencial}} 80% do valor (usado em objeção de preço)
//   {{dias_prescricao}}   dias até prescrever
//   {{advogado_responsavel}} nome do responsável
//   {{data_hoje}}         data de hoje formatada

export interface TemplateVars {
  empresa?: string | null;
  cnpj?: string | null;
  contato_nome?: string | null;
  tese?: string | null;
  valor_potencial?: number | null;
  dias_prescricao?: number | null;
  advogado_responsavel?: string | null;
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

export function applyTemplate(text: string, vars: TemplateVars): string {
  const primeiroNome = (vars.contato_nome ?? "").split(/\s+/)[0] || "";

  const valorPot = vars.valor_potencial ?? 0;
  const valor80 = valorPot * 0.8;
  const hoje = new Date().toLocaleDateString("pt-BR");

  const map: Record<string, string> = {
    empresa: vars.empresa ?? "[empresa]",
    cnpj: vars.cnpj ?? "[CNPJ]",
    contato_nome: vars.contato_nome ?? "[contato]",
    contato_primeiro_nome: primeiroNome || "[contato]",
    tese: vars.tese ?? "[tese]",
    valor_potencial: valorPot > 0 ? formatBRL(valorPot) : "[valor a recuperar]",
    valor_80_potencial: valorPot > 0 ? formatBRL(valor80) : "[valor]",
    dias_prescricao: vars.dias_prescricao != null && vars.dias_prescricao > 0
      ? String(vars.dias_prescricao)
      : "[X]",
    advogado_responsavel: vars.advogado_responsavel ?? "[advogado]",
    data_hoje: hoje,
  };

  return text.replace(/\{\{(\w+)\}\}/g, (full, key) => {
    const v = map[key];
    return v != null ? v : full; // mantém variável não conhecida para evitar silenciosa perda
  });
}

// Lista de variáveis suportadas (usado na UI de edição de template)
export const TEMPLATE_VARS: { key: keyof typeof TEMPLATE_VAR_LABELS; label: string }[] = [
  { key: "empresa", label: "Nome da empresa" },
  { key: "cnpj", label: "CNPJ" },
  { key: "contato_nome", label: "Nome completo do lead" },
  { key: "contato_primeiro_nome", label: "Primeiro nome do lead" },
  { key: "tese", label: "Nome da tese/ação" },
  { key: "valor_potencial", label: "Valor potencial (R$)" },
  { key: "valor_80_potencial", label: "80% do valor potencial" },
  { key: "dias_prescricao", label: "Dias para prescrição" },
  { key: "advogado_responsavel", label: "Advogado responsável" },
  { key: "data_hoje", label: "Data de hoje" },
];

const TEMPLATE_VAR_LABELS = {
  empresa: 1, cnpj: 1, contato_nome: 1, contato_primeiro_nome: 1, tese: 1,
  valor_potencial: 1, valor_80_potencial: 1, dias_prescricao: 1,
  advogado_responsavel: 1, data_hoje: 1,
} as const;
