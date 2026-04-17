import { useState, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";

interface ImportRow {
  nome: string;
  cnpj: string;
  status: string;
  valid: boolean;
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

export default function Importacao() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, errors: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const parseFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

        if (jsonData.length < 2) {
          toast.error("Planilha vazia ou sem dados além do cabeçalho");
          return;
        }

        const headers = (jsonData[0] as string[]).map(String);
        const nomeCol = findColumn(headers, ["nome", "razao", "empresa", "name"]);
        const cnpjCol = findColumn(headers, ["cnpj", "cpf_cnpj"]);
        const statusCol = findColumn(headers, ["status", "situacao"]);

        if (nomeCol === -1 || cnpjCol === -1) {
          toast.error("Não foi possível identificar as colunas 'Nome' e 'CNPJ' na planilha");
          return;
        }

        const parsed: ImportRow[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as string[];
          if (!row || row.length === 0) continue;

          const nome = String(row[nomeCol] || "").trim();
          const rawCnpj = String(row[cnpjCol] || "").trim();
          const status = statusCol !== -1 ? String(row[statusCol] || "prospect").trim().toLowerCase() : "prospect";
          const cnpj = formatCNPJ(rawCnpj);
          const errors: string[] = [];

          if (!nome) errors.push("Nome vazio");
          if (!validateCNPJ(rawCnpj)) errors.push("CNPJ inválido");
          if (parsed.some((p) => p.cnpj.replace(/\D/g, "") === cnpj.replace(/\D/g, ""))) {
            errors.push("CNPJ duplicado");
          }

          parsed.push({ nome, cnpj, status, valid: errors.length === 0, errors });
        }

        setRows(parsed);
        const validCount = parsed.filter((r) => r.valid).length;
        toast.success(`${parsed.length} registros lidos – ${validCount} válidos`);
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
    const validRows = rows.filter((r) => r.valid);
    if (validRows.length === 0) {
      toast.error("Nenhum registro válido para importar");
      return;
    }
    setImporting(true);
    try {
      const insertData = validRows.map((r) => ({
        nome: r.nome,
        cnpj: r.cnpj,
        status: r.status,
        obs: "",
        user_id: user?.id,
      }));
      // Insert em batch e recupera IDs (pra enriquecer em seguida)
      const { data: inserted, error } = await supabase
        .from("empresas")
        .insert(insertData)
        .select("id, cnpj");
      if (error) throw error;
      toast.success(`${validRows.length} empresas importadas!`);

      // Enriquecimento automático via Receita Federal (paralelo, limitado a 3 concorrentes)
      if (inserted && inserted.length > 0) {
        setImporting(false);
        setEnriching(true);
        setEnrichProgress({ done: 0, total: inserted.length, errors: 0 });
        const loadingId = toast.loading(
          `Enriquecendo ${inserted.length} empresas com dados da Receita...`
        );

        // Processa em chunks de 3 em paralelo (BrasilAPI suporta bem)
        const CHUNK = 3;
        let done = 0;
        let errors = 0;
        for (let i = 0; i < inserted.length; i += CHUNK) {
          const chunk = inserted.slice(i, i + CHUNK);
          await Promise.all(
            chunk.map(async (emp: any) => {
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
          // mini-pausa pra não bater no rate limit
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
    } catch (error: any) {
      toast.error("Erro ao importar: " + (error.message || "erro desconhecido"));
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validCount = rows.filter((r) => r.valid).length;
  const errorCount = rows.filter((r) => !r.valid).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Importação em Massa"
        description="Importe empresas via planilhas CSV ou XLSX"
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-success/10 text-success border-0 gap-1">
                <CheckCircle2 className="h-3 w-3" /> {validCount} válidos
              </Badge>
              {errorCount > 0 && (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-0 gap-1">
                  <XCircle className="h-3 w-3" /> {errorCount} com erros
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClear}>
                <Trash2 className="mr-2 h-4 w-4" />
                Limpar
              </Button>
              <Button onClick={handleImport} disabled={importing || enriching || validCount === 0}>
                {importing
                  ? "Importando..."
                  : enriching
                    ? `Enriquecendo ${enrichProgress.done}/${enrichProgress.total}...`
                    : `Importar ${validCount} empresas`}
              </Button>
            </div>
          </div>

          {/* Barra de progresso de enriquecimento (durante o fetch da Receita) */}
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
                Puxando razão social, porte, CNAE, endereço e quadro societário.
              </p>
            </div>
          )}

          <Card className="shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground w-10">#</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Nome</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">CNPJ</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Validação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-border last:border-0 transition-colors ${!r.valid ? "bg-destructive/5" : "hover:bg-muted/50"}`}>
                      <td className="py-3 px-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-4 font-medium">{r.nome || "—"}</td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{r.cnpj || "—"}</td>
                      <td className="py-3 px-4 capitalize text-muted-foreground">{r.status}</td>
                      <td className="py-3 px-4">
                        {r.valid ? (
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
          <h3 className="font-heading font-semibold mb-3">Instruções</h3>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>• A planilha deve conter colunas para: Nome Empresarial, CNPJ, Status</li>
            <li>• O CNPJ será validado automaticamente</li>
            <li>• Registros duplicados serão identificados antes da importação</li>
            <li>• Você poderá revisar e confirmar antes da gravação definitiva</li>
          </ul>
        </Card>
      )}
    </div>
  );
}
