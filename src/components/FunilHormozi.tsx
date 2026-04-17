import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, ArrowDown, AlertCircle, Users, Handshake, CheckCircle2, XCircle, Send, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Ordem canônica do funil (do topo pro fundo)
const STAGES: { key: string; label: string; icon: typeof Users; color: string; dot: string }[] = [
  { key: "Não iniciado",      label: "Não Iniciado",      icon: Users,         color: "text-muted-foreground", dot: "bg-muted-foreground" },
  { key: "Contato feito",     label: "Contato Feito",     icon: MessageSquare, color: "text-info",             dot: "bg-info" },
  { key: "Proposta enviada",  label: "Proposta Enviada",  icon: Send,          color: "text-warning",          dot: "bg-warning" },
  { key: "Em negociação",     label: "Em Negociação",     icon: Handshake,     color: "text-primary",          dot: "bg-primary" },
  { key: "Contrato assinado", label: "Contrato Assinado", icon: CheckCircle2,  color: "text-success",          dot: "bg-success" },
];

const LOST_KEY = "Perdido";

interface FunilRow {
  etapa: string;
  qtd: number;
  valor_contrato_total: number;
  dias_medios_na_etapa: number;
}

interface ValorPotencialRow {
  etapa: string;
  qtd: number;
  valor_potencial_total: number;
}

