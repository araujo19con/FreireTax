import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";
import { unmaskCNPJ } from "@/lib/cnpj";
import { getCapitaisForUFs, normalizeMunicipio } from "@/lib/municipiosBrasil";

export type EmpresaStatus = "prospect" | "cliente" | "inativo";
export type EmpresaPorte = "MEI" | "ME" | "EPP" | "DEMAIS" | "NAO_INFORMADO";
export type EmpresaSituacao = "NULA" | "ATIVA" | "SUSPENSA" | "INAPTA" | "BAIXADA";

export interface EmpresaFilters {
  status?: EmpresaStatus[];
  porte?: EmpresaPorte[];
  situacao?: EmpresaSituacao[];
  uf?: string[];
  opcaoSimples?: boolean | null;   // null = qualquer, true = sim, false = não
  enriquecida?: "yes" | "no" | "error" | null;
  temAcao?: boolean | null;
  pastaId?: string | null;
  /** Restringe a empresas vinculadas a esta ação (via elegibilidade). */
  acaoId?: string | null;
  capitalMin?: number | null;
  capitalMax?: number | null;
  /** Municípios selecionados (match exato, multi-select via IBGE) */
  municipios?: string[] | null;
  /** Se true e `uf` estiver preenchido, exclui as capitais das UFs selecionadas */
  interior?: boolean;
  /** Busca em `cnae_principal` (código) OU `cnae_principal_desc` (descrição) via ilike */
  cnae?: string | null;
  /** Quantidade de funcionários — range numérico (só casa empresas com valor manual/importado numérico) */
  funcionariosMin?: number | null;
  funcionariosMax?: number | null;
  /** Faturamento anual em R$ — range numérico (só casa empresas com valor manual/importado numérico) */
  faturamentoMin?: number | null;
  faturamentoMax?: number | null;
  /** Faixa de funcionários como texto (vindo da planilha — ex: "500 A 999") */
  faixaFuncionarios?: string[];
  /** Faixa de faturamento como texto (vindo da planilha — ex: "10M A 20M") */
  faixaFaturamento?: string[];
  /** Regime tributário (simples/mei/lucro_presumido/lucro_real/imune_isento) */
  regimeTributario?: string[];
}

export type EmpresaSort =
  | "recent"
  | "nome_asc"
  | "nome_desc"
  | "valor_desc"
  | "capital_desc"
  | "data_abertura_desc";

export interface UseEmpresasParams {
  search?: string;
  filters?: EmpresaFilters;
  sort?: EmpresaSort;
  page?: number;      // 1-based
  pageSize?: number;  // default 25
}

export interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
  status: string;
  obs: string | null;
  created_at: string;
  updated_at: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: string | null;
  porte: string | null;
  uf: string | null;
  municipio: string | null;
  cnae_principal: string | null;
  cnae_principal_desc: string | null;
  opcao_simples: boolean | null;
  opcao_mei: boolean | null;
  capital_social: number | null;
  faturamento_estimado: number | null;
  faturamento_anual: number | null;
  quantidade_funcionarios: number | null;
  valor_potencial_total: number | null;
  data_abertura: string | null;
  receita_atualizada_em: string | null;
  receita_erro: string | null;
  qsa: unknown;
  cnaes_secundarios: unknown;
  logradouro: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  telefone_receita: string | null;
  email_receita: string | null;
  natureza_juridica: string | null;
  motivo_situacao: string | null;
  situacao_cadastral_data: string | null;
  data_opcao_simples: string | null;
  responsavel_id: string | null;
  user_id: string;
  /** Campos personalizados definidos pelo usuário ({ rótulo: valor }) */
  metadados: Record<string, string> | null;
  /** Regime tributário identificado: simples, mei, lucro_presumido, lucro_real, imune_isento */
  regime_tributario: string | null;
}

