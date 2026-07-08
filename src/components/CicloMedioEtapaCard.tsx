import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Ordem canônica do funil — mesma do FunilHormozi. Só mostramos etapas de
// trânsito (o histórico registra a saída da etapa; "Contrato assinado"/"Perdido"
// são terminais e não têm "dias até avançar").
const ETAPAS: { key: string; label: string }[] = [
  { key: "Contato feito",    label: "Contato Feito" },
  { key: "Proposta enviada", label: "Proposta Enviada" },
  { key: "Em negociação",    label: "Em Negociação" },
];

interface CicloRow {
  etapa: string;
  transicoes: number;
  dias_medios_na_etapa: number | null;
}

export function CicloMedioEtapaCard() {
  const [rows, setRows] = useState<CicloRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await (supabase.from("v_ciclo_medio_etapa" as any).select("*")) as any;
      setRows(
        ((data as CicloRow[]) ?? []).map((r) => ({
          etapa: r.etapa,
          transicoes: Number(r.transicoes) || 0,
          dias_medios_na_etapa: r.dias_medios_na_etapa == null ? null : Number(r.dias_medios_na_etapa),
        }))
      );
      setLoading(false);
    };
    load();
  }, []);

  const byEtapa = useMemo(() => new Map(rows.map((r) => [r.etapa, r])), [rows]);
  const linhas = ETAPAS.map((e) => ({ ...e, row: byEtapa.get(e.key) }));
  const cicloTotal = linhas.reduce((s, l) => s + (l.row?.dias_medios_na_etapa ?? 0), 0);
  const maxDias = Math.max(1, ...linhas.map((l) => l.row?.dias_medios_na_etapa ?? 0));

  if (loading) {
    return (
      <Card className="p-6 shadow-card">
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  const semDados = linhas.every((l) => !l.row || !l.row.dias_medios_na_etapa);

  return (
    <Card className="p-6 shadow-card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Ciclo Médio por Etapa
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Dias médios que um negócio leva para avançar de cada etapa.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ciclo até negociar</p>
          <p className="font-heading text-2xl font-bold tabular-nums text-primary">
            {cicloTotal.toFixed(1)}<span className="text-sm text-muted-foreground">d</span>
          </p>
        </div>
      </div>

      {semDados ? (
        <p className="text-xs text-muted-foreground">
          Ainda sem transições registradas. Conforme os negócios avançam de etapa, o tempo médio aparece aqui.
        </p>
      ) : (
        <div className="space-y-3">
          {linhas.map((l) => {
            const dias = l.row?.dias_medios_na_etapa ?? 0;
            const n = l.row?.transicoes ?? 0;
            const width = Math.max(4, (dias / maxDias) * 100);
            return (
              <div key={l.key} className="flex items-center gap-3">
                <span className="min-w-[130px] text-xs font-medium">{l.label}</span>
                <div className="flex flex-1 items-center gap-2">
                  <div
                    className="h-6 rounded-md bg-primary/80 transition-all"
                    style={{ width: `${width}%`, minWidth: "24px" }}
                  />
                  <span className="text-sm font-semibold tabular-nums">{dias.toFixed(1)}d</span>
                  <span className="text-[10px] text-muted-foreground">({n})</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
