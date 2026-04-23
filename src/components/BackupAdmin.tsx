import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, HardDriveDownload, ShieldCheck, Loader2, RefreshCw, Trash2, FileJson } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { logAudit } from "@/lib/audit";

interface BackupArquivo {
  pasta: string;          // "2026-04-22"
  nome: string;           // "143022-manual.json"
  path: string;           // "2026-04-22/143022-manual.json"
  tamanho: number | null;
  criado_em: string | null;
}

/**
 * Painel de Backup do Sistema (admin only).
 *
 * 3 ações:
 *  1. "Baixar agora" → invoca edge function em modo download, browser baixa JSON local.
 *  2. "Salvar snapshot" → invoca edge function em modo storage, salva no bucket.
 *  3. Lista snapshots existentes com download/exclusão individual.
 *
 * O backup automático é configurado via pg_cron no Supabase (instrução no UI).
 */
export function BackupAdmin() {
  const [arquivos, setArquivos] = useState<BackupArquivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [baixandoLocal, setBaixandoLocal] = useState(false);
  const [salvandoStorage, setSalvandoStorage] = useState(false);

  const carregarBackups = async () => {
    setLoading(true);
    try {
      // Lista pastas top-level (datas) e depois conteúdo de cada uma
      const { data: pastas, error: pastaErr } = await supabase
        .storage.from("backups").list("", { limit: 200, sortBy: { column: "name", order: "desc" } });

      if (pastaErr) throw pastaErr;

      const todos: BackupArquivo[] = [];
      for (const pasta of pastas ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pasta.name)) continue;
        const { data: files } = await supabase
          .storage.from("backups").list(pasta.name, { limit: 100, sortBy: { column: "name", order: "desc" } });
        for (const f of files ?? []) {
          todos.push({
            pasta: pasta.name,
            nome: f.name,
            path: `${pasta.name}/${f.name}`,
            tamanho: f.metadata?.size ?? null,
            criado_em: f.created_at ?? null,
          });
        }
      }
      // Ordena: mais recentes primeiro (path lexicográfico já cobre isso)
      todos.sort((a, b) => b.path.localeCompare(a.path));
      setArquivos(todos);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      toast.error(`Erro ao listar backups: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarBackups();
  }, []);

  /**
   * Chama edge function via fetch direto (preserva query string e devolve
   * o erro real do gateway). `supabase.functions.invoke` não aceita query
   * params no nome da função, então fetch direto é o caminho confiável.
   */
  const callBackupFunction = async (mode: "download" | "storage", motivo: string): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL não configurada");

    const url = `${supabaseUrl}/functions/v1/backup-completo?mode=${mode}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ motivo }),
    });

    if (!res.ok) {
      // Diagnóstico melhor — distingue função-não-deployada de erro interno
      let detalhe = "";
      try { detalhe = await res.text(); } catch { /* ignore */ }
      const trecho = detalhe.slice(0, 300);
      if (res.status === 404) {
        throw new Error(
          `Edge function "backup-completo" não foi deployada ainda. ` +
          `Vá em Supabase Dashboard → Edge Functions e crie/deploye a função (instruções no chat).`
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Sem permissão (${res.status}): ${trecho}`);
      }
      throw new Error(`HTTP ${res.status}: ${trecho || res.statusText}`);
    }
    return res;
  };

  const handleBaixarLocal = async () => {
    setBaixandoLocal(true);
    try {
      toast.info("Gerando backup… isso pode levar 10-30 segundos");
      const res = await callBackupFunction("download", "manual-download");

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/i);
      const filename = m?.[1] ?? `tax-trakker-backup-${new Date().toISOString().slice(0,10)}.json`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast.success(`Backup baixado: ${(blob.size / 1024).toFixed(1)} KB`);
      logAudit({ tabela: "backups", acao: "Baixou backup local", detalhes: { filename, tamanho: blob.size } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      console.error("[backup local]", e);
      toast.error(msg, { duration: 8000 });
    } finally {
      setBaixandoLocal(false);
    }
  };

  const handleSalvarStorage = async () => {
    setSalvandoStorage(true);
    try {
      toast.info("Gerando snapshot e enviando pro storage…");
      const res = await callBackupFunction("storage", "manual");
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "Resposta inválida da função");

      const tamanhoKb = ((data.tamanho_bytes as number) / 1024).toFixed(1);
      toast.success(`Snapshot salvo: ${data.path} (${tamanhoKb} KB)`);
      logAudit({ tabela: "backups", acao: "Criou snapshot storage", detalhes: { path: data.path, tamanho: data.tamanho_bytes } });
      await carregarBackups();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      console.error("[backup storage]", e);
      toast.error(msg, { duration: 8000 });
    } finally {
      setSalvandoStorage(false);
    }
  };

  const handleDownloadStorage = async (path: string) => {
    try {
      const { data, error } = await supabase.storage.from("backups").download(path);
      if (error) throw error;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(data);
      link.download = path.replace("/", "-");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast.success("Download iniciado");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro";
      toast.error(`Falha: ${msg}`);
    }
  };

  const handleDeleteStorage = async (path: string) => {
    try {
      const { error } = await supabase.storage.from("backups").remove([path]);
      if (error) throw error;
      toast.success("Snapshot removido");
      logAudit({ tabela: "backups", acao: "Removeu snapshot", detalhes: { path } });
      await carregarBackups();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro";
      toast.error(`Falha: ${msg}`);
    }
  };

  const fmtTamanho = (b: number | null) => {
    if (!b) return "—";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* ===== AÇÕES ===== */}
      <Card className="shadow-card p-6">
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-success mt-0.5" />
          <div>
            <h3 className="font-heading font-semibold">Backup do Sistema</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Snapshot JSON com TODAS as tabelas críticas: empresas, ações, elegibilidade,
              prospecções, propostas, tarefas, reuniões, perfis e templates. Use antes de
              mudanças em massa ou periodicamente como cópia de segurança extra.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Button
            onClick={handleBaixarLocal}
            disabled={baixandoLocal}
            variant="default"
            className="h-auto py-3 flex-col items-start gap-1"
          >
            <div className="flex items-center gap-2 w-full">
              {baixandoLocal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="font-medium">Baixar agora (local)</span>
            </div>
            <span className="text-[10px] font-normal opacity-80 text-left">
              Gera o JSON e baixa direto pro seu computador. Guarde no Drive/Dropbox.
            </span>
          </Button>

          <Button
            onClick={handleSalvarStorage}
            disabled={salvandoStorage}
            variant="outline"
            className="h-auto py-3 flex-col items-start gap-1"
          >
            <div className="flex items-center gap-2 w-full">
              {salvandoStorage ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
              <span className="font-medium">Salvar snapshot (Storage)</span>
            </div>
            <span className="text-[10px] font-normal opacity-80 text-left">
              Salva no bucket do Supabase. Visível abaixo. Retenção: 90 dias.
            </span>
          </Button>
        </div>

        <div className="mt-4 p-3 rounded-md border border-info/30 bg-info/5 text-xs space-y-1">
          <p className="font-medium text-info">Camadas de proteção em vigor</p>
          <ul className="text-muted-foreground space-y-0.5 list-disc list-inside ml-1">
            <li><strong>Supabase backup automático diário</strong> (retenção 7 dias) — gerenciado pela infra. Restauração via dashboard Supabase → Database → Backups.</li>
            <li><strong>Backup manual local</strong> (botão acima) — sob demanda, antes de mudanças grandes.</li>
            <li><strong>Snapshot no Storage</strong> (botão acima) — pra ter histórico sem ocupar espaço local.</li>
            <li><strong>Backup automático semanal</strong> — opcional, configurar via pg_cron no SQL Editor (instruções abaixo).</li>
          </ul>
        </div>
      </Card>

      {/* ===== LISTA DE SNAPSHOTS ===== */}
      <Card className="shadow-card p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-heading font-semibold flex items-center gap-2">
              <FileJson className="h-4 w-4 text-muted-foreground" />
              Snapshots no Storage
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Backups salvos no bucket. Retenção automática de 90 dias.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={carregarBackups} disabled={loading} className="h-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
        ) : arquivos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum snapshot salvo ainda. Use o botão "Salvar snapshot" acima.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {arquivos.map((a) => (
              <div
                key={a.path}
                className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-border hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs truncate">{a.path}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtTamanho(a.tamanho)}</span>
                  </div>
                  {a.criado_em && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Criado em {new Date(a.criado_em).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleDownloadStorage(a.path)}
                    title="Baixar"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Excluir">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir snapshot?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Vai remover permanentemente <strong>{a.path}</strong>. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteStorage(a.path)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===== INSTRUÇÃO CRON ===== */}
      <Card className="shadow-card p-6">
        <h3 className="font-heading font-semibold text-sm mb-2">Backup automático semanal (opcional)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Pra rodar backup automático todo domingo às 3h da manhã, copie e cole no
          Supabase SQL Editor (uma única vez):
        </p>
        <pre className="text-[10px] bg-muted/40 border border-border rounded p-3 overflow-x-auto font-mono leading-relaxed">
{`-- Habilita extensões (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Job semanal: domingo 03:00 UTC (00:00 BRT). Ajuste se quiser outro horário.
SELECT cron.schedule(
  'backup-semanal',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<SEU-PROJETO>.supabase.co/functions/v1/backup-completo?mode=storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUA-SERVICE-ROLE-KEY>'
    ),
    body := jsonb_build_object('motivo', 'cron-semanal')
  );
  $$
);`}
        </pre>
        <p className="text-[10px] text-muted-foreground mt-2">
          Substitua <code>&lt;SEU-PROJETO&gt;</code> pelo subdomínio do projeto Supabase
          e <code>&lt;SUA-SERVICE-ROLE-KEY&gt;</code> pela service-role key (Settings → API).
          A retenção de 90 dias é aplicada automaticamente em cada execução.
        </p>
      </Card>
    </div>
  );
}