// Supabase's PostgrestFilterBuilder typings são verbosos; usamos um tipo relaxado local
// para encadear .order/.in/.eq/.range sem travar com generics.
type QB = {
  order: (c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => QB;
  in: (c: string, v: unknown[]) => QB;
  eq: (c: string, v: unknown) => QB;
  gte: (c: string, v: unknown) => QB;
  lte: (c: string, v: unknown) => QB;
  is: (c: string, v: unknown) => QB;
  not: (c: string, op: string, v: unknown) => QB;
  or: (filter: string) => QB;
  range: (from: number, to: number) => QB;
};

function applySort(query: QB, sort: EmpresaSort) {
  switch (sort) {
    case "nome_asc":            return query.order("nome", { ascending: true });
    case "nome_desc":           return query.order("nome", { ascending: false });
    case "valor_desc":          return query.order("valor_potencial_total", { ascending: false, nullsFirst: false });
    case "capital_desc":        return query.order("capital_social", { ascending: false, nullsFirst: false });
    case "data_abertura_desc":  return query.order("data_abertura", { ascending: false, nullsFirst: false });
    case "recent":
    default:                    return query.order("created_at", { ascending: false });
  }
}

/** Combina range numérico e faixa textual (metadados) em um único filtro OR.
 *  Numérico e texto se complementam: a mesma empresa pode ter só um dos dois. */
function aplicarFiltroFaixa(
  query: QB,
  colunaNum: string,
  chaveMeta: string,
  min: number | null | undefined,
  max: number | null | undefined,
  faixasTexto: string[] | undefined,
): QB {
  const temNum = min != null || max != null;
  const temTxt = (faixasTexto?.length ?? 0) > 0;
  if (!temNum && !temTxt) return query;

  const partes: string[] = [];
  if (temNum) {
    if (min != null && max != null) partes.push(`and(${colunaNum}.gte.${min},${colunaNum}.lte.${max})`);
    else if (min != null) partes.push(`${colunaNum}.gte.${min}`);
    else if (max != null) partes.push(`${colunaNum}.lte.${max}`);
  }
  if (temTxt) {
    // metadados->>key com espaços funciona; valores com vírgula viram risco,
    // mas faixas importadas ("500 A 999") não costumam ter vírgula
    const valores = faixasTexto!.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
    partes.push(`metadados->>${chaveMeta}.in.(${valores})`);
  }
  if (partes.length === 1) {
    // Um só — aplica direto sem OR (mais eficiente e evita edge-cases de sintaxe)
    if (temNum && !temTxt) {
      if (min != null) query = query.gte(colunaNum, min);
      if (max != null) query = query.lte(colunaNum, max);
      return query;
    }
    if (temTxt && !temNum) {
      return query.in(`metadados->>${chaveMeta}`, faixasTexto!);
    }
  }
  return query.or(partes.join(","));
}

function applyFilters(query: QB, filters: EmpresaFilters) {
  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.porte?.length) query = query.in("porte", filters.porte);
  if (filters.situacao?.length) query = query.in("situacao_cadastral", filters.situacao);
  if (filters.uf?.length) query = query.in("uf", filters.uf);
  if (filters.opcaoSimples === true) query = query.eq("opcao_simples", true);
  if (filters.opcaoSimples === false) query = query.eq("opcao_simples", false);
  if (filters.capitalMin != null) query = query.gte("capital_social", filters.capitalMin);
  if (filters.capitalMax != null) query = query.lte("capital_social", filters.capitalMax);
  // Funcionários e Faturamento: combina range numérico (manual/importado)
  // com faixa textual (metadados vindo da planilha) via OR. Assim empresas
  // sem valor numérico mas com texto "500 A 999" também casam.
  query = aplicarFiltroFaixa(
    query,
    "quantidade_funcionarios",
    "Faixa de Funcionários",
    filters.funcionariosMin,
    filters.funcionariosMax,
    filters.faixaFuncionarios,
  );
  query = aplicarFiltroFaixa(
    query,
    "faturamento_anual",
    "Faixa de Faturamento",
    filters.faturamentoMin,
    filters.faturamentoMax,
    filters.faixaFaturamento,
  );
  if (filters.regimeTributario?.length) query = query.in("regime_tributario", filters.regimeTributario);
  if (filters.enriquecida === "yes") query = query.not("receita_atualizada_em", "is", null);
  if (filters.enriquecida === "no") query = query.is("receita_atualizada_em", null);
  if (filters.enriquecida === "error") query = query.not("receita_erro", "is", null);
  if (filters.municipios?.length) {
    // Normaliza para uppercase sem acento — banco armazena nomes da RFB (ex: "MOSSORO")
    const orFilter = filters.municipios.map((m) => `municipio.ilike.${normalizeMunicipio(m)}`).join(",");
    query = query.or(orFilter);
  } else if (filters.interior && filters.uf?.length) {
    const caps = getCapitaisForUFs(filters.uf);
    for (const cap of caps) {
      query = query.not("municipio", "ilike", normalizeMunicipio(cap));
    }
  }
  if (filters.cnae?.trim()) {
    const term = filters.cnae.trim();
    // Busca em código (cnae_principal) e descrição (cnae_principal_desc) via or+ilike
    query = query.or(`cnae_principal.ilike.%${term}%,cnae_principal_desc.ilike.%${term}%`);
  }
  return query;
}

