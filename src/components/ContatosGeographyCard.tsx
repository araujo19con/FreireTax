import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2 } from "lucide-react";

type CoverageByUf = {
  uf: string;
  totalEmpresas: number;
  empresasComContato: number;
  pctCobertura: number;
  totalContatos: number;
};

export function ContatosGeographyCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["contatos-geography"],
    queryFn: async () => {
      // Agrupa por UF: contatos, empresas totais, empresas com contato
      const { data: rows, error } = await supabase
        .from("empresa_contatos")
        .select("empresas!inner(uf), id", { head: false });

      if (error) throw error;

      const byUf: Record<string, { empresasSet: Set<string>; count: number }> = {};
      (rows ?? []).forEach((row: { empresas: { id: string; uf: string } | null }) => {
        const uf = row.empresas?.uf;
        if (uf) {
          if (!byUf[uf]) {
            byUf[uf] = { empresasSet: new Set(), count: 0 };
          }
          byUf[uf].empresasSet.add(row.empresas.id);
          byUf[uf].count++;
        }
      });

      // Total de empresas por UF (sem filtro de contato)
      const { data: allEmpresas } = await supabase
        .from("empresas")
        .select("id, uf", { head: false });

      const totalByUf: Record<string, number> = {};
      (allEmpresas ?? []).forEach((row: { id: string; uf: string | null }) => {
        const uf = row.uf;
        if (uf) {
          totalByUf[uf] = (totalByUf[uf] ?? 0) + 1;
        }
      });

      // Mount coverage stats
      const coverage: CoverageByUf[] = Object.entries(totalByUf)
        .map(([uf, total]) => {
          const withContact = byUf[uf]?.empresasSet.size ?? 0;
          return {
            uf,
            totalEmpresas: total,
            empresasComContato: withContact,
            pctCobertura: total > 0 ? Math.round((withContact / total) * 100) : 0,
            totalContatos: byUf[uf]?.count ?? 0,
          };
        })
        .sort((a, b) => b.pctCobertura - a.pctCobertura);

      return coverage;
    },
    staleTime: 10 * 60 * 1000, // 10 min
  });

  if (isLoading || !data) {
    return (
      <Card className="flex items-center justify-center p-6 shadow-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">
          Carregando cobertura geográfica...
        </span>
      </Card>
    );
  }

  const topUfs = data.slice(0, 10);
  const lowCoverageUfs = data.filter((uf) => uf.pctCobertura < 50).slice(0, 5);

  return (
    <Card className="space-y-4 p-4 shadow-card">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Cobertura por UF</h3>
      </div>

      {/* Top cobertura */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Melhor cobertura (top 5)</div>
        <div className="space-y-1">
          {topUfs.slice(0, 5).map((uf) => (
            <div
              key={uf.uf}
              className="flex items-center justify-between gap-2 rounded bg-muted/50 p-2"
            >
              <div className="flex items-center gap-2">
                <span className="w-12 font-mono text-sm font-semibold">{uf.uf}</span>
                <div className="text-[11px] text-muted-foreground">
                  {uf.empresasComContato}/{uf.totalEmpresas} empresas
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-green-600">{uf.pctCobertura}%</div>
                <div className="text-[10px] text-muted-foreground">{uf.totalContatos} contatos</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerta: baixa cobertura */}
      {lowCoverageUfs.length > 0 && (
        <div className="space-y-2 border-t pt-2">
          <div className="text-xs font-medium text-orange-600">
            ⚠️ Baixa cobertura (&lt;50%) — priorizar DRIVA
          </div>
          <div className="flex flex-wrap gap-1">
            {lowCoverageUfs.map((uf) => (
              <Badge key={uf.uf} variant="outline" className="text-[10px] text-orange-600">
                {uf.uf}: {uf.pctCobertura}% ({uf.empresasComContato}/{uf.totalEmpresas})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Sumário */}
      <div className="border-t pt-2 text-[10px] text-muted-foreground">
        <div>
          {data.length} UF{data.length === 1 ? "" : "s"} | Média de cobertura:{" "}
          <span className="font-semibold">
            {Math.round(
              (data.reduce((sum, uf) => sum + uf.empresasComContato, 0) /
                data.reduce((sum, uf) => sum + uf.totalEmpresas, 0)) *
                100
            )}
          </span>
          %
        </div>
      </div>
    </Card>
  );
}
