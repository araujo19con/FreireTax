import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Trash2, RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";

type ImportMode = "nova" | "atualizar" | "invalido";

interface ImportRow {
  nome: string;
  cnpj: string;
  status: string;
  quantidade_funcionarios: number | null;
  faturamento_anual: number | null;
  /** ID da empresa existente (quando o CNPJ já existe na base) */
  existing_id: string | null;
  mode: ImportMode;
  errors: string[];
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
  return String(header || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.findIndex((h) => normalizeHeader(h).includes(candidate));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Converte string de planilha (R$ 1.500,00 / 1500.5 / 1500,5 / vazio) em número ou null. */
function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
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

export default function Importacao() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [hasFuncionariosCol, setHasFuncionariosCol] = useState(false);
  const [hasFaturamentoCol, setHasFaturamentoCol] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const parseFile = useCallback((file: File) => {
    setFileName(file.name);
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
        const nomeCol = findColumn(headers, ["nome", "razao", "empresa", "name"]);
        const statusCol = findColumn(headers, ["status", "situacao"]);
        const funcCol = findColumn(headers, ["funcionario", "funcionarios", "colaborador", "employee"]);
        const fatCol  = findColumn(headers, ["faturamento", "receita", "revenue", "billing"]);

        if (cnpjCol === -1) {
          toast.error("Não foi possível identificar a coluna 'CNPJ' na planilha");
          return;
        }

        setHasFuncionariosCol(funcCol !== -1);
        setHasFaturamentoCol(fatCol !== -1);

        const parsedDraft: Omit<ImportRow, "existing_id" | "mode">[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as unknown[];
          if (!row || row.length === 0) continue;

          const nome = nomeCol !== -1 ? String(row[nomeCol] || "").trim() : "";
          const rawCnpj = String(row[cnpjCol] || "").trim();
          const status = statusCol !== -1 ? String(row[statusCol] || "prospect").trim().toLowerCase() : "prospect";
          const cnpj = formatCNPJ(rawCnpj);
          const quantidade_funcionarios = funcCol !== -1 ? parseNumber(row[funcCol]) : null;
          const faturamento_anual = fatCol !== -1 ? parseNumber(row[fatCol]) : null;
          const errors: string[] = [];

          if (!validateCNPJ(rawCnpj)) errors.push("CNPJ inválido");

          parsedDraft.push({
            nome, cnpj, status,
            quantidade_funcionarios, faturamento_anual,
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
        const cnpjsValidos = parsedDraft
          .filter((r) => r.errors.length === 0)
          .map((r) => r.cnpj);
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
        const upd   = parsed.filter((r) => r.mode === "atualizar").length;
        const errs  = parsed.filter((r) => r.mode === "invalido").length;
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
    if (file) parseFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const handleImport = async () => {
    const newRows = rows.filter((r) => r.mode === "nova");
    const updRows = rows.filter((r) => r.mode === "atualizar");
    const total = newRows.length + updRows.length;
    if (total === 0) {
      toast.error("Nenhum registro válido para importar");
      return;
    }
    setImporting(true);
    try {
      let inserted: Array<{ id: string; cnpj: string }> = [];
      let upsertedCount = 0;

      // 1) INSERT em batch das novas
      if (newRows.length > 0) {
        const insertData = newRows.map((r) => ({
          nome: r.nome,
          cnpj: r.cnpj,
          status: r.status,
          obs: "",
          user_id: user?.id,
          quantidade_funcionarios: r.quantidade_funcionarios,
          faturamento_anual: r.faturamento_anual,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: ins, error } = await (supabase.from("empresas") as any)
          .insert(insertData)
          .select("id, cnpj");
        if (error) throw error;
        inserted = (ins ?? []) as typeof inserted;
      }

      // 2) UPDATE 1×1 das existentes (Promise.all em chunks pra velocidade)
      if (updRows.length > 0) {
        const CHUNK = 8;
        for (let i = 0; i < updRows.length; i += CHUNK) {
          const slice = updRows.slice(i, i + CHUNK);
          await Promise.all(slice.map(async (r) => {
            // Só sobrescreve campos vindos da planilha (não toca nome/status/RFB)
            const patch: Record<string, unknown> = {};
            if (hasFuncionariosCol) patch.quantidade_funcionarios = r.quantidade_funcionarios;
            if (hasFaturamentoCol)  patch.faturamento_anual = r.faturamento_anual;
            // Se o usuário trouxe nome ou status, atualiza também
            if (r.nome) patch.nome = r.nome;
            if (Object.keys(patch).length === 0) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase.from("empresas") as any)
              .update(patch).eq("id", r.existing_id!);
            if (!error) upsertedCount++;
          }));
        }
      }

      const msgParts: string[] = [];
      if (inserted.length > 0) msgParts.push(`${inserted.length} criada${inserted.length === 1 ? "" : "s"}`);
      if (upsertedCount > 0)  msgParts.push(`${upsertedCount} atualizada${upsertedCount === 1 ? "" : "s"}`);
      toast.success("Importação concluída: " + msgParts.join(", "));

      // 3) Enriquecimento RFB só pras novas
      if (inserted.length > 0) {
        setImporting(false);
        setEnriching(true);
        setEnrichProgress({ done: 0, total: inserted.length, errors: 0 });
        const loadingId = toast.loading(
          `Enriquecendo ${inserted.length} novas empresas com dados da Receita...`
        );

        const CHUNK = 3;
        let done = 0;
        let errors = 0;
        for (let i = 0; i < inserted.length; i += CHUNK) {
          const chunk = inserted.slice(i, i + CHUNK);
          await Promise.all(
            chunk.map(async (emp) => {
              try {
                const { data, error: enErr } = await supabase.functions.invoke(
                  "enriquecer-cnpj",
                  { body: { cnpj: emp.cnpj, empresa_id: emp.id } }
                );
                if (enErr || data?.error) errors += 1;
              } catch {
                errors += 1;
              } finally {
                done += 1;
                setEnrichProgress({ done, total: inserted.length, errors });
              }
            })
          );
          await new Promise((r) => setTimeout(r, 300));
        }

        toast.success(
          `Receita aplicada: ${done - errors}/${inserted.length} enriquecidas` +
            (errors > 0 ? ` (${errors} falharam — aparecerão marcadas na lista)` : ""),
          { id: loadingId, duration: 6000 }
        );
      }

      setRows([]);
      setFileName("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "erro desconhecido";
      toast.error("Erro ao importar: " + msg);
      console.error(error);
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const novaCount  = rows.filter((r) => r.mode === "nova").length;
  const updCount   = rows.filter((r) => r.mode === "atualizar").length;
  const errorCount = rows.filter((r) => r.mode === "invalido").length;
  const totalImportar = novaCount + updCount;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Importação em Massa"
        description="Importe ou atualize empresas via planilhas CSV ou XLSX"
        icon={<Upload className="h-7 w-7" />}
      />

      <Card className="shadow-card p-8">
        <div
          className={`flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-lg transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-heading font-semibold text-lg mb-1">
            {fileName ? fileName : "Arraste sua planilha aqui"}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">CSV ou XLSX com dados das empresas</p>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Selecionar Arquivo
          </Button>
        </div>
      </Card>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="bg-info/10 text-info border-0 gap-1">
                <Plus className="h-3 w-3" /> {novaCount} nova{novaCount === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="bg-warning/10 text-warning border-0 gap-1">
                <RefreshCw className="h-3 w-3" /> {updCount} pra atualizar
              </Badge>
              {errorCount > 0 && (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 gap-1">
                  <XCircle className="h-3 w-3" /> {errorCount} com erro{errorCount === 1 ? "" : "s"}
                </Badge>
              )}
              {(hasFuncionariosCol || hasFaturamentoCol) && (
                <Badge variant="secondary" className="text-[10px]">
                  Detectado: {[hasFuncionariosCol && "funcionários", hasFaturamentoCol && "faturamento"].filter(Boolean).join(" + ")}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClear}>
                <Trash2 className="mr-2 h-4 w-4" />
                Limpar
              </Button>
              <Button onClick={handleImport} disabled={importing || enriching || totalImportar === 0}>
                {importing
                  ? "Importando..."
                  : enriching
                    ? `Enriquecendo ${enrichProgress.done}/${enrichProgress.total}...`
                    : `Importar (${totalImportar})`}
              </Button>
            </div>
          </div>

          {enriching && enrichProgress.total > 0 && (
            <div className="mt-3 p-3 rounded-md border border-primary/30 bg-primary/5">
              <div className="flex items-center justify-between mb-1.5 text-xs">
                <span className="font-medium flex items-center gap-1">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Consultando Receita Federal (BrasilAPI)
                </span>
                <span className="tabular-nums">
                  {enrichProgress.done}/{enrichProgress.total}
                  {enrichProgress.errors > 0 && (
                    <span className="text-destructive ml-2">
                      · {enrichProgress.errors} falha{enrichProgress.errors > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round(
                      (enrichProgress.done / Math.max(1, enrichProgress.total)) * 100
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Puxando razão social, porte, CNAE, endereço e quadro societário (apenas pras novas).
              </p>
            </div>
          )}

          <Card className="shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground w-10">#</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Modo</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Nome</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">CNPJ</th>
                    {hasFuncionariosCol && (
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Funcionários</th>
                    )}
                    {hasFaturamentoCol && (
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Faturamento</th>
                    )}
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Validação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-border last:border-0 transition-colors ${
                      r.mode === "invalido" ? "bg-destructive/5" :
                      r.mode === "atualizar" ? "bg-warning/5" :
                      "hover:bg-muted/50"
                    }`}>
                      <td className="py-3 px-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-4">
                        {r.mode === "nova" && (
                          <Badge variant="outline" className="bg-info/10 text-info border-info/30 text-[10px] gap-1">
                            <Plus className="h-2.5 w-2.5" />Nova
                          </Badge>
                        )}
                        {r.mode === "atualizar" && (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px] gap-1">
                            <RefreshCw className="h-2.5 w-2.5" />Atualizar
                          </Badge>
                        )}
                        {r.mode === "invalido" && (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px] gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />Inválido
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium">{r.nome || "—"}</td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{r.cnpj || "—"}</td>
                      {hasFuncionariosCol && (
                        <td className="py-3 px-4 text-right tabular-nums">
                          {r.quantidade_funcionarios ?? "—"}
                        </td>
                      )}
                      {hasFaturamentoCol && (
                        <td className="py-3 px-4 text-right tabular-nums">
                          {r.faturamento_anual != null
                            ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(r.faturamento_anual)
                            : "—"}
                        </td>
                      )}
                      <td className="py-3 px-4">
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
        <Card className="shadow-card p-6">
          <h3 className="font-heading font-semibold mb-3">Como usar</h3>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>• A planilha precisa ter no mínimo a coluna <strong>CNPJ</strong>.</li>
            <li>• Colunas opcionais reconhecidas: <strong>Nome</strong>, <strong>Status</strong>, <strong>Funcionários</strong> (ou "Colaboradores"), <strong>Faturamento</strong> (ou "Receita").</li>
            <li>• Se o CNPJ <strong>já existe</strong> na base, os campos importados (funcionários, faturamento, nome) <strong>atualizam</strong> a empresa existente.</li>
            <li>• Se o CNPJ <strong>não existe</strong>, uma empresa nova é criada (e enriquecida automaticamente via Receita Federal).</li>
            <li>• Valores monetários aceitam formato BR (R$ 1.500,00) ou US (1500.00).</li>
          </ul>
        </Card>
      )}
    </div>
  );
}