/**
 * Hook principal de listagem de empresas com paginação, busca e filtros server-side.
 * Suporta filtro por pasta e "tem ação" via filtros client-side complementares
 * (buscam os vínculos em queries separadas para não complicar o SQL).
 */
export function useEmpresas(params: UseEmpresasParams = {}) {
  const {
    search = "",
    filters = {},
    sort = "recent",
    page = 1,
    pageSize = 25,
  } = params;

  return useQuery({
    queryKey: ["empresas", { search, filters, sort, page, pageSize }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // 1) Se tem filtro por pasta, ação ou "tem ação", pré-resolve IDs elegíveis
      let restrictIds: Set<string> | null = null;
      if (filters.pastaId) {
        const { data } = await supabase
          .from("pasta_empresa_items")
          .select("empresa_id")
          .eq("pasta_id", filters.pastaId);
        restrictIds = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
      }
      if (filters.acaoId) {
        const { data } = await supabase
          .from("elegibilidade")
          .select("empresa_id")
          .eq("acao_id", filters.acaoId);
        const idsInAcao = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
        restrictIds = restrictIds
          ? new Set(Array.from(restrictIds).filter((id) => idsInAcao.has(id)))
          : idsInAcao;
      }
      if (filters.temAcao != null) {
        const { data } = await supabase.from("elegibilidade").select("empresa_id");
        const withAcao = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
        if (filters.temAcao) {
          restrictIds = restrictIds
            ? new Set(Array.from(restrictIds).filter((id) => withAcao.has(id)))
            : withAcao;
        } else {
          // tem_acao = false: excluir os que têm ação
          // Não há como fazer NOT IN nativo eficiente; buscamos depois e filtramos.
        }
      }

      // 2) Query base
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("empresas")
        .select("*", { count: "exact" }) as unknown as QB;

      // Search: or(ilike) em 4 campos
      if (search.trim()) {
        const term = search.trim();
        const digits = unmaskCNPJ(term);
        const orClauses = [
          `nome.ilike.%${term}%`,
          `razao_social.ilike.%${term}%`,
          `nome_fantasia.ilike.%${term}%`,
        ];
        if (digits.length >= 2) orClauses.push(`cnpj.ilike.%${digits}%`);
        query = query.or(orClauses.join(","));
      }

      query = applyFilters(query, filters);
      query = applySort(query, sort);

      if (restrictIds && restrictIds.size > 0) {
        query = query.in("id", Array.from(restrictIds));
      } else if (restrictIds && restrictIds.size === 0) {
        return { rows: [] as Empresa[], total: 0 };
      }

      query = query.range(from, to);

      const result = await (query as unknown as PromiseLike<{ data: Empresa[] | null; error: Error | null; count: number | null }>);
      const { data, error, count } = result;
      if (error) throw error;

      let rows = (data || []) as Empresa[];

      // 3) Se filtro "não tem ação", remove os que aparecem na tabela elegibilidade
      if (filters.temAcao === false) {
        const { data: elegs } = await supabase.from("elegibilidade").select("empresa_id");
        const withAcao = new Set((elegs || []).map((r: { empresa_id: string }) => r.empresa_id));
        rows = rows.filter((e) => !withAcao.has(e.id));
      }

      return { rows, total: count ?? rows.length };
    },
  });
}

/**
 * Busca TODAS as empresas que casam com search/filters/sort, paginando por baixo
 * até esgotar. Usado por exports — ignora a paginação visível na tela.
 *
 * Limite por página = 1000 (default PostgREST). Loop até `count` ou bloco vazio.
 */
