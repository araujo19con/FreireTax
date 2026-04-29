// Capitais estaduais e helpers para o filtro de "Interior"
// A lista completa de municípios é buscada da API do IBGE no componente MunicipioMultiSelect.

export const CAPITAIS_UF: Record<string, string> = {
  AC: "Rio Branco",
  AL: "Maceió",
  AP: "Macapá",
  AM: "Manaus",
  BA: "Salvador",
  CE: "Fortaleza",
  DF: "Brasília",
  ES: "Vitória",
  GO: "Goiânia",
  MA: "São Luís",
  MT: "Cuiabá",
  MS: "Campo Grande",
  MG: "Belo Horizonte",
  PA: "Belém",
  PB: "João Pessoa",
  PR: "Curitiba",
  PE: "Recife",
  PI: "Teresina",
  RJ: "Rio de Janeiro",
  RN: "Natal",
  RS: "Porto Alegre",
  RO: "Porto Velho",
  RR: "Boa Vista",
  SC: "Florianópolis",
  SP: "São Paulo",
  SE: "Aracaju",
  TO: "Palmas",
};

/** Retorna as capitais das UFs fornecidas (sem duplicatas). */
export function getCapitaisForUFs(ufs: string[]): string[] {
  return [...new Set(ufs.map((uf) => CAPITAIS_UF[uf]).filter(Boolean))];
}

/** Retorna true se o município é capital da UF. */
export function isCapital(municipio: string, uf: string): boolean {
  return CAPITAIS_UF[uf]?.toLowerCase() === municipio?.toLowerCase();
}

// ---------------------------------------------------------------------------
// Helpers para busca IBGE (usados pelo MunicipioMultiSelect)
// ---------------------------------------------------------------------------

export interface IBGEMunicipio {
  id: number;
  nome: string;
  uf: string; // sigla
}

const CACHE_KEY = "ibge_municipios_v1";
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

interface CacheEntry {
  ts: number;
  data: IBGEMunicipio[];
}

function readCache(): IBGEMunicipio[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_MAX_AGE_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(data: IBGEMunicipio[]): void {
  try {
    const entry: CacheEntry = { ts: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage cheio — ignora, não é crítico
  }
}

let _inFlight: Promise<IBGEMunicipio[]> | null = null;

/** Busca todos os municípios do Brasil via API IBGE. Usa cache localStorage (30 dias). */
export async function fetchMunicipiosIBGE(): Promise<IBGEMunicipio[]> {
  const cached = readCache();
  if (cached) return cached;

  // evita múltiplos fetches simultâneos
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    const res = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`IBGE API ${res.status}`);
    const raw = await res.json() as Array<{
      id: number;
      nome: string;
      microrregiao: { mesorregiao: { UF: { sigla: string } } };
    }>;
    const data: IBGEMunicipio[] = raw.map((m) => ({
      id: m.id,
      nome: m.nome,
      uf: m.microrregiao.mesorregiao.UF.sigla,
    }));
    writeCache(data);
    return data;
  })().finally(() => { _inFlight = null; });

  return _inFlight;
}

/** Filtra a lista por UFs (se vazia, retorna todos). */
export function filterMunicipiosByUF(municipios: IBGEMunicipio[], ufs: string[]): IBGEMunicipio[] {
  if (!ufs.length) return municipios;
  const set = new Set(ufs);
  return municipios.filter((m) => set.has(m.uf));
}
