import { useState, useRef, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Plus,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { extractErrorMessage } from "@/lib/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

type ImportMode = "nova" | "atualizar" | "invalido";

type SituacaoCadastral = Database["public"]["Enums"]["situacao_cadastral_rfb"];
type PorteRfb = Database["public"]["Enums"]["porte_rfb"];

/** Dados RFB extraídos da planilha — todos opcionais; só sobrescreve o DB se houver valor. */
interface RfbFields {
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao_cadastral: SituacaoCadastral | null;
  porte: PorteRfb | null;
  opcao_simples: boolean | null;
  opcao_mei: boolean | null;
  uf: string | null;
  municipio: string | null;
  cnae_principal: string | null;
  cnae_principal_desc: string | null;
  natureza_juridica: string | null;
  capital_social: number | null;
  data_abertura: string | null; // ISO yyyy-mm-dd
  email_receita: string | null;
  telefone_receita: string | null;
  endereco_texto: string | null; // composto, vai pra metadados (endereco_* tem ~7 colunas separadas)
  receita_atualizada_em: string | null; // ISO timestamp
}

/** Dados por-ação (elegibilidade) — só aplicados quando há acao_id selecionado. */
interface ElegFields {
  status_na_acao_texto: string | null; // "Não elegível" / "Aguardando" / status de prospecção
  elegivel: boolean | null;
  justificativa: string | null;
  valor_potencial_estimado: number | null;
}

interface ImportRow {
  nome: string;
  cnpj: string;
  status: string;
  quantidade_funcionarios: number | null;
  faturamento_anual: number | null;
  /** Texto original quando a célula é um range tipo "100 A 999" — guardado em metadados */
  faixa_funcionarios_texto: string | null;
  faixa_faturamento_texto: string | null;
  regime_tributario: string | null;
  /** Contatos da planilha — quando preenchidos, marcam email_manual/telefone_manual=true
   *  pra proteger da sobrescrita pelo enrichment RFB. */
  email: string | null;
  telefone: string | null;
  /** Campos RFB extras (planilha de export "Empresas por Ação") */
  rfb: RfbFields;
  /** Campos por-ação (elegibilidade) — só aplicados se acao_id selecionado */
  eleg: ElegFields;
  /** ID da empresa existente (quando o CNPJ já existe na base) */
  existing_id: string | null;
  mode: ImportMode;
  errors: string[];
}

/** Normaliza valor de regime da planilha → enum aceito pelo DB. */
function parseRegime(raw: unknown): string | null {
  if (raw == null) return null;
  const s = cellStr(raw)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!s) return null;
  if (s.includes("mei")) return "mei";
  if (s.includes("simples")) return "simples";
  if (s.includes("real")) return "lucro_real";
  if (s.includes("presum")) return "lucro_presumido";
  if (s.includes("imune") || s.includes("isent")) return "imune_isento";
  return null;
}

function formatCNPJ(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function validateCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  return digits.length === 14;
}