export async function fetchAllEmpresas(params: Omit<UseEmpresasParams, "page" | "pageSize"> = {}): Promise<Empresa[]> {
  const { search = "", filters = {}, sort = "recent" } = params;

  // Pré-resolve restrictIds (mesma lógica de useEmpresas)
  let restrictIds: Set<string> | null = null;
  if (filters.pastaId) {
    const { data } = await supabase
      .from("pasta_empresa_items").select("empresa_id").eq("pasta_id", filters.pastaId);
    restrictIds = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
  }
  if (filters.acaoId) {
    const { data } = await supabase
      .from("elegibilidade").select("empresa_id").eq("acao_id", filters.acaoId);
    const idsInAcao = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
    restrictIds = restrictIds
      ? new Set(Array.from(restrictIds).filter((id) => idsInAcao.has(id)))
      : idsInAcao;
  }
  if (filters.temAcao === true) {
    const { data } = await supabase.from("elegibilidade").select("empresa_id");
    const withAcao = new Set((data || []).map((r: { empresa_id: string }) => r.empresa_id));
    restrictIds = restrictIds
      ? new Set(Array.from(restrictIds).filter((id) => withAcao.has(id)))
      : withAcao;
  }

  if (restrictIds && restrictIds.size === 0) return [];

  const PAGE = 1000;
  const all: Empresa[] = [];
  let from = 0;
  // Loop até receber bloco menor que PAGE (= esgotou)
  for (;;) {
    let query = supabase.from("empresas").select("*") as unknown as QB;

    if (search.trim()) {
      const term = search.trim();
      const digits = unmaskCNPJ(term);
      const orClauses = [
        `nome.ilike.%${term}%`,
        `razao_social.ilike.%${term}%`,
        `nome_fantasia.ilike.%${term}%`,
      ];
      if (digits.length >= 2) orClauses.push(`cnpj.ilike.%${digits}%`);
      query = query.or(orClauses.join(","));
    }

    query = applyFilters(query, filters);
    query = applySort(query, sort);

    if (restrictIds && restrictIds.size > 0) {
      query = query.in("id", Array.from(restrictIds));
    }

    query = query.range(from, from + PAGE - 1);

    const result = await (query as unknown as PromiseLike<{ data: Empresa[] | null; error: Error | null }>);
    if (result.error) throw result.error;
    const batch = (result.data || []) as Empresa[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
    // Trava de segurança contra loop infinito (50k empresas — improvável)
    if (from > 50_000) break;
  }

  // Pós-processo: filtro "não tem ação"
  if (filters.temAcao === false) {
    const { data: elegs } = await supabase.from("elegibilidade").select("empresa_id");
    const withAcao = new Set((elegs || []).map((r: { empresa_id: string }) => r.empresa_id));
    return all.filter((e) => !withAcao.has(e.id));
  }
  return all;
}

/**
 * Retorna os valores textuais distintos de "Faixa de Funcionários" e "Faixa de Faturamento"
 * em metadados — usado pra montar multiselect dos filtros. Ordenação por nome alfabético
 * (o parser tenta numericamente quando detecta padrão "N A M").
 */
export function useFaixasDistintas() {
  return useQuery({
    queryKey: ["empresas", "faixas-distintas"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const funcSet = new Set<string>();
      const fatSet = new Set<string>();
      const PAGE = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("empresas")
          .select("metadados")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = ((data || []) as unknown) as Array<{ metadados: Record<string, string> | null }>;
        for (const r of batch) {
          const f = r.metadados?.["Faixa de Funcionários"];
          const g = r.metadados?.["Faixa de Faturamento"];
          if (f) funcSet.add(f);
          if (g) fatSet.add(g);
        }
        if (batch.length < PAGE) break;
        from += PAGE;
        if (from > 50_000) break;
      }
      return {
        funcionarios: ordenarFaixas(Array.from(funcSet)),
        faturamento: ordenarFaixas(Array.from(fatSet)),
      };
    },
  });
}

/** Ordena faixas textuais pelo primeiro número encontrado (fallback alfabético). */
function ordenarFaixas(values: string[]): string[] {
  return values.sort((a, b) => {
    const na = extrairPrimeiroNumero(a);
    const nb = extrairPrimeiroNumero(b);
    if (na != null && nb != null) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
    return a.localeCompare(b, "pt-BR");
  });
}

