import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Shield, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface AuditLog {
  id: string;
  tabela: string;
  acao: string;
  detalhes: Record<string, unknown>;
  created_at: string;
}

const acaoColors: Record<string, string> = {
  criou: "bg-success/10 text-success",
  editou: "bg-info/10 text-info",
  removeu: "bg-destructive/10 text-destructive",
  adicionou: "bg-primary/10 text-primary",
};

function getAcaoColor(acao: string) {
  const key = Object.keys(acaoColors).find((k) => acao.toLowerCase().includes(k));
  return key ? acaoColors[key] : "bg-muted text-muted-foreground";
}

export default function Auditoria() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200) as { data: AuditLog[] | null };
      setLogs(data || []);
      setLoading(false);
    };
    fetchLogs();
  }, []);

  const filtered = logs.filter(
    (l) =>
      l.acao.toLowerCase().includes(search.toLowerCase()) ||
      l.tabela.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(l.detalhes).toLowerCase().includes(search.toLowerCase())
  );

  const formatDetail = (detalhes: Record<string, unknown>) => {
    const parts: string[] = [];
    if (detalhes.nome) parts.push(String(detalhes.nome));
    if (detalhes.empresa) parts.push(String(detalhes.empresa));
    if (detalhes.acao_nome) parts.push(`Ação: ${detalhes.acao_nome}`);
    if (detalhes.pasta) parts.push(`Pasta: ${detalhes.pasta}`);
    if (detalhes.quantidade) parts.push(`${detalhes.quantidade} itens`);
    if (parts.length === 0) return "—";
    return parts.join(" · ");
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-heading font-bold tracking-tight">Auditoria</h1>
          <p className="text-muted-foreground mt-1">Log completo de alterações do sistema</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar nos logs..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card className="shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Data/Hora</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Tabela</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Ação</th>
                <th className="text-left py-3 px-4 font-medium text-muted-foreground">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">
                  {logs.length === 0 ? "Nenhum log registrado ainda." : "Nenhum resultado encontrado."}
                </td></tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {format(new Date(l.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant="outline" className="text-[10px] capitalize">{l.tabela}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getAcaoColor(l.acao)}`}>
                      {l.acao}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground max-w-[300px] truncate">
                    {formatDetail(l.detalhes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
