import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Handshake,
  Phone,
  Mail,
  Building2,
  Scale,
  Pencil,
  DollarSign,
  ArrowRight,
  Search,
  Filter,
  Plus,
  MessageSquare,
  AlertTriangle,
  TrendingUp,
  Clock,
  Zap,
  FileText,
  BookOpen,
  EyeOff,
  Columns2,
  User,
  Users,
  Lock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProspeccaoContatosDialog } from "@/components/ProspeccaoContatosDialog";
import { TemplateSelectorDialog } from "@/components/TemplateSelectorDialog";
import { PropostaDialog } from "@/components/PropostaDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { EmpresaQuickSheet } from "./empresas/EmpresaQuickSheet";
import type { Database } from "@/integrations/supabase/types";
import { differenceInDays, parseISO } from "date-fns";
import { PROSPECCAO_STATUSES as statusColumns } from "@/lib/prospeccaoStatus";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

type MotivoPerdido = Database["public"]["Enums"]["motivo_perdido"];
type CargoCategoria = Database["public"]["Enums"]["cargo_categoria"];

const CARGO_CATEGORIAS: { value: CargoCategoria; label: string }[] = [
  { value: "ceo", label: "CEO / Presidente" },
  { value: "cfo", label: "CFO / Diretor Financeiro" },
  { value: "socio", label: "Sócio" },
  { value: "diretor", label: "Diretor (outros)" },
  { value: "controller", label: "Controller" },
  { value: "gerente_fiscal", label: "Gerente Fiscal / Tributário" },
  { value: "contador", label: "Contador" },
  { value: "coordenador", label: "Coordenador" },
  { value: "analista", label: "Analista" },
  { value: "outros", label: "Outros" },
];

const OBJECOES_COMUNS = [
  "Preço / success fee alto",
  "Desconfia da tese",
  "Timing ruim",
  "Precisa autorização do sócio",
  "Já está com outro escritório",
  "Receia problema com a Receita",
  "Burocracia interna",
  "Não entendeu o valor",
];

interface Prospeccao {
  id: string;
  elegibilidade_id: string;
  empresa_id: string | null;
  acao_id: string | null;
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
  motivo_perdido: MotivoPerdido | null;
  motivo_perdido_detalhes: string | null;
  numero_contatos: number;
  ultimo_contato_em: string | null;
  proximo_contato_em: string | null;
  // CLOSER framework — Sprint 2
  dor_identificada: string | null;
  tentativas_anteriores: string | null;
  decisor_confirmado: boolean;
  valor_emocional_articulado: string | null;
  objecoes_principais: string[];
  cargo_categoria: CargoCategoria | null;
  eh_decisor: boolean;
}

interface ElegibilidadeRow {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  ja_ajuizada: boolean;
  valor_potencial_estimado: number | null;
}

interface Empresa {
  id: string;
  nome: string;
  cnpj: string;
}

interface Acao {
  id: string;
  nome: string;
  data_limite_prescricao: string | null;
  tipo_prazo: string | null;
}

// Linha do painel "Progresso geral" — estatísticas agregadas por SDR/responsável.
interface EquipeRow {
  id: string;
  nome: string;
  isMe: boolean;
  total: number;
  contato: number;
  proposta: number;
  negociacao: number;
  assinados: number;
  iniciados: number;
  perdidos: number;
  valorAssinado: number;
  pipeline: number;
  conversao: number;
}

// fetchAllRows movido para src/lib/supabaseFetchAll.ts (compartilhado com
// Dashboard, Acoes, AnaliseRFB, EmpresasMapView). Importado abaixo.

