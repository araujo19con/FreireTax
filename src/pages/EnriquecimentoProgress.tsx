import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, Download, BarChart3 } from "lucide-react";
import { toast } from "sonner";

type StateProgress = {
  uf: string;
  totalSocios: number;
  enrichedPje: number;
  enrichedDriva: number;
  enrichedOther: number;
  totalEnriched: number;
  pctCovered: number;
  pendingCount: number;
};

export default function EnriquecimentoProgress() {
  const { data, isLoading } = useQuery({
    queryKey: ["enrichment-progress"],
    queryFn: async () => {
      // Busca sócios PF por UF + status de enriquecimento
      const { data: rows, error } = await supabase
        .from("empresa_contatos")
        .select("id, papel, empresas!inner(uf), origem, observacoes", { head: false });

      if (error) throw error;

      const byUf: Record<string, StateProgress> = {};

      (rows ?? []).forEach(
        (row: {
          empresas: { uf: string } | null;
          papel: string;
          observacoes?: string;
          origem?: string;
        }) => {
          const uf = row.empresas?.uf;
          if (!uf || row.papel !== "socio") return;

          if (!byUf[uf]) {
            byUf[uf] = {
              uf,
              totalSocios: 0,
              enrichedPje: 0,
              enrichedDriva: 0,
              enrichedOther: 0,
              totalEnriched: 0,
              pctCovered: 0,
              pendingCount: 0,
            };
          }

          byUf[uf].totalSocios++;

          if ((row.observacoes || "").includes("PJe")) {
            byUf[uf].enrichedPje++;
            byUf[uf].totalEnriched++;
          } else if (row.origem === "driva") {
            byUf[uf].enrichedDriva++;
            byUf[uf].totalEnriched++;
          } else if (row.origem && row.origem !== "rfb") {
            byUf[uf].enrichedOther++;
            byUf[uf].totalEnriched++;
          }
        }
      );

      // Calcular stats
      Object.keys(byUf).forEach((uf) => {
        const state = byUf[uf];
        state.pendingCount = state.totalSocios - state.totalEnriched;
        state.pctCovered =
          state.totalSocios > 0 ? Math.round((state.totalEnriched / state.totalSocios) * 100) : 0;
      });

      return Object.values(byUf).sort((a, b) => b.totalSocios - a.totalSocios);
    },
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const exportPendingCsv = () => {
    void (async () => {
      try {
        // Busca todos os sócios pendentes
        const { data: rows, error } = await supabase
          .from("empresa_contatos")
          .select("nome, cpf_mascarado, empresas!inner(uf, nome), papel, email, telefone", {
            head: false,
          })
          .eq("papel", "socio")
          .is("observacoes", null); // Sem enriquecimento

        if (error) throw error;

        const csv =
          "UF,Nome,CPF Mascarado,Empresa,Email,Telefone\n" +
          (rows ?? [])
            .map(
              (r: {
                empresas: { uf: string; nome: string } | null;
                nome: string;
                cpf_mascarado: string;
                email: string;
                telefone: string;
              }) => {
                const uf = r.empresas?.uf || "";
                const nome = r.nome || "";
                const cpf = r.cpf_mascarado || "";
                const empresa = (r.empresas?.nome || "").replace(/,/g, ";");
                const email = r.email || "";
                const tel = r.telefone || "";
                return `${uf},"${nome}","${cpf}","${empresa}",${email},${tel}`;
              }
            )
            .join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `socios_pendentes_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        toast.success(`${rows?.length || 0} sócios pendentes exportados`);
      } catch (e) {
        console.error(e);
        toast.error("Erro ao exportar");
      }
    })();
  };

  if (isLoading || !data) {
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader
          title="Enriquecimento de Sócios"
          description="Progresso e pipeline por estado"
          icon={<BarChart3 className="h-7 w-7" />}
        />
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </Card>
      </div>
    );
  }

  const totalSocios = data.reduce((sum, s) => sum + s.totalSocios, 0);
  const totalEnriched = data.reduce((sum, s) => sum + s.totalEnriched, 0);
  const globalPct = totalSocios > 0 ? Math.round((totalEnriched / totalSocios) * 100) : 0;

  const byOrigin = {
    pje: data.reduce((sum, s) => sum + s.enrichedPje, 0),
    driva: data.reduce((sum, s) => sum + s.enrichedDriva, 0),
    other: data.reduce((sum, s) => sum + s.enrichedOther, 0),
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Enriquecimento de Sócios"
        description="Progresso de CPF+Endereço+Telefone por estado"
        icon={<BarChart3 className="h-7 w-7" />}
      />

      {/* Global stats */}
      <Card className="space-y-4 p-4 shadow-card">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Cobertura Global</div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold">{globalPct}%</div>
              <div className="text-xs text-muted-foreground">
                {totalEnriched} / {totalSocios}
              </div>
            </div>
            <Progress value={globalPct} className="h-2" />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Origem</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{byOrigin.pje} PJe</Badge>
              <Badge variant="secondary">{byOrigin.driva} DRIVA</Badge>
              <Badge variant="secondary">{byOrigin.other} Outro</Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Ações */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={exportPendingCsv} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar Pendentes (CSV)
        </Button>
      </div>

      {/* Por estado */}
      <div className="space-y-3">
        {data.map((state) => (
          <Card key={state.uf} className="space-y-2 p-4 shadow-card">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-bold">{state.uf}</span>
                  <span className="text-xs text-muted-foreground">{state.totalSocios} sócios</span>
                </div>
                <Progress value={state.pctCovered} className="mt-2 h-1.5" />
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">{state.pctCovered}%</div>
                <div className="text-[11px] text-muted-foreground">
                  {state.totalEnriched} / {state.totalSocios}
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
              {state.enrichedPje > 0 && (
                <Badge variant="outline" className="text-blue-600">
                  PJe: {state.enrichedPje}
                </Badge>
              )}
              {state.enrichedDriva > 0 && (
                <Badge variant="outline" className="text-green-600">
                  DRIVA: {state.enrichedDriva}
                </Badge>
              )}
              {state.enrichedOther > 0 && (
                <Badge variant="outline" className="text-orange-600">
                  Outro: {state.enrichedOther}
                </Badge>
              )}
              {state.pendingCount > 0 && (
                <Badge variant="outline" className="text-red-600">
                  Pendente: {state.pendingCount}
                </Badge>
              )}
            </div>

            {/* Recomendação */}
            {state.pctCovered < 50 && (
              <div className="mt-2 text-[10px] text-orange-600">
                ⚠️ Baixa cobertura — priorizar DRIVA ou PJe
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Roadmap */}
      <Card className="space-y-3 bg-muted/30 p-4 shadow-card">
        <div className="text-sm font-semibold">Próximos passos sugeridos</div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            • <strong>RN (7.052)</strong> → Rodar PJe (794/7052, faltam 6.258)
          </li>
          <li>
            • <strong>PR (2.708)</strong> → Testarscrape TJPR (sem Cloudflare)
          </li>
          <li>
            • <strong>RS, SC (4.567)</strong> → Aguardar novo export DRIVA ou API
          </li>
          <li>
            • <strong>PB (988)</strong> → TJPB tem Cloudflare, talvez DRIVA seja mais rápido
          </li>
        </ul>
      </Card>
    </div>
  );
}
