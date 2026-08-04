import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AuditRow {
  id: string;
  user_id: string | null;
  tabela: string | null;
  acao: string | null;
  registro_id: string | null;
  detalhes: unknown;
  created_at: string;
}

// verbo -> cor do badge (destaca ações destrutivas)
function acaoColor(acao: string): string {
  const a = acao.toLowerCase();
  if (/remov|delet|exclu|apag/.test(a))
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (/criou|inser|adicion/.test(a)) return "border-success/30 bg-success/10 text-success";
  if (/edit|atualiz|alter/.test(a)) return "border-info/30 bg-info/10 text-info";
  if (/export|baix/.test(a)) return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-muted text-muted-foreground";
}

/** Visualizador do log de auditoria (audit_logs) — admin/gestor. Mostra QUEM fez
 *  O QUE e QUANDO. Read-only. Cobre a lacuna: o log era gravado mas não tinha UI. */
export function AuditLogViewer() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nomePorId, setNomePorId] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const carregar = async () => {
    setLoading(true);
    try {
      const [{ data: logs, error }, { data: profs }] = await Promise.all([
        supabase
          .from("audit_logs")
          .select("id, user_id, tabela, acao, registro_id, detalhes, created_at")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("profiles").select("id, nome, email"),
      ]);
      if (error) throw error;
      setRows((logs ?? []) as AuditRow[]);
      setNomePorId(new Map((profs ?? []).map((p) => [p.id, p.nome || p.email || "—"])));
    } catch (e) {
      toast.error("Erro ao carregar auditoria: " + (e instanceof Error ? e.message : "erro"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void carregar();
  }, []);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => {
      const quem = (r.user_id ? nomePorId.get(r.user_id) : "") || "";
      return (
        (r.acao || "").toLowerCase().includes(t) ||
        (r.tabela || "").toLowerCase().includes(t) ||
        quem.toLowerCase().includes(t)
      );
    });
  }, [rows, q, nomePorId]);

  const fmtVal = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v as string | number | boolean);
  };
  const resumoDetalhes = (d: unknown): string => {
    if (!d || typeof d !== "object") return "";
    return Object.entries(d as Record<string, unknown>)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${fmtVal(v)}`)
      .join(" · ")
      .slice(0, 140);
  };

  return (
    <Card className="p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-heading font-semibold">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Auditoria — quem fez o quê
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Últimas 200 ações registradas no sistema (criação, edição, exclusão, exportação).
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => void carregar()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Atualizar</span>
        </Button>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por ação, tabela ou pessoa…"
          className="h-9 pl-8"
        />
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "Nenhum registro de auditoria." : "Nada bate com o filtro."}
        </p>
      ) : (
        <div className="max-h-[32rem] space-y-1.5 overflow-y-auto">
          {filtradas.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-2.5 text-xs hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] ${acaoColor(r.acao || "")}`}>
                    {r.acao || "—"}
                  </Badge>
                  {r.tabela && (
                    <span className="font-mono text-[10px] text-muted-foreground">{r.tabela}</span>
                  )}
                </div>
                {!!resumoDetalhes(r.detalhes) && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {resumoDetalhes(r.detalhes)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium">
                  {r.user_id ? (nomePorId.get(r.user_id) ?? "—") : "sistema"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
