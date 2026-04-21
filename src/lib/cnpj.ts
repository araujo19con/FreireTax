/**
 * Utilitários de CNPJ: máscara, desmáscara e validação real (módulo 11).
 */

/** Remove tudo que não for dígito. */
export function unmaskCNPJ(value: string): string {
  return (value || "").replace(/\D/g, "");
}

/** Aplica máscara 00.000.000/0000-00. Aceita com ou sem máscara. */
export function maskCNPJ(value: string): string {
  const d = unmaskCNPJ(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/**
 * Valida CNPJ via algoritmo módulo 11 (dígitos verificadores).
 * Aceita com ou sem máscara. Rejeita sequências repetidas (ex: 11111111111111).
 */
export function validateCNPJ(value: string): boolean {
  const cnpj = unmaskCNPJ(value);
  if (cnpj.length !== 14) return false;
  // rejeita todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base: string, weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(base[i], 10) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(cnpj.slice(0, 12), weights1);
  if (d1 !== parseInt(cnpj[12], 10)) return false;

  const d2 = calc(cnpj.slice(0, 13), weights2);
  if (d2 !== parseInt(cnpj[13], 10)) return false;

  return true;
}

/** Retorna null se válido, ou uma mensagem de erro pt-BR caso inválido. */
export function validateCNPJMessage(value: string): string | null {
  const cnpj = unmaskCNPJ(value);
  if (!cnpj) return "CNPJ é obrigatório";
  if (cnpj.length !== 14) return "CNPJ deve ter 14 dígitos";
  if (/^(\d)\1{13}$/.test(cnpj)) return "CNPJ inválido (sequência repetida)";
  if (!validateCNPJ(cnpj)) return "CNPJ inválido (dígitos verificadores)";
  return null;
}