function extrairPrimeiroNumero(s: string): number | null {
  const m = s.match(/(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?/i);
  if (!m) return null;
  return aplicarSufixo(m[1], m[2]);
}

function aplicarSufixo(num: string, suf: string | undefined): number | null {
  const n = Number(num.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const s = (suf || "").toLowerCase();
  if (s.startsWith("b")) return n * 1_000_000_000;
  if (s.startsWith("mi") || s === "m") return n * 1_000_000;
  if (s.startsWith("mil") || s === "k") return n * 1_000;
  return n;
}

/** Parseia uma faixa textual pra [min, max]. Aceita "500 A 999", "10M-20M",
 *  "acima de 1000", "até 10". Retorna null se não reconhecer. */
export function parseFaixaRange(text: string | null | undefined): [number, number] | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  // Padrão range: "N [sufixo] A|até|- M [sufixo]"
  const rng = t.match(/(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?\s*(?:a|at[ée]|-|–|—|to)\s*(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?/i);
  if (rng) {
    const min = aplicarSufixo(rng[1], rng[2]);
    const max = aplicarSufixo(rng[3], rng[4]);
    if (min != null && max != null) return [Math.min(min, max), Math.max(min, max)];
  }
  // "acima de 1000", "mais de 1000", "1000+"
  const acima = t.match(/(?:acima de|mais de|>\s*|superior a)\s*(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?|(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?\s*\+/i);
  if (acima) {
    const num = acima[1] ?? acima[3];
    const suf = acima[2] ?? acima[4];
    const n = aplicarSufixo(num, suf);
    if (n != null) return [n + 1, Number.MAX_SAFE_INTEGER];
  }
  // "até 10", "menos de 10", "<10"
  const ate = t.match(/(?:at[ée]|menos de|<\s*|inferior a)\s*(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?/i);
  if (ate) {
    const n = aplicarSufixo(ate[1], ate[2]);
    if (n != null) return [0, n];
  }
  // Valor único ("50 funcionários")
  const uni = t.match(/^(\d[\d.,]*)\s*(k|m|mi|mil|milh|bi)?\b/i);
  if (uni) {
    const n = aplicarSufixo(uni[1], uni[2]);
    if (n != null) return [n, n];
  }
  return null;
}

/** Verifica se a faixa textual se sobrepõe ao range [min, max] (bounds null = abertos). */
export function faixaSobrepoe(text: string, min: number | null, max: number | null): boolean {
  const r = parseFaixaRange(text);
  if (!r) return false;
  const [a, b] = r;
  const lo = min ?? Number.NEGATIVE_INFINITY;
  const hi = max ?? Number.POSITIVE_INFINITY;
  return a <= hi && b >= lo;
}

/** Lista simples (sem paginação) — usado em selects de combobox. */
export function useEmpresasSimple() {
  return useQuery({
    queryKey: ["empresas", "simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome, cnpj")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Métricas agregadas (para KPI cards). */
export function useEmpresasKpi() {
  return useQuery({
    queryKey: ["empresas", "kpi"],
    staleTime: 60_000,
    queryFn: async () => {
      // Supabase retorna no máximo 1000 linhas por query; usar count: exact evita o truncamento.
      const [totalRes, prospectRes, clienteRes, inativoRes, enrichedRes, withErrorRes, valorRes, elegRes] = await Promise.all([
        supabase.from("empresas").select("*", { count: "exact", head: true }),
        supabase.from("empresas").select("*", { count: "exact", head: true }).eq("status", "prospect"),
        supabase.from("empresas").select("*", { count: "exact", head: true }).eq("status", "cliente"),
        supabase.from("empresas").select("*", { count: "exact", head: true }).eq("status", "inativo"),
        supabase.from("empresas").select("id", { count: "exact", head: true }).not("receita_atualizada_em", "is", null),
        supabase.from("empresas").select("*", { count: "exact", head: true }).not("receita_erro", "is", null),
        supabase.from("empresas").select("valor_potencial_total").limit(10000),
        supabase.from("elegibilidade").select("empresa_id").limit(10000),
      ]);
      const total = totalRes.count ?? 0;
      const byStatus: Record<string, number> = {
        prospect: prospectRes.count ?? 0,
        cliente: clienteRes.count ?? 0,
        inativo: inativoRes.count ?? 0,
      };
      const enriched = enrichedRes.count ?? 0;
      const withError = withErrorRes.count ?? 0;
      const valorPotencial = (valorRes.data ?? []).reduce(
        (sum, r: { valor_potencial_total: number | null }) => sum + (r.valor_potencial_total ?? 0), 0
      );
      const comAcao = new Set((elegRes.data ?? []).map((r: { empresa_id: string }) => r.empresa_id)).size;
      return { total, byStatus, enriched, withError, valorPotencial, comAcao };
    },
  });
}

export function useCreateEmpresa() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const payload = { ...input, user_id: user!.id };
      // cast: Supabase's generated types requer Insert shape completo; aceitamos payload parcial aqui.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("empresas") as any).insert(payload).select().single();
      if (error) throw error;
      await logAudit({ tabela: "empresas", acao: "Criou empresa", detalhes: { nome: input.nome, cnpj: input.cnpj } });
      return data as Empresa;
    },
    onSuccess: (emp) => {
      toast.success(`Empresa "${emp.nome}" criada`);
      qc.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (err: unknown) => {
      // Postgres 23505 = unique_violation. Mensagem amigável para CNPJ duplicado.
      const e = err as { code?: string; message?: string } | undefined;
      if (e?.code === "23505" && (e?.message ?? "").includes("cnpj")) {
        toast.error("Este CNPJ já está cadastrado — verifique na lista de empresas.");
        return;
      }
      toast.error("Erro ao criar empresa: " + (e?.message ?? "falha"));
    },
  });
}

export function useUpdateEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("empresas") as any).update(data).eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "empresas", acao: "Editou empresa", registro_id: id, detalhes: { nome: data.nome } });
    },
    onSuccess: () => {
      toast.success("Empresa atualizada");
      qc.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (err) => toast.error("Erro ao atualizar: " + (err?.message ?? "falha")),
  });
}

