import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
// import { validateCNPJ } from "@/lib/cnpj"; // mod 11 muito estrito pro import — dados legados frequentemente falham
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  Loader2, ArrowRight, RotateCcw, HelpCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RowStatus = "ok_existente" | "ok_nova" | "sem_cnpj" | "cnpj_invalido" | "ja_importada";

interface ProspRow {
  // raw
  nomeRaw: string;
  cnpjRaw: string;
  processoRaw: string;
  situacaoRaw: string;
  valorCausaRaw: string;
  ufRaw: string;
  obsRaw: string;
  simRaw: string;
  // processed
  cnpj: string | null;
  cnpjErro: string | null;   // motivo se CNPJ inválido
  statusProspeccao: string;
  numeroProcesso: string | null;
  valorCausa: number | null;
  // resolution
  empresaId: string | null;
  empresaNome: string;
  rowStatus: RowStatus;
  // UI
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStr(s: string) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Tenta resolver o CNPJ da célula.
 * - Células numéricas do Excel perdem o zero à esquerda (13 → 14 dígitos com padding)
 * - Retorna { cnpj, erro } onde cnpj é null se inválido
 */
function resolveCNPJ(raw: unknown): { cnpj: string | null; erro: string | null } {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { cnpj: null, erro: null };
  }

  let digits = String(raw).replace(/\D/g, "");

  // Excel armazena CNPJ como número → perde zeros à esquerda
  if (digits.length === 13) digits = "0" + digits;
  if (digits.length === 12) digits = "00" + digits;
  if (digits.length === 11) digits = "000" + digits;

  if (digits.length !== 14) {
    return {
      cnpj: null,
      erro: `${digits.length} dígitos (esperado: 14)`,
    };
  }

  // Não validamos mod 11 aqui — planilhas legadas frequentemente têm CNPJs com
  // dígitos verificadores errados (typos no cadastro original) mas a empresa existe.
  // O enriquecimento RFB rejeitará CNPJs realmente inválidos.

  return { cnpj: digits, erro: null };
}

