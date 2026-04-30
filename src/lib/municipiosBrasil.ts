/**
 * Normaliza o nome de um município para comparação case/acento-insensitiva.
 * Ex: "São Paulo" → "SAO PAULO", "são paulo" → "SAO PAULO"
 */
export function normalizeMunicipio(nome: string | null | undefined): string {
  if (!nome) return "";
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}
