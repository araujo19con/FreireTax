import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Folder,
  Users,
  DollarSign,
  UserCheck,
  ListChecks,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  AcaoEmpresasPanel,
  type ProspMin,
  type AcaoEmpresasExportPayload,
} from "./acoes/AcaoEmpresasPanel";
import { ImportacaoProspeccaoDialog } from "./acoes/ImportacaoProspeccaoDialog";
import { EmpresaQuickSheet } from "./empresas/EmpresaQuickSheet";
import { exportEmpresasAcaoXlsx, type ExportRow } from "@/lib/exportEmpresasAcao";
import { ProspeccaoRapidaDialog } from "./acoes/ProspeccaoRapidaDialog";
import { maskCNPJ, validateCNPJ } from "@/lib/cnpj";
import { formatCurrency } from "@/lib/format";
import { CriteriosAdmin } from "./elegibilidade/CriteriosAdmin";
import { AcaoDialog } from "@/components/AcaoDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Scale, BookOpen } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { gerarCodigoUnico, nomeTeseExiste } from "@/lib/acaoCodigo";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Acao {
  id: string;
  nome: string;
  tipo: string;
  status: string;
  vinculo: string;
  created_at: string;
}

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
  porte: string | null;
  uf: string | null;
  situacao_cadastral: string | null;
  regime_tributario: string | null;
  municipio: string | null;
  capital_social: number | null;
  opcao_simples: boolean | null;
  cnae_principal: string | null;
  cnae_principal_desc: string | null;
  quantidade_funcionarios: number | null;
  faturamento_anual: number | null;
  metadados: Record<string, string> | null;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  ja_ajuizada: boolean;
  justificativa: string | null;
  created_at: string;
  valor_potencial_estimado: number | null;
}

interface Pasta {
  id: string;
  nome: string;
}

interface PastaItem {
  pasta_id: string;
  empresa_id: string;
}

interface Processo {
  id: string;
  elegibilidade_id: string;
  empresa_id: string;
  acao_id: string;
  numero_processo: string;
  fase: string;
  valor_estimado: number;
  valor_ganho: number;
  status: string;
  observacoes: string;
  data_processo: string;
  tribunal: string;
}

interface Prospeccao {
  id: string;
  elegibilidade_id: string | null;
  empresa_id: string;
  acao_id: string;
  contato_nome: string;
  contato_telefone: string;
  contato_email: string;
  contato_cargo: string;
  status_prospeccao: string;
  notas_prospeccao: string;
  valor_contrato: number;
  tipo_contrato: string;
  data_contrato: string | null;
  data_assinatura: string | null;
  observacoes_contrato: string;
}

const faseOptions = [
  "Inicial",
  "Recurso",
  "Sentença",
  "Acórdão",
  "Trânsito em Julgado",
  "Execução",
  "Finalizado",
];
const statusProcessoOptions = [
  "Em andamento",
  "Favorável",
  "Desfavorável",
  "Suspenso",
  "Finalizado",
];

const EMPRESA_COLS =
  "id, nome, cnpj, porte, uf, situacao_cadastral, regime_tributario, municipio, capital_social, opcao_simples, cnae_principal, cnae_principal_desc, quantidade_funcionarios, faturamento_anual, metadados";

// Busca empresas por lista de IDs (chunks paralelos de 500) — usado pra carregar
// só as empresas REFERENCIADAS (elegibilidade/pastas), não as milhares do banco.
async function fetchEmpresasByIds(ids: string[]): Promise<Empresa[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
  const res = await Promise.all(
    chunks.map((c) => supabase.from("empresas").select(EMPRESA_COLS).in("id", c))
  );
  return res.flatMap((r) => (r.data ?? []) as unknown as Empresa[]);
}

