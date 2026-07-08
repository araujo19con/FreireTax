import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Contact, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Buckets vindos de v_empresa_contato_qualidade (via v_enriquecimento_resumo).
// Ordem do melhor pro pior — dita a ordem visual e as cores.
const BUCKETS: { key: string; label: string; bar: string; text: string }[] = [
  { key: "otimo",       label: "Ótimo (decisor + e-mail + LinkedIn)", bar: "bg-success",     text: "text-success" },
  { key: "bom",         label: "Bom (canais suficientes)",            bar: "bg-info",        text: "text-info" },
  { key: "fraco",       label: "Fraco (contato incompleto)",          bar: "bg-warning",     text: "text-warning" },
  { key: "sem_contato", label: "Sem contato",                         bar: "bg-destructive", text: "text-destructive" },
];

interface ResumoRow {
  bucket: string;
  empresas: number;
}

export function ContatoCoberturaCard() {
  const [rows, setRows] = useState<ResumoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await (supabase.from("v_enriquecimento_resumo" as any).select("*")) as any;
      setRows(
        ((data as ResumoRow[]) ?? []).map((r) => ({
          bucket: r.bucket,
          empresas: Number(r.empresas) || 0,
        }))
      );
      setLoading(false);
    };
    load();
  }, []);

  const byBucket = useMemo(() => new Map(rows.map((r) => [r.bucket, r.empresas])), [rows]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.empresas, 0), [rows]);
  const prontas = (byBucket.get("otimo") ?? 0) + (byBucket.get("bom") ?? 0);
  const pctProntas = total > 0 ? (prontas / total) * 100 : 0;
  const maxBucket = Math.max(1, ...BUCKETS.map((b) => byBucket.get(b.key) ?? 0));

  if (loading) {
    return (
      <Card className="p-6 shadow-card">
        <div className="space-y-3">
          <Skeleton className="h-5 w-56" />
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 shadow-card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-h2 font-semibold">
            <Contact className="h-5 w-5 text-primary" />
            Cobertura de Contatos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Qualidade dos contatos por empresa. O enriquecimento automático sobe quem está fraco/sem contato.
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" />
            Prontas p/ prospecção
          </p>
          <p className="font-heading text-2xl font-bold tabular-nums text-success">
            {pctProntas.toFixed(0)}%
          </p>
          <p className="text-[10px] text-muted-foreground">
            {prontas} de {total} empresas
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {BUCKETS.map((b) => {
          const qtd = byBucket.get(b.key) ?? 0;
          const width = Math.max(4, (qtd / maxBucket) * 100);
          return (
            <div key={b.key} className="flex items-center gap-3">
              <span className="min-w-[210px] text-xs font-medium">{b.label}</span>
              <div className="flex flex-1 items-center gap-2">
                <div
                  className={`h-6 rounded-md ${b.bar} transition-all`}
                  style={{ width: `${width}%`, minWidth: "24px" }}
                />
                <span className={`text-sm font-semibold tabular-nums ${b.text}`}>{qtd}</span>
              </div>
            </div>
          );
        })}
      </div>

      {total === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Sem empresas ainda. Assim que houver base, a cobertura aparece aqui.
        </p>
      )}
    </Card>
  );
}
