// Módulo puro (sem React) com tipos e funções de filtro/ordenação para o painel
// de empresas dentro de uma Ação Tributária. Os dados já estão carregados em
// memória — diferente do EmpresaFilterPopover canônico, que monta queries
// Supabase server-side. Aqui tudo é client-side.

import type { EmpresaAcao, ElegAcao, ProspMin } from "./AcaoEmpresasPanel";
import type { EmpresaPorte, EmpresaSituacao } from "@/hooks/useEmpresas";
import { prospStatusOrder, PROSPECCAO_STATUSES } from "@/lib/prospeccaoStatus";
import { getCapitaisForUFs, normalizeMunicipio } from "@/lib/municipiosBrasil";

export type StatusCombinadoKey =
  | "nao_elegivel"
  | "aguardando"
  | "Contato feito"
  | "Proposta enviada"
  | "Em negociação"
  | "Contrato assinado"
  | "Serviço iniciado"
  | "Perdido";

export interface StatusCombinadoOption {
  key: StatusCombinadoKey;
  label: string;
  color: string;
}

export const STATUS_COMBINADO_OPTIONS: StatusCombinadoOption[] = [
  {
    key: "nao_elegivel",
    label: "Não elegível",
    color: "bg-destructive/10 text-destructive border-destructive/30",
  },
  { key: "aguardando", label: "Aguardando", color: "bg-warning/10 text-warning border-warning/30" },
  ...PROSPECCAO_STATUSES.map<StatusCombinadoOption>((s) => ({
    key: s.key as StatusCombinadoKey,
    label: s.label,
    color: `${s.color} border-current/30`,
  })),
];

export interface AcaoEmpresaFilters {
  statusCombinado?: StatusCombinadoKey[];
  porte?: EmpresaPorte[];
  uf?: string[];
  situacao?: EmpresaSituacao[];
  regimeTributario?: string[];
  opcaoSimples?: boolean | null;
  municipios?: string[] | null;
  interior?: boolean;
  cnae?: string | null;
  capitalMin?: number | null;
  capitalMax?: number | null;
  funcionariosMin?: number | null;
  funcionariosMax?: number | null;
  faturamentoMin?: number | null;
  faturamentoMax?: number | null;
  faixaFuncionarios?: string[];
  faixaFaturamento?: string[];
}

export type AcaoEmpresaSort =
  | "elegibilidade_recente"
  | "nome_asc"
  | "nome_desc"
  | "status_funil"
  | "valor_desc";

export interface AcaoEmpresaItem {
  el: ElegAcao;
  empresa: EmpresaAcao | undefined;
  prosp: ProspMin | undefined;
}

// Mapeia 1 item para a chave única que representa seu estado combinado.
// Regra: !elegivel → "nao_elegivel"; sem prosp → "aguardando"; senão → status_prospeccao.
export function statusOf(item: AcaoEmpresaItem): StatusCombinadoKey {
  if (!item.el.elegivel) return "nao_elegivel";
  if (!item.prosp) return "aguardando";
  return item.prosp.status_prospeccao as StatusCombinadoKey;
}

function normPorte(raw: string | null | undefined): EmpresaPorte {
  if (raw === "MEI" || raw === "ME" || raw === "EPP" || raw === "DEMAIS") return raw;
  return "NAO_INFORMADO";
}

function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function inRange(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined
): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false; // se há um bound, exige valor presente
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

export function activeFiltersCount(f: AcaoEmpresaFilters): number {
  let n = 0;
  if (f.statusCombinado?.length) n += f.statusCombinado.length;
  if (f.porte?.length) n += f.porte.length;
  if (f.uf?.length) n += f.uf.length;
  if (f.situacao?.length) n += f.situacao.length;
  if (f.regimeTributario?.length) n += f.regimeTributario.length;
  if (f.opcaoSimples != null) n++;
  if (f.municipios?.length) n += f.municipios.length;
  if (f.interior) n++;
  if (f.cnae?.trim()) n++;
  if (f.capitalMin != null || f.capitalMax != null) n++;
  // funcionários/faturamento contam 1 cada — faixaFuncionarios/faixaFaturamento
  // são derivadas do intervalo, não filtros independentes.
  if (f.funcionariosMin != null || f.funcionariosMax != null) n++;
  if (f.faturamentoMin != null || f.faturamentoMax != null) n++;
  return n;
}