function formatCompact(n: number): string {
  if (!n) return "R$ 0";
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

export function FunilHormozi() {
  const [funil, setFunil] = useState<FunilRow[]>([]);
  const [valorPot, setValorPot] = useState<ValorPotencialRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: f }, { data: v }] = await Promise.all([
        (supabase.from("v_funil_conversao" as any).select("*")) as any,
        (supabase.from("v_funil_valor_potencial" as any).select("*")) as any,
      ]);
      setFunil((f as FunilRow[]) ?? []);
      setValorPot((v as ValorPotencialRow[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const byStage = useMemo(() => new Map(funil.map((r) => [r.etapa, r])), [funil]);
  const valorByStage = useMemo(() => new Map(valorPot.map((r) => [r.etapa, r])), [valorPot]);

  // Totais
  const totalAtivos = STAGES.reduce((s, st) => s + (byStage.get(st.key)?.qtd ?? 0), 0);
  const totalPerdidos = byStage.get(LOST_KEY)?.qtd ?? 0;
  const totalGeral = totalAtivos + totalPerdidos;

  // Taxa de conversão total: Não iniciado → Contrato assinado
  const iniciados = byStage.get(STAGES[0].key)?.qtd ?? 0;
  const fechados = byStage.get("Contrato assinado")?.qtd ?? 0;
  // Close rate sobre quem SAIU do "Não iniciado" (teve algum toque):
  const trabalhados = totalAtivos - iniciados + fechados; // todos menos os não iniciados
  const closeRate = totalGeral > 0
    ? ((fechados / Math.max(1, totalGeral)) * 100)
    : 0;
  const closeRateTrabalhado = trabalhados > 0
    ? ((fechados / trabalhados) * 100)
    : 0;

  if (loading) {
    return (
      <Card className="p-6 shadow-card">
        <div className="space-y-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-48" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 shadow-card">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-h2 font-heading font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Funil Hormozi — Conversão por Etapa
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Onde o pipeline está travando. Taxa de conversão entre cada etapa.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Close rate geral</p>
            <p className="text-2xl font-heading font-bold tabular-nums">{closeRate.toFixed(1)}%</p>
          </div>
          <div className="text-right pl-3 border-l border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Close rate trabalhado</p>
            <p className="text-2xl font-heading font-bold tabular-nums text-primary">{closeRateTrabalhado.toFixed(1)}%</p>
            <p className="text-[10px] text-muted-foreground">(exc. não iniciados)</p>
          </div>
        </div>
      </div>

      {/* Funil linear */}
      <div className="space-y-2">
        {STAGES.map((stage, idx) => {
          const row = byStage.get(stage.key);
          const qtd = row?.qtd ?? 0;
          const vp = valorByStage.get(stage.key)?.valor_potencial_total ?? 0;
          const dias = row?.dias_medios_na_etapa ?? 0;

          // Taxa de conversão pra próxima etapa (ou pra fechamento)
          const nextStage = STAGES[idx + 1];
          const qtdNext = nextStage ? (byStage.get(nextStage.key)?.qtd ?? 0) : 0;
          const conversion = qtd > 0 && nextStage
            ? ((qtdNext + (idx + 1 < STAGES.length - 1 ? 0 : 0)) / qtd) * 100
            : null;

          // Largura proporcional (visual funil)
          const maxQtd = Math.max(1, ...STAGES.map((s) => byStage.get(s.key)?.qtd ?? 0));
          const width = Math.max(10, (qtd / maxQtd) * 100);

          const Icon = stage.icon;

          return (
            <div key={stage.key}>
              <div className="flex items-stretch gap-3">
                {/* Ícone + nome */}
                <div className="flex items-center gap-2 min-w-[180px]">
                  <div className={`h-8 w-8 rounded-md bg-muted flex items-center justify-center ${stage.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium">{stage.label}</span>
                </div>

                {/* Barra visual do funil */}
                <div className="flex-1 flex items-center">
                  <div
                    className={`h-10 rounded-md ${stage.dot} transition-all flex items-center px-3 text-sm font-semibold text-white shadow-card`}
                    style={{ width: `${width}%`, minWidth: "90px" }}
                  >
                    <span className="tabular-nums">{qtd}</span>
                  </div>
                </div>

                {/* Métricas à direita */}
                <div className="flex items-center gap-4 min-w-[220px] justify-end">
                  {vp > 0 && (
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor pot.</p>
                      <p className="text-xs font-semibold tabular-nums text-primary">{formatCompact(vp)}</p>
                    </div>
                  )}
                  {dias > 0 && (
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dias médios</p>
                      <p className="text-xs font-semibold tabular-nums">{dias.toFixed(1)}d</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Conversão para próxima etapa */}
              {nextStage && qtd > 0 && (
                <div className="flex items-center gap-2 pl-[52px] mt-1 mb-2">
                  <ArrowDown className={`h-3 w-3 ${
                    conversion! < 30 ? "text-destructive" : conversion! < 60 ? "text-warning" : "text-success"
                  }`} />
                  <span className={`text-[10px] ${
                    conversion! < 30 ? "text-destructive" : conversion! < 60 ? "text-warning" : "text-success"
                  }`}>
                    {qtdNext}/{qtd} avançaram — <span className="font-semibold">{conversion!.toFixed(0)}%</span> de conversão
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {/* Perdidos (saída lateral do funil) */}
        {totalPerdidos > 0 && (
          <div className="mt-4 pt-4 border-t border-dashed border-border">
            <div className="flex items-stretch gap-3">
              <div className="flex items-center gap-2 min-w-[180px]">
                <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center text-destructive">
                  <XCircle className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-destructive">Perdidos</span>
              </div>
              <div className="flex-1 flex items-center">
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 tabular-nums">
                  {totalPerdidos} — {((totalPerdidos / Math.max(1, totalGeral)) * 100).toFixed(0)}% do total
                </Badge>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Insights Hormozi */}
      <div className="mt-5 pt-5 border-t border-border">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5 text-warning" />
          Diagnóstico Hormozi
        </h3>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          {(() => {
            const insights: string[] = [];
            const iniciadosQtd = byStage.get("Não iniciado")?.qtd ?? 0;
            const contatosQtd = byStage.get("Contato feito")?.qtd ?? 0;
            const propostasQtd = byStage.get("Proposta enviada")?.qtd ?? 0;
            const negocQtd = byStage.get("Em negociação")?.qtd ?? 0;
            const fechadosQtd = byStage.get("Contrato assinado")?.qtd ?? 0;

            if (iniciadosQtd > totalAtivos * 0.3) {
              insights.push(`⚠ ${iniciadosQtd} prospecções (${((iniciadosQtd / Math.max(1, totalAtivos)) * 100).toFixed(0)}%) estão em "Não iniciado" — time precisa começar os toques. Cadência dorme dinheiro.`);
            }
            if (contatosQtd > 0 && propostasQtd / Math.max(1, contatosQtd) < 0.5) {
              insights.push(`⚠ Só ${((propostasQtd / Math.max(1, contatosQtd)) * 100).toFixed(0)}% dos contatos avançam pra proposta. Mensagem não está causando desejo — revisar abordagem/template de abertura.`);
            }
            if (propostasQtd > 0 && negocQtd / Math.max(1, propostasQtd) < 0.4) {
              insights.push(`⚠ Só ${((negocQtd / Math.max(1, propostasQtd)) * 100).toFixed(0)}% das propostas viram negociação. Oferta pode estar fraca ou preço mal apresentado. Verifique objeções categorizadas nos perdidos.`);
            }
            if (negocQtd > 0 && fechadosQtd / Math.max(1, negocQtd) < 0.5) {
              insights.push(`⚠ Close em negociação: ${((fechadosQtd / Math.max(1, negocQtd)) * 100).toFixed(0)}%. Preciso olhar o CLOSER — decisor confirmado? Dor identificada? Valor emocional articulado?`);
            }
            if (totalPerdidos > fechadosQtd) {
              insights.push(`🔴 Mais negócios perdidos (${totalPerdidos}) do que fechados (${fechadosQtd}). Revisar motivos de perda categorizados — padrão pode indicar oferta-commodity.`);
            }
            if (closeRateTrabalhado > 30) {
              insights.push(`✓ Close rate trabalhado de ${closeRateTrabalhado.toFixed(1)}% é SÓLIDO. Foco agora é ALIMENTAR o topo do funil.`);
            }
            if (!insights.length) {
              insights.push("Funil saudável e balanceado. Continue medindo semana a semana.");
            }
            return insights.map((s, i) => <p key={i}>{s}</p>);
          })()}
        </div>
      </div>
    </Card>
  );
}
