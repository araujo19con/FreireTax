import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Printer, Gavel, Lightbulb, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCNPJ } from "@/lib/format";
import { getRegimeEffective, humanizeRegime, REGIMES_TRIBUTARIOS } from "@/lib/regimeTributario";
import { ESCRITORIO_DEFAULT } from "@/lib/proposta";
import { renderRelatorioTesesHTML, type RelatorioEmpresa } from "./relatorioTesesPrint";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  empresaIds: string[];
}

/** Regra de regime de cada tese: critério `select` cujas opções são os regimes.
 *  `excludeOptions` lista os regimes que DESQUALIFICAM — é assim que sabemos
 *  a que a empresa "tem direito" sem inventar heurística. */
interface RegraRegime {
  acao_id: string;
  exclui: string[];
}

export function RelatorioTesesDialog({ open, onOpenChange, empresaIds }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["relatorio-teses", empresaIds.join(",")],
    enabled: open && empresaIds.length > 0,
    queryFn: async () => {
      const [empRes, procRes, catRes, critRes] = await Promise.all([
        supabase
          .from("empresas")
          .select(
            "id, nome, razao_social, cnpj, uf, municipio, regime_tributario, opcao_simples, opcao_mei"
          )
          .in("id", empresaIds),
        supabase
          .from("empresa_processos_tributarios")
          .select(
            "empresa_id, numero, grau, classe, orgao, acao_id, metadados, acoes_tributarias(nome)"
          )
          .in("empresa_id", empresaIds),
        supabase.from("acoes_tributarias").select("id, nome").eq("status", "Ativa").order("nome"),
        supabase
          .from("criterios_elegibilidade")
          .select("acao_id, tipo_resposta, opcoes, regra_excludente")
          .eq("tipo_resposta", "select"),
      ]);
      return {
        empresas: (empRes.data || []) as unknown as Array<Record<string, unknown>>,
        proc: (procRes.data || []) as unknown as Array<Record<string, unknown>>,
        catalogo: (catRes.data || []) as unknown as Array<{ id: string; nome: string }>,
        criterios: (critRes.data || []) as unknown as Array<Record<string, unknown>>,
      };
    },
  });

  const relatorio: RelatorioEmpresa[] = useMemo(() => {
    if (!data) return [];
    const LABELS = new Set(REGIMES_TRIBUTARIOS.map((r) => r.label));
    // só critérios de REGIME (select cujas opções são os regimes conhecidos)
    const regras: RegraRegime[] = data.criterios
      .map((c) => {
        const opts = (c.opcoes as string[] | null) || [];
        const regra = c.regra_excludente as { tipo?: string; excludeOptions?: string[] } | null;
        if (!opts.length || !opts.every((o) => LABELS.has(o))) return null;
        return { acao_id: c.acao_id as string, exclui: regra?.excludeOptions || [] };
      })
      .filter((v): v is RegraRegime => !!v);

    return data.empresas.map((e) => {
      const id = e.id as string;
      const regime = getRegimeEffective(e as never);
      const regimeLabel = regime
        ? (REGIMES_TRIBUTARIOS.find((r) => r.value === regime)?.label ?? null)
        : null;

      const meus = data.proc.filter((p) => p.empresa_id === id);
      const jaAjuizadas = meus
        .filter((p) => p.acao_id)
        .map((p) => ({
          tese: ((p.acoes_tributarias as { nome: string } | null)?.nome || "").trim(),
          numero: p.numero as string,
          grau: (p.grau as string) || "",
          orgao: (p.orgao as string) || "",
        }));
      const sugeridas = meus
        .filter(
          (p) => !p.acao_id && (p.metadados as { tese_sugerida?: string } | null)?.tese_sugerida
        )
        .map((p) => ({
          tese: ((p.metadados as { tese_sugerida?: string }).tese_sugerida || "").trim(),
          numero: p.numero as string,
        }));

      const jaIds = new Set(meus.filter((p) => p.acao_id).map((p) => p.acao_id as string));
      const podeEntrar = data.catalogo
        .filter((a) => !jaIds.has(a.id))
        .filter((a) => {
          // sem regime conhecido -> não dá pra excluir; mostra e sinaliza
          if (!regimeLabel) return true;
          const r = regras.find((x) => x.acao_id === a.id);
          return !r || !r.exclui.includes(regimeLabel);
        })
        .map((a) => a.nome.trim());

      return {
        nome: ((e.razao_social as string) || (e.nome as string) || "").trim(),
        cnpj: e.cnpj ? formatCNPJ(e.cnpj as string) : "—",
        uf: (e.uf as string) || "",
        municipio: (e.municipio as string) || "",
        regime: humanizeRegime(regime),
        regimeConhecido: !!regimeLabel,
        jaAjuizadas,
        sugeridas,
        podeEntrar,
      };
    });
  }, [data]);

  const gerarPDF = () => {
    const html = renderRelatorioTesesHTML(relatorio, ESCRITORIO_DEFAULT);
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Relatório de teses — {empresaIds.length} empresa(s)
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-4">
                {relatorio.map((r) => (
                  <div key={r.cnpj + r.nome} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.cnpj}
                          {r.uf ? ` · ${r.municipio ? r.municipio + "/" : ""}${r.uf}` : ""} ·{" "}
                          {r.regime}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Badge
                          variant="outline"
                          className="border-success/30 bg-success/10 text-success"
                        >
                          {r.jaAjuizadas.length} ajuizada(s)
                        </Badge>
                        <Badge variant="outline">{r.podeEntrar.length} a oferecer</Badge>
                      </div>
                    </div>

                    {r.jaAjuizadas.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {r.jaAjuizadas.map((t) => (
                          <p key={t.numero} className="flex items-start gap-1 text-[11px]">
                            <Gavel className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                            <span>
                              <span className="font-medium">{t.tese}</span>{" "}
                              <span className="font-mono text-muted-foreground">({t.numero})</span>
                            </span>
                          </p>
                        ))}
                      </div>
                    )}

                    {r.sugeridas.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {r.sugeridas.map((t) => (
                          <p
                            key={t.numero}
                            className="flex items-start gap-1 text-[11px] text-warning"
                          >
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>
                              {t.tese} <span className="font-mono opacity-70">({t.numero})</span> —
                              a confirmar
                            </span>
                          </p>
                        ))}
                      </div>
                    )}

                    {r.podeEntrar.length > 0 && (
                      <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
                        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                        <span>{r.podeEntrar.join(" · ")}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button onClick={gerarPDF} disabled={relatorio.length === 0}>
                <Printer className="mr-2 h-4 w-4" />
                Gerar PDF
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