export function applyAcaoFilters(
  items: AcaoEmpresaItem[],
  filters: AcaoEmpresaFilters,
  search: string
): AcaoEmpresaItem[] {
  let list = items;

  if (filters.statusCombinado?.length) {
    const set = new Set(filters.statusCombinado);
    list = list.filter((i) => set.has(statusOf(i)));
  }

  if (filters.porte?.length) {
    const set = new Set(filters.porte);
    list = list.filter((i) => set.has(normPorte(i.empresa?.porte)));
  }

  if (filters.uf?.length) {
    const set = new Set(filters.uf);
    list = list.filter((i) => i.empresa?.uf != null && set.has(i.empresa.uf));
  }

  if (filters.situacao?.length) {
    const set = new Set(filters.situacao);
    list = list.filter((i) => {
      const s = i.empresa?.situacao_cadastral as EmpresaSituacao | null | undefined;
      return s != null && set.has(s);
    });
  }

  if (filters.regimeTributario?.length) {
    const set = new Set(filters.regimeTributario);
    list = list.filter(
      (i) => i.empresa?.regime_tributario != null && set.has(i.empresa.regime_tributario)
    );
  }

  if (filters.opcaoSimples != null) {
    list = list.filter((i) => i.empresa?.opcao_simples === filters.opcaoSimples);
  }

  if (filters.municipios?.length) {
    const set = new Set(filters.municipios.map(normalizeMunicipio));
    list = list.filter((i) => set.has(normalizeMunicipio(i.empresa?.municipio)));
  } else if (filters.interior && filters.uf?.length) {
    const caps = new Set(getCapitaisForUFs(filters.uf).map(normalizeMunicipio));
    list = list.filter((i) => !caps.has(normalizeMunicipio(i.empresa?.municipio)));
  }

  if (filters.cnae?.trim()) {
    const needle = lower(filters.cnae.trim());
    list = list.filter(
      (i) =>
        lower(i.empresa?.cnae_principal).includes(needle) ||
        lower(i.empresa?.cnae_principal_desc).includes(needle)
    );
  }

  if (filters.capitalMin != null || filters.capitalMax != null) {
    list = list.filter((i) =>
      inRange(i.empresa?.capital_social, filters.capitalMin, filters.capitalMax)
    );
  }

  // Funcionários e Faturamento: numérico OU faixa textual (metadados) combinados
  // via OR — a empresa pode ter só uma das duas formas. As faixaFuncionarios/
  // faixaFaturamento já vêm derivadas do intervalo (faixasNoIntervalo).
  const temNumFunc = filters.funcionariosMin != null || filters.funcionariosMax != null;
  const temTxtFunc = (filters.faixaFuncionarios?.length ?? 0) > 0;
  if (temNumFunc || temTxtFunc) {
    const setTxt = new Set(filters.faixaFuncionarios ?? []);
    list = list.filter((i) => {
      const okNum = temNumFunc
        ? inRange(
            i.empresa?.quantidade_funcionarios,
            filters.funcionariosMin,
            filters.funcionariosMax
          )
        : false;
      const v = i.empresa?.metadados?.["Faixa de Funcionários"];
      const okTxt = temTxtFunc ? !!v && setTxt.has(v) : false;
      return temNumFunc && temTxtFunc ? okNum || okTxt : temNumFunc ? okNum : okTxt;
    });
  }

  const temNumFat = filters.faturamentoMin != null || filters.faturamentoMax != null;
  const temTxtFat = (filters.faixaFaturamento?.length ?? 0) > 0;
  if (temNumFat || temTxtFat) {
    const setTxt = new Set(filters.faixaFaturamento ?? []);
    list = list.filter((i) => {
      const okNum = temNumFat
        ? inRange(i.empresa?.faturamento_anual, filters.faturamentoMin, filters.faturamentoMax)
        : false;
      const v = i.empresa?.metadados?.["Faixa de Faturamento"];
      const okTxt = temTxtFat ? !!v && setTxt.has(v) : false;
      return temNumFat && temTxtFat ? okNum || okTxt : temNumFat ? okNum : okTxt;
    });
  }

  if (search.trim()) {
    const q = lower(search.trim());
    list = list.filter(
      (i) => lower(i.empresa?.nome).includes(q) || (i.empresa?.cnpj ?? "").includes(q)
    );
  }

  return list;
}

// Order key used by status_funil sort. Lower comes first.
function funilOrder(item: AcaoEmpresaItem): number {
  if (!item.el.elegivel) return 100; // não elegíveis ao fim
  if (!item.prosp) return -1; // aguardando primeiro
  return prospStatusOrder(item.prosp.status_prospeccao);
}

function nameCompare(a: AcaoEmpresaItem, b: AcaoEmpresaItem): number {
  const an = a.empresa?.nome ?? "";
  const bn = b.empresa?.nome ?? "";
  return an.localeCompare(bn, "pt-BR");
}

export function applyAcaoSort(items: AcaoEmpresaItem[], sort: AcaoEmpresaSort): AcaoEmpresaItem[] {
  const arr = items.slice();
  switch (sort) {
    case "nome_asc":
      arr.sort(nameCompare);
      return arr;
    case "nome_desc":
      arr.sort((a, b) => -nameCompare(a, b));
      return arr;
    case "elegibilidade_recente":
      arr.sort((a, b) => (b.el.created_at ?? "").localeCompare(a.el.created_at ?? ""));
      return arr;
    case "status_funil":
      arr.sort((a, b) => {
        const d = funilOrder(a) - funilOrder(b);
        return d !== 0 ? d : nameCompare(a, b);
      });
      return arr;
    case "valor_desc":
      arr.sort((a, b) => {
        const va = a.el.valor_potencial_estimado ?? 0;
        const vb = b.el.valor_potencial_estimado ?? 0;
        const d = vb - va;
        return d !== 0 ? d : nameCompare(a, b);
      });
      return arr;
  }
}
