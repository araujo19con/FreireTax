import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { maskCNPJ } from "@/lib/cnpj";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pastaId: string;
  pastaNome: string;
}

// Resolve uma célula bruta a CNPJ de 14 dígitos (só dígitos). Recupera zeros
// à esquerda que o Excel come quando trata CNPJ como número.
// Converte célula Excel (unknown) para string segura — rejeita objetos.
function cellStr(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

function resolveCNPJ(raw: unknown): string | null {
  const s = cellStr(raw);
  if (!s.trim()) return null;
  let digits = s.replace(/\D/g, "");
  if (digits.length === 13) digits = "0" + digits;
  if (digits.length === 12) digits = "00" + digits;
  if (digits.length === 11) digits = "000" + digits;
  return digits.length === 14 ? digits : null;
}

function normalizeHeader(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[_\s\-/]+/g, "");
}

const HEADER_CANDIDATES = {
  cnpj: ["cnpj", "cnpjsa"],
  nome: ["nome", "empresa", "nomeempresa"],
  razao: ["razaosocial", "razao", "razaosocialempresa"],
  fantasia: ["nomefantasia", "fantasia"],
  uf: ["uf", "estado"],
  municipio: ["municipio", "cidade"],
};

function detectColumn(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) => ({ orig: h, n: normalizeHeader(h) }));
  for (const cand of candidates) {
    const m = normalized.find((h) => h.n === cand);
    if (m) return m.orig;
  }
  return null;
}

interface ParsedRow {
  cnpjDigits: string;
  nome: string | null;
  razao: string | null;
  fantasia: string | null;
  uf: string | null;
  municipio: string | null;
}

interface ImportResult {
  total: number;
  invalidCnpj: number;
  duplicates: number;
  matched: number;
  created: number;
  pastaAdded: number;
  errors: Array<{ cnpj: string; msg: string }>;
}

