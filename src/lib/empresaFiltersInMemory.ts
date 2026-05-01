// Filtragem in-memory de empresas espelhando applyFilters() do useEmpresas.ts
// (que opera server-side via Supabase). Usado no painel lateral do mapa, onde
// ufEmpresas já está totalmente carregado e filtrar server-side enviesaria o
// heatmap municipal (munCounts deriva da mesma lista).
//
// Cobre todos os campos do EmpresaFilters exceto pastaId/acaoId (vivem no
// sidebar da página Empresas, fora do escopo do mapa). temAcao depende de uma
// lookup à tabela elegibilidade — caller passa o set `withAcaoIds`.

import type { EmpresaFilters, Empresa } from "@/hooks/useEmpresas";
import { getCapitaisForUFs, normalizeMunicipio } from "@/lib/municipiosBrasil";

function inRange(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

export interface ApplyEmpresaFiltersExtras {
  /** Set de empresa_ids que possuem ao menos uma elegibilidade. Quando ausente,
   *  o filtro `temAcao` é ignorado (por exemplo enquanto a query auxiliar carrega). */
  withAcaoIds?: Set<string> | null;
}

export function applyEmpresaFiltersInMemory(
  list: Empresa[],
  filters: EmpresaFilters,
  extras: ApplyEmpresaFiltersExtras = {},
): Empresa[] {
  let out = list;

  if (filters.status?.length) {
    const set = new Set(filters.status);
    out = out.filter((e) => set.has(e.status as never));
  }

  if (filters.porte?.length) {
    // Empresas sem porte definido casam só quando "NAO_INFORMADO" estiver na lista
    const set = new Set(filters.porte);
    out = out.filter((e) => {
      const p = e.porte;
      if (p == null || p === "") return set.has("NAO_INFORMADO" as never);
      return set.has(p as never);
    });
  }

  if (filters.situacao?.length) {
    const set = new Set(filters.situacao);
    out = out.filter((e) => e.situacao_cadastral != null && set.has(e.situacao_cadastral as never));
  }

  if (filters.uf?.length) {
    const set = new Set(filters.uf);
    out = out.filter((e) => e.uf != null && set.has(e.uf));
  }

  if (filters.opcaoSimples === true) out = out.filter((e) => e.opcao_simples === true);
  if (filters.opcaoSimples === false) out = out.filter((e) => e.opcao_simples === false);

  if (filters.regimeTributario?.length) {
    const set = new Set(filters.regimeTributario);
    out = out.filter((e) => e.regime_tributario != null && set.has(e.regime_tributario));
  }

  if (filters.enriquecida === "yes") out = out.filter((e) => e.receita_atualizada_em != null);
  if (filters.enriquecida === "no") out = out.filter((e) => e.receita_atualizada_em == null);
  if (filters.enriquecida === "error") out = out.filter((e) => e.receita_erro != null);

  if (filters.capitalMin != null || filters.capitalMax != null) {
    out = out.filter((e) => inRange(e.capital_social, filters.capitalMin, filters.capitalMax));
  }

  // Funcionários: numérico OU faixa textual (metadados) — combinados via OR
  // para casar mesmo quem só tem uma das duas formas.
  const temNumFunc = filters.funcionariosMin != null || filters.funcionariosMax != null;
  const temTxtFunc = (filters.faixaFuncionarios?.length ?? 0) > 0;
  if (temNumFunc || temTxtFunc) {
    const setTxt = new Set(filters.faixaFuncionarios ?? []);
    out = out.filter((e) => {
      const okNum = temNumFunc
        ? inRange(e.quantidade_funcionarios, filters.funcionariosMin, filters.funcionariosMax)
        : false;
      const okTxt = temTxtFunc
        ? !!e.metadados?.["Faixa de Funcionários"] && setTxt.has(e.metadados["Faixa de Funcionários"])
        : false;
      return temNumFunc && temTxtFunc ? (okNum || okTxt) : (temNumFunc ? okNum : okTxt);
    });
  }

  const temNumFat = filters.faturamentoMin != null || filters.faturamentoMax != null;
  const temTxtFat = (filters.faixaFaturamento?.length ?? 0) > 0;
  if (temNumFat || temTxtFat) {
    const setTxt = new Set(filters.faixaFaturamento ?? []);
    out = out.filter((e) => {
      const okNum = temNumFat
        ? inRange(e.faturamento_anual, filters.faturamentoMin, filters.faturamentoMax)
        : false;
      const okTxt = temTxtFat
        ? !!e.metadados?.["Faixa de Faturamento"] && setTxt.has(e.metadados["Faixa de Faturamento"])
        : false;
      return temNumFat && temTxtFat ? (okNum || okTxt) : (temNumFat ? okNum : okTxt);
    });
  }

  if (filters.municipios?.length) {
    const set = new Set(filters.municipios.map(normalizeMunicipio));
    out = out.filter((e) => set.has(normalizeMunicipio(e.municipio ?? "")));
  } else if (filters.interior && filters.uf?.length) {
    const caps = new Set(getCapitaisForUFs(filters.uf).map(normalizeMunicipio));
    out = out.filter((e) => !caps.has(normalizeMunicipio(e.municipio ?? "")));
  }

  if (filters.cnae?.trim()) {
    const term = filters.cnae.trim().toLowerCase();
    out = out.filter(
      (e) =>
        (e.cnae_principal ?? "").toLowerCase().includes(term) ||
        (e.cnae_principal_desc ?? "").toLowerCase().includes(term),
    );
  }

  // temAcao só é aplicado se o caller forneceu o set; caso contrário ignora
  // silenciosamente (ex: query de elegibilidade ainda carregando).
  if (filters.temAcao != null && extras.withAcaoIds) {
    const idsSet = extras.withAcaoIds;
    out = filters.temAcao
      ? out.filter((e) => idsSet.has(e.id))
      : out.filter((e) => !idsSet.has(e.id));
  }

  return out;
}
