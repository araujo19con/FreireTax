// Mapeamento UF ↔ código IBGE e dados geográficos auxiliares para o mapa Brasil.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { feature } from "topojson-client";

export const UF_IBGE_CODE: Record<string, number> = {
  AC: 12, AL: 27, AM: 13, AP: 16, BA: 29, CE: 23, DF: 53, ES: 32,
  GO: 52, MA: 21, MG: 31, MS: 50, MT: 51, PA: 15, PB: 25, PE: 26,
  PI: 22, PR: 41, RJ: 33, RN: 24, RO: 11, RR: 14, RS: 43, SC: 42,
  SE: 28, SP: 35, TO: 17,
};

export const IBGE_CODE_TO_UF: Record<number, string> = Object.fromEntries(
  Object.entries(UF_IBGE_CODE).map(([uf, code]) => [code, uf])
);

export const UF_NOME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá",
  BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul",
  MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco",
  PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina",
  SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

// Coordenadas aproximadas do centroide de cada estado para os labels no mapa
export const UF_LABEL_COORDS: Record<string, [number, number]> = {
  AC: [-70.5, -9.5],  AL: [-36.6, -9.6],  AM: [-64.9, -4.1],  AP: [-51.8, 1.4],
  BA: [-41.7, -12.6], CE: [-39.3, -5.1],  DF: [-47.9, -15.8], ES: [-40.4, -19.6],
  GO: [-49.6, -16.0], MA: [-44.8, -5.1],  MG: [-44.7, -18.5], MS: [-54.6, -20.7],
  MT: [-55.9, -13.3], PA: [-52.4, -3.7],  PB: [-36.8, -7.2],  PE: [-37.5, -8.4],
  PI: [-42.9, -7.8],  PR: [-51.5, -24.7], RJ: [-43.2, -22.4], RN: [-36.7, -5.8],
  RO: [-62.9, -10.8], RR: [-61.4, 2.1],   RS: [-53.2, -29.7], SC: [-50.5, -27.3],
  SE: [-37.4, -10.6], SP: [-48.5, -22.2], TO: [-48.4, -10.2],
};

// Parâmetros de projeção Mercator por estado para o drill-down de municípios
export const STATE_MAP_PROJECTIONS: Record<string, { center: [number, number]; scale: number }> = {
  AC: { center: [-70.5, -9.5],  scale: 2500 },
  AL: { center: [-36.6, -9.6],  scale: 9000 },
  AM: { center: [-64.9, -4.1],  scale: 900  },
  AP: { center: [-51.8, 1.4],   scale: 3000 },
  BA: { center: [-41.7, -12.6], scale: 1400 },
  CE: { center: [-39.3, -5.1],  scale: 3800 },
  DF: { center: [-47.9, -15.8], scale: 55000},
  ES: { center: [-40.4, -19.6], scale: 5500 },
  GO: { center: [-49.6, -16.0], scale: 2000 },
  MA: { center: [-44.8, -5.1],  scale: 1500 },
  MG: { center: [-44.7, -18.5], scale: 1400 },
  MS: { center: [-54.6, -20.7], scale: 1900 },
  MT: { center: [-55.9, -13.3], scale: 1100 },
  PA: { center: [-52.4, -3.7],  scale: 750  },
  PB: { center: [-36.8, -7.2],  scale: 5500 },
  PE: { center: [-37.5, -8.4],  scale: 3200 },
  PI: { center: [-42.9, -7.8],  scale: 2000 },
  PR: { center: [-51.5, -24.7], scale: 2100 },
  RJ: { center: [-43.2, -22.4], scale: 6500 },
  RN: { center: [-36.7, -5.8],  scale: 5500 },
  RO: { center: [-62.9, -10.8], scale: 1600 },
  RR: { center: [-61.4, 2.1],   scale: 1900 },
  RS: { center: [-53.2, -29.7], scale: 1600 },
  SC: { center: [-50.5, -27.3], scale: 2700 },
  SE: { center: [-37.4, -10.6], scale: 10000},
  SP: { center: [-48.5, -22.2], scale: 2200 },
  TO: { center: [-48.4, -10.2], scale: 1600 },
};

export function ibgeMunicipiosGeoUrl(ufCode: number): string {
  return `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${ufCode}?formato=application/json&qualidade=intermediaria&resolucao=5`;
}

/**
 * Busca os 27 estados individualmente (qualidade=minima para o overview) e
 * combina num GeoJSON FeatureCollection com propriedades { codarea, uf }.
 * A API IBGE não fornece endpoint único com estados separados — paises/BR
 * retorna um MultiPolygon indivisível; precisamos dos estados individuais.
 */
export async function fetchBrazilStatesGeoJSON(): Promise<object> {
  const entries = Object.entries(UF_IBGE_CODE); // [["AC",12], ...]
  const results = await Promise.all(
    entries.map(async ([uf, code]) => {
      try {
        const r = await fetch(
          `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${code}?formato=application/json&qualidade=minima`,
        );
        if (!r.ok) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const topo = await r.json() as any;
        const obj = Object.values(topo.objects)[0];
        if (!obj) return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fc = feature(topo, obj as any) as any;
        const feat = fc.type === "FeatureCollection" ? fc.features[0] : fc;
        if (!feat) return null;
        return { ...feat, properties: { codarea: String(code), uf } };
      } catch {
        return null;
      }
    }),
  );
  return { type: "FeatureCollection", features: results.filter(Boolean) };
}

