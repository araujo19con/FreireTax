import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Upload, Users, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import { maskCNPJ } from "@/lib/cnpj";
import { parseDrivaSheets, type DrivaParsed, type ContatoDraft } from "@/lib/drivaImport";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

type Match = { id: string; metadados: Record<string, string> | null };

interface Plano {
  matched: Map<string, Match>; // cnpj(14) → empresa
  missing: string[]; // cnpjs sem cadastro
  novosContatos: number; // após dedup
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function ImportarDrivaDialog({ open, onOpenChange, onDone }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<DrivaParsed | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [criarFaltantes, setCriarFaltantes] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);

  const reset = () => {
    setFileName("");
    setParsed(null);
    setPlano(null);
    setCriarFaltantes(false);
    setProgress(null);
    setResumo(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Lê o xlsx, faz parse e já casa por CNPJ. */
  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setParsed(null);
    setPlano(null);
    setResumo(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      const sheets: Record<string, Record<string, unknown>[]> = {};
      for (const name of wb.SheetNames) {
        sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
      }
      const p = parseDrivaSheets(sheets);
      setParsed(p);
      if (p.empresas.size === 0) {
        toast.error("Nenhuma empresa encontrada (a planilha precisa da aba 'RFB' com CNPJ).");
        return;
      }
      await casar(p);
    } catch (e) {
      toast.error("Erro ao ler a planilha: " + ((e as Error).message ?? "falha"));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Casa empresas por CNPJ (formato da base é variável → tenta formatado e cru). */
  const casar = async (p: DrivaParsed) => {
    const cnpjs = [...p.empresas.keys()];
    const variantes = cnpjs.flatMap((d) => [maskCNPJ(d), d]);
    const matched = new Map<string, Match>();
    for (const grp of chunk(variantes, 100)) {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, cnpj, metadados")
        .in("cnpj", grp);
      if (error) throw new Error(error.message);
      for (const e of data ?? []) {
        const d = (e.cnpj ?? "").replace(/\D/g, "");
        if (d.length === 14)
          matched.set(d, {
            id: e.id,
            metadados: (e.metadados ?? null) as unknown as Record<string, string> | null,
          });
      }
    }
    const missing = cnpjs.filter((d) => !matched.has(d));

    // dedup vs contatos já existentes nessas empresas
    const ids = [...matched.values()].map((m) => m.id);
    const existentes = new Set<string>();
    for (const grp of chunk(ids, 100)) {
      const { data } = await supabase
        .from("empresa_contatos")
        .select("empresa_id, dedup_key")
        .in("empresa_id", grp);
      for (const c of data ?? []) if (c.dedup_key) existentes.add(`${c.empresa_id}|${c.dedup_key}`);
    }
    let novos = 0;
    for (const [cnpj, lista] of p.contatos) {
      const m = matched.get(cnpj);
      if (!m) continue;
      for (const c of lista) if (!existentes.has(`${m.id}|${c.dedup_key}`)) novos++;
    }
    setPlano({ matched, missing, novosContatos: novos });
  };

  const linhaInsert = (empresaId: string, c: ContatoDraft) => ({
    empresa_id: empresaId,
    nome: c.nome,
    cargo: c.cargo,
    papel: c.papel,
    email: c.email,
    telefone: c.telefone,
    tipo_telefone: c.tipo_telefone,
    whatsapp: c.whatsapp,
    linkedin: c.linkedin,
    is_contador: c.is_contador,
    principal: !!c.principal,
    origem: c.origem,
    dedup_key: c.dedup_key,
    cpf_mascarado: c.cpf_mascarado,
    faixa_etaria: c.faixa_etaria,
    created_by: user?.id ?? null,
  });

  const importar = async () => {
    if (!parsed || !plano) return;
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      const matched = new Map(plano.matched);

      // 1) cria empresas faltantes (opcional)
      let criadas = 0;
      if (criarFaltantes && plano.missing.length) {
        if (!user?.id) {
          toast.error("Sessão inválida.");
          return;
        }
        const novas = plano.missing
          .map((d) => parsed.empresas.get(d))
          .filter((e): e is NonNullable<typeof e> => !!e)
          .map((e) => ({
            nome: e.razao_social || e.nome_fantasia || e.cnpj,
            razao_social: e.razao_social,
            nome_fantasia: e.nome_fantasia,
            cnpj: maskCNPJ(e.cnpj),
            uf: e.uf,
            municipio: e.municipio,
            status: "prospect",
            user_id: user.id,
            responsavel_id: user.id,
            metadados: { origem_cadastro: "driva-import" },
          }));
        for (const grp of chunk(novas, 200)) {
          const { data, error } = await supabase.from("empresas").insert(grp).select("id, cnpj");
          if (error) throw new Error("Criar empresas: " + error.message);
          for (const e of data ?? []) {
            const d = (e.cnpj ?? "").replace(/\D/g, "");
            if (d.length === 14) matched.set(d, { id: e.id, metadados: null });
          }
          criadas += grp.length;
        }
      }

      // 2) recalcula dedup p/ as empresas alvo
      const ids = [...matched.values()].map((m) => m.id);
      const existentes = new Set<string>();
      for (const grp of chunk(ids, 100)) {
        const { data } = await supabase
          .from("empresa_contatos")
          .select("empresa_id, dedup_key")
          .in("empresa_id", grp);
        for (const c of data ?? [])
          if (c.dedup_key) existentes.add(`${c.empresa_id}|${c.dedup_key}`);
      }

      // 3) monta linhas novas
      const linhas: ReturnType<typeof linhaInsert>[] = [];
      for (const [cnpj, lista] of parsed.contatos) {
        const m = matched.get(cnpj);
        if (!m) continue;
        for (const c of lista) {
          const k = `${m.id}|${c.dedup_key}`;
          if (existentes.has(k)) continue;
          existentes.add(k);
          linhas.push(linhaInsert(m.id, c));
        }
      }

      // 4) insere em lote
      setProgress({ done: 0, total: linhas.length });
      let inseridos = 0;
      for (const grp of chunk(linhas, 500)) {
        const { error } = await supabase.from("empresa_contatos").insert(grp);
        if (error) throw new Error("Inserir contatos: " + error.message);
        inseridos += grp.length;
        setProgress({ done: inseridos, total: linhas.length });
      }

      // 5) web/social → metadados (sem sobrescrever)
      let websAtualizadas = 0;
      for (const [cnpj, w] of parsed.web) {
        const m = matched.get(cnpj);
        if (!m) continue;
        const meta: Record<string, string> = m.metadados ? { ...m.metadados } : {};
        let mudou = false;
        for (const [k, v] of Object.entries(w))
          if (!meta[k]) {
            meta[k] = v;
            mudou = true;
          }
        if (!mudou) continue;
        const { error } = await supabase
          .from("empresas")
          .update({ metadados: meta })
          .eq("id", m.id);
        if (!error) websAtualizadas++;
      }

      void logAudit({
        tabela: "empresa_contatos",
        acao: "Importou DRIVA",
        detalhes: { contatos: inseridos, empresas_criadas: criadas, arquivo: fileName },
      });
      setResumo(
        `${inseridos} contatos importados${criadas ? `, ${criadas} empresas criadas` : ""}${websAtualizadas ? `, ${websAtualizadas} com site/social` : ""}.`
      );
      toast.success("Importação concluída");
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message ?? "Falha na importação");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const st = parsed?.stats;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Importar DRIVA
          </DialogTitle>
          <DialogDescription>
            Suba a planilha .xlsx da DRIVA. O sistema casa as empresas por CNPJ e grava os contatos
            (sócios, decisores, telefones e site/social).
          </DialogDescription>
        </DialogHeader>

        {!resumo && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-muted/30 disabled:opacity-50"
            >
              <Upload className="h-6 w-6" />
              {fileName || "Clique para escolher a planilha (.xlsx)"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              aria-label="Planilha DRIVA (.xlsx)"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />

            {busy && !progress && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Processando...
              </p>
            )}

            {st && plano && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{st.empresasNaPlanilha} empresas</Badge>
                  <Badge variant="secondary">{st.contatos} contatos</Badge>
                  {st.nomeados > 0 && <Badge variant="secondary">{st.nomeados} nomeados</Badge>}
                  {st.comEmail > 0 && <Badge variant="secondary">{st.comEmail} c/ email</Badge>}
                  {st.comTelefone > 0 && (
                    <Badge variant="secondary">{st.comTelefone} c/ telefone</Badge>
                  )}
                  {st.comWhatsapp > 0 && (
                    <Badge variant="secondary">{st.comWhatsapp} c/ WhatsApp</Badge>
                  )}
                  {st.comLinkedin > 0 && (
                    <Badge variant="secondary">{st.comLinkedin} c/ LinkedIn</Badge>
                  )}
                </div>
                <div className="border-t border-border/60 pt-2">
                  <p className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <strong>{plano.matched.size}</strong> empresas casadas no CRM ·{" "}
                    <strong className="text-primary">{plano.novosContatos}</strong> contatos novos a
                    inserir
                  </p>
                  {plano.missing.length > 0 && (
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={criarFaltantes}
                        onCheckedChange={(v) => setCriarFaltantes(!!v)}
                      />
                      Criar as {plano.missing.length} empresas sem cadastro (como prospect)
                    </label>
                  )}
                </div>
              </div>
            )}

            {progress && progress.total > 0 && (
              <div className="space-y-1">
                <Progress value={(progress.done / progress.total) * 100} />
                <p className="text-center text-xs text-muted-foreground">
                  {progress.done}/{progress.total} contatos
                </p>
              </div>
            )}
          </div>
        )}

        {resumo && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-medium">{resumo}</p>
          </div>
        )}

        <DialogFooter>
          {resumo ? (
            <Button
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button
                onClick={() => void importar()}
                disabled={
                  busy ||
                  !plano ||
                  (plano.novosContatos === 0 && !(criarFaltantes && plano.missing.length))
                }
              >
                {busy ? "Importando..." : "Importar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
