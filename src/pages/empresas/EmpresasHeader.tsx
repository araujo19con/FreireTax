import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Sparkles, DollarSign, Gavel } from "lucide-react";
import { useEmpresasKpi } from "@/hooks/useEmpresas";
import { formatCompactCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "default" | "success" | "warning" | "info";
}

function KpiCard({ label, value, sub, icon, accent = "default" }: KpiCardProps) {
  return (
    <Card className="p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-2xl font-heading mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div
          className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
            accent === "success" && "bg-success/10 text-success",
            accent === "warning" && "bg-warning/10 text-warning",
            accent === "info" && "bg-info/10 text-info",
            accent === "default" && "bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

export function EmpresasHeader() {
  const { data, isLoading } = useEmpresasKpi();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4 shadow-card">
            <Skeleton className="h-4 w-20 mb-3" />
            <Skeleton className="h-7 w-24" />
          </Card>
        ))}
      </div>
    );
  }

  const { total, byStatus, enriched, withError, valorPotencial, comAcao } = data;
  const pctEnriched = total > 0 ? Math.round((enriched / total) * 100) : 0;
  const missingEnrichment = total - enriched;
  const pctComAcao = total > 0 ? Math.round((comAcao / total) * 100) : 0;
  const subStatus = [
    byStatus.prospect ? `${byStatus.prospect} prospect` : null,
    byStatus.cliente ? `${byStatus.cliente} cliente` : null,
    byStatus.inativo ? `${byStatus.inativo} inativo` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard
        label="Total de empresas"
        value={formatNumber(total)}
        sub={subStatus || "Nenhuma cadastrada"}
        icon={<Building2 className="h-5 w-5" />}
      />
      <KpiCard
        label="Enriquecidas RFB"
        value={`${pctEnriched}%`}
        sub={
          withError
            ? `${missingEnrichment} faltando · ${withError} com erro`
            : `${missingEnrichment} ${missingEnrichment === 1 ? "precisa" : "precisam"} de enrichment`
        }
        icon={<Sparkles className="h-5 w-5" />}
        accent={withError > 0 ? "warning" : "info"}
      />
      <KpiCard
        label="Valor potencial"
        value={formatCompactCurrency(valorPotencial)}
        sub="Soma de todas as empresas"
        icon={<DollarSign className="h-5 w-5" />}
        accent="success"
      />
      <KpiCard
        label="Com ação vinculada"
        value={`${formatNumber(comAcao)} (${pctComAcao}%)`}
        sub="Têm ≥ 1 elegibilidade registrada"
        icon={<Gavel className="h-5 w-5" />}
      />
    </div>
  );
}