export function useDeleteEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome?: string }) => {
      const { error } = await supabase.from("empresas").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "empresas", acao: "Removeu empresa", registro_id: id, detalhes: { nome } });
    },
    onSuccess: () => {
      toast.success("Empresa removida");
      qc.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (err) => toast.error("Erro ao remover: " + (err?.message ?? "falha")),
  });
}

export function useBulkDeleteEmpresas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase.from("empresas").delete().in("id", ids);
      if (error) throw error;
      await logAudit({ tabela: "empresas", acao: "Removeu empresas em lote", detalhes: { count: ids.length, ids } });
    },
    onSuccess: (_r, ids) => {
      toast.success(`${ids.length} empresa(s) removida(s)`);
      qc.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (err) => toast.error("Erro ao remover em lote: " + (err?.message ?? "falha")),
  });
}

export function useEnrichEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cnpj }: { id: string; cnpj: string }) => {
      const { data, error } = await supabase.functions.invoke("enriquecer-cnpj", {
        body: { cnpj, empresa_id: id, force: true },
      });
      // supabase-js funções: quando status != 2xx, `error` tem a mensagem genérica
      // "non-2xx" e o body fica em `error.context.body` (Response). Tentamos extrair.
      if (error) {
        let realMsg: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ctx = (error as any).context;
          if (ctx?.body) {
            const text = typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
            try {
              const parsed = JSON.parse(text);
              realMsg = parsed.error || parsed.detail || parsed.message || text;
            } catch { realMsg = text; }
          }
        } catch { /* ignore */ }
        console.error("[enriquecer-cnpj] error:", error, "body:", realMsg);
        throw new Error(realMsg || error.message || "falha");
      }
      if (data?.error) throw new Error(data.error);
      await logAudit({ tabela: "empresas", acao: "Enriqueceu dados RFB", registro_id: id, detalhes: { cnpj } });
      return data;
    },
    onSuccess: (data: { data?: { razao_social?: string } } | undefined) => {
      toast.success(`Dados atualizados: ${data?.data?.razao_social || "RFB"}`);
      qc.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (err) => toast.error("Erro ao enriquecer: " + (err?.message ?? "falha")),
  });
}

/** Muda o status de uma empresa (usado no Kanban via drag-drop de coluna). */
export function useUpdateEmpresaStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: EmpresaStatus }) => {
      const { error } = await supabase.from("empresas").update({ status }).eq("id", id);
      if (error) throw error;
      await logAudit({ tabela: "empresas", acao: `Mudou status para ${status}`, registro_id: id, detalhes: { status } });
    },
    onMutate: async ({ id, status }) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: ["empresas"] });
      const snapshots = qc.getQueriesData({ queryKey: ["empresas"] });
      type Snap = { rows: Empresa[]; total: number };
      snapshots.forEach(([key, value]) => {
        const v = value as Snap | undefined;
        if (v?.rows) {
          qc.setQueryData(key, {
            ...v,
            rows: v.rows.map((e) => e.id === id ? { ...e, status } : e),
          });
        }
      });
      return { snapshots };
    },
    onError: (err, _vars, context) => {
      toast.error("Erro ao mudar status: " + (err?.message ?? "falha"));
      context?.snapshots?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["empresas"] }),
  });
}