function normalizeHeader(header: string): string {
  return String(header || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => normalizeHeader(h).includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Versão estrita: o header normalizado deve ser EXATAMENTE igual a um candidato.
 * Evita falsos positivos como "Situação" (cadastral RFB) ser detectado como "Status" CRM.
 */
function findColumnExact(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => normalizeHeader(h) === candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

const STATUS_VALIDOS = new Set(["prospect", "cliente", "inativo"]);

// extractErrorMessage movido pra src/lib/errors.ts (compartilhado com hooks/páginas).

/** Coerce célula XLSX (string | number | boolean | null | Date | object) em string segura. */
function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Converte string de planilha (R$ 1.500,00 / 1500.5 / 1500,5 / vazio) em número ou null. */
function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = cellStr(raw).trim();
  if (!s) return null;
  // Remove "R$", espaços, e formatação BR
  s = s.replace(/[R$\s]/g, "");
  // Se tem vírgula E ponto, ponto é separador de milhar e vírgula é decimal
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Converte "Sim"/"Não"/true/false/1/0 → boolean | null. Vazio = null. */
function parseBool(raw: unknown): boolean | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  const s = cellStr(raw).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (["sim", "s", "yes", "y", "true", "1"].includes(s)) return true;
  if (["nao", "n", "no", "false", "0"].includes(s)) return false;
  return null;
}

/** Aceita date serial Excel, ISO, ou "dd/mm/yyyy". Retorna ISO yyyy-mm-dd ou null. */
function parseDateBR(raw: unknown): string | null {
  if (raw == null) return null;
  // Date serial Excel (número de dias desde 1900-01-01)
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // 25569 = dias entre 1900-01-01 e 1970-01-01 (epoch unix), ajuste do bug 1900
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  const s = cellStr(raw).trim();
  if (!s) return null;
  // dd/mm/yyyy
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // ISO já válido
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Aceita timestamp completo (dd/mm/yyyy ou ISO). Retorna ISO timestamptz ou null. */
function parseTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }
  const s = cellStr(raw).trim();
  if (!s) return null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const SITUACOES_VALIDAS = new Set<SituacaoCadastral>([
  "NULA",
  "ATIVA",
  "SUSPENSA",
  "INAPTA",
  "BAIXADA",
]);
function parseSituacao(raw: unknown): SituacaoCadastral | null {
  if (raw == null) return null;
  const s = cellStr(raw).trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (SITUACOES_VALIDAS.has(s as SituacaoCadastral)) return s as SituacaoCadastral;
  return null;
}

const PORTES_VALIDOS = new Set<PorteRfb>(["MEI", "ME", "EPP", "DEMAIS", "NAO_INFORMADO"]);
function parsePorte(raw: unknown): PorteRfb | null {
  if (raw == null) return null;
  const s = cellStr(raw).trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (PORTES_VALIDOS.has(s as PorteRfb)) return s as PorteRfb;
  return null;
}

/** Slugify igual ao do export (mantém roundtrip filename → acao). */
function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Extrai slug da ação do nome do arquivo "acao-<slug>-yyyy-MM-dd.xlsx". */
function extractAcaoSlugFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const m = base.match(/^acao-(.+)-\d{4}-\d{2}-\d{2}$/);
  return m ? m[1] : null;
}

interface AcaoOption {
  id: string;
  nome: string;
}

export default function Importacao() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [hasFuncionariosCol, setHasFuncionariosCol] = useState(false);
  const [hasFaturamentoCol, setHasFaturamentoCol] = useState(false);
  /** Quais colunas RFB extras foram detectadas — usado pra avisar o usuário. */
  const [rfbColsDetected, setRfbColsDetected] = useState<string[]>([]);
  /** Colunas por-ação detectadas (Status na ação, Elegível, Justificativa, Valor potencial). */
  const [elegColsDetected, setElegColsDetected] = useState<string[]>([]);
  const [acoes, setAcoes] = useState<AcaoOption[]>([]);
  /** Ação selecionada para aplicar campos de elegibilidade. "" = nenhuma. */
  const [acaoId, setAcaoId] = useState<string>("");
  /** True quando a ação foi auto-detectada via slug do nome de arquivo. */
  const [acaoAutoDetected, setAcaoAutoDetected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Carrega ações ativas pra alimentar o select (e tentar auto-match por filename).
  useEffect(() => {
    let cancel = false;
    void (async () => {
      const { data, error } = await supabase
        .from("acoes_tributarias")
        .select("id, nome")
        .order("nome", { ascending: true });
      if (error) {
        console.warn("[Importacao] falha ao carregar ações:", error.message);
        return;
      }
      if (!cancel) setAcoes((data ?? []) as AcaoOption[]);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const parseFile = useCallback((file: File, currentAcoes: AcaoOption[]) => {
    setFileName(file.name);

    // Auto-detect ação pelo nome do arquivo: "acao-<slug>-<data>.xlsx"
    const slug = extractAcaoSlugFromFilename(file.name);
    if (slug && currentAcoes.length > 0) {
      const match = currentAcoes.find(
        (a) => slugify(a.nome).startsWith(slug) || slug.startsWith(slugify(a.nome))
      );
      if (match) {
        setAcaoId(match.id);
        setAcaoAutoDetected(true);
      }
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

        if (jsonData.length < 2) {
          toast.error("Planilha vazia ou sem dados além do cabeçalho");
          return;
        }

        const headers = (jsonData[0] as string[]).map(String);
        const cnpjCol = findColumn(headers, ["cnpj", "cpf_cnpj"]);
        // "Nome" é o nome curto editorial; "Razão social" é o oficial RFB.
        // Match estrito pra "nome" evita pegar "Razão social" como nome editorial.
        const nomeCol = findColumnExact(headers, ["nome"]);
        const nomeColFallback =
          nomeCol === -1 ? findColumn(headers, ["nome", "empresa", "name"]) : nomeCol;
        // ATENÇÃO: status do CRM (prospect/cliente/inativo) é DIFERENTE da
        // situação cadastral RFB (ATIVA/SUSPENSA/...). Match estrito pra evitar confusão.
        const statusCol = findColumnExact(headers, ["status"]);
        const funcCol = findColumn(headers, [
          "funcionario",
          "funcionarios",
          "colaborador",
          "employee",
        ]);
        const fatCol = findColumn(headers, ["faturamento", "receita", "revenue", "billing"]);
        const regCol = findColumn(headers, ["regime", "tributa", "forma de tribut"]);
        // E-mail e telefone "manuais" (não-RFB): match exato pra evitar conflito com "E-mail (RFB)".
        const emailCol = findColumnExact(headers, ["e-mail", "email"]);
        const telCol = findColumnExact(headers, ["telefone", "fone", "celular", "contato"]);

        // === Novas colunas (formato export "Empresas por Ação") ===
        const razaoCol = findColumn(headers, ["razao social", "razao_social"]);
        const fantasiaCol = findColumn(headers, ["nome fantasia", "fantasia"]);
        const situacaoCol = findColumn(headers, ["situacao cadastral", "situacao"]);
        const porteCol = findColumnExact(headers, ["porte"]);
        const simplesCol = findColumn(headers, ["optante simples", "simples"]);
        const meiCol = findColumnExact(headers, ["mei"]);
        const ufCol = findColumnExact(headers, ["uf"]);
        const municipioCol = findColumn(headers, ["municipio", "cidade"]);
        const cnaeCol = findColumn(headers, ["cnae principal", "cnae_principal"]);
        const cnaeDescCol = findColumn(headers, ["cnae descricao", "cnae_desc"]);
        const naturezaCol = findColumn(headers, ["natureza juridica", "natureza_juridica"]);
        const capitalCol = findColumn(headers, ["capital social", "capital_social"]);
        const aberturaCol = findColumn(headers, ["data de abertura", "data_abertura", "abertura"]);
        const emailRfbCol = findColumn(headers, [
          "e-mail (rfb)",
          "email (rfb)",
          "email_rfb",
          "e-mail rfb",
        ]);
        const telRfbCol = findColumn(headers, ["telefone (rfb)", "telefone_rfb", "telefone rfb"]);
        const enderecoCol = findColumnExact(headers, ["endereco"]);
        const receitaAtCol = findColumn(headers, ["receita atualizada", "receita_atualizada"]);

        // Per-ação
        const statusAcaoCol = findColumn(headers, ["status na acao", "status_na_acao"]);
        const elegivelCol = findColumn(headers, ["elegivel", "elegível"]);
        const justifCol = findColumn(headers, ["justificativa"]);
        const valorPotCol = findColumn(headers, ["valor potencial", "valor_potencial"]);

        if (cnpjCol === -1) {
          toast.error("Não foi possível identificar a coluna 'CNPJ' na planilha");
          return;
        }

        setHasFuncionariosCol(funcCol !== -1);
        setHasFaturamentoCol(fatCol !== -1);

        const rfbDetected: string[] = [];
        if (razaoCol !== -1) rfbDetected.push("Razão social");
        if (fantasiaCol !== -1) rfbDetected.push("Nome fantasia");
        if (situacaoCol !== -1) rfbDetected.push("Situação");
        if (porteCol !== -1) rfbDetected.push("Porte");
        if (simplesCol !== -1) rfbDetected.push("Simples");
        if (meiCol !== -1) rfbDetected.push("MEI");
        if (ufCol !== -1) rfbDetected.push("UF");
        if (municipioCol !== -1) rfbDetected.push("Município");
        if (cnaeCol !== -1) rfbDetected.push("CNAE");
        if (capitalCol !== -1) rfbDetected.push("Capital");
        if (aberturaCol !== -1) rfbDetected.push("Abertura");
        if (naturezaCol !== -1) rfbDetected.push("Natureza");
        if (emailRfbCol !== -1) rfbDetected.push("Email RFB");
        if (telRfbCol !== -1) rfbDetected.push("Tel RFB");
        if (enderecoCol !== -1) rfbDetected.push("Endereço");
        if (receitaAtCol !== -1) rfbDetected.push("Receita em");
        setRfbColsDetected(rfbDetected);

        const elegDetected: string[] = [];
        if (statusAcaoCol !== -1) elegDetected.push("Status na ação");
        if (elegivelCol !== -1) elegDetected.push("Elegível");
        if (justifCol !== -1) elegDetected.push("Justificativa");
        if (valorPotCol !== -1) elegDetected.push("Valor potencial");
        setElegColsDetected(elegDetected);

        const parsedDraft: Omit<ImportRow, "existing_id" | "mode">[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;

          // Nome editorial: prioriza coluna "Nome"; se vazia, cai pra "Razão social"
          const nomeRaw = nomeColFallback !== -1 ? cellStr(row[nomeColFallback]).trim() : "";
          const razaoRaw = razaoCol !== -1 ? cellStr(row[razaoCol]).trim() : "";
          const nome = nomeRaw || razaoRaw;
          const rawCnpj = cellStr(row[cnpjCol]).trim();
          // Só aceita status válido — qualquer outra coisa vira "prospect"
          const rawStatus =
            statusCol !== -1 ? cellStr(row[statusCol]).trim().toLowerCase() : "prospect";
          const status = STATUS_VALIDOS.has(rawStatus) ? rawStatus : "prospect";
          const cnpj = formatCNPJ(rawCnpj);

          // Funcionários/Faturamento: tenta como número; se não, captura texto pra metadados
          const rawFunc = funcCol !== -1 ? cellStr(row[funcCol]).trim() : "";
          const rawFat = fatCol !== -1 ? cellStr(row[fatCol]).trim() : "";
          const quantidade_funcionarios = funcCol !== -1 ? parseNumber(row[funcCol]) : null;
          const faturamento_anual = fatCol !== -1 ? parseNumber(row[fatCol]) : null;
          // Se a coluna existe, valor é não-vazio E não virou número → é uma faixa/texto
          const faixa_funcionarios_texto =
            funcCol !== -1 && rawFunc && quantidade_funcionarios == null ? rawFunc : null;
          const faixa_faturamento_texto =
            fatCol !== -1 && rawFat && faturamento_anual == null ? rawFat : null;
          const regime_tributario = regCol !== -1 ? parseRegime(row[regCol]) : null;
          const email = emailCol !== -1 ? cellStr(row[emailCol]).trim() || null : null;
          const telefone = telCol !== -1 ? cellStr(row[telCol]).trim() || null : null;

          const rfb: RfbFields = {
            razao_social: razaoCol !== -1 ? cellStr(row[razaoCol]).trim() || null : null,
            nome_fantasia: fantasiaCol !== -1 ? cellStr(row[fantasiaCol]).trim() || null : null,
            situacao_cadastral: situacaoCol !== -1 ? parseSituacao(row[situacaoCol]) : null,
            porte: porteCol !== -1 ? parsePorte(row[porteCol]) : null,
            opcao_simples: simplesCol !== -1 ? parseBool(row[simplesCol]) : null,
            opcao_mei: meiCol !== -1 ? parseBool(row[meiCol]) : null,
            uf: ufCol !== -1 ? cellStr(row[ufCol]).trim().toUpperCase() || null : null,
            municipio: municipioCol !== -1 ? cellStr(row[municipioCol]).trim() || null : null,
            cnae_principal: cnaeCol !== -1 ? cellStr(row[cnaeCol]).trim() || null : null,
            cnae_principal_desc:
              cnaeDescCol !== -1 ? cellStr(row[cnaeDescCol]).trim() || null : null,
            natureza_juridica: naturezaCol !== -1 ? cellStr(row[naturezaCol]).trim() || null : null,
            capital_social: capitalCol !== -1 ? parseNumber(row[capitalCol]) : null,
            data_abertura: aberturaCol !== -1 ? parseDateBR(row[aberturaCol]) : null,
            email_receita: emailRfbCol !== -1 ? cellStr(row[emailRfbCol]).trim() || null : null,
            telefone_receita: telRfbCol !== -1 ? cellStr(row[telRfbCol]).trim() || null : null,
            endereco_texto: enderecoCol !== -1 ? cellStr(row[enderecoCol]).trim() || null : null,
            receita_atualizada_em: receitaAtCol !== -1 ? parseTimestamp(row[receitaAtCol]) : null,
          };

          const statusAcaoTxt =
            statusAcaoCol !== -1 ? cellStr(row[statusAcaoCol]).trim() || null : null;
          const eleg: ElegFields = {
            status_na_acao_texto: statusAcaoTxt,
            elegivel: elegivelCol !== -1 ? parseBool(row[elegivelCol]) : null,
            justificativa: justifCol !== -1 ? cellStr(row[justifCol]).trim() || null : null,
            valor_potencial_estimado: valorPotCol !== -1 ? parseNumber(row[valorPotCol]) : null,
          };
          // "Não elegível" em "Status na ação" implica elegivel=false (override)
          if (eleg.elegivel == null && statusAcaoTxt) {
            const norm = statusAcaoTxt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
            if (norm.includes("nao elegivel")) eleg.elegivel = false;
            else if (norm.includes("aguardando")) eleg.elegivel = true;
          }

          const errors: string[] = [];

          if (!validateCNPJ(rawCnpj)) errors.push("CNPJ inválido");

          parsedDraft.push({
            nome,
            cnpj,
            status,
            quantidade_funcionarios,
            faturamento_anual,
            faixa_funcionarios_texto,
            faixa_faturamento_texto,
            regime_tributario,
            email,
            telefone,
            rfb,
            eleg,
            errors,
          });
        }

        // Detecta duplicados dentro do próprio arquivo
        const cnpjCount = new Map<string, number>();
        for (const r of parsedDraft) {
          const k = r.cnpj.replace(/\D/g, "");
          if (k) cnpjCount.set(k, (cnpjCount.get(k) || 0) + 1);
        }

        // Busca empresas existentes na base por CNPJ pra decidir update vs insert
        const cnpjsValidos = parsedDraft.filter((r) => r.errors.length === 0).map((r) => r.cnpj);
        const existingByCnpj = new Map<string, string>();
        if (cnpjsValidos.length > 0) {
          // Supabase suporta filtro IN com até alguns milhares — paginamos por segurança
          const CHUNK = 500;
          for (let i = 0; i < cnpjsValidos.length; i += CHUNK) {
            const slice = cnpjsValidos.slice(i, i + CHUNK);
            const { data: existing } = await supabase
              .from("empresas")
              .select("id, cnpj")
              .in("cnpj", slice);
            for (const e of (existing ?? []) as Array<{ id: string; cnpj: string }>) {
              existingByCnpj.set(e.cnpj, e.id);
            }
          }
        }

        // Final: monta com mode + existing_id
        const parsed: ImportRow[] = parsedDraft.map((r) => {
          const k = r.cnpj.replace(/\D/g, "");
          const dupInFile = (cnpjCount.get(k) || 0) > 1;
          const existing_id = existingByCnpj.get(r.cnpj) ?? null;

          let mode: ImportMode;
          const errors = [...r.errors];
          if (errors.length > 0) {
            mode = "invalido";
          } else if (dupInFile && !existing_id) {
            // Duplicado dentro do arquivo, sem registro no DB → erro
            errors.push("CNPJ duplicado no arquivo");
            mode = "invalido";
          } else if (existing_id) {
            mode = "atualizar";
          } else {
            // Novo cadastro precisa de nome
            if (!r.nome) errors.push("Nome obrigatório para empresas novas");
            mode = errors.length > 0 ? "invalido" : "nova";
          }
          return { ...r, errors, mode, existing_id };
        });

        setRows(parsed);
        const novas = parsed.filter((r) => r.mode === "nova").length;
        const upd = parsed.filter((r) => r.mode === "atualizar").length;
        const errs = parsed.filter((r) => r.mode === "invalido").length;
        toast.success(
          `${parsed.length} linhas: ${novas} nova${novas === 1 ? "" : "s"}, ` +
            `${upd} pra atualizar, ${errs} com erro`
        );
      } catch (err) {
        console.error("Erro ao processar planilha:", err);
        toast.error("Erro ao processar o arquivo. Verifique o formato.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file, acoes);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file, acoes);
  };

  /** Monta patch só com campos RFB não-nulos da planilha. */
  const buildRfbPatch = (rfb: RfbFields): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    if (rfb.razao_social) patch.razao_social = rfb.razao_social;
    if (rfb.nome_fantasia) patch.nome_fantasia = rfb.nome_fantasia;
    if (rfb.situacao_cadastral) patch.situacao_cadastral = rfb.situacao_cadastral;
    if (rfb.porte) patch.porte = rfb.porte;
    if (rfb.opcao_simples != null) patch.opcao_simples = rfb.opcao_simples;
    if (rfb.opcao_mei != null) patch.opcao_mei = rfb.opcao_mei;
    if (rfb.uf) patch.uf = rfb.uf;
    if (rfb.municipio) patch.municipio = rfb.municipio;
    if (rfb.cnae_principal) patch.cnae_principal = rfb.cnae_principal;
    if (rfb.cnae_principal_desc) patch.cnae_principal_desc = rfb.cnae_principal_desc;
    if (rfb.natureza_juridica) patch.natureza_juridica = rfb.natureza_juridica;
    if (rfb.capital_social != null) patch.capital_social = rfb.capital_social;
    if (rfb.data_abertura) patch.data_abertura = rfb.data_abertura;
    if (rfb.email_receita) patch.email_receita = rfb.email_receita;
    if (rfb.telefone_receita) patch.telefone_receita = rfb.telefone_receita;
    if (rfb.receita_atualizada_em) patch.receita_atualizada_em = rfb.receita_atualizada_em;
    return patch;
  };

  const handleImport = async () => {
    const newRows = rows.filter((r) => r.mode === "nova");
    const updRows = rows.filter((r) => r.mode === "atualizar");
    const total = newRows.length + updRows.length;
    if (total === 0) {
      toast.error("Nenhum registro válido para importar");
      return;
    }
    // Aviso quando há colunas de elegibilidade na planilha mas nenhuma ação foi selecionada
    if (elegColsDetected.length > 0 && !acaoId) {
      const ok = window.confirm(
        `A planilha tem ${elegColsDetected.length} coluna${elegColsDetected.length === 1 ? "" : "s"} por-ação (${elegColsDetected.join(", ")}) ` +
          `mas nenhuma ação foi selecionada. Esses campos serão ignorados. Continuar mesmo assim?`
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      let inserted: Array<{ id: string; cnpj: string }> = [];
      let upsertedCount = 0;

      // 1) INSERT em batch das novas — defensivo: se colunas novas
      //    (quantidade_funcionarios, faturamento_anual, metadados) não
      //    existirem no DB, faz fallback sem elas.
      let usandoNovasColunas = true;
      if (newRows.length > 0) {
        const buildRow = (r: ImportRow, comExtras: boolean) => {
          const base: Record<string, unknown> = {
            nome: r.nome,
            cnpj: r.cnpj,
            status: r.status,
            obs: "",
            user_id: user?.id,
          };
          if (comExtras) {
            if (r.quantidade_funcionarios != null)
              base.quantidade_funcionarios = r.quantidade_funcionarios;
            if (r.faturamento_anual != null) base.faturamento_anual = r.faturamento_anual;
            if (r.regime_tributario) base.regime_tributario = r.regime_tributario;
            // Contatos importados → marca como manual pra que enrichment RFB não sobrescreva.
            // E-mail/telefone "manual" da planilha tem prioridade sobre os _receita da RFB.
            if (r.email) {
              base.email_receita = r.email;
              base.email_manual = true;
            }
            if (r.telefone) {
              base.telefone_receita = r.telefone;
              base.telefone_manual = true;
            }
            // Campos RFB da planilha (formato export "Empresas por Ação")
            Object.assign(base, buildRfbPatch(r.rfb));
            const meta: Record<string, string> = {};
            if (r.faixa_funcionarios_texto)
              meta["Faixa de Funcionários"] = r.faixa_funcionarios_texto;
            if (r.faixa_faturamento_texto) meta["Faixa de Faturamento"] = r.faixa_faturamento_texto;
            // Endereço completo da planilha vai pra metadados (estrutura granular do
            // endereço só vem da BrasilAPI, e re-parsear é frágil)
            if (r.rfb.endereco_texto) meta["Endereço (planilha)"] = r.rfb.endereco_texto;
            if (Object.keys(meta).length > 0) base.metadados = meta;
          }
          return base;
        };

        const tryInsert = async (comExtras: boolean) => {
          const data = newRows.map((r) => buildRow(r, comExtras));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (supabase.from("empresas") as any).insert(data).select("id, cnpj");
        };

        const first = await tryInsert(true);
        let ins = first.data;
        if (first.error) {
          // Provavelmente colunas novas ainda não foram criadas no Supabase.
          // Loga e tenta de novo sem elas.
          console.warn(
            "[Importacao] insert com colunas novas falhou:",
            extractErrorMessage(first.error)
          );
          const retry = await tryInsert(false);
          if (retry.error) throw retry.error;
          ins = retry.data;
          usandoNovasColunas = false;
          toast.warning(
            "Importadas sem funcionários/faturamento/faixas — aplique as migrations 20260424 no Supabase pra usar esses campos.",
            { duration: 8000 }
          );
        }
        inserted = (ins ?? []) as typeof inserted;
      }

      // Busca receita_atualizada_em das existentes pra decidir se planilha sobrescreve RFB.
      // Política: sobrescreve quando DB é null OU planilha é estritamente mais recente.
      const dbRfbStaleness = new Map<string, string | null>(); // id → receita_atualizada_em do DB
      if (updRows.length > 0) {
        const ids = updRows.map((r) => r.existing_id).filter(Boolean);
        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: stale } = await (supabase.from("empresas") as any)
            .select("id, receita_atualizada_em")
            .in("id", slice);
          for (const row of (stale ?? []) as Array<{
            id: string;
            receita_atualizada_em: string | null;
          }>) {
            dbRfbStaleness.set(row.id, row.receita_atualizada_em);
          }
        }
      }

      // 2) UPDATE 1×1 das existentes (Promise.all em chunks pra velocidade).
      //    Se colunas novas não existirem (detectado no insert), pula elas no patch.
      const updateErrors: string[] = [];
      if (updRows.length > 0) {
        const CHUNK = 8;
        for (let i = 0; i < updRows.length; i += CHUNK) {
          const slice = updRows.slice(i, i + CHUNK);
          await Promise.all(
            slice.map(async (r) => {
              const patchFull: Record<string, unknown> = {};
              const patchSafe: Record<string, unknown> = {};
              if (r.nome) {
                patchFull.nome = r.nome;
                patchSafe.nome = r.nome;
              }
              if (usandoNovasColunas) {
                if (hasFuncionariosCol && r.quantidade_funcionarios != null) {
                  patchFull.quantidade_funcionarios = r.quantidade_funcionarios;
                }
                if (hasFaturamentoCol && r.faturamento_anual != null) {
                  patchFull.faturamento_anual = r.faturamento_anual;
                }
                if (r.regime_tributario) {
                  patchFull.regime_tributario = r.regime_tributario;
                }
                // Contatos importados → marca como manual. Só sobrescreve se
                // a planilha trouxe valor (cell vazia preserva o que estiver no DB).
                if (r.email) {
                  patchFull.email_receita = r.email;
                  patchFull.email_manual = true;
                }
                if (r.telefone) {
                  patchFull.telefone_receita = r.telefone;
                  patchFull.telefone_manual = true;
                }
                // RFB fields: sobrescreve quando DB não tem dado ou planilha é mais recente.
                // Evita reverter um enriquecimento BrasilAPI recente por uma planilha antiga.
                const dbReceitaAt = dbRfbStaleness.get(r.existing_id) ?? null;
                const planilhaReceitaAt = r.rfb.receita_atualizada_em;
                const planilhaMaisFresca =
                  !dbReceitaAt ||
                  (planilhaReceitaAt && new Date(planilhaReceitaAt) > new Date(dbReceitaAt));
                if (planilhaMaisFresca) {
                  Object.assign(patchFull, buildRfbPatch(r.rfb));
                }
                // Faixas como metadados (preserva formatação original)
                const meta: Record<string, string> = {};
                if (r.faixa_funcionarios_texto)
                  meta["Faixa de Funcionários"] = r.faixa_funcionarios_texto;
                if (r.faixa_faturamento_texto)
                  meta["Faixa de Faturamento"] = r.faixa_faturamento_texto;
                if (r.rfb.endereco_texto) meta["Endereço (planilha)"] = r.rfb.endereco_texto;
                if (Object.keys(meta).length > 0) patchFull.metadados = meta;
              }
              if (Object.keys(patchFull).length === 0) return;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { error } = await (supabase.from("empresas") as any)
                .update(patchFull)
                .eq("id", r.existing_id);
              if (error) {
                // Se for por causa das colunas novas, tenta o "safe" (só nome ou nada)
                if (Object.keys(patchSafe).length > 0) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const retry = await (supabase.from("empresas") as any)
                    .update(patchSafe)
                    .eq("id", r.existing_id);
                  if (!retry.error) {
                    upsertedCount++;
                    return;
                  }
                  updateErrors.push(`${r.cnpj}: ${extractErrorMessage(retry.error)}`);
                } else {
                  updateErrors.push(`${r.cnpj}: ${extractErrorMessage(error)}`);
                }
              } else {
                upsertedCount++;
              }
            })
          );
        }
      }

      const msgParts: string[] = [];
      if (inserted.length > 0)
        msgParts.push(`${inserted.length} criada${inserted.length === 1 ? "" : "s"}`);
      if (upsertedCount > 0)
        msgParts.push(`${upsertedCount} atualizada${upsertedCount === 1 ? "" : "s"}`);
      if (msgParts.length > 0) {
        toast.success("Importação concluída: " + msgParts.join(", "));
      }
      if (updateErrors.length > 0) {
        console.warn("[Importacao] erros de update:", updateErrors);
        toast.warning(
          `${updateErrors.length} update${updateErrors.length === 1 ? " falhou" : "s falharam"} — veja o console`,
          { duration: 8000 }
        );
      }

      // 3) Enriquecimento RFB só pras novas — pula as que já vieram enriquecidas
      //    pela planilha (razao_social + receita_atualizada_em presentes).
      const insertedByCnpj = new Map(inserted.map((i) => [i.cnpj, i.id]));
      const novasEnriquecidasPorPlanilha = new Set<string>();
      for (const r of newRows) {
        if (r.rfb.razao_social && r.rfb.receita_atualizada_em && insertedByCnpj.has(r.cnpj)) {
          novasEnriquecidasPorPlanilha.add(insertedByCnpj.get(r.cnpj));
        }
      }
      const insertedParaEnriquecer = inserted.filter(
        (i) => !novasEnriquecidasPorPlanilha.has(i.id)
      );
      const insertedPuladoEnrich = inserted.length - insertedParaEnriquecer.length;
      if (insertedPuladoEnrich > 0) {
        toast.info(
          `${insertedPuladoEnrich} empresa${insertedPuladoEnrich === 1 ? "" : "s"} já enriquecida${insertedPuladoEnrich === 1 ? "" : "s"} pela planilha — pulando BrasilAPI.`,
          { duration: 4000 }
        );
      }
      if (insertedParaEnriquecer.length > 0) {
        setImporting(false);
        setEnriching(true);
        setEnrichProgress({ done: 0, total: insertedParaEnriquecer.length, errors: 0 });
        const loadingId = toast.loading(
          `Enriquecendo ${insertedParaEnriquecer.length} novas empresas com dados da Receita...`
        );

        // BrasilAPI: sequencial com delay — paralelo explode o rate limit (~3 req/s)
        // Edge fn retorna 400 para tudo; a mensagem real fica em error.context.body
        async function readEdgeErr(err: unknown): Promise<string> {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ctx = (err as any)?.context;
            if (!ctx?.body) return (err as Error)?.message ?? "";
            const text =
              typeof ctx.body === "string" ? ctx.body : await new Response(ctx.body).text();
            try {
              const parsed = JSON.parse(text);
              return parsed.error || parsed.detail || text;
            } catch {
              return text;
            }
          } catch {
            return "";
          }
        }
        function isTransient(msg: string): boolean {
          const m = msg.toLowerCase();
          // 5xx (504/502/503), rate limit, timeout, fetch failed
          return (
            m.includes("rate limit") ||
            /retornou 5\d\d/.test(m) ||
            m.includes("timeout") ||
            m.includes("failed to fetch") ||
            m.includes("network")
          );
        }

        let done = 0;
        let errors = 0;
        for (let i = 0; i < insertedParaEnriquecer.length; i++) {
          const emp = insertedParaEnriquecer[i];
          let ok = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const { data, error: enErr } = await supabase.functions.invoke("enriquecer-cnpj", {
                body: { cnpj: emp.cnpj, empresa_id: emp.id },
              });
              if (!enErr && !data?.error) {
                ok = true;
                break;
              }
              const errMsg = enErr ? await readEdgeErr(enErr) : (data?.error ?? "");
              if (isTransient(errMsg) && attempt < 3) {
                // backoff: rate limit espera mais; 5xx/timeout 2s/4s/6s
                const isRL = errMsg.toLowerCase().includes("rate limit");
                const wait = isRL ? 8000 * (attempt + 1) : 2000 * (attempt + 1);
                await new Promise((r) => setTimeout(r, wait));
                continue;
              }
              break; // erro permanente (404, CNPJ inválido, etc)
            } catch {
              if (attempt < 3) {
                await new Promise((r) => setTimeout(r, 2000));
                continue;
              }
              break;
            }
          }
          if (!ok) errors += 1;
          done += 1;
          setEnrichProgress({ done, total: insertedParaEnriquecer.length, errors });
          // 450ms entre requisições — abaixo do limite ~3 req/s da BrasilAPI
          if (i < insertedParaEnriquecer.length - 1) await new Promise((r) => setTimeout(r, 450));
        }

        toast.success(
          `Receita aplicada: ${done - errors}/${insertedParaEnriquecer.length} enriquecidas` +
            (errors > 0 ? ` (${errors} falharam — aparecerão marcadas na lista)` : ""),
          { id: loadingId, duration: 6000 }
        );
      }

      // 4) Upsert de elegibilidade (per-ação) — só roda se acao_id selecionado
      //    E a planilha tem alguma coluna por-ação.
      if (acaoId && elegColsDetected.length > 0) {
        // Mapeia CNPJ → empresa_id (junta recém-inseridas + existentes do update)
        const cnpjToEmpresaId = new Map<string, string>(insertedByCnpj);
        for (const r of updRows) {
          if (r.existing_id) cnpjToEmpresaId.set(r.cnpj, r.existing_id);
        }

        // Busca elegibilidades já existentes pra esta ação (evita duplicação)
        const empresaIds = Array.from(cnpjToEmpresaId.values());
        const elegExistente = new Map<string, string>(); // empresa_id → eleg_id
        for (let i = 0; i < empresaIds.length; i += 500) {
          const slice = empresaIds.slice(i, i + 500);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: existing } = await (supabase.from("elegibilidade") as any)
            .select("id, empresa_id")
            .eq("acao_id", acaoId)
            .in("empresa_id", slice);
          for (const e of (existing ?? []) as Array<{ id: string; empresa_id: string }>) {
            elegExistente.set(e.empresa_id, e.id);
          }
        }

        const elegRowsParaProcessar = rows
          .filter((r) => r.mode !== "invalido")
          .map((r) => {
            const empresa_id = cnpjToEmpresaId.get(r.cnpj);
            if (!empresa_id) return null;
            const e = r.eleg;
            const hasAnyEleg =
              e.elegivel != null ||
              e.justificativa != null ||
              e.valor_potencial_estimado != null ||
              e.status_na_acao_texto != null;
            if (!hasAnyEleg) return null;
            return { row: r, empresa_id, elegFields: e };
          })
          .filter(
            (x): x is { row: ImportRow; empresa_id: string; elegFields: ElegFields } => x !== null
          );

        let elegInseridas = 0;
        let elegAtualizadas = 0;
        const elegErrors: string[] = [];

        for (let i = 0; i < elegRowsParaProcessar.length; i += 8) {
          const slice = elegRowsParaProcessar.slice(i, i + 8);
          await Promise.all(
            slice.map(async ({ empresa_id, elegFields }) => {
              const existingId = elegExistente.get(empresa_id);
              const payload: Record<string, unknown> = {};
              if (elegFields.elegivel != null) payload.elegivel = elegFields.elegivel;
              if (elegFields.justificativa != null)
                payload.justificativa = elegFields.justificativa;
              if (elegFields.valor_potencial_estimado != null) {
                payload.valor_potencial_estimado = elegFields.valor_potencial_estimado;
              }
              if (Object.keys(payload).length === 0) return;

              if (existingId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase.from("elegibilidade") as any)
                  .update(payload)
                  .eq("id", existingId);
                if (error) {
                  elegErrors.push(`empresa ${empresa_id}: ${extractErrorMessage(error)}`);
                } else {
                  elegAtualizadas++;
                }
              } else {
                payload.empresa_id = empresa_id;
                payload.acao_id = acaoId;
                payload.user_id = user?.id;
                // Default: se elegivel não veio, assume true (linha foi exportada como pool)
                if (payload.elegivel == null) payload.elegivel = true;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error } = await (supabase.from("elegibilidade") as any).insert(payload);
                if (error) {
                  elegErrors.push(`empresa ${empresa_id}: ${extractErrorMessage(error)}`);
                } else {
                  elegInseridas++;
                }
              }
            })
          );
        }

        if (elegInseridas + elegAtualizadas > 0) {
          toast.success(
            `Elegibilidade aplicada à ação: ${elegInseridas} criada${elegInseridas === 1 ? "" : "s"}, ` +
              `${elegAtualizadas} atualizada${elegAtualizadas === 1 ? "" : "s"}`,
            { duration: 5000 }
          );
        }
        if (elegErrors.length > 0) {
          console.warn("[Importacao] erros de elegibilidade:", elegErrors);
          toast.warning(
            `${elegErrors.length} elegibilidade${elegErrors.length === 1 ? "" : "s"} falharam — veja o console`,
            { duration: 6000 }
          );
        }
      }

      setRows([]);
      setFileName("");
      setAcaoId("");
      setAcaoAutoDetected(false);
      setRfbColsDetected([]);
      setElegColsDetected([]);
    } catch (error) {
      const msg = extractErrorMessage(error);
      toast.error("Erro ao importar: " + msg, { duration: 10000 });
      console.error("[Importacao] erro detalhado:", error);
    } finally {
      setImporting(false);
      setEnriching(false);
      setEnrichProgress({ done: 0, total: 0, errors: 0 });
    }
  };

  const handleClear = () => {
    setRows([]);
    setFileName("");
    setHasFuncionariosCol(false);
    setHasFaturamentoCol(false);
    setRfbColsDetected([]);
    setElegColsDetected([]);
    setAcaoId("");
    setAcaoAutoDetected(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const novaCount = rows.filter((r) => r.mode === "nova").length;
  const updCount = rows.filter((r) => r.mode === "atualizar").length;
  const errorCount = rows.filter((r) => r.mode === "invalido").length;
  const totalImportar = novaCount + updCount;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Importação em Massa"
        description="Importe ou atualize empresas via planilhas CSV ou XLSX"
        icon={<Upload className="h-7 w-7" />}
      />

      <Card className="p-8 shadow-card">
        <div
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-1 font-heading text-lg font-semibold">
            {fileName ? fileName : "Arraste sua planilha aqui"}
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">CSV ou XLSX com dados das empresas</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Selecionar Arquivo
          </Button>
        </div>
      </Card>

      {rows.length > 0 && (
        <>
          {/* Picker de ação — visível só quando há colunas por-ação na planilha */}
          {elegColsDetected.length > 0 && (
            <Card className="border-primary/30 bg-primary/5 p-4 shadow-card">
              <div className="flex items-start gap-3">
                <Target className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 font-heading text-sm font-semibold">
                    Planilha tem dados por-ação ({elegColsDetected.join(", ")})
                  </h3>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Selecione a ação tributária pra aplicar esses campos à elegibilidade.
                    {acaoAutoDetected && " Detectada automaticamente pelo nome do arquivo."}
                  </p>
                  <Select
                    value={acaoId || "__none__"}
                    onValueChange={(v) => {
                      setAcaoId(v === "__none__" ? "" : v);
                      setAcaoAutoDetected(false);
                    }}
                  >
                    <SelectTrigger className="max-w-md">
                      <SelectValue placeholder="Escolha uma ação..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Ignorar campos por-ação —</SelectItem>
                      {acoes.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 border-0 bg-info/10 text-info">
                <Plus className="h-3 w-3" /> {novaCount} nova{novaCount === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="gap-1 border-0 bg-warning/10 text-warning">
                <RefreshCw className="h-3 w-3" /> {updCount} pra atualizar
              </Badge>
              {errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-0 bg-destructive/10 text-destructive"
                >
                  <XCircle className="h-3 w-3" /> {errorCount} com erro{errorCount === 1 ? "" : "s"}
                </Badge>
              )}
              {(hasFuncionariosCol || hasFaturamentoCol) && (
                <Badge variant="secondary" className="text-[10px]">
                  Comercial:{" "}
                  {[hasFuncionariosCol && "funcionários", hasFaturamentoCol && "faturamento"]
                    .filter(Boolean)
                    .join(" + ")}
                </Badge>
              )}
              {rfbColsDetected.length > 0 && (
                <Badge variant="secondary" className="bg-success/10 text-[10px] text-success">
                  RFB ({rfbColsDetected.length}): {rfbColsDetected.slice(0, 5).join(", ")}
                  {rfbColsDetected.length > 5 ? "…" : ""}
                </Badge>
              )}
              {elegColsDetected.length > 0 && acaoId && (
                <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
                  Por-ação ({elegColsDetected.length}) →{" "}
                  {acoes.find((a) => a.id === acaoId)?.nome ?? "?"}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClear}>
                <Trash2 className="mr-2 h-4 w-4" />
                Limpar
              </Button>
              <Button
                onClick={() => {
                  void handleImport();
                }}
                disabled={importing || enriching || totalImportar === 0}
              >
                {importing
                  ? "Importando..."
                  : enriching
                    ? `Enriquecendo ${enrichProgress.done}/${enrichProgress.total}...`
                    : `Importar (${totalImportar})`}
              </Button>
            </div>
          </div>

          {enriching && enrichProgress.total > 0 && (
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 font-medium">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Consultando Receita Federal (BrasilAPI)
                </span>
                <span className="tabular-nums">
                  {enrichProgress.done}/{enrichProgress.total}
                  {enrichProgress.errors > 0 && (
                    <span className="ml-2 text-destructive">
                      · {enrichProgress.errors} falha{enrichProgress.errors > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round(
                      (enrichProgress.done / Math.max(1, enrichProgress.total)) * 100
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Puxando razão social, porte, CNAE, endereço e quadro societário (apenas pras novas).
              </p>
            </div>
          )}

          <Card className="shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-10 px-4 py-3 text-left font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Modo</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">CNPJ</th>
                    {hasFuncionariosCol && (
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Funcionários
                      </th>
                    )}
                    {hasFaturamentoCol && (
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Faturamento
                      </th>
                    )}
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Validação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-b border-border transition-colors last:border-0 ${
                        r.mode === "invalido"
                          ? "bg-destructive/5"
                          : r.mode === "atualizar"
                            ? "bg-warning/5"
                            : "hover:bg-muted/50"
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        {r.mode === "nova" && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-info/30 bg-info/10 text-[10px] text-info"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            Nova
                          </Badge>
                        )}
                        {r.mode === "atualizar" && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
                          >
                            <RefreshCw className="h-2.5 w-2.5" />
                            Atualizar
                          </Badge>
                        )}
                        {r.mode === "invalido" && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Inválido
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{r.nome || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {r.cnpj || "—"}
                      </td>
                      {hasFuncionariosCol && (
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.quantidade_funcionarios != null ? (
                            r.quantidade_funcionarios
                          ) : r.faixa_funcionarios_texto ? (
                            <span className="font-mono text-[11px] italic text-info">
                              {r.faixa_funcionarios_texto}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {hasFaturamentoCol && (
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.faturamento_anual != null ? (
                            new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                              maximumFractionDigits: 0,
                            }).format(r.faturamento_anual)
                          ) : r.faixa_faturamento_texto ? (
                            <span className="font-mono text-[11px] italic text-info">
                              {r.faixa_faturamento_texto}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {r.errors.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CheckCircle2 className="h-3 w-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <AlertTriangle className="h-3 w-3" /> {r.errors.join(", ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {rows.length === 0 && (
        <Card className="p-6 shadow-card">
          <h3 className="mb-3 font-heading font-semibold">Como usar</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • A planilha precisa ter no mínimo a coluna <strong>CNPJ</strong>.
            </li>
            <li>
              • <strong>Formato &ldquo;Empresas por Ação&rdquo; (export do sistema)</strong> é
              reconhecido por completo — as 26 colunas são lidas e aplicadas como enriquecimento.
            </li>
            <li>
              • Colunas comerciais opcionais: <strong>Nome</strong>, <strong>Status</strong> (CRM),{" "}
              <strong>Funcionários</strong>, <strong>Faturamento</strong>, <strong>Regime</strong>,{" "}
              <strong>E-mail</strong>, <strong>Telefone</strong>.
            </li>
            <li>
              • Colunas RFB opcionais: <strong>Razão social</strong>, <strong>Nome fantasia</strong>
              , <strong>Situação cadastral</strong>, <strong>Porte</strong>,{" "}
              <strong>Optante Simples</strong>, <strong>MEI</strong>, <strong>UF</strong>,{" "}
              <strong>Município</strong>, <strong>CNAE principal</strong>,{" "}
              <strong>CNAE descrição</strong>, <strong>Natureza jurídica</strong>,{" "}
              <strong>Capital social</strong>, <strong>Data de abertura</strong>,{" "}
              <strong>E-mail (RFB)</strong>, <strong>Telefone (RFB)</strong>,{" "}
              <strong>Endereço</strong>, <strong>Receita atualizada em</strong>.
            </li>
            <li>
              • Colunas <strong>por-ação</strong>: <strong>Status na ação</strong>,{" "}
              <strong>Elegível</strong>, <strong>Justificativa</strong>,{" "}
              <strong>Valor potencial estimado</strong> — quando detectadas, o sistema pede uma ação
              tributária pra aplicar a elegibilidade. O nome do arquivo no padrão{" "}
              <code>acao-&lt;slug&gt;-yyyy-MM-dd.xlsx</code> auto-detecta a ação.
            </li>
            <li>
              • <strong>Frescor RFB</strong>: campos RFB só sobrescrevem o DB quando o{" "}
              <code>Receita atualizada em</code> da planilha é mais recente que o do banco — protege
              enriquecimentos via BrasilAPI.
            </li>
            <li>
              • <strong>E-mail/Telefone</strong> "comerciais" da planilha são marcados como manuais
              — a sincronização com a Receita Federal não os sobrescreve. As variantes{" "}
              <strong>(RFB)</strong> alimentam os campos institucionais.
            </li>
            <li>
              • Se o CNPJ <strong>já existe</strong>, os campos importados atualizam a empresa
              existente.
            </li>
            <li>
              • Se o CNPJ <strong>não existe</strong>, uma empresa nova é criada. Quando a planilha
              já trouxer <strong>Razão social + Receita atualizada em</strong>, o BrasilAPI
              roundtrip é <strong>pulado</strong> (economiza rate limit).
            </li>
            <li>
              • Valores monetários aceitam formato BR (R$ 1.500,00) ou US (1500.00). Datas aceitam
              dd/mm/yyyy ou ISO.
            </li>
            <li>
              • <strong>Faixas</strong> nas colunas Funcionários/Faturamento (ex: &ldquo;100 A
              999&rdquo;) e o <strong>Endereço completo</strong> são guardados em{" "}
              <strong>campos personalizados</strong> (metadados).
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}