function formatCNPJ(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function parseValor(raw: unknown): number | null {
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[^\d,.-]/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

function parseProcesso(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s || s === "x" || s === "X" || s === "-") return null;
  return s;
}

// Chaves devem bater exatamente com PROSPECCAO_STATUSES em src/lib/prospeccaoStatus.ts
// "CONTATO RD" / "CONTATO" = só indica facilidade de acesso ao contato, não que houve contato
const SITUACAO_MAP: Record<string, string> = {
  "CONTATO RD":        "Não iniciado",
  "CONTATO":           "Não iniciado",
  "PROTOCOLADO":       "Contato feito",
  "CONTRATO ENVIADO":  "Proposta enviada",
  "PROPOSTA ENVIADA":  "Proposta enviada",
  "NEGOCIACAO":        "Em negociação",
  "NEGOCIAÇÃO":        "Em negociação",
  "CONTRATO ASSINADO": "Contrato assinado",
  "SERVICO INICIADO":  "Serviço iniciado",
  "SERVIÇO INICIADO":  "Serviço iniciado",
  "PERDIDO":           "Perdido",
};

function mapSituacao(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "Não iniciado";
  // exact match first
  if (SITUACAO_MAP[s]) return SITUACAO_MAP[s];
  // partial match
  for (const [key, val] of Object.entries(SITUACAO_MAP)) {
    if (s.includes(key)) return val;
  }
  return "Não iniciado";
}

function findColIdx(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => normalizeStr(h).includes(normalizeStr(cand)));
    if (idx !== -1) return idx;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  acaoId: string;
  acaoNome: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  empresasMap: Map<string, { id: string; nome: string; cnpj?: string | null }>;
  elegibilidades: Array<{ empresa_id: string; acao_id: string }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportacaoProspeccaoDialog({
  acaoId, acaoNome, open, onClose, onImported, empresasMap, elegibilidades,
}: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<ProspRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  // CNPJ → empresa lookup
  const cnpjToId = new Map<string, string>();
  empresasMap.forEach((e) => {
    if (e.cnpj) cnpjToId.set(e.cnpj.replace(/\D/g, ""), e.id);
  });

  // Set of empresa_ids already linked to this ação
  const jaImportadas = new Set(
    elegibilidades.filter((e) => e.acao_id === acaoId).map((e) => e.empresa_id),
  );

  // -------------------------------------------------------------------------
  // Parse xlsx
  // -------------------------------------------------------------------------

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      if (raw.length < 1) { toast.error("Planilha vazia"); return; }

      // Detecta formato:
      // Formato A (com cabeçalho): primeira linha tem labels como "EMPRESA", "CNPJ", "SITUAÇÃO"
      // Formato B (sem cabeçalho): coluna 0 = número processo, col 1 = empresa, col 2 = CNPJ
      const headers = raw[0].map((h) => String(h));
      const iNomeLabel = findColIdx(headers, ["empresas em", "empresa", "nome"]);
      const iCnpjLabel = findColIdx(headers, ["cnpj"]);
      const hasHeaderRow = iNomeLabel !== -1;

      let startRow: number;
      let iSituacao: number, iNome: number, iCnpj: number, iProcesso: number;
      let iValor: number, iUF: number, iObs: number, iSim: number;

      if (hasHeaderRow) {
        // Formato A
        startRow  = 1;
        iSituacao = findColIdx(headers, ["situacao", "situação", "status"]);
        iNome     = iNomeLabel;
        iCnpj     = iCnpjLabel;
        iProcesso = findColIdx(headers, ["numero processo", "número processo", "processo"]);
        iValor    = findColIdx(headers, ["valor causa", "valor"]);
        iUF       = findColIdx(headers, ["estado", "uf"]);
        iObs      = findColIdx(headers, ["observ"]);
        iSim      = findColIdx(headers, ["sim"]);
      } else {
        // Formato B: [processo_originario, empresa, cnpj, obs?] — sem linha de cabeçalho
        startRow  = 0;
        iSituacao = -1;
        iNome     = 1;
        iCnpj     = 2;
        iProcesso = 0;
        iValor    = -1;
        iUF       = -1;
        iObs      = 3;
        iSim      = -1;
      }

      const parsed: ProspRow[] = [];

      for (let i = startRow; i < raw.length; i++) {
        const r = raw[i];
        // Para CNPJ com múltiplos valores separados por quebra de linha, pega o primeiro
        const cnpjCell = iCnpj !== -1 ? String(r[iCnpj] ?? "").split(/[\n\r]/)[0] : "";
        const nomeRaw = String(r[iNome] ?? "").trim();
        if (!nomeRaw) continue; // linha vazia

        const cnpjRaw = cnpjCell;
        const situacaoRaw = String(r[iSituacao] ?? "").trim();
        const processoRaw = String(r[iProcesso] ?? "").trim();
        const valorCausaRaw = String(r[iValor] ?? "").trim();
        const ufRaw = String(r[iUF] ?? "").trim();
        const obsRaw = String(r[iObs] ?? "").trim();
        const simRaw = String(r[iSim] ?? "").trim();

        const { cnpj, erro: cnpjErro } = resolveCNPJ(cnpjRaw);
        const statusProspeccao = mapSituacao(situacaoRaw);
        const numeroProcesso = parseProcesso(processoRaw);
        const valorCausa = parseValor(valorCausaRaw);

        // Resolve empresa
        let empresaId: string | null = null;
        let empresaNome = nomeRaw;

        if (cnpj) {
          const foundId = cnpjToId.get(cnpj);
          if (foundId) {
            empresaId = foundId;
            empresaNome = empresasMap.get(foundId)?.nome ?? nomeRaw;
          }
        }

        const jaImportada = empresaId ? jaImportadas.has(empresaId) : false;

        let rowStatus: RowStatus;
        if (jaImportada) rowStatus = "ja_importada";
        else if (empresaId) rowStatus = "ok_existente";
        else if (cnpj) rowStatus = "ok_nova";
        else if (cnpjErro) rowStatus = "cnpj_invalido";
        else rowStatus = "sem_cnpj";

        parsed.push({
          nomeRaw,
          cnpjRaw: String(cnpjRaw ?? "").trim(),
          processoRaw, situacaoRaw, valorCausaRaw, ufRaw, obsRaw, simRaw,
          cnpj, cnpjErro, statusProspeccao, numeroProcesso, valorCausa,
          empresaId, empresaNome,
          rowStatus,
          // sem_cnpj e cnpj_invalido agora são importáveis (cnpj nullable em empresas);
          // ja_importada continua bloqueada
          selected: rowStatus !== "ja_importada",
        });
      }

      setRows(parsed);
      setStep(2);
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleRow = (i: number) =>
    setRows((prev) => prev.map((r, j) => j === i ? { ...r, selected: !r.selected } : r));

  const toggleAll = (v: boolean) =>
    setRows((prev) => prev.map((r) => r.rowStatus === "ja_importada" ? r : { ...r, selected: v }));

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  const handleImport = async () => {
    const selected = rows.filter((r) => r.selected && r.rowStatus !== "ja_importada");
    if (selected.length === 0) { toast.error("Selecione ao menos uma empresa"); return; }

    setImporting(true);
    let importadas = 0;
    let erros = 0;

    for (const row of selected) {
      try {
        let empresaId: string | null = null;

        // 1) Resolver empresa: lookup fresco no DB por CNPJ (não confia no mapa stale)
        if (row.cnpj) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: existingByC } = await (supabase as any)
            .from("empresas")
            .select("id")
            .eq("cnpj", row.cnpj)
            .maybeSingle();
          empresaId = (existingByC as { id: string } | null)?.id ?? null;
        } else {
          // Sem CNPJ: dedup por nome (case-insensitive) pra evitar criar empresas duplicadas em re-imports
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: byName } = await (supabase as any)
            .from("empresas")
            .select("id")
            .ilike("nome", row.nomeRaw)
            .limit(1);
          empresaId = (byName as Array<{ id: string }> | null)?.[0]?.id ?? null;
        }

        // Criar empresa se não encontrou pelo CNPJ (nova ou sem CNPJ)
        if (!empresaId) {
          const insertEmp: Record<string, unknown> = {
            nome: row.nomeRaw,
            status: "prospect",
            user_id: user!.id,
          };
          if (row.cnpj) insertEmp.cnpj = row.cnpj;
          if (row.ufRaw) insertEmp.uf = row.ufRaw.toUpperCase().slice(0, 2);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: empData, error: empErr } = await (supabase.from("empresas") as any)
            .insert(insertEmp)
            .select("id")
            .single();
          if (empErr) throw empErr;
          empresaId = empData.id;

          // Enriquecimento assíncrono se tiver CNPJ
          if (row.cnpj) {
            supabase.functions.invoke("enriquecer-cnpj", {
              body: { cnpj: row.cnpj, empresa_id: empresaId },
            }).catch(() => {/* silently */});
          }
        }

        // 2) Elegibilidade
        let elegId: string | null = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingEleg } = await (supabase as any)
          .from("elegibilidade")
          .select("id")
          .eq("empresa_id", empresaId!)
          .eq("acao_id", acaoId)
          .maybeSingle();

        if (existingEleg) {
          elegId = (existingEleg as { id: string }).id;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newEleg, error: elegErr } = await (supabase as any)
            .from("elegibilidade")
            .insert({ empresa_id: empresaId, acao_id: acaoId, elegivel: true, user_id: user!.id })
            .select("id")
            .single();
          if (elegErr) throw elegErr;
          elegId = (newEleg as { id: string }).id;
        }

        // 3) Prospecção — vincula apenas por elegibilidade_id
        // empresa_id e acao_id não existem em produção (migration 20260421 não aplicada)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingProsp } = await (supabase as any)
          .from("prospeccoes")
          .select("id")
          .eq("elegibilidade_id", elegId!)
          .maybeSingle();

        if (!existingProsp) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: prospErr } = await (supabase.from("prospeccoes") as any).insert({
            elegibilidade_id: elegId,
            status_prospeccao: row.statusProspeccao,
            user_id: user!.id,
            notas_prospeccao: row.obsRaw || null,
            valor_contrato: row.valorCausa,
          });
          // Não lança erro de prospecção — elegibilidade já foi criada e é suficiente
          if (prospErr) console.warn("Prospecção não criada:", row.nomeRaw, prospErr);
        } else {
          // Atualiza o status no reimport (importações anteriores podem ter status errado)
          const existingId = (existingProsp as { id: string }).id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from("prospeccoes") as any)
            .update({ status_prospeccao: row.statusProspeccao })
            .eq("id", existingId);
        }

        // 4) Processo (se tiver número)
        if (row.numeroProcesso && elegId) {
          const { data: existingProc } = await supabase
            .from("processos")
            .select("id")
            .eq("elegibilidade_id", elegId)
            .maybeSingle();

          if (!existingProc) {
            await supabase.from("processos").insert({
              elegibilidade_id: elegId,
              user_id: user!.id,
              numero_processo: row.numeroProcesso,
              fase: "Inicial",
              valor_estimado: row.valorCausa ?? 0,
              status: "Em andamento",
              observacoes: row.obsRaw || "",
            });
          }
        }

        importadas++;
      } catch (err) {
        console.error("Erro ao importar linha:", row.nomeRaw, err);
        erros++;
      }
    }

    setImporting(false);

    // Diagnóstico detalhado — facilita identificar rows que sumiram
    const total = rows.length;
    const semCnpj = rows.filter(r => r.rowStatus === "sem_cnpj").length;
    const cnpjInvalido = rows.filter(r => r.rowStatus === "cnpj_invalido").length;
    const jaImportada = rows.filter(r => r.rowStatus === "ja_importada").length;
    const naoSelecionadas = rows.filter(
      r => !r.selected && r.rowStatus !== "ja_importada"
        && r.rowStatus !== "sem_cnpj" && r.rowStatus !== "cnpj_invalido"
    ).length;

    const partes: string[] = [`${importadas} importadas`];
    if (erros > 0) partes.push(`${erros} com erro`);
    if (jaImportada > 0) partes.push(`${jaImportada} já existiam`);
    if (semCnpj > 0) partes.push(`${semCnpj} sem CNPJ`);
    if (cnpjInvalido > 0) partes.push(`${cnpjInvalido} CNPJ inválido`);
    if (naoSelecionadas > 0) partes.push(`${naoSelecionadas} desmarcadas`);

    const msg = `${partes.join(" • ")} (total ${total})`;
    if (erros > 0 || semCnpj > 0 || cnpjInvalido > 0) {
      toast.warning(msg);
    } else {
      toast.success(msg);
    }
    onImported();
    handleClose();
  };

  // -------------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------------

  const handleClose = () => {
    setStep(1);
    setRows([]);
    setFileName("");
    onClose();
  };

  const selectedCount = rows.filter((r) => r.selected && r.rowStatus !== "ja_importada").length;
  const novasCount = rows.filter((r) => r.selected && r.rowStatus === "ok_nova").length;
  const existentesCount = rows.filter((r) => r.selected && r.rowStatus === "ok_existente").length;
  const semCnpjCount = rows.filter((r) => r.selected && r.rowStatus === "sem_cnpj").length;
  const cnpjInvalidoCount = rows.filter((r) => r.rowStatus === "cnpj_invalido").length;
  const jaCount = rows.filter((r) => r.rowStatus === "ja_importada").length;

  const STATUS_COLORS: Record<RowStatus, string> = {
    ok_existente: "bg-success/10 text-success border-0",
    ok_nova: "bg-info/10 text-info border-0",
    sem_cnpj: "bg-warning/10 text-warning border-0",
    cnpj_invalido: "bg-destructive/10 text-destructive border-0",
    ja_importada: "bg-muted text-muted-foreground border-0",
  };

  const STATUS_LABELS: Record<RowStatus, string> = {
    ok_existente: "Cadastrada",
    ok_nova: "Nova (CNPJ)",
    sem_cnpj: "Sem CNPJ",
    cnpj_invalido: "CNPJ inválido",
    ja_importada: "Já importada",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Importar prospecção — {acaoNome}
          </DialogTitle>
        </DialogHeader>

        {/* -------- STEP 1: Upload -------- */}
        {step === 1 && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div
              className="w-full max-w-md border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/40 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-sm">Arraste a planilha ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground mt-1">Aceita .xlsx e .xls</p>
              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Colunas esperadas: SITUAÇÃO · EMPRESAS EM PROSPEÇÃO · CNPJ · NÚMERO PROCESSO
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          </div>
        )}

        {/* -------- STEP 2: Review -------- */}
        {step === 2 && (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-2 flex-wrap px-1 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground mr-1">{fileName}</span>
              {existentesCount > 0 && (
                <Badge variant="outline" className={STATUS_COLORS.ok_existente}>
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />{existentesCount} cadastradas
                </Badge>
              )}
              {novasCount > 0 && (
                <Badge variant="outline" className={STATUS_COLORS.ok_nova}>
                  <Upload className="h-2.5 w-2.5 mr-1" />{novasCount} novas
                </Badge>
              )}
              {semCnpjCount > 0 && (
                <Badge variant="outline" className={STATUS_COLORS.sem_cnpj}>
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" />{semCnpjCount} sem CNPJ
                </Badge>
              )}
              {cnpjInvalidoCount > 0 && (
                <Badge variant="outline" className={STATUS_COLORS.cnpj_invalido}>
                  <XCircle className="h-2.5 w-2.5 mr-1" />{cnpjInvalidoCount} CNPJ inválido
                </Badge>
              )}
              {jaCount > 0 && (
                <Badge variant="outline" className={STATUS_COLORS.ja_importada}>
                  <XCircle className="h-2.5 w-2.5 mr-1" />{jaCount} já importadas
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                  onClick={() => { setStep(1); setRows([]); }}>
                  <RotateCcw className="h-3 w-3" />Trocar arquivo
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toggleAll(true)}>
                  Selecionar todos
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toggleAll(false)}>
                  Desmarcar todos
                </Button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground w-8"></th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">Empresa</th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground w-36">CNPJ</th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">Processo</th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground">Status prospecção</th>
                    <th className="py-2 px-2 text-left font-medium text-muted-foreground w-28">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-t border-border/50 ${r.rowStatus === "ja_importada" ? "opacity-40" : ""} hover:bg-muted/30`}
                    >
                      <td className="py-1.5 px-2">
                        <Checkbox
                          checked={r.selected}
                          disabled={r.rowStatus === "ja_importada"}
                          onCheckedChange={() => toggleRow(i)}
                        />
                      </td>
                      <td className="py-1.5 px-2 max-w-[200px]">
                        <p className="truncate font-medium">{r.empresaNome}</p>
                        {r.empresaId && r.empresaNome !== r.nomeRaw && (
                          <p className="text-[10px] text-muted-foreground truncate">{r.nomeRaw}</p>
                        )}
                      </td>
                      <td className="py-1.5 px-2 font-mono">
                        {r.cnpj ? (
                          formatCNPJ(r.cnpj)
                        ) : r.cnpjErro ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 text-destructive text-[10px] cursor-help">
                                <HelpCircle className="h-3 w-3 shrink-0" />
                                {r.cnpjRaw ? r.cnpjRaw.slice(0, 18) : "inválido"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[220px] text-xs">
                              <p className="font-medium mb-0.5">CNPJ inválido</p>
                              <p className="text-muted-foreground">{r.cnpjErro}</p>
                              {r.cnpjRaw && <p className="mt-1 font-mono opacity-70">Original: {r.cnpjRaw}</p>}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-warning text-[10px]">ausente</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 max-w-[180px]">
                        <span className="truncate block text-[10px]">{r.numeroProcesso ?? "—"}</span>
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="text-foreground/80">{r.statusProspeccao}</span>
                        {r.situacaoRaw && r.situacaoRaw !== r.statusProspeccao && (
                          <span className="text-muted-foreground ml-1">({r.situacaoRaw})</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[r.rowStatus]}`}>
                          {STATUS_LABELS[r.rowStatus]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {selectedCount} empresa(s) selecionada(s) para importar
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleClose}>Cancelar</Button>
                <Button
                  size="sm"
                  disabled={selectedCount === 0 || importing}
                  onClick={handleImport}
                  className="gap-1.5"
                >
                  {importing ? (
                    <><Loader2 className="h-3 w-3 animate-spin" />Importando...</>
                  ) : (
                    <><ArrowRight className="h-3 w-3" />Importar {selectedCount} empresa(s)</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