export function ImportarParaPastaDialog({ open, onOpenChange, pastaId, pastaNome }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [invalidCount, setInvalidCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setFile(null);
    setRows(null);
    setInvalidCount(0);
    setDuplicateCount(0);
    setResult(null);
    setProgress({ done: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpenChange = (v: boolean) => {
    if (running) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const parseFile = async (f: File) => {
    setFile(f);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        raw: false,
        defval: "",
      });
      if (!json.length) {
        toast.error("Planilha vazia ou sem cabeçalho");
        setFile(null);
        return;
      }
      const headers = Object.keys(json[0]);
      const cnpjCol = detectColumn(headers, HEADER_CANDIDATES.cnpj);
      if (!cnpjCol) {
        toast.error("Não achei coluna 'CNPJ' no cabeçalho da planilha");
        setFile(null);
        return;
      }
      const nomeCol = detectColumn(headers, HEADER_CANDIDATES.nome);
      const razaoCol = detectColumn(headers, HEADER_CANDIDATES.razao);
      const fantasiaCol = detectColumn(headers, HEADER_CANDIDATES.fantasia);
      const ufCol = detectColumn(headers, HEADER_CANDIDATES.uf);
      const munCol = detectColumn(headers, HEADER_CANDIDATES.municipio);

      let invalid = 0;
      let dup = 0;
      const seen = new Set<string>();
      const out: ParsedRow[] = [];
      for (const row of json) {
        const digits = resolveCNPJ(row[cnpjCol]);
        if (!digits) {
          invalid++;
          continue;
        }
        if (seen.has(digits)) {
          dup++;
          continue;
        }
        seen.add(digits);
        const strOrNull = (col: string | null) => {
          if (!col) return null;
          const v = cellStr(row[col]).trim();
          return v || null;
        };
        out.push({
          cnpjDigits: digits,
          nome: strOrNull(nomeCol),
          razao: strOrNull(razaoCol),
          fantasia: strOrNull(fantasiaCol),
          uf: ufCol ? cellStr(row[ufCol]).trim().toUpperCase() || null : null,
          municipio: strOrNull(munCol),
        });
      }
      setInvalidCount(invalid);
      setDuplicateCount(dup);
      setRows(out);
    } catch (e) {
      toast.error("Erro ao ler planilha: " + (e as Error).message);
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const execute = async () => {
    if (!rows || !user || rows.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: rows.length });

    const res: ImportResult = {
      total: rows.length,
      invalidCnpj: invalidCount,
      duplicates: duplicateCount,
      matched: 0,
      created: 0,
      pastaAdded: 0,
      errors: [],
    };

    try {
      // 1) Match existentes em lotes pelo cnpj mascarado
      const maskedAll = rows.map((r) => maskCNPJ(r.cnpjDigits));
      const existingMap = new Map<string, string>(); // cnpj mascarado -> empresa.id
      const FIND_CHUNK = 100;
      for (let i = 0; i < maskedAll.length; i += FIND_CHUNK) {
        const chunk = maskedAll.slice(i, i + FIND_CHUNK);
        const { data, error } = await supabase
          .from("empresas")
          .select("id, cnpj")
          .in("cnpj", chunk);
        if (error) throw error;
        for (const e of (data ?? []) as Array<{ id: string; cnpj: string }>) {
          existingMap.set(e.cnpj, e.id);
        }
        setProgress({ done: Math.min(i + chunk.length, maskedAll.length), total: rows.length });
      }
      res.matched = existingMap.size;

      // 2) Insert dos não encontrados em lotes de 50
      const toInsertRows = rows.filter((r) => !existingMap.has(maskCNPJ(r.cnpjDigits)));
      const createdIds: string[] = [];
      const INSERT_CHUNK = 50;
      for (let i = 0; i < toInsertRows.length; i += INSERT_CHUNK) {
        const chunk = toInsertRows.slice(i, i + INSERT_CHUNK).map((r) => {
          const cnpjMasked = maskCNPJ(r.cnpjDigits);
          return {
            cnpj: cnpjMasked,
            nome: r.nome || r.razao || cnpjMasked,
            razao_social: r.razao,
            nome_fantasia: r.fantasia,
            uf: r.uf,
            municipio: r.municipio,
            status: "prospect",
            user_id: user.id,
          };
        });
        // cast: o Insert shape da tabela tem mais campos; aceitamos parcial.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from("empresas") as any)
          .insert(chunk)
          .select("id, cnpj");
        if (error) {
          // Em conflito de CNPJ (race) ou outro erro de lote, registra e segue.
          res.errors.push({
            cnpj: chunk[0]?.cnpj ?? "?",
            msg: `Lote ${i / INSERT_CHUNK + 1}: ${error.message}`,
          });
        } else if (data) {
          for (const e of data as Array<{ id: string; cnpj: string }>) createdIds.push(e.id);
        }
      }
      res.created = createdIds.length;

      // 3) Vincula tudo à pasta — deduplicando contra vínculos já existentes
      const allEmpresaIds = [...existingMap.values(), ...createdIds];
      if (allEmpresaIds.length) {
        const { data: existingItems } = await supabase
          .from("pasta_empresa_items")
          .select("empresa_id")
          .eq("pasta_id", pastaId)
          .in("empresa_id", allEmpresaIds);
        const already = new Set(
          (existingItems ?? []).map((r: { empresa_id: string }) => r.empresa_id)
        );
        const toLink = allEmpresaIds
          .filter((id) => !already.has(id))
          .map((empresa_id) => ({ pasta_id: pastaId, empresa_id, user_id: user.id }));
        if (toLink.length) {
          const { error } = await supabase.from("pasta_empresa_items").insert(toLink);
          if (error) {
            res.errors.push({ cnpj: "vinculo", msg: error.message });
          } else {
            res.pastaAdded = toLink.length;
          }
        }
      }

      await logAudit({
        tabela: "pastas_empresas",
        acao: "Importou empresas em lote pra pasta",
        registro_id: pastaId,
        detalhes: {
          pasta_nome: pastaNome,
          arquivo: file?.name,
          total_planilha: rows.length,
          ja_existentes: res.matched,
          novas_criadas: res.created,
          vinculadas: res.pastaAdded,
          erros: res.errors.length,
        },
      });

      qc.invalidateQueries({ queryKey: ["empresas"] });
      qc.invalidateQueries({ queryKey: ["pasta_empresa_items"] });
      setResult(res);
      toast.success(`${res.pastaAdded} empresa(s) vinculada(s) a "${pastaNome}"`);
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
      res.errors.push({ cnpj: "geral", msg: (e as Error).message });
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar empresas para "{pastaNome}"</DialogTitle>
          <DialogDescription>
            Sobe uma planilha (.xlsx ou .csv) com coluna <code>CNPJ</code>. Empresas que já existem
            na base são reaproveitadas; as ausentes são criadas com os dados disponíveis (nome, UF,
            município). No fim todas vão pra esta pasta.
          </DialogDescription>
        </DialogHeader>

        {!file && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:bg-muted/30"
            role="button"
            tabIndex={0}
            aria-label="Selecionar planilha"
          >
            <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Arraste a planilha aqui ou clique pra selecionar</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cabeçalho esperado: <strong>CNPJ</strong> (obrigatório), Nome/Razão Social, UF,
              Município (opcionais)
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        )}

        {file && parsing && (
          <div className="py-6 text-center">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
            <p className="text-sm text-muted-foreground">Lendo planilha…</p>
          </div>
        )}

        {file && rows && !running && !result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm">{file.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
                <RotateCcw className="h-3.5 w-3.5" /> Trocar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {rows.length} CNPJ(s) válido(s)
              </Badge>
              {invalidCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-destructive/30 bg-destructive/10 text-destructive"
                >
                  <AlertCircle className="mr-1 h-3 w-3" /> {invalidCount} sem CNPJ válido
                </Badge>
              )}
              {duplicateCount > 0 && (
                <Badge variant="outline">{duplicateCount} duplicado(s) na planilha</Badge>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  void execute();
                }}
                disabled={rows.length === 0}
                className="gap-2"
              >
                <Upload className="h-4 w-4" /> Importar e vincular
              </Button>
            </div>
          </div>
        )}

        {running && (
          <div className="space-y-2 py-4">
            <p className="text-sm">Processando…</p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            <p className="text-xs tabular-nums text-muted-foreground">
              {progress.done} / {progress.total}
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <ResultStat label="Já existiam" value={result.matched} />
              <ResultStat label="Novas criadas" value={result.created} />
              <ResultStat label="Adicionadas à pasta" value={result.pastaAdded} highlight />
              <ResultStat label="CNPJ inválido" value={result.invalidCnpj} />
            </div>
            {result.duplicates > 0 && (
              <p className="text-xs text-muted-foreground">
                {result.duplicates} CNPJ(s) duplicado(s) na planilha foram processados só uma vez.
              </p>
            )}
            {result.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="mb-1 font-medium">
                    {result.errors.length} erro(s) durante a importação
                  </p>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        <code>{e.cnpj}</code> — {e.msg}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={reset}>
                Importar outra
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-primary/30 bg-primary/5" : "bg-muted/20"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