const MOTIVOS_PERDIDO: { value: MotivoPerdido; label: string }[] = [
  { value: "preco", label: "Preço / success fee alto" },
  { value: "desconfianca_tese", label: "Desconfiança da tese jurídica" },
  { value: "timing", label: "Timing — cliente não prioriza agora" },
  { value: "concorrente", label: "Foi para concorrente" },
  { value: "decisor_errado", label: "Falamos com decisor errado" },
  { value: "sem_interesse", label: "Sem interesse real" },
  { value: "sem_resposta", label: "Sem resposta após insistir" },
  { value: "outros", label: "Outros (descrever)" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCompactCurrency(value: number) {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return formatCurrency(value);
}

// Cadência Hormozi: 5-8 toques em B2B. <5 é desperdício.
function cadenciaStatus(n: number): { color: string; label: string } {
  if (n === 0) return { color: "bg-muted text-muted-foreground", label: "0/7" };
  if (n < 5) return { color: "bg-warning/15 text-warning", label: `${n}/7` };
  if (n < 7) return { color: "bg-info/15 text-info", label: `${n}/7` };
  return { color: "bg-success/15 text-success", label: `${n}/7 ✓` };
}

// Urgência de prescrição — quanto tempo falta até a data limite
function prescricaoInfo(
  dataLimite: string | null
): { cor: string; texto: string; emoji: string } | null {
  if (!dataLimite) return null;
  const dias = differenceInDays(parseISO(dataLimite), new Date());
  if (dias < 0)
    return {
      cor: "bg-destructive/20 text-destructive",
      texto: `PRESCRITA há ${Math.abs(dias)}d`,
      emoji: "⛔",
    };
  if (dias <= 30)
    return {
      cor: "bg-destructive/15 text-destructive",
      texto: `${dias}d p/ prescrever`,
      emoji: "🔥",
    };
  if (dias <= 90)
    return { cor: "bg-warning/15 text-warning", texto: `${dias}d p/ prescrever`, emoji: "⚠" };
  if (dias <= 180)
    return { cor: "bg-info/15 text-info", texto: `${dias}d p/ prescrever`, emoji: "⏳" };
  return null;
}

export default function Prospeccao() {
  const [prospeccoes, setProspeccoes] = useState<Prospeccao[]>([]);
  const [elegibilidades, setElegibilidades] = useState<ElegibilidadeRow[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; nome: string; email: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAcao, setFilterAcao] = useState("all");
  const [filterResponsavel, setFilterResponsavel] = useState("all");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [compact, setCompact] = useState(false);
  // Visão do Kanban: "meu" (só as prospecções sob minha responsabilidade) x
  // "geral" (equipe inteira + painel de progresso). SDR (role comercial,
  // não-gestor) começa em "meu"; gestor/admin começam em "geral".
  const [viewMode, setViewMode] = useState<"meu" | "geral">("meu");
  const viewModeInitRef = useRef(false);
  const { user, roles, canManageAll, loading: authLoading } = useAuth();
  const isSDR = roles.includes("comercial") && !canManageAll;

  // Define a visão inicial uma única vez, quando as roles resolverem. Depois
  // disso o usuário controla o toggle manualmente.
  useEffect(() => {
    if (viewModeInitRef.current || authLoading) return;
    viewModeInitRef.current = true;
    setViewMode(isSDR ? "meu" : "geral");
  }, [authLoading, isSDR]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createAcaoId, setCreateAcaoId] = useState("");
  const [createElegId, setCreateElegId] = useState("");
  const [createContatoNome, setCreateContatoNome] = useState("");
  const [createContatoTel, setCreateContatoTel] = useState("");
  const [createContatoEmail, setCreateContatoEmail] = useState("");
  const [createContatoCargo, setCreateContatoCargo] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [detailEmpresaId, setDetailEmpresaId] = useState<string | null>(null);
  const [editProsp, setEditProsp] = useState<Prospeccao | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editContatoNome, setEditContatoNome] = useState("");
  const [editContatoTel, setEditContatoTel] = useState("");
  const [editContatoEmail, setEditContatoEmail] = useState("");
  const [editContatoCargo, setEditContatoCargo] = useState("");
  const [editNotas, setEditNotas] = useState("");
  const [editValorContrato, setEditValorContrato] = useState("");
  const [editTipoContrato, setEditTipoContrato] = useState("");
  const [editDataContrato, setEditDataContrato] = useState("");
  const [editDataAssinatura, setEditDataAssinatura] = useState("");
  const [editObsContrato, setEditObsContrato] = useState("");
  const [editMotivoPerdido, setEditMotivoPerdido] = useState<MotivoPerdido | "">("");
  const [editMotivoDetalhes, setEditMotivoDetalhes] = useState("");

  // Responsável pela prospecção (FK profiles)
  const [editResponsavelId, setEditResponsavelId] = useState<string>("");

  // CLOSER — Sprint 2
  const [editDor, setEditDor] = useState("");
  const [editTentativas, setEditTentativas] = useState("");
  const [editDecisorConfirmado, setEditDecisorConfirmado] = useState(false);
  const [editValorEmocional, setEditValorEmocional] = useState("");
  const [editObjecoes, setEditObjecoes] = useState<string[]>([]);
  const [editCargoCat, setEditCargoCat] = useState<CargoCategoria | "">("");
  const [editEhDecisor, setEditEhDecisor] = useState(false);

  // Excluir prospecção (ex: duplicada) — não precisa passar por "Perdido"
  const [deleteProsp, setDeleteProsp] = useState<Prospeccao | null>(null);

  // Contatos (cadência) dialog
  const [contatosOpen, setContatosOpen] = useState(false);
  const [contatosProspId, setContatosProspId] = useState<string | null>(null);
  const [contatosLabel, setContatosLabel] = useState<string>("");

  // Templates dialog
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Proposta dialog (criação/edição da proposta comercial)
  const [propostaOpen, setPropostaOpen] = useState(false);
  const [propostaProsp, setPropostaProsp] = useState<Prospeccao | null>(null);

  const fetchAll = async () => {
    // prospeccoes e elegibilidade são paginadas — o PostgREST corta respostas
    // grandes em ~1000 linhas e empresas tem ~5k. Buscar `empresas` inteira
    // truncava silenciosamente: prospecções cuja empresa caía fora das 1000
    // primeiras sumiam do kanban. Aqui buscamos só as empresas referenciadas
    // pelas elegibilidades, por id.
    const [prospRows, elegRows, acoesRes, profsRes] = await Promise.all([
      fetchAllRows<Prospeccao>("prospeccoes", "*"),
      fetchAllRows<ElegibilidadeRow>(
        "elegibilidade",
        "id, empresa_id, acao_id, elegivel, ja_ajuizada, valor_potencial_estimado"
      ),
      supabase.from("acoes_tributarias").select("id, nome, data_limite_prescricao, tipo_prazo"),
      supabase.from("profiles").select("id, nome, email").eq("ativo", true).order("nome"),
    ]);

    // Empresas: só as referenciadas pelas elegibilidades, buscadas por id em
    // lotes de 100 (evita URL longa demais no filtro .in).
    const empresaIds = [...new Set(elegRows.map((e) => e.empresa_id).filter(Boolean))];
    const empresasData: Empresa[] = [];
    for (let i = 0; i < empresaIds.length; i += 100) {
      const { data } = await (
        supabase.from("empresas") as never as {
          select: (s: string) => {
            in: (c: string, v: string[]) => Promise<{ data: Empresa[] | null }>;
          };
        }
      )
        .select("id, nome, cnpj")
        .in("id", empresaIds.slice(i, i + 100));
      if (data) empresasData.push(...data);
    }

    setProspeccoes(prospRows);
    setElegibilidades(elegRows);
    setEmpresas(empresasData);
    setProfiles((profsRes.data ?? []) as Array<{ id: string; nome: string; email: string }>);
    setAcoes((acoesRes.data as Acao[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // prospeccoes tem empresa_id + acao_id desnormalizados (migration 20260527).
  // elegibilidade_id permanece para lookup de valor_potencial_estimado.
  const getEmpresa = (p: Prospeccao) =>
    p.empresa_id ? (empresas.find((emp) => emp.id === p.empresa_id) ?? null) : null;

  const getAcao = (p: Prospeccao) =>
    p.acao_id ? (acoes.find((a) => a.id === p.acao_id) ?? null) : null;

  const getElegibilidade = (p: { empresa_id: string | null; acao_id: string | null }) =>
    elegibilidades.find((e) => e.empresa_id === p.empresa_id && e.acao_id === p.acao_id);
  const getValorPotencial = (p: { empresa_id: string | null; acao_id: string | null }) =>
    Number(getElegibilidade(p)?.valor_potencial_estimado ?? 0);

  // Ownership de prospecção — espelha a policy RLS de UPDATE
  // (auth.uid() = user_id OR responsavel_id OR gestor/admin).
  const respOf = (p: Prospeccao) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((p as any).responsavel_id ?? null) as string | null;
  const ownerOf = (p: Prospeccao) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((p as any).user_id ?? null) as string | null;
  // "Minha": tenho responsabilidade explícita, ou (sem responsável) fui o criador.
  const isMine = (p: Prospeccao) => {
    const r = respOf(p);
    return r ? r === user?.id : ownerOf(p) === user?.id;
  };
  // Posso mover/editar? Gestor/admin sempre; SDR só as próprias (senão RLS barra).
  const canEdit = (p: Prospeccao) => canManageAll || isMine(p);

  const filteredProspeccoes = useMemo(() => {
    // Remove só prospecções realmente órfãs (empresa deletada).
    const empresaIdSet = new Set(empresas.map((e) => e.id));
    let items = prospeccoes.filter((p) => !!p.empresa_id && empresaIdSet.has(p.empresa_id));
    if (filterAcao !== "all") {
      items = items.filter((p) => p.acao_id === filterAcao);
    }
    if (viewMode === "meu") {
      // "Meu trabalho": só as prospecções sob minha responsabilidade.
      items = items.filter(isMine);
    } else {
      // "Progresso geral": filtro opcional por responsável do dropdown.
      // 'all' | '_me' (logado) | '_none' (sem) | <profile_id>
      if (filterResponsavel === "_me") {
        items = items.filter(isMine);
      } else if (filterResponsavel === "_none") {
        items = items.filter((p) => !respOf(p));
      } else if (filterResponsavel !== "all") {
        items = items.filter((p) => respOf(p) === filterResponsavel);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((p) => {
        const emp = getEmpresa(p);
        const acao = getAcao(p);
        return (
          emp?.nome.toLowerCase().includes(q) ||
          p.contato_nome?.toLowerCase().includes(q) ||
          acao?.nome.toLowerCase().includes(q)
        );
      });
    }
    // QW2: ordena por valor_potencial DESC (empresas grandes no topo)
    return [...items].sort((a, b) => {
      const va = getValorPotencial(a);
      const vb = getValorPotencial(b);
      return vb - va;
    });
  }, [
    prospeccoes,
    elegibilidades,
    empresas,
    acoes,
    filterAcao,
    filterResponsavel,
    viewMode,
    search,
    user?.id,
    canManageAll,
  ]);

  // Estatísticas por SDR/responsável — alimenta o painel "Progresso geral".
  // Base = mesmas prospecções do escopo geral (ação + busca), sem filtrar por
  // responsável, agrupadas por quem detém a prospecção.
  const equipeRows = useMemo<EquipeRow[]>(() => {
    if (viewMode !== "geral") return [];
    const empresaIdSet = new Set(empresas.map((e) => e.id));
    let base = prospeccoes.filter((p) => !!p.empresa_id && empresaIdSet.has(p.empresa_id));
    if (filterAcao !== "all") base = base.filter((p) => p.acao_id === filterAcao);
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((p) => {
        const emp = getEmpresa(p);
        const acao = getAcao(p);
        return (
          emp?.nome.toLowerCase().includes(q) ||
          p.contato_nome?.toLowerCase().includes(q) ||
          acao?.nome.toLowerCase().includes(q)
        );
      });
    }
    const SEM = "__sem__";
    const groups = new Map<string, Prospeccao[]>();
    for (const p of base) {
      const key = respOf(p) ?? ownerOf(p) ?? SEM;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    const nomeDe = (id: string) =>
      id === SEM ? "Sem responsável" : (profiles.find((x) => x.id === id)?.nome ?? "—");
    const rows: EquipeRow[] = [...groups.entries()].map(([id, ps]) => {
      const countBy = (k: string) => ps.filter((p) => p.status_prospeccao === k).length;
      const assinados = countBy("Contrato assinado");
      const iniciados = countBy("Serviço iniciado");
      const perdidos = countBy("Perdido");
      const ganhos = assinados + iniciados;
      const decididos = ganhos + perdidos;
      const valorAssinado = ps
        .filter(
          (p) =>
            p.status_prospeccao === "Contrato assinado" ||
            p.status_prospeccao === "Serviço iniciado"
        )
        .reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
      const pipeline = ps
        .filter(
          (p) =>
            p.status_prospeccao !== "Perdido" &&
            p.status_prospeccao !== "Contrato assinado" &&
            p.status_prospeccao !== "Serviço iniciado"
        )
        .reduce((s, p) => s + getValorPotencial(p), 0);
      return {
        id,
        nome: nomeDe(id),
        isMe: id === user?.id,
        total: ps.length,
        contato: countBy("Contato feito"),
        proposta: countBy("Proposta enviada"),
        negociacao: countBy("Em negociação"),
        assinados,
        iniciados,
        perdidos,
        valorAssinado,
        pipeline,
        conversao: decididos > 0 ? ganhos / decididos : 0,
      };
    });
    // "Sem responsável" vai pro fim; demais por ganhos e pipeline desc.
    rows.sort((a, b) => {
      if (a.id === "__sem__") return 1;
      if (b.id === "__sem__") return -1;
      return b.assinados + b.iniciados - (a.assinados + a.iniciados) || b.pipeline - a.pipeline;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewMode,
    prospeccoes,
    empresas,
    acoes,
    elegibilidades,
    filterAcao,
    search,
    profiles,
    user?.id,
  ]);

  const openEdit = (p: Prospeccao) => {
    setEditProsp(p);
    setEditStatus(p.status_prospeccao);
    setEditContatoNome(p.contato_nome || "");
    setEditContatoTel(p.contato_telefone || "");
    setEditContatoEmail(p.contato_email || "");
    setEditContatoCargo(p.contato_cargo || "");
    setEditNotas(p.notas_prospeccao || "");
    setEditValorContrato(String(p.valor_contrato || 0));
    setEditTipoContrato(p.tipo_contrato || "");
    setEditDataContrato(p.data_contrato || "");
    setEditDataAssinatura(p.data_assinatura || "");
    setEditObsContrato(p.observacoes_contrato || "");
    setEditMotivoPerdido(p.motivo_perdido ?? "");
    setEditMotivoDetalhes(p.motivo_perdido_detalhes ?? "");
    // CLOSER — Sprint 2
    setEditDor(p.dor_identificada ?? "");
    setEditTentativas(p.tentativas_anteriores ?? "");
    setEditDecisorConfirmado(p.decisor_confirmado ?? false);
    setEditValorEmocional(p.valor_emocional_articulado ?? "");
    setEditObjecoes(p.objecoes_principais ?? []);
    setEditCargoCat(p.cargo_categoria ?? "");
    setEditEhDecisor(p.eh_decisor ?? false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEditResponsavelId(((p as any).responsavel_id ?? "") as string);
    setEditOpen(true);
  };

  const openContatos = (p: Prospeccao) => {
    const emp = getEmpresa(p);
    const acao = getAcao(p);
    setContatosProspId(p.id);
    setContatosLabel(`${emp?.nome ?? "—"} — ${acao?.nome ?? "—"}`);
    setContatosOpen(true);
  };

  const openProposta = (prosp: Prospeccao) => {
    setPropostaProsp(prosp);
    setPropostaOpen(true);
  };

  const handleSave = async () => {
    if (!editProsp) return;

    if (!canEdit(editProsp)) {
      toast.info("Você não pode editar uma prospecção de outro responsável.");
      return;
    }

    // QW1: obriga motivo ao salvar como Perdido
    if (editStatus === "Perdido" && !editMotivoPerdido) {
      toast.error(
        "Ao marcar como Perdido, selecione o MOTIVO. Sem isso, o escritório não aprende com o que não fecha."
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      status_prospeccao: editStatus,
      contato_nome: editContatoNome,
      contato_telefone: editContatoTel,
      contato_email: editContatoEmail,
      contato_cargo: editContatoCargo,
      notas_prospeccao: editNotas,
      valor_contrato: parseFloat(editValorContrato) || 0,
      tipo_contrato: editTipoContrato,
      data_contrato: editDataContrato || null,
      data_assinatura: editDataAssinatura || null,
      observacoes_contrato: editObsContrato,
      motivo_perdido: editStatus === "Perdido" ? editMotivoPerdido : null,
      motivo_perdido_detalhes: editStatus === "Perdido" ? editMotivoDetalhes || null : null,
      // CLOSER — Sprint 2
      dor_identificada: editDor.trim() || null,
      tentativas_anteriores: editTentativas.trim() || null,
      decisor_confirmado: editDecisorConfirmado,
      valor_emocional_articulado: editValorEmocional.trim() || null,
      objecoes_principais: editObjecoes,
      cargo_categoria: editCargoCat || null,
      eh_decisor: editEhDecisor,
      responsavel_id: editResponsavelId || null,
    };
    const { error } = await supabase.from("prospeccoes").update(payload).eq("id", editProsp.id);
    if (error) {
      toast.error("Erro ao atualizar: " + error.message);
      return;
    }
    toast.success("Prospecção atualizada!");
    logAudit({
      tabela: "prospeccoes",
      acao: "Editou prospecção",
      registro_id: editProsp.id,
      detalhes: { status: editStatus, motivo: editMotivoPerdido },
    });

    // QW5: avisa sobre trigger de upsell se fechou contrato
    if (editStatus === "Contrato assinado" && editProsp.status_prospeccao !== "Contrato assinado") {
      toast.success(
        "🎯 Upsell: tarefa automática criada para avaliar outras teses desta empresa!",
        { duration: 5000 }
      );
    }

    // Gatilho da proposta: ao mudar para "Proposta enviada" vindo de outro status,
    // abre o dialog de proposta automaticamente pra preencher.
    const triggerProposta =
      editStatus === "Proposta enviada" && editProsp.status_prospeccao !== "Proposta enviada";

    setEditOpen(false);
    fetchAll();

    if (triggerProposta) {
      // Pequeno timeout pra fechamento do dialog de edição não conflitar
      setTimeout(() => openProposta({ ...editProsp, status_prospeccao: editStatus }), 300);
    }
  };

  // Exclui a prospecção direto (sem passar por "Perdido") — uso típico:
  // card duplicado criado por engano. RLS exige dono/responsável/gestor/admin.
  const handleDeleteConfirm = async () => {
    if (!deleteProsp) return;
    if (!canEdit(deleteProsp)) {
      toast.info("Você só pode excluir prospecções sob sua responsabilidade.");
      return;
    }
    const { error } = await supabase.from("prospeccoes").delete().eq("id", deleteProsp.id);
    if (error) {
      toast.error("Erro ao excluir prospecção: " + error.message);
      return;
    }
    toast.success("Prospecção excluída");
    logAudit({
      tabela: "prospeccoes",
      acao: "Excluiu prospecção",
      registro_id: deleteProsp.id,
      detalhes: { empresa_id: deleteProsp.empresa_id, acao_id: deleteProsp.acao_id },
    });
    // Se a prospecção excluída estava aberta no dialog de edição, fecha também.
    if (editProsp?.id === deleteProsp.id) setEditOpen(false);
    setDeleteProsp(null);
    fetchAll();
  };

  // QW1: bloqueia quick-move para Perdido (obriga passar pelo dialog)
  const handleQuickStatusChange = async (prosp: Prospeccao, newStatus: string) => {
    if (!canEdit(prosp)) {
      toast.info("Você só pode mover prospecções sob sua responsabilidade.");
      return;
    }
    if (newStatus === "Perdido") {
      openEdit({ ...prosp, status_prospeccao: "Perdido" });
      toast.info("Para marcar como Perdido, preencha o motivo no formulário.");
      return;
    }
    const { error } = await supabase
      .from("prospeccoes")
      .update({ status_prospeccao: newStatus })
      .eq("id", prosp.id);
    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    toast.success(`Status atualizado para "${newStatus}"`);
    logAudit({
      tabela: "prospeccoes",
      acao: "Alterou status prospecção",
      registro_id: prosp.id,
      detalhes: { de: prosp.status_prospeccao, para: newStatus },
    });

    // QW5: avisa sobre upsell quando fechou contrato
    if (newStatus === "Contrato assinado") {
      toast.success(
        "🎯 Upsell: tarefa automática criada para avaliar outras teses desta empresa!",
        { duration: 5000 }
      );
    }

    // Gatilho da proposta: ao mover para "Proposta enviada" via card-quick-move
    if (newStatus === "Proposta enviada" && prosp.status_prospeccao !== "Proposta enviada") {
      setTimeout(() => openProposta({ ...prosp, status_prospeccao: newStatus }), 300);
    }

    fetchAll();
  };

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;
    const prosp = prospeccoes.find((p) => p.id === draggableId);
    if (!prosp) return;
    await handleQuickStatusChange(prosp, destination.droppableId);
  };

  // Create handlers
  const openCreateDialog = () => {
    setCreateAcaoId("");
    setCreateElegId("");
    setCreateContatoNome("");
    setCreateContatoTel("");
    setCreateContatoEmail("");
    setCreateContatoCargo("");
    setCreateOpen(true);
  };

  const elegiveisForCreate = useMemo(() => {
    if (!createAcaoId) return [];
    // Empresas que já têm prospecção nesta ação (via empresa_id direto)
    const prospEmpIds = new Set(
      prospeccoes.filter((p) => p.acao_id === createAcaoId).map((p) => p.empresa_id)
    );
    return elegibilidades
      .filter(
        (e) =>
          e.acao_id === createAcaoId &&
          e.elegivel &&
          !e.ja_ajuizada &&
          !prospEmpIds.has(e.empresa_id)
      )
      .sort(
        (a, b) => Number(b.valor_potencial_estimado ?? 0) - Number(a.valor_potencial_estimado ?? 0)
      );
  }, [createAcaoId, elegibilidades, prospeccoes]);

  const handleCreate = async () => {
    if (!createElegId) {
      toast.error("Selecione uma empresa elegível");
      return;
    }
    const eleg = elegibilidades.find((e) => e.id === createElegId);
    const payload = {
      empresa_id: eleg?.empresa_id ?? null,
      acao_id: eleg?.acao_id ?? null,
      user_id: user.id,
      // Criador assume a responsabilidade — a nova prospecção já aparece no
      // "Meu trabalho" de quem criou (e satisfaz a RLS de UPDATE).
      responsavel_id: user.id,
      status_prospeccao: "Contato feito",
      contato_nome: createContatoNome,
      contato_telefone: createContatoTel,
      contato_email: createContatoEmail,
      contato_cargo: createContatoCargo,
    };
    const { error } = await supabase.from("prospeccoes").insert(payload);
    if (error) {
      if (error.code === "23505") {
        toast.error("Já existe prospecção ativa para esta empresa nesta tese.");
      } else {
        toast.error("Erro ao criar prospecção");
      }
      console.error(error);
      return;
    }
    toast.success("Prospecção criada!");
    logAudit({
      tabela: "prospeccoes",
      acao: "Criou prospecção",
      detalhes: { empresa_id: eleg?.empresa_id, acao_id: eleg?.acao_id },
    });
    setCreateOpen(false);
    fetchAll();
  };

  // KPIs
  const totalValor = filteredProspeccoes.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
  const assinados = filteredProspeccoes.filter((p) => p.status_prospeccao === "Contrato assinado");
  const valorAssinado = assinados.reduce((s, p) => s + (Number(p.valor_contrato) || 0), 0);
  const valorPotencialPipeline = useMemo(
    () => filteredProspeccoes.reduce((s, p) => s + getValorPotencial(p), 0),
    [filteredProspeccoes, elegibilidades]
  );
  const semContato7d = filteredProspeccoes.filter((p) => {
    if (p.status_prospeccao === "Contrato assinado" || p.status_prospeccao === "Perdido")
      return false;
    if (!p.ultimo_contato_em) return p.numero_contatos === 0;
    return differenceInDays(new Date(), parseISO(p.ultimo_contato_em)) >= 7;
  }).length;

  const kanbanColumns = statusColumns.filter((col) => col.key !== "Não iniciado");
  const visibleColumns = hideEmpty
    ? kanbanColumns.filter((col) =>
        filteredProspeccoes.some((p) => p.status_prospeccao === col.key)
      )
    : kanbanColumns;

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingState variant="kpi-grid" count={5} />
        <LoadingState variant="kanban" count={5} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Prospecção"
        description="Pipeline comercial — cadência 7 toques, foco em alto valor"
        icon={<Handshake className="h-7 w-7" />}
        helpTutorialTab="fluxo"
        helpTooltip="Fluxo: Conduzir a prospecção"
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nova Prospecção
          </Button>
        }
      />

      {/* Alternância: Meu trabalho (SDR) x Progresso geral (equipe) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          <Button
            variant={viewMode === "meu" ? "default" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setViewMode("meu")}
            aria-pressed={viewMode === "meu"}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            Meu trabalho
          </Button>
          <Button
            variant={viewMode === "geral" ? "default" : "ghost"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setViewMode("geral")}
            aria-pressed={viewMode === "geral"}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Progresso geral
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {viewMode === "meu"
            ? "Mostrando apenas as prospecções sob sua responsabilidade."
            : "Visão consolidada de toda a equipe de prospecção."}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {filteredProspeccoes.length}
          </p>
        </Card>
        <Card className="p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3 w-3" aria-hidden="true" />
            Valor Potencial
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-primary">
            {formatCompactCurrency(valorPotencialPipeline)}
          </p>
        </Card>
        <Card className="p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Valor Contrato
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {formatCompactCurrency(totalValor)}
          </p>
        </Card>
        <Card className="p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Assinados</p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-success">
            {assinados.length}{" "}
            <span className="text-xs text-muted-foreground">
              · {formatCompactCurrency(valorAssinado)}
            </span>
          </p>
        </Card>
        <Card className="p-4 shadow-card transition-shadow hover:shadow-elevated">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Parados 7+ dias
          </p>
          <p
            className={`mt-1 font-heading text-2xl font-bold tabular-nums ${semContato7d > 0 ? "text-destructive" : "text-success"}`}
          >
            {semContato7d}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa, contato ou ação..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterAcao} onValueChange={setFilterAcao}>
          <SelectTrigger className="w-[220px]">
            <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder="Filtrar por ação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as ações</SelectItem>
            {acoes.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Filtro por responsável só faz sentido na visão geral;
            no "Meu trabalho" o escopo já é o usuário logado. */}
        {viewMode === "geral" && (
          <Select value={filterResponsavel} onValueChange={setFilterResponsavel}>
            <SelectTrigger className="w-[220px]">
              <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Filtrar por responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos responsáveis</SelectItem>
              <SelectItem value="_me">Meus (logado)</SelectItem>
              <SelectItem value="_none">Sem responsável</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={hideEmpty ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setHideEmpty((v) => !v)}
            className="h-9 gap-1.5 text-xs"
            title={hideEmpty ? "Mostrar colunas vazias" : "Ocultar colunas vazias"}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {hideEmpty ? `${visibleColumns.length} colunas` : "Ocultar vazias"}
          </Button>
          <Button
            variant={compact ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCompact((v) => !v)}
            className="h-9 gap-1.5 text-xs"
            title={compact ? "Modo normal" : "Modo compacto"}
          >
            <Columns2 className="h-3.5 w-3.5" />
            {compact ? "Normal" : "Compacto"}
          </Button>
        </div>
      </div>

      {/* Painel de progresso por SDR — só na visão geral */}
      {viewMode === "geral" && <EquipeProgressoPanel rows={equipeRows} />}

      {filteredProspeccoes.length === 0 &&
      !search &&
      filterAcao === "all" &&
      (viewMode === "geral" ? filterResponsavel === "all" : true) ? (
        <EmptyState
          icon={Handshake}
          title={
            viewMode === "meu" ? "Você ainda não tem prospecções" : "Nenhuma prospecção cadastrada"
          }
          description={
            viewMode === "meu"
              ? "Nenhuma prospecção está sob sua responsabilidade ainda. Crie uma nova ou peça ao gestor para atribuir prospecções a você."
              : "Comece criando uma prospecção a partir das empresas elegíveis. As empresas com maior valor potencial aparecem primeiro."
          }
          action={{ label: "Nova Prospecção", onClick: openCreateDialog, icon: Plus }}
          secondaryAction={{ label: "Ver tutorial", to: "/tutorial?tab=fluxo", icon: BookOpen }}
        />
      ) : (
        <KanbanWithNav
          statusColumns={visibleColumns}
          getCount={(key) => filteredProspeccoes.filter((p) => p.status_prospeccao === key).length}
        >
          <DragDropContext
            onDragEnd={(r) => {
              void handleDragEnd(r);
            }}
          >
            <div
              className="snap-kanban scrollbar-thin flex gap-4 overflow-x-auto pb-4"
              role="list"
              aria-label="Pipeline de prospecção por etapa"
              id="prospeccao-kanban-scroll"
            >
              {visibleColumns.map((col) => {
                const items = filteredProspeccoes.filter((p) => p.status_prospeccao === col.key);
                return (
                  <div
                    key={col.key}
                    id={`kanban-col-${col.key.replace(/\s+/g, "-")}`}
                    className={`flex-shrink-0 scroll-mt-4 ${compact ? "w-[220px]" : "w-[300px]"}`}
                    role="listitem"
                    aria-label={`Etapa ${col.label}, ${items.length} ${items.length === 1 ? "prospecção" : "prospecções"}`}
                  >
                    <div className="mb-3 flex items-center gap-2 px-1">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`}
                        aria-hidden="true"
                      />
                      <h3 className="text-sm font-semibold">{col.label}</h3>
                      <Badge variant="outline" className="ml-auto text-[10px] tabular-nums">
                        {items.length}
                      </Badge>
                    </div>

                    <Droppable droppableId={col.key}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`min-h-[120px] space-y-3 rounded-lg transition-colors ${snapshot.isDraggingOver ? "bg-muted/30 ring-1 ring-primary/20" : ""}`}
                        >
                          {items.length === 0 && !snapshot.isDraggingOver && (
                            <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
                              Nenhuma prospecção
                            </div>
                          )}
                          {items.map((p, index) => {
                            const emp = getEmpresa(p);
                            const acao = getAcao(p);
                            const valorPot = getValorPotencial(p);
                            const prescricao = prescricaoInfo(acao?.data_limite_prescricao ?? null);
                            const cadencia = cadenciaStatus(p.numero_contatos);
                            const colIdx = statusColumns.findIndex(
                              (c) => c.key === p.status_prospeccao
                            );
                            const nextCol =
                              colIdx < statusColumns.length - 2 ? statusColumns[colIdx + 1] : null;
                            const diasSemContato = p.ultimo_contato_em
                              ? differenceInDays(new Date(), parseISO(p.ultimo_contato_em))
                              : null;
                            const elegInativa = getElegibilidade(p)?.elegivel === false;
                            // Na visão geral, um SDR vê cards de colegas mas não
                            // pode movê-los/editá-los (a RLS barra). Trava o drag
                            // e as ações de mutação nesses casos.
                            const editable = canEdit(p);

                            return (
                              <Draggable
                                key={p.id}
                                draggableId={p.id}
                                index={index}
                                isDragDisabled={!editable}
                              >
                                {(dragProvided) => (
                                  <Card
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    {...dragProvided.dragHandleProps}
                                    className="group cursor-pointer shadow-card transition-all hover:shadow-elevated"
                                    onClick={() => openEdit(p)}
                                  >
                                    <div className="space-y-2.5 p-3">
                                      {/* QW4: banner de prescrição no topo se urgente */}
                                      {prescricao && (
                                        <div
                                          className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium ${prescricao.cor}`}
                                        >
                                          <AlertTriangle className="h-3 w-3" />
                                          <span>
                                            {prescricao.emoji} {prescricao.texto}
                                          </span>
                                        </div>
                                      )}

                                      {/* Empresa desqualificada com prospecção ainda ativa */}
                                      {elegInativa && p.status_prospeccao !== "Perdido" && (
                                        <div className="flex items-center gap-1 rounded bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive">
                                          <AlertTriangle className="h-3 w-3" />
                                          <span>Empresa inelegível — prospecção ainda aberta</span>
                                        </div>
                                      )}

                                      {/* Company + value */}
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-medium">
                                          <Building2
                                            className="h-4 w-4 shrink-0 text-muted-foreground"
                                            aria-hidden
                                          />
                                          <button
                                            type="button"
                                            className="truncate text-left hover:underline focus-visible:underline"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (emp?.id) setDetailEmpresaId(emp.id);
                                            }}
                                          >
                                            {emp?.nome || "—"}
                                          </button>
                                        </div>
                                        <div
                                          className="flex shrink-0 items-center gap-1"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {valorPot > 0 && (
                                            <Badge
                                              variant="secondary"
                                              className="bg-primary/10 text-[10px] text-primary"
                                              title="Valor potencial estimado"
                                            >
                                              {formatCompactCurrency(valorPot)}
                                            </Badge>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                                            onClick={() => openEdit(p)}
                                            aria-label={`Editar prospecção ${emp?.nome ?? ""}`}
                                            title="Editar"
                                          >
                                            <Pencil className="h-3 w-3" aria-hidden="true" />
                                          </Button>
                                        </div>
                                      </div>

                                      {/* Ação */}
                                      {!compact && acao && (
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                          <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                          <span className="truncate">{acao.nome}</span>
                                        </div>
                                      )}

                                      {/* Contact */}
                                      {p.contato_nome && (
                                        <div className="text-xs">
                                          <span className="font-medium">{p.contato_nome}</span>
                                          {!compact && p.contato_cargo && (
                                            <span className="text-muted-foreground">
                                              {" "}
                                              · {p.contato_cargo}
                                            </span>
                                          )}
                                        </div>
                                      )}

                                      {/* Contact info — oculto no modo compacto */}
                                      {!compact && (
                                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                                          {p.contato_telefone && (
                                            <span className="flex items-center gap-1.5">
                                              <Phone className="h-3 w-3 shrink-0" aria-hidden />
                                              {p.contato_telefone}
                                            </span>
                                          )}
                                          {p.contato_email && (
                                            <span className="flex items-center gap-1.5 truncate">
                                              <Mail className="h-3 w-3 shrink-0" aria-hidden />
                                              {p.contato_email}
                                            </span>
                                          )}
                                        </div>
                                      )}

                                      {/* Responsável (avatar com iniciais) */}
                                      {(() => {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        const respId = (p as any).responsavel_id as
                                          | string
                                          | null
                                          | undefined;
                                        if (!respId) return null;
                                        const resp = profiles.find((x) => x.id === respId);
                                        if (!resp) return null;
                                        const ini =
                                          resp.nome
                                            .split(" ")
                                            .slice(0, 2)
                                            .map((n) => n[0] ?? "")
                                            .join("")
                                            .toUpperCase() || "?";
                                        return (
                                          <div
                                            className="flex items-center gap-1.5 text-[11px]"
                                            title={resp.nome}
                                          >
                                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                                              {ini}
                                            </div>
                                            <span className="truncate text-muted-foreground">
                                              {resp.nome.split(" ")[0]}
                                            </span>
                                          </div>
                                        );
                                      })()}

                                      {/* QW3: badge cadência + último contato */}
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                          variant="secondary"
                                          className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] ${cadencia.color}`}
                                        >
                                          <Zap className="h-3 w-3 shrink-0" aria-hidden />
                                          Toque {cadencia.label}
                                        </Badge>
                                        {diasSemContato !== null &&
                                          diasSemContato >= 7 &&
                                          p.status_prospeccao !== "Contrato assinado" &&
                                          p.status_prospeccao !== "Perdido" && (
                                            <span className="flex items-center gap-1.5 text-[10px] text-destructive">
                                              <Clock className="h-3 w-3 shrink-0" aria-hidden />
                                              parado {diasSemContato}d
                                            </span>
                                          )}
                                      </div>

                                      {/* Motivo perda se Perdido */}
                                      {p.status_prospeccao === "Perdido" && p.motivo_perdido && (
                                        <div className="text-[10px] text-destructive">
                                          Motivo:{" "}
                                          {MOTIVOS_PERDIDO.find((m) => m.value === p.motivo_perdido)
                                            ?.label ?? p.motivo_perdido}
                                        </div>
                                      )}

                                      {/* Valor contrato (só depois de fechar) */}
                                      {Number(p.valor_contrato) > 0 && (
                                        <div className="flex items-center gap-1.5 text-xs">
                                          <DollarSign className="h-3 w-3 text-success" />
                                          <span className="font-medium">
                                            {formatCurrency(Number(p.valor_contrato))}
                                          </span>
                                        </div>
                                      )}

                                      {/* Action row — só pra quem pode editar.
                                          Card de colega fica somente leitura. */}
                                      {editable ? (
                                        <div
                                          className="flex gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 min-w-0 flex-1 gap-1 px-2 text-[11px]"
                                            onClick={() => openContatos(p)}
                                            title="Registrar toque de contato"
                                          >
                                            <MessageSquare
                                              className="h-3.5 w-3.5 shrink-0"
                                              aria-hidden
                                            />
                                            <span className="truncate">Contato</span>
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 min-w-0 flex-1 gap-1 px-2 text-[11px]"
                                            onClick={() => openProposta(p)}
                                            title="Criar / editar proposta comercial"
                                          >
                                            <FileText
                                              className="h-3.5 w-3.5 shrink-0"
                                              aria-hidden
                                            />
                                            <span className="truncate">Proposta</span>
                                          </Button>
                                          {nextCol && (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-7 min-w-0 flex-1 gap-1 px-2 text-[11px]"
                                              onClick={() => {
                                                void handleQuickStatusChange(p, nextCol.key);
                                              }}
                                              title={`Avançar pra: ${nextCol.label}`}
                                            >
                                              <ArrowRight
                                                className="h-3.5 w-3.5 shrink-0"
                                                aria-hidden
                                              />
                                              <span className="truncate">Avançar</span>
                                            </Button>
                                          )}
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            onClick={() => setDeleteProsp(p)}
                                            title="Excluir prospecção (ex: duplicada) — não precisa marcar como Perdido"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                          </Button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
                                          <Lock className="h-3 w-3 shrink-0" aria-hidden />
                                          <span>Somente leitura (outro responsável)</span>
                                        </div>
                                      )}
                                    </div>
                                  </Card>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        </KanbanWithNav>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              <Handshake className="h-5 w-5" />
              Editar Prospecção
            </DialogTitle>
          </DialogHeader>
          {editProsp && (
            <div className="space-y-4">
              {/* Info header */}
              <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">{getEmpresa(editProsp)?.nome}</p>
                <p className="text-xs text-muted-foreground">{getAcao(editProsp)?.nome}</p>
                <div className="flex items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                  <span>
                    Toques:{" "}
                    <strong className="text-foreground">{editProsp.numero_contatos}/7</strong>
                  </span>
                  {getValorPotencial(editProsp) > 0 && (
                    <span>
                      Potencial:{" "}
                      <strong className="text-primary">
                        {formatCompactCurrency(getValorPotencial(editProsp))}
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Botão de cadência */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => openContatos(editProsp)}
              >
                <MessageSquare className="mr-2 h-3.5 w-3.5" />
                Ver histórico de contatos e registrar novo toque
              </Button>

              {/* Botão Templates — Sprint 2 */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setTemplatesOpen(true)}
                type="button"
              >
                📝 Abrir biblioteca de templates (email / WhatsApp / LinkedIn)
              </Button>

              <div>
                <Label>Etapa da Prospecção</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusColumns.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Responsável pela prospecção */}
              <div>
                <Label>Responsável</Label>
                <Select
                  value={editResponsavelId || "_none"}
                  onValueChange={(v) => setEditResponsavelId(v === "_none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— sem responsável —</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Quem está liderando esta prospecção. Aparece como badge no card e pode ser usado
                  pra filtrar.
                </p>
              </div>

              {/* QW1: motivo perdido quando status = Perdido */}
              {editStatus === "Perdido" && (
                <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div>
                    <Label className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Motivo da perda * (obrigatório)
                    </Label>
                    <p className="mb-1.5 text-[10px] text-muted-foreground">
                      Hormozi: sem categorizar por que perdemos, o escritório fica cego e a oferta
                      não evolui.
                    </p>
                    <Select
                      value={editMotivoPerdido}
                      onValueChange={(v) => setEditMotivoPerdido(v as MotivoPerdido)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o motivo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {MOTIVOS_PERDIDO.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Detalhes (opcional mas recomendado)</Label>
                    <Textarea
                      rows={2}
                      value={editMotivoDetalhes}
                      onChange={(e) => setEditMotivoDetalhes(e.target.value)}
                      placeholder="Ex: 'Acha 20% caro, queria 15%' — detalhe específico vira input pra ajustar oferta"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome do Contato</Label>
                  <Input
                    value={editContatoNome}
                    onChange={(e) => setEditContatoNome(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Cargo</Label>
                  <Input
                    value={editContatoCargo}
                    onChange={(e) => setEditContatoCargo(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={editContatoTel}
                    onChange={(e) => setEditContatoTel(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={editContatoEmail}
                    onChange={(e) => setEditContatoEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Notas de Prospecção</Label>
                <Textarea
                  value={editNotas}
                  onChange={(e) => setEditNotas(e.target.value)}
                  rows={2}
                />
              </div>

              {/* ========= CLOSER FRAMEWORK — Sprint 2 ========= */}
              <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1 font-semibold text-primary">
                    🎯 CLOSER Framework
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    Qualificação Hormozi para vender
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Preencha conforme for descobrindo na conversa. Sem estes dados, você está vendendo
                  no escuro.
                </p>

                {/* Decisor */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Categoria do cargo</Label>
                    <Select
                      value={editCargoCat || "none"}
                      onValueChange={(v) =>
                        setEditCargoCat(v === "none" ? "" : (v as CargoCategoria))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— não informado —</SelectItem>
                        {CARGO_CATEGORIAS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-2 text-xs">
                      É decisor / tem poder de compra?
                    </Label>
                    <div className="flex h-10 items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={editEhDecisor}
                          onChange={(e) => setEditEhDecisor(e.target.checked)}
                          className="h-4 w-4"
                        />
                        É decisor
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={editDecisorConfirmado}
                          onChange={(e) => setEditDecisorConfirmado(e.target.checked)}
                          className="h-4 w-4"
                        />
                        Confirmado (perguntou explicitamente)
                      </label>
                    </div>
                  </div>
                </div>

                {/* C — Clarify */}
                <div className="space-y-1">
                  <Label className="text-xs">
                    <span className="font-bold text-primary">C</span>larify — Qual é a DOR concreta
                    do cliente?
                  </Label>
                  <Textarea
                    rows={2}
                    value={editDor}
                    onChange={(e) => setEditDor(e.target.value)}
                    placeholder="Ex: 'Pagamos R$ 80k/mês de PIS/COFINS e acho que boa parte é indevido. CFO ansioso com fiscalização recente.'"
                  />
                </div>

                {/* O — Overview do passado */}
                <div className="space-y-1">
                  <Label className="text-xs">
                    <span className="font-bold text-primary">O</span>verview — Tentaram algo antes?
                    Por que não deu certo?
                  </Label>
                  <Textarea
                    rows={2}
                    value={editTentativas}
                    onChange={(e) => setEditTentativas(e.target.value)}
                    placeholder="Ex: 'Tentaram com outro escritório em 2022, perderam o prazo. Ou: nunca tentaram, nunca conversaram com advogado tributário.'"
                  />
                </div>

                {/* S — Sell the vacation */}
                <div className="space-y-1">
                  <Label className="text-xs">
                    <span className="font-bold text-primary">S</span>ell — Valor emocional
                    articulado (o que MUDA com a recuperação?)
                  </Label>
                  <Textarea
                    rows={2}
                    value={editValorEmocional}
                    onChange={(e) => setEditValorEmocional(e.target.value)}
                    placeholder="Ex: 'Com R$ 500k de volta, consegue investir em nova filial que já está engavetada há 3 anos.'"
                  />
                </div>

                {/* E — Explain away concerns */}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    <span className="font-bold text-primary">E</span>xplain — Objeções levantadas
                    (selecione todas que aplicam)
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {OBJECOES_COMUNS.map((obj) => {
                      const selected = editObjecoes.includes(obj);
                      return (
                        <button
                          key={obj}
                          type="button"
                          onClick={() => {
                            setEditObjecoes((curr) =>
                              selected ? curr.filter((x) => x !== obj) : [...curr, obj]
                            );
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            selected
                              ? "border-primary/30 bg-primary/15 text-primary"
                              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {selected && "✓ "}
                          {obj}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Sem categorizar objeções, a oferta não evolui. Use dados pra ajustar script,
                    garantias e preço.
                  </p>
                </div>

                {/* Indicadores visuais de completude */}
                <div className="flex flex-wrap items-center gap-3 border-t border-primary/20 pt-2 text-[10px]">
                  <span
                    className={editEhDecisor ? "font-medium text-success" : "text-muted-foreground"}
                  >
                    {editEhDecisor ? "✓" : "○"} Decisor
                  </span>
                  <span
                    className={
                      editDor.length > 10 ? "font-medium text-success" : "text-muted-foreground"
                    }
                  >
                    {editDor.length > 10 ? "✓" : "○"} Dor clara
                  </span>
                  <span
                    className={
                      editValorEmocional.length > 10
                        ? "font-medium text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {editValorEmocional.length > 10 ? "✓" : "○"} Valor articulado
                  </span>
                  <span
                    className={
                      editObjecoes.length > 0 ? "font-medium text-success" : "text-muted-foreground"
                    }
                  >
                    {editObjecoes.length > 0 ? "✓" : "○"} Objeções mapeadas
                  </span>
                </div>
              </div>
              {/* ========= FIM CLOSER ========= */}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor do Contrato</Label>
                  <Input
                    type="number"
                    value={editValorContrato}
                    onChange={(e) => setEditValorContrato(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Tipo de Contrato</Label>
                  <Input
                    value={editTipoContrato}
                    onChange={(e) => setEditTipoContrato(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Data do Contrato</Label>
                  <Input
                    type="date"
                    value={editDataContrato}
                    onChange={(e) => setEditDataContrato(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Data de Assinatura</Label>
                  <Input
                    type="date"
                    value={editDataAssinatura}
                    onChange={(e) => setEditDataAssinatura(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Observações do Contrato</Label>
                <Textarea
                  value={editObsContrato}
                  onChange={(e) => setEditObsContrato(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void handleSave();
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              <Plus className="h-5 w-5" />
              Nova Prospecção
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Ação Tributária</Label>
              <Select
                value={createAcaoId}
                onValueChange={(v) => {
                  setCreateAcaoId(v);
                  setCreateElegId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a ação..." />
                </SelectTrigger>
                <SelectContent>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createAcaoId && (
              <div>
                <Label>
                  Empresa Elegível{" "}
                  <span className="text-[10px] text-muted-foreground">
                    (ordenadas por valor potencial)
                  </span>
                </Label>
                {elegiveisForCreate.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nenhuma empresa elegível disponível nesta ação (todas já possuem prospecção).
                  </p>
                ) : (
                  <Select value={createElegId} onValueChange={setCreateElegId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a empresa..." />
                    </SelectTrigger>
                    <SelectContent>
                      {elegiveisForCreate.map((e) => {
                        const emp = empresas.find((emp) => emp.id === e.empresa_id);
                        const v = Number(e.valor_potencial_estimado ?? 0);
                        return (
                          <SelectItem key={e.id} value={e.id}>
                            {emp?.nome || "—"} ({emp?.cnpj})
                            {v > 0 ? ` — ${formatCompactCurrency(v)}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome do Contato</Label>
                <Input
                  value={createContatoNome}
                  onChange={(e) => setCreateContatoNome(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label>Cargo</Label>
                <Input
                  value={createContatoCargo}
                  onChange={(e) => setCreateContatoCargo(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={createContatoTel}
                  onChange={(e) => setCreateContatoTel(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={createContatoEmail}
                  onChange={(e) => setCreateContatoEmail(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void handleCreate();
              }}
              disabled={!createElegId}
            >
              Criar Prospecção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão — atalho pra duplicados, sem passar por "Perdido" */}
      <AlertDialog open={!!deleteProsp} onOpenChange={(v) => !v && setDeleteProsp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir prospecção?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProsp && (
                <>
                  {getEmpresa(deleteProsp)?.nome ?? "Empresa"} —{" "}
                  {getAcao(deleteProsp)?.nome ?? "ação"}. Esta ação não pode ser desfeita: os toques
                  de cadência e a proposta vinculada (se houver) também são removidos. Tarefas e
                  reuniões vinculadas são mantidas, só desvinculadas.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDeleteConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* QW3: Dialog de cadência / contatos */}
      <ProspeccaoContatosDialog
        open={contatosOpen}
        onOpenChange={setContatosOpen}
        prospeccaoId={contatosProspId}
        prospeccaoLabel={contatosLabel}
        onSaved={() => {
          void fetchAll();
        }}
      />

      {/* Sprint 2: Templates de mensagem */}
      {editProsp &&
        (() => {
          const emp = getEmpresa(editProsp);
          const acao = getAcao(editProsp);
          const valorPot = getValorPotencial(editProsp);
          const dias = acao?.data_limite_prescricao
            ? differenceInDays(parseISO(acao.data_limite_prescricao), new Date())
            : null;
          return (
            <TemplateSelectorDialog
              open={templatesOpen}
              onOpenChange={setTemplatesOpen}
              vars={{
                empresa: emp?.nome,
                cnpj: emp?.cnpj,
                contato_nome: editContatoNome || editProsp.contato_nome,
                tese: acao?.nome,
                valor_potencial: valorPot,
                dias_prescricao: dias,
              }}
            />
          );
        })()}

      {/* Dialog de proposta comercial — abre ao mover pra "Proposta enviada"
          ou clicando em "Proposta" no card */}
      {propostaOpen &&
        propostaProsp &&
        (() => {
          const emp = getEmpresa(propostaProsp);
          const acao = getAcao(propostaProsp);
          const valorPot = getValorPotencial(propostaProsp);
          return (
            <PropostaDialog
              open={propostaOpen}
              onClose={() => {
                setPropostaOpen(false);
                setPropostaProsp(null);
              }}
              prospeccaoId={propostaProsp.id}
              context={{
                empresaNome: emp?.nome ?? "",
                empresaCnpj: emp?.cnpj ?? "",
                contatoNome: propostaProsp.contato_nome,
                contatoCargo: propostaProsp.contato_cargo,
                contatoEmail: propostaProsp.contato_email,
                contatoTelefone: propostaProsp.contato_telefone,
                acaoId: acao?.id ?? null,
                acaoNome: acao?.nome ?? null,
                valorPotencial: valorPot,
              }}
              onSaved={(status) => {
                // Se marcou como enviada, garante que status de prospecção também avance
                if (
                  status === "enviada" &&
                  propostaProsp.status_prospeccao !== "Proposta enviada"
                ) {
                  (
                    supabase.from("prospeccoes") as unknown as {
                      update: (p: object) => { eq: (k: string, v: string) => Promise<unknown> };
                    }
                  )
                    .update({ status_prospeccao: "Proposta enviada" })
                    .eq("id", propostaProsp.id)
                    .then(() => fetchAll());
                } else {
                  fetchAll();
                }
              }}
            />
          );
        })()}

      <EmpresaQuickSheet empresaId={detailEmpresaId} onClose={() => setDetailEmpresaId(null)} />
    </div>
  );
}

// Barra de navegação por coluna do Kanban — facilita pular entre etapas
// quando o pipeline tem muitas colunas (scroll horizontal cansativo).
function KanbanWithNav({
  statusColumns,
  getCount,
  children,
}: {
  statusColumns: Array<{ key: string; label: string; color: string; dotColor: string }>;
  getCount: (key: string) => number;
  children: React.ReactNode;
}) {
  const scrollTo = (key: string) => {
    const id = `kanban-col-${key.replace(/\s+/g, "-")}`;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  return (
    <div className="space-y-3">
      <div
        className="scrollbar-thin sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-background/95 pb-1.5 backdrop-blur-sm"
        role="tablist"
        aria-label="Navegar entre etapas do pipeline"
      >
        {statusColumns.map((col) => {
          const n = getCount(col.key);
          return (
            <Button
              key={col.key}
              type="button"
              role="tab"
              variant="ghost"
              size="sm"
              onClick={() => scrollTo(col.key)}
              className="h-8 shrink-0 gap-1.5 text-xs"
              aria-label={`Ir para etapa ${col.label}, ${n} ${n === 1 ? "prospecção" : "prospecções"}`}
            >
              <span className={`h-2 w-2 rounded-full ${col.dotColor}`} aria-hidden="true" />
              <span>{col.label}</span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">
                {n}
              </Badge>
            </Button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

// Painel "Progresso geral": uma linha por SDR/responsável com a contagem por
// etapa do funil, valor em pipeline (potencial), fechado e taxa de conversão.
function EquipeProgressoPanel({ rows }: { rows: EquipeRow[] }) {
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      contato: acc.contato + r.contato,
      proposta: acc.proposta + r.proposta,
      negociacao: acc.negociacao + r.negociacao,
      assinados: acc.assinados + r.assinados,
      iniciados: acc.iniciados + r.iniciados,
      perdidos: acc.perdidos + r.perdidos,
      valorAssinado: acc.valorAssinado + r.valorAssinado,
      pipeline: acc.pipeline + r.pipeline,
    }),
    {
      total: 0,
      contato: 0,
      proposta: 0,
      negociacao: 0,
      assinados: 0,
      iniciados: 0,
      perdidos: 0,
      valorAssinado: 0,
      pipeline: 0,
    }
  );
  const ganhosTot = totals.assinados + totals.iniciados;
  const conversaoTot =
    ganhosTot + totals.perdidos > 0 ? ganhosTot / (ganhosTot + totals.perdidos) : 0;

  const numCol = "px-3 py-2 text-right tabular-nums";
  const headCol = "px-3 py-2 text-right font-medium";

  return (
    <Card className="shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Progresso da equipe</h3>
        <Badge variant="outline" className="ml-auto text-[10px]">
          {rows.length} {rows.length === 1 ? "responsável" : "responsáveis"}
        </Badge>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">SDR</th>
              <th className={headCol}>Contato</th>
              <th className={headCol}>Proposta</th>
              <th className={headCol}>Negoc.</th>
              <th className={headCol}>Fechado</th>
              <th className={headCol}>Perdido</th>
              <th className={headCol}>Pipeline</th>
              <th className={headCol}>Fechado R$</th>
              <th className={headCol}>Conv.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ini =
                r.nome
                  .split(" ")
                  .slice(0, 2)
                  .map((n) => n[0] ?? "")
                  .join("")
                  .toUpperCase() || "?";
              return (
                <tr
                  key={r.id}
                  className={`border-b border-border/50 last:border-0 ${r.isMe ? "bg-primary/5" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                        {r.id === "__sem__" ? "—" : ini}
                      </div>
                      <span className="truncate font-medium">{r.nome}</span>
                      {r.isMe && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                          você
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className={numCol}>{r.contato}</td>
                  <td className={numCol}>{r.proposta}</td>
                  <td className={numCol}>{r.negociacao}</td>
                  <td className={`${numCol} text-success`}>{r.assinados + r.iniciados}</td>
                  <td className={`${numCol} ${r.perdidos > 0 ? "text-destructive" : ""}`}>
                    {r.perdidos}
                  </td>
                  <td className={`${numCol} text-primary`}>{formatCompactCurrency(r.pipeline)}</td>
                  <td className={numCol}>{formatCompactCurrency(r.valorAssinado)}</td>
                  <td className={numCol}>{Math.round(r.conversao * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className={numCol}>{totals.contato}</td>
              <td className={numCol}>{totals.proposta}</td>
              <td className={numCol}>{totals.negociacao}</td>
              <td className={`${numCol} text-success`}>{ganhosTot}</td>
              <td className={`${numCol} ${totals.perdidos > 0 ? "text-destructive" : ""}`}>
                {totals.perdidos}
              </td>
              <td className={`${numCol} text-primary`}>{formatCompactCurrency(totals.pipeline)}</td>
              <td className={numCol}>{formatCompactCurrency(totals.valorAssinado)}</td>
              <td className={numCol}>{Math.round(conversaoTot * 100)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