export function ibgeMunicipioNomesUrl(uf: string): string {
  return `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`;
}

// Paleta categórica para colorir microrregiões no mapa estadual.
// Tons claros, distintos, sem brigar com o destaque azul de seleção.
export const REGION_PALETTE: string[] = [
  "hsl(20 70% 78%)",   // pêssego
  "hsl(45 75% 75%)",   // amarelo
  "hsl(85 50% 75%)",   // verde-claro
  "hsl(155 45% 72%)",  // turquesa
  "hsl(195 60% 78%)",  // azul-bebê
  "hsl(225 55% 80%)",  // azul-acinzentado
  "hsl(265 50% 82%)",  // lavanda
  "hsl(310 50% 82%)",  // rosa-claro
  "hsl(0 55% 80%)",    // coral
  "hsl(35 45% 72%)",   // bege-amarelado
  "hsl(180 40% 75%)",  // azul-pálido
  "hsl(120 35% 75%)",  // verde-pálido
];

/**
 * Busca o GeoJSON de municípios de um estado.
 * Tenta primeiro via resolucao=6 (bulk). Se retornar apenas 1 feature
 * (boundary do estado inteiro), cai em fallback: busca cada município
 * individualmente no endpoint /malhas/municipios/{id} em lotes.
 */
export async function fetchStateMunicipiosGeoJSON(
  uf: string,
  ufCode: number,
): Promise<{ type: "FeatureCollection"; features: object[] }> {
  // Passo 1 — busca nomes/códigos dos municípios + hierarquia (microrregião)
  const namesRes = await fetch(ibgeMunicipioNomesUrl(uf));
  if (!namesRes.ok) throw new Error(`IBGE nomes: ${namesRes.status}`);
  type MunicipioIBGE = {
    id: number;
    nome: string;
    microrregiao?: { id: number; nome: string; mesorregiao?: { id: number; nome: string } };
  };
  const munList = (await namesRes.json()) as MunicipioIBGE[];

  const codeToNome: Record<string, string> = {};
  const codeToMicro: Record<string, { id: number; nome: string }> = {};
  const codeToMeso: Record<string, { id: number; nome: string }> = {};
  for (const m of munList) {
    codeToNome[String(m.id)] = m.nome;
    if (m.microrregiao) {
      codeToMicro[String(m.id)] = { id: m.microrregiao.id, nome: m.microrregiao.nome };
      if (m.microrregiao.mesorregiao) {
        codeToMeso[String(m.id)] = {
          id: m.microrregiao.mesorregiao.id,
          nome: m.microrregiao.mesorregiao.nome,
        };
      }
    }
  }

  // Passo 2 — tenta bulk (resolucao=6 pode retornar GeometryCollection de municípios)
  try {
    const geoRes = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${ufCode}?formato=application/json&qualidade=minima&resolucao=6`,
    );
    if (geoRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topo = (await geoRes.json()) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = Object.values(topo.objects)[0] as any;
      if (obj) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fc = feature(topo, obj) as any;
        const feats = fc.type === "FeatureCollection" ? fc.features : [fc];
        if (feats.length > 1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return {
            type: "FeatureCollection",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            features: feats.map((f: any) => {
              const codarea = f.properties?.codarea ?? "";
              const micro = codeToMicro[codarea];
              const meso = codeToMeso[codarea];
              return {
                ...f,
                properties: {
                  codarea,
                  nome: codeToNome[codarea] ?? codarea,
                  microrregiao_id: micro?.id ?? null,
                  microrregiao_nome: micro?.nome ?? null,
                  mesorregiao_id: meso?.id ?? null,
                  mesorregiao_nome: meso?.nome ?? null,
                },
              };
            }),
          };
        }
      }
    }
  } catch {
    // fallthrough para busca individual
  }

  // Passo 3 — fallback: busca cada município individualmente em lotes de 25
  const BATCH = 25;
  const allFeatures: object[] = [];
  for (let i = 0; i < munList.length; i += BATCH) {
    const batch = munList.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async ({ id, nome }) => {
        try {
          const r = await fetch(
            `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${id}?formato=application/json&qualidade=minima`,
          );
          if (!r.ok) return null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const topo = (await r.json()) as any;
          const obj = Object.values(topo.objects)[0];
          if (!obj) return null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fc = feature(topo, obj as any) as any;
          const feat = fc.type === "FeatureCollection" ? fc.features[0] : fc;
          if (!feat) return null;
          const micro = codeToMicro[String(id)];
          const meso = codeToMeso[String(id)];
          return {
            ...feat,
            properties: {
              codarea: String(id),
              nome,
              microrregiao_id: micro?.id ?? null,
              microrregiao_nome: micro?.nome ?? null,
              mesorregiao_id: meso?.id ?? null,
              mesorregiao_nome: meso?.nome ?? null,
            },
          };
        } catch {
          return null;
        }
      }),
    );
    allFeatures.push(...results.filter(Boolean));
  }
  return { type: "FeatureCollection", features: allFeatures };
}