export default function Acoes() {
  const [expandedAcao, setExpandedAcao] = useState<string | null>(null);
  const acaoCardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [searchParams, setSearchParams] = useSearchParams();
  const [criteriosAcaoId, setCriteriosAcaoId] = useState<string | null>(null);
  const [importProspAcao, setImportProspAcao] = useState<{ id: string; nome: string } | null>(null);
  const [detailEmpresaId, setDetailEmpresaId] = useState<string | null>(null);
  const { user } = useAuth();
  const qc = useQueryClient();

  // Dialog rápido de prospecção
  const [prospRapidaOpen, setProspRapidaOpen] = useState(false);
  const [prospRapidaEmpresaId, setProspRapidaEmpresaId] = useState("");

  // Elegibilidade dialog
  const [elegDialogOpen, setElegDialogOpen] = useState(false);
  const [elegAcaoId, setElegAcaoId] = useState("");
  const [elegMode, setElegMode] = useState<"individual" | "pasta" | "planilha">("individual");
  const [elegSelectedEmpresas, setElegSelectedEmpresas] = useState<Set<string>>(new Set());
  // Lista COMPLETA de empresas — só p/ o picker "individual". Carregada sob demanda
  // (não no load da página) pra não puxar as milhares de empresas à toa.
  const [allEmpresas, setAllEmpresas] = useState<Empresa[]>([]);
  const [allEmpresasLoading, setAllEmpresasLoading] = useState(false);
  const [empresaBusca, setEmpresaBusca] = useState("");
  const [elegSelectedPasta, setElegSelectedPasta] = useState("");
  const [elegElegivel, setElegElegivel] = useState("true");
  const [elegJustificativa, setElegJustificativa] = useState("");

  // Planilha mode — linhas parseadas do arquivo
  interface PlanilhaRow {
    cnpj: string;
    nome: string;
    existing_id: string | null;
    valid: boolean;
    errors: string[];
  }
  const [planilhaRows, setPlanilhaRows] = useState<PlanilhaRow[]>([]);
  const [planilhaFileName, setPlanilhaFileName] = useState("");
  const [planilhaProcessing, setPlanilhaProcessing] = useState(false);

  // Processo dialog
  const [procDialogOpen, setProcDialogOpen] = useState(false);
  const [editingProcesso, setEditingProcesso] = useState<Processo | null>(null);
  const [procElegId, setProcElegId] = useState("");
  const [procNumero, setProcNumero] = useState("");
  const [procFase, setProcFase] = useState("Inicial");
  const [procValorEstimado, setProcValorEstimado] = useState("");
  const [procValorGanho, setProcValorGanho] = useState("");
  const [procStatus, setProcStatus] = useState("Em andamento");
  const [procObs, setProcObs] = useState("");
  const [procDataProcesso, setProcDataProcesso] = useState("");
  const [procTribunal, setProcTribunal] = useState("");
  const [procTribunalOutro, setProcTribunalOutro] = useState("");

  // useQuery => cacheado (staleTime 30s): reabrir a página é instantâneo; as
  // mutações chamam refetch(). fetchAllRows pagina (PostgREST corta em ~1000).
  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: ["acoes-page"],
    staleTime: 30_000,
    queryFn: async () => {
      // Não carrega as ~5.8k empresas — só as referenciadas (elegibilidade ∪ pastas).
      const [acoesRes, elegibilidades, pastasRes, itemsRes, processos, prospeccoes] =
        await Promise.all([
          supabase.from("acoes_tributarias").select("*").order("created_at", { ascending: false }),
          fetchAllRows<ElegibilidadeRow>(
            "elegibilidade",
            "id, empresa_id, acao_id, elegivel, justificativa, created_at, valor_potencial_estimado, destaque, notas_contexto, ja_ajuizada"
          ),
          supabase.from("pastas_empresas").select("id, nome"),
          supabase.from("pasta_empresa_items").select("pasta_id, empresa_id"),
          fetchAllRows<Processo>("processos", "*"),
          fetchAllRows<Prospeccao>("prospeccoes", "*"),
        ]);
      const items = itemsRes.data || [];
      const refIds = Array.from(
        new Set([...elegibilidades.map((e) => e.empresa_id), ...items.map((i) => i.empresa_id)])
      ).filter(Boolean);
      const empresas = refIds.length ? await fetchEmpresasByIds(refIds) : [];
      return {
        acoes: (acoesRes.data || []) as Acao[],
        empresas,
        elegibilidades,
        pastas: (pastasRes.data || []) as Pasta[],
        pastaItems: items,
        processos,
        prospeccoes,
      };
    },
  });

  const acoes = data?.acoes ?? [];
  const empresas = data?.empresas ?? [];
  const elegibilidades = data?.elegibilidades ?? [];
  const pastas = data?.pastas ?? [];
  const pastaItems: PastaItem[] = data?.pastaItems ?? [];
  const processos = data?.processos ?? [];
  const prospeccoes = data?.prospeccoes ?? [];

  const acoesIniciais = acoes
    .filter((a) => a.tipo === "INICIAL")
    .map((a) => ({ id: a.id, nome: a.nome }));

  const empresasMap = useMemo(() => new Map(empresas.map((e) => [e.id, e])), [empresas]);

  // Carrega a lista completa de empresas só quando o picker "individual" abre.
  useEffect(() => {
    if (
      elegDialogOpen &&
      elegMode === "individual" &&
      allEmpresas.length === 0 &&
      !allEmpresasLoading
    ) {
      setAllEmpresasLoading(true);
      fetchAllRows<Empresa>("empresas", EMPRESA_COLS)
        .then(setAllEmpresas)
        .finally(() => setAllEmpresasLoading(false));
    }
  }, [elegDialogOpen, elegMode, allEmpresas.length, allEmpresasLoading]);

  // Deep-link: /acoes?acao=<id>&empresa=<id> abre a ação expandida e filtra
  // o painel pela empresa. Usado pelo "click na ação" dentro do EmpresaDetailSheet.
  const urlAcaoId = searchParams.get("acao");
  const urlEmpresaId = searchParams.get("empresa");

  const clearPinnedEmpresa = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("empresa");
    setSearchParams(next, { replace: true });
  };

  // Expande a ação alvo assim que a lista de ações chega e rola pra ela.
  useEffect(() => {
    if (!urlAcaoId) return;
    if (acoes.length === 0) return;
    if (!acoes.some((a) => a.id === urlAcaoId)) return; // id inválido
    setExpandedAcao(urlAcaoId);
    // Rola pra ação no próximo tick (depois do render do painel)
    requestAnimationFrame(() => {
      acaoCardRefs.current.get(urlAcaoId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [urlAcaoId, acoes]);

  const handleProspectar = (_elegId: string, empresaId: string) => {
    setProspRapidaEmpresaId(empresaId);
    setProspRapidaOpen(true);
  };

  const handleExportAcao = async (payload: AcaoEmpresasExportPayload) => {
    if (payload.empresaIds.length === 0) return;
    try {
      // chunk em 1000 (limite seguro de .in()) — quase sempre 1 chunk só
      const chunks: string[][] = [];
      for (let i = 0; i < payload.empresaIds.length; i += 1000) {
        chunks.push(payload.empresaIds.slice(i, i + 1000));
      }
      const results = await Promise.all(
        chunks.map((c) => supabase.from("empresas").select("*").in("id", c))
      );
      if (results.some((r) => r.error)) throw new Error("Erro Supabase");
      const empresasFull = results.flatMap((r) => r.data ?? []);
      const byId = new Map(empresasFull.map((e) => [e.id, e]));

      const rows: ExportRow[] = payload.empresaIds
        .map((id) => {
          const empresa = byId.get(id);
          const elegInfo = payload.elegInfoByEmpresaId.get(id);
          const status = payload.statusByEmpresaId.get(id);
          if (!empresa || !elegInfo || !status) return null;
          return { empresa, status, ...elegInfo } as ExportRow;
        })
        .filter((r): r is ExportRow => r !== null);

      if (rows.length === 0) {
        toast.error("Nenhuma empresa encontrada para exportar.");
        return;
      }

      await exportEmpresasAcaoXlsx(rows, payload.acaoNome);
      toast.success(`Planilha gerada (${rows.length} empresas).`);
      logAudit({
        tabela: "acoes_tributarias",
        acao: "Exportou empresas filtradas",
        detalhes: { acao_nome: payload.acaoNome, total: rows.length },
      });
    } catch (e) {
      console.error(e);
      toast.error("Falha ao exportar planilha.");
    }
  };

  // CRUD Ação
  const handleCreate = async (data: {
    nome: string;
    tipo: string;
    status: string;
    vinculo: string;
  }) => {
    // Nome duplicado quebra o mapeamento tese→id da detecção PJe (casa por nome).
    // `codigo` estável = contrato da detecção. Helpers compartilhados com o Admin.
    const nomeTrim = data.nome.trim();
    if (await nomeTeseExiste(nomeTrim)) {
      toast.error("Já existe uma tese com esse nome.");
      return;
    }
    const codigo = await gerarCodigoUnico(nomeTrim);
    const { error } = await supabase.from("acoes_tributarias").insert({
      ...data,
      nome: nomeTrim,
      vinculo: data.vinculo || "",
      user_id: user?.id,
      codigo,
    });
    if (error) {
      toast.error("Erro ao criar ação");
    } else {
      logAudit({
        tabela: "acoes_tributarias",
        acao: "Criou ação",
        detalhes: { nome: data.nome, tipo: data.tipo },
      });
      void refetch();
    }
  };

  const handleEdit = async (
    id: string,
    data: { nome: string; tipo: string; status: string; vinculo: string }
  ) => {
    const { error } = await supabase
      .from("acoes_tributarias")
      .update({ ...data, vinculo: data.vinculo || "" })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar ação");
    } else {
      toast.success("Ação atualizada!");
      logAudit({
        tabela: "acoes_tributarias",
        acao: "Editou ação",
        registro_id: id,
        detalhes: { nome: data.nome },
      });
      void refetch();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("acoes_tributarias").delete().eq("id", id);
    const acao = acoes.find((a) => a.id === id);
    if (error) {
      toast.error("Erro ao remover ação");
    } else {
      toast.success("Ação removida");
      logAudit({
        tabela: "acoes_tributarias",
        acao: "Removeu ação",
        registro_id: id,
        detalhes: { nome: acao?.nome },
      });
      // CASCADE no DB já remove elegibilidades/prospeccoes/criterios. Mas outras
      // páginas usam React Query com cache próprio — precisa invalidar pra que
      // /elegibilidade, /empresas, /prospeccao, /dashboard reflitam a remoção.
      qc.invalidateQueries({ queryKey: ["elegibilidade"] });
      qc.invalidateQueries({ queryKey: ["elegibilidade-recentes"] });
      qc.invalidateQueries({ queryKey: ["acoes"] });
      qc.invalidateQueries({ queryKey: ["empresas"] });
      qc.invalidateQueries({ queryKey: ["prospeccoes"] });
      qc.invalidateQueries({ queryKey: ["criterios"] });
      void refetch();
    }
  };

  const getElegibilidadesForAcao = (acaoId: string) =>
    elegibilidades.filter((e) => e.acao_id === acaoId);
  const handleDeleteEleg = async (id: string) => {
    const { error } = await supabase.from("elegibilidade").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover");
    } else {
      toast.success("Removido!");
      logAudit({ tabela: "elegibilidade", acao: "Removeu elegibilidade", registro_id: id });
      void refetch();
    }
  };

  const handleDesqualificar = async (elegId: string, motivo: string) => {
    // Persistir motivo + estado enum (mig 20260506000000/20260421000000) — antes
    // o motivo passado pela UI era silenciosamente descartado.
    const motivoTrim = motivo.trim();
    const { error } = await supabase
      .from("elegibilidade")
      .update({
        elegivel: false,
        status_qualificacao: "desqualificada",
        motivo_desqualificacao: motivoTrim || null,
      })
      .eq("id", elegId);
    if (error) {
      toast.error("Erro ao desqualificar empresa");
    } else {
      toast.success("Empresa marcada como inelegível");
      logAudit({
        tabela: "elegibilidade",
        acao: "Desqualificou empresa",
        registro_id: elegId,
        detalhes: motivoTrim ? { motivo: motivoTrim } : undefined,
      });
      void refetch();
    }
  };

  const handleUpdateContexto = async (elegId: string, destaque: boolean, notas: string | null) => {
    const { error } = await supabase
      .from("elegibilidade")
      .update({ destaque, notas_contexto: notas })
      .eq("id", elegId);
    if (error) {
      toast.error("Erro ao salvar contexto");
    } else {
      toast.success(destaque ? "Empresa marcada como destaque" : "Contexto salvo");
      void refetch();
    }
  };

  // Elegibilidade dialog
  const openElegDialog = (acaoId: string) => {
    setElegAcaoId(acaoId);
    setElegMode("individual");
    setElegSelectedEmpresas(new Set());
    setElegSelectedPasta("");
    setElegElegivel("true");
    setElegJustificativa("");
    setPlanilhaRows([]);
    setPlanilhaFileName("");
    setElegDialogOpen(true);
  };

  // Parse de planilha .xlsx/.csv para o modo "planilha"
  const handlePlanilhaUpload = async (file: File) => {
    setPlanilhaFileName(file.name);
    setPlanilhaProcessing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1 });
      if (json.length < 2) {
        toast.error("Planilha vazia");
        return;
      }

      const headers = (json[0] as string[]).map((h) =>
        String(h)
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
      );
      const cnpjCol = headers.findIndex((h) => h.includes("cnpj"));
      const nomeCol = headers.findIndex(
        (h) => h.includes("nome") || h.includes("razao") || h.includes("empresa")
      );
      if (cnpjCol === -1) {
        toast.error("Coluna CNPJ não encontrada");
        return;
      }

      const draft: Array<Omit<PlanilhaRow, "existing_id">> = [];
      const seen = new Set<string>();
      for (let i = 1; i < json.length; i++) {
        const row = json[i];
        if (!row || row.length === 0) continue;
        const rawCnpj = String(row[cnpjCol] ?? "").trim();
        const cnpj = maskCNPJ(rawCnpj);
        const nome = nomeCol !== -1 ? String(row[nomeCol] ?? "").trim() : "";
        const errors: string[] = [];
        if (!validateCNPJ(rawCnpj)) errors.push("CNPJ inválido");
        const key = cnpj.replace(/\D/g, "");
        if (seen.has(key)) errors.push("Duplicado no arquivo");
        else if (key) seen.add(key);
        draft.push({ cnpj, nome, valid: errors.length === 0, errors });
      }

      // Match contra empresas existentes
      const cnpjsValidos = draft.filter((r) => r.valid).map((r) => r.cnpj);
      const existingByCnpj = new Map<string, string>();
      if (cnpjsValidos.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < cnpjsValidos.length; i += CHUNK) {
          const slice = cnpjsValidos.slice(i, i + CHUNK);
          const { data } = await supabase.from("empresas").select("id, cnpj").in("cnpj", slice);
          for (const e of (data ?? []) as Array<{ id: string; cnpj: string }>) {
            existingByCnpj.set(e.cnpj, e.id);
          }
        }
      }

      const final: PlanilhaRow[] = draft.map((r) => ({
        ...r,
        existing_id: existingByCnpj.get(r.cnpj) ?? null,
      }));
      setPlanilhaRows(final);
      const novas = final.filter((r) => r.valid && !r.existing_id).length;
      const exist = final.filter((r) => r.valid && r.existing_id).length;
      const erros = final.filter((r) => !r.valid).length;
      toast.success(
        `${final.length} linhas: ${novas} novas, ${exist} existentes, ${erros} com erro`
      );
    } catch (e) {
      console.error(e);
      toast.error("Erro ao processar planilha");
    } finally {
      setPlanilhaProcessing(false);
    }
  };

  const empresaIdsInPasta = (pastaId: string) =>
    new Set(pastaItems.filter((i) => i.pasta_id === pastaId).map((i) => i.empresa_id));

  const handleSaveElegibilidade = async () => {
    let empresaIds: string[] = [];

    if (elegMode === "individual") {
      empresaIds = Array.from(elegSelectedEmpresas);
    } else if (elegMode === "pasta" && elegSelectedPasta) {
      empresaIds = Array.from(empresaIdsInPasta(elegSelectedPasta));
    } else if (elegMode === "planilha") {
      // 1) Cria empresas novas (CNPJs sem match) e enriquece via Receita
      const validRows = planilhaRows.filter((r) => r.valid);
      if (validRows.length === 0) {
        toast.error("Nenhuma linha válida na planilha");
        return;
      }

      const novasParaCriar = validRows.filter((r) => !r.existing_id);
      let criadasIds: string[] = [];
      if (novasParaCriar.length > 0) {
        const insertData = novasParaCriar.map((r) => ({
          cnpj: r.cnpj,
          nome: r.nome || "Importação — pendente RFB",
          status: "prospect",
          obs: "",
          user_id: user.id,
        }));
        const { data: ins, error } = await supabase
          .from("empresas")
          .insert(insertData)
          .select("id, cnpj");
        if (error) {
          toast.error("Erro ao criar empresas: " + error.message);
          return;
        }
        criadasIds = (ins ?? []).map((e: { id: string }) => e.id);

        // Dispara enriquecimento async (fire-and-forget — não bloqueia o save)
        for (const e of (ins ?? []) as Array<{ id: string; cnpj: string }>) {
          supabase.functions
            .invoke("enriquecer-cnpj", {
              body: { cnpj: e.cnpj, empresa_id: e.id },
            })
            .catch(() => {
              /* silently */
            });
        }
      }
      // 2) Junta IDs existentes + recém-criados
      const existentesIds = validRows.filter((r) => r.existing_id).map((r) => r.existing_id);
      empresaIds = [...existentesIds, ...criadasIds];
    }

    if (empresaIds.length === 0) {
      toast.error("Selecione ao menos uma empresa");
      return;
    }

    const existingPairs = new Set(
      elegibilidades.filter((e) => e.acao_id === elegAcaoId).map((e) => e.empresa_id)
    );
    const newIds = empresaIds.filter((id) => !existingPairs.has(id));
    if (newIds.length === 0) {
      toast.error("Todas as empresas já possuem elegibilidade nesta ação");
      return;
    }

    const items = newIds.map((empresa_id) => ({
      empresa_id,
      acao_id: elegAcaoId,
      elegivel: elegElegivel === "true",
      justificativa: elegJustificativa || "",
      user_id: user.id,
    }));

    // upsert com ignoreDuplicates: o filtro `existingPairs` acima já remove duplicatas,
    // mas se houver race condition (outro user inseriu no meio), evita erro 23505.
    const { error } = await supabase.from("elegibilidade").upsert(items, {
      onConflict: "empresa_id,acao_id",
      ignoreDuplicates: true,
    });
    if (error) {
      toast.error("Erro ao salvar");
      console.error(error);
      return;
    }
    const novasEmpresasMsg =
      elegMode === "planilha"
        ? ` (${planilhaRows.filter((r) => r.valid && !r.existing_id).length} empresas novas criadas + RFB sendo enriquecida em background)`
        : "";
    toast.success(`${newIds.length} elegibilidade(s) adicionada(s)!${novasEmpresasMsg}`);
    setElegDialogOpen(false);
    void refetch();
  };

  const toggleEmpresa = (id: string) => {
    setElegSelectedEmpresas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Processo handlers
  const openProcessoDialog = (elegId: string, existing?: Processo) => {
    setProcElegId(elegId);
    if (existing) {
      setEditingProcesso(existing);
      setProcNumero(existing.numero_processo || "");
      setProcFase(existing.fase);
      setProcValorEstimado(String(existing.valor_estimado || 0));
      setProcValorGanho(String(existing.valor_ganho || 0));
      setProcStatus(existing.status);
      setProcObs(existing.observacoes || "");
      setProcDataProcesso(existing.data_processo || "");
      const knownTribunais = [
        "JFAC",
        "JFAL",
        "JFAM",
        "JFAP",
        "JFBA",
        "JFCE",
        "JFDF",
        "JFES",
        "JFGO",
        "JFMA",
        "JFMG",
        "JFMS",
        "JFMT",
        "JFPA",
        "JFPB",
        "JFPE",
        "JFPI",
        "JFPR",
        "JFRJ",
        "JFRN",
        "JFRO",
        "JFRR",
        "JFRS",
        "JFSC",
        "JFSE",
        "JFSP",
        "JFTO",
        "TJAC",
        "TJAL",
        "TJAM",
        "TJAP",
        "TJBA",
        "TJCE",
        "TJDFT",
        "TJES",
        "TJGO",
        "TJMA",
        "TJMG",
        "TJMS",
        "TJMT",
        "TJPA",
        "TJPB",
        "TJPE",
        "TJPI",
        "TJPR",
        "TJRJ",
        "TJRN",
        "TJRO",
        "TJRR",
        "TJRS",
        "TJSC",
        "TJSE",
        "TJSP",
        "TJTO",
        "TRF1",
        "TRF2",
        "TRF3",
        "TRF4",
        "TRF5",
        "TRF6",
        "STJ",
        "STF",
        "",
      ];
      const t = existing.tribunal || "";
      if (knownTribunais.includes(t)) {
        setProcTribunal(t);
        setProcTribunalOutro("");
      } else {
        setProcTribunal("Outro");
        setProcTribunalOutro(t);
      }
    } else {
      setEditingProcesso(null);
      setProcNumero("");
      setProcFase("Inicial");
      setProcValorEstimado("");
      setProcValorGanho("");
      setProcStatus("Em andamento");
      setProcObs("");
      setProcDataProcesso("");
      setProcTribunal("");
      setProcTribunalOutro("");
    }
    setProcDialogOpen(true);
  };

  const handleSaveProcesso = async () => {
    const payload = {
      numero_processo: procNumero,
      fase: procFase,
      valor_estimado: parseFloat(procValorEstimado) || 0,
      valor_ganho: parseFloat(procValorGanho) || 0,
      status: procStatus,
      observacoes: procObs,
      data_processo: procDataProcesso || null,
      tribunal: procTribunal === "Outro" ? procTribunalOutro : procTribunal,
    };
    if (editingProcesso) {
      const { error } = await supabase
        .from("processos")
        .update(payload)
        .eq("id", editingProcesso.id);
      if (error) {
        toast.error("Erro ao atualizar processo");
        return;
      }
      toast.success("Processo atualizado!");
      logAudit({
        tabela: "processos",
        acao: "Editou processo",
        registro_id: editingProcesso.id,
        detalhes: payload,
      });
    } else {
      const eleg = elegibilidades.find((e) => e.id === procElegId);
      const { error } = await supabase.from("processos").insert({
        ...payload,
        elegibilidade_id: procElegId,
        empresa_id: eleg?.empresa_id ?? null,
        acao_id: eleg?.acao_id ?? null,
        user_id: user.id,
      });
      if (error) {
        toast.error("Erro ao criar processo");
        return;
      }
      toast.success("Processo registrado!");
      logAudit({
        tabela: "processos",
        acao: "Criou processo",
        detalhes: { ...payload, elegibilidade_id: procElegId },
      });
    }
    setProcDialogOpen(false);
    void refetch();
  };

  // Totals
  const getTotalsForAcao = (acaoId: string) => {
    const acaoProcessos = processos.filter((p) => p.acao_id === acaoId);
    return {
      estimado: acaoProcessos.reduce((s, p) => s + (Number(p.valor_estimado) || 0), 0),
      ganho: acaoProcessos.reduce((s, p) => s + (Number(p.valor_ganho) || 0), 0),
      count: acaoProcessos.length,
    };
  };

  if (loading) {
    return <LoadingState variant="page" />;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Ações Tributárias"
        description="Gestão de ações iniciais e rescisórias"
        icon={<Scale className="h-7 w-7" />}
        helpTutorialTab="fluxo"
        helpTooltip="Fluxo: Criar ações tributárias"
        actions={
          <AcaoDialog
            onSave={(d) => {
              void handleCreate(d);
            }}
            acoesIniciais={acoesIniciais}
          />
        }
      />

      {acoes.length === 0 && (
        <EmptyState
          icon={Scale}
          title="Nenhuma ação cadastrada"
          description="Ações são as teses jurídicas do escritório. Ao cadastrar, defina regras de elegibilidade e o sistema calcula automaticamente quais empresas do banco são candidatas."
          secondaryAction={{ label: "Ver tutorial", to: "/tutorial?tab=fluxo", icon: BookOpen }}
        />
      )}

      <div className="grid gap-4">
        {acoes.map((a) => {
          const acaoElegs = getElegibilidadesForAcao(a.id);
          const isExpanded = expandedAcao === a.id;
          const totals = getTotalsForAcao(a.id);
          // Contagens deduplicadas por empresa_id e sem órfãos — bate com o painel
          const seenAll = new Set<string>();
          const seenEleg = new Set<string>();
          for (const eleg of acaoElegs) {
            if (!empresasMap.has(eleg.empresa_id)) continue;
            seenAll.add(eleg.empresa_id);
            if (eleg.elegivel) seenEleg.add(eleg.empresa_id);
          }
          const empresasCount = seenAll.size;
          const elegiveisCount = seenEleg.size;

          return (
            <Card
              key={a.id}
              ref={(node) => {
                if (node) acaoCardRefs.current.set(a.id, node);
                else acaoCardRefs.current.delete(a.id);
              }}
              className="shadow-card transition-shadow hover:shadow-elevated"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{a.nome}</h3>
                      <Badge
                        variant={a.tipo === "INICIAL" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {a.tipo}
                      </Badge>
                    </div>
                    {a.tipo === "RESCISÓRIA" && a.vinculo && (
                      <p className="text-xs text-muted-foreground">
                        Vinculada a: <span className="text-foreground">{a.vinculo}</span>
                      </p>
                    )}
                    {totals.count > 0 && (
                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <DollarSign className="h-3 w-3" />
                          Estimado:{" "}
                          <span className="font-medium text-foreground">
                            {formatCurrency(totals.estimado)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          Ganho:{" "}
                          <span className="font-medium text-success">
                            {formatCurrency(totals.ganho)}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        a.status === "Ativa"
                          ? "bg-success/10 text-success"
                          : a.status === "Inativa"
                            ? "bg-muted text-muted-foreground"
                            : "bg-warning/10 text-warning"
                      }`}
                    >
                      {a.status}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      <Users className="mr-1 h-3 w-3" />
                      {empresasCount} empresas
                    </Badge>
                    {elegiveisCount > 0 && (
                      <Badge
                        variant="outline"
                        className="border-success/30 text-[10px] text-success"
                      >
                        <UserCheck className="mr-1 h-3 w-3" />
                        {elegiveisCount} elegíveis
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setImportProspAcao({ id: a.id, nome: a.nome })}
                    >
                      <FileSpreadsheet className="mr-1 h-3 w-3" />
                      Importar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openElegDialog(a.id)}>
                      <Plus className="mr-1 h-3 w-3" />
                      Elegibilidade
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setCriteriosAcaoId(a.id)}>
                      <ListChecks className="mr-1 h-3 w-3" />
                      Critérios
                    </Button>
                    <AcaoDialog
                      onSave={(data) => {
                        void handleEdit(a.id, data);
                      }}
                      initialData={a}
                      title="Editar Ação"
                      acoesIniciais={acoesIniciais}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Editar
                        </Button>
                      }
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                          <AlertDialogDescription>Remover "{a.nome}"?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              void handleDelete(a.id);
                            }}
                          >
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setExpandedAcao(isExpanded ? null : a.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border px-5 py-4">
                  <AcaoEmpresasPanel
                    acaoId={a.id}
                    acaoNome={a.nome}
                    empresasMap={empresasMap}
                    elegs={acaoElegs}
                    prospeccoes={prospeccoes as unknown as ProspMin[]}
                    onProspectar={handleProspectar}
                    onOpenProcesso={(elegId) => openProcessoDialog(elegId)}
                    onDeleteEleg={(id) => {
                      void handleDeleteEleg(id);
                    }}
                    onDesqualificar={handleDesqualificar}
                    onUpdateContexto={handleUpdateContexto}
                    onExport={handleExportAcao}
                    onViewEmpresaId={setDetailEmpresaId}
                    pinnedEmpresaId={a.id === urlAcaoId ? urlEmpresaId : null}
                    onClearPinnedEmpresa={a.id === urlAcaoId ? clearPinnedEmpresa : undefined}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <ProspeccaoRapidaDialog
        open={prospRapidaOpen}
        onOpenChange={setProspRapidaOpen}
        empresaId={prospRapidaEmpresaId}
        acaoId={expandedAcao ?? ""}
        empresaNome={empresas.find((e) => e.id === prospRapidaEmpresaId)?.nome ?? ""}
        onSuccess={() => {
          void refetch();
        }}
      />

      <EmpresaQuickSheet empresaId={detailEmpresaId} onClose={() => setDetailEmpresaId(null)} />

      {importProspAcao && (
        <ImportacaoProspeccaoDialog
          acaoId={importProspAcao.id}
          acaoNome={importProspAcao.nome}
          open={!!importProspAcao}
          onClose={() => setImportProspAcao(null)}
          onImported={() => {
            void refetch();
            setImportProspAcao(null);
          }}
          empresasMap={empresasMap}
          elegibilidades={elegibilidades}
        />
      )}

      {/* Elegibilidade Dialog */}
      <Dialog open={elegDialogOpen} onOpenChange={setElegDialogOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Adicionar Elegibilidade — {acoes.find((a) => a.id === elegAcaoId)?.nome}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={elegMode === "individual" ? "default" : "outline"}
                size="sm"
                onClick={() => setElegMode("individual")}
              >
                <Users className="mr-2 h-3 w-3" />
                Individual
              </Button>
              <Button
                variant={elegMode === "pasta" ? "default" : "outline"}
                size="sm"
                onClick={() => setElegMode("pasta")}
              >
                <Folder className="mr-2 h-3 w-3" />
                Por Pasta
              </Button>
              <Button
                variant={elegMode === "planilha" ? "default" : "outline"}
                size="sm"
                onClick={() => setElegMode("planilha")}
              >
                <FileSpreadsheet className="mr-2 h-3 w-3" />
                Planilha
              </Button>
            </div>
            {elegMode === "individual" && (
              <div className="space-y-2">
                <Label>Selecione as empresas</Label>
                <Input
                  value={empresaBusca}
                  onChange={(e) => setEmpresaBusca(e.target.value)}
                  placeholder="Buscar por nome ou CNPJ…"
                  className="h-9"
                />
                <div className="max-h-[30vh] space-y-1 overflow-y-auto">
                  {allEmpresasLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Carregando empresas…
                    </p>
                  ) : (
                    (() => {
                      const q = empresaBusca.trim().toLowerCase();
                      const filtered = q
                        ? allEmpresas.filter(
                            (e) =>
                              (e.nome || "").toLowerCase().includes(q) || (e.cnpj || "").includes(q)
                          )
                        : allEmpresas;
                      const shown = filtered.slice(0, 200);
                      return (
                        <>
                          {shown.map((e) => (
                            <label
                              key={e.id}
                              className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={elegSelectedEmpresas.has(e.id)}
                                onCheckedChange={() => toggleEmpresa(e.id)}
                              />
                              <div>
                                <div className="text-sm font-medium">{e.nome}</div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {e.cnpj}
                                </div>
                              </div>
                            </label>
                          ))}
                          {filtered.length > shown.length && (
                            <p className="py-1 text-center text-[11px] text-muted-foreground">
                              Mostrando {shown.length} de {filtered.length} — refine a busca.
                            </p>
                          )}
                          {filtered.length === 0 && (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                              Nenhuma empresa encontrada.
                            </p>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              </div>
            )}
            {elegMode === "pasta" && (
              <div className="space-y-2">
                <Label>Selecione a pasta</Label>
                <Select value={elegSelectedPasta} onValueChange={setElegSelectedPasta}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha uma pasta..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pastas.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome} ({empresaIdsInPasta(p.id).size} empresas)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {elegMode === "planilha" && (
              <div className="space-y-3">
                <div className="rounded-lg border-2 border-dashed border-border p-4 text-center transition-colors hover:border-muted-foreground/30">
                  <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="mb-1 text-sm font-medium">
                    {planilhaFileName || "Selecione um arquivo"}
                  </p>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    CSV ou XLSX com coluna CNPJ (e Nome opcional)
                  </p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    id="planilha-eleg-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handlePlanilhaUpload(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("planilha-eleg-input")?.click()}
                    disabled={planilhaProcessing}
                  >
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                    {planilhaProcessing ? "Processando..." : "Escolher arquivo"}
                  </Button>
                </div>

                {planilhaRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="gap-1 border-0 bg-info/10 text-info">
                        <Plus className="h-2.5 w-2.5" />
                        {planilhaRows.filter((r) => r.valid && !r.existing_id).length} novas
                      </Badge>
                      <Badge
                        variant="outline"
                        className="gap-1 border-0 bg-success/10 text-success"
                      >
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {planilhaRows.filter((r) => r.valid && r.existing_id).length} existentes
                      </Badge>
                      {planilhaRows.some((r) => !r.valid) && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-0 bg-destructive/10 text-destructive"
                        >
                          <XCircle className="h-2.5 w-2.5" />
                          {planilhaRows.filter((r) => !r.valid).length} com erro
                        </Badge>
                      )}
                    </div>
                    <div className="max-h-[28vh] overflow-y-auto rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/30">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                              CNPJ
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                              Nome
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {planilhaRows.map((r, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-2 py-1 font-mono text-[10px]">{r.cnpj || "—"}</td>
                              <td className="max-w-[140px] truncate px-2 py-1">{r.nome || "—"}</td>
                              <td className="px-2 py-1">
                                {!r.valid ? (
                                  <span className="text-destructive">{r.errors.join(", ")}</span>
                                ) : r.existing_id ? (
                                  <span className="text-success">existente</span>
                                ) : (
                                  <span className="text-info">nova</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Empresas novas serão criadas com nome da planilha (ou "Importação — pendente
                      RFB" se vazio) e enriquecidas via Receita Federal automaticamente em
                      background.
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Elegível?</Label>
              <Select value={elegElegivel} onValueChange={setElegElegivel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim — Elegível</SelectItem>
                  <SelectItem value="false">Não — Não elegível</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Justificativa</Label>
              <Textarea
                value={elegJustificativa}
                onChange={(e) => setElegJustificativa(e.target.value)}
                placeholder="Motivo (opcional)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setElegDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void handleSaveElegibilidade();
              }}
            >
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Processo Dialog */}
      <Dialog open={procDialogOpen} onOpenChange={setProcDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingProcesso ? "Editar Processo" : "Novo Processo"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Número do Processo</Label>
                <Input
                  value={procNumero}
                  onChange={(e) => setProcNumero(e.target.value)}
                  placeholder="Ex: 0001234-56.2024.8.26.0100"
                />
              </div>
              <div className="space-y-2">
                <Label>Tribunal</Label>
                <Select
                  value={procTribunal}
                  onValueChange={(v) => {
                    setProcTribunal(v);
                    if (v !== "Outro") setProcTribunalOutro("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {[
                      {
                        label: "— Justiça Federal —",
                        items: [
                          "JFAC",
                          "JFAL",
                          "JFAM",
                          "JFAP",
                          "JFBA",
                          "JFCE",
                          "JFDF",
                          "JFES",
                          "JFGO",
                          "JFMA",
                          "JFMG",
                          "JFMS",
                          "JFMT",
                          "JFPA",
                          "JFPB",
                          "JFPE",
                          "JFPI",
                          "JFPR",
                          "JFRJ",
                          "JFRN",
                          "JFRO",
                          "JFRR",
                          "JFRS",
                          "JFSC",
                          "JFSE",
                          "JFSP",
                          "JFTO",
                        ],
                      },
                      {
                        label: "— Tribunais Estaduais —",
                        items: [
                          "TJAC",
                          "TJAL",
                          "TJAM",
                          "TJAP",
                          "TJBA",
                          "TJCE",
                          "TJDFT",
                          "TJES",
                          "TJGO",
                          "TJMA",
                          "TJMG",
                          "TJMS",
                          "TJMT",
                          "TJPA",
                          "TJPB",
                          "TJPE",
                          "TJPI",
                          "TJPR",
                          "TJRJ",
                          "TJRN",
                          "TJRO",
                          "TJRR",
                          "TJRS",
                          "TJSC",
                          "TJSE",
                          "TJSP",
                          "TJTO",
                        ],
                      },
                      {
                        label: "— Tribunais Regionais Federais —",
                        items: ["TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6"],
                      },
                      { label: "— Tribunais Superiores —", items: ["STJ", "STF"] },
                    ].map((group) => (
                      <div key={group.label}>
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                          {group.label}
                        </div>
                        {group.items.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                {procTribunal === "Outro" && (
                  <Input
                    className="mt-2"
                    value={procTribunalOutro}
                    onChange={(e) => setProcTribunalOutro(e.target.value)}
                    placeholder="Informe o tribunal..."
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Data do Processo</Label>
              <Input
                type="date"
                value={procDataProcesso}
                onChange={(e) => setProcDataProcesso(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fase</Label>
                <Select value={procFase} onValueChange={setProcFase}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {faseOptions.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={procStatus} onValueChange={setProcStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusProcessoOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valor Estimado (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={procValorEstimado}
                  onChange={(e) => setProcValorEstimado(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label>Valor Ganho (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={procValorGanho}
                  onChange={(e) => setProcValorGanho(e.target.value)}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={procObs}
                onChange={(e) => setProcObs(e.target.value)}
                placeholder="Detalhes (opcional)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void handleSaveProcesso();
              }}
            >
              {editingProcesso ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Critérios de Elegibilidade Dialog */}
      <Dialog open={!!criteriosAcaoId} onOpenChange={(v) => !v && setCriteriosAcaoId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading">Critérios de Elegibilidade</DialogTitle>
          </DialogHeader>
          {criteriosAcaoId && (
            <CriteriosAdmin
              acaoId={criteriosAcaoId}
              acaoNome={acoes.find((a) => a.id === criteriosAcaoId)?.nome}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
