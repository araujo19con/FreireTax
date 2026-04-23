import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileCheck, List, Grid3x3 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { MatrizView } from "./elegibilidade/MatrizView";
import { QualificacaoWizard } from "./elegibilidade/QualificacaoWizard";
import { useAcoes } from "@/hooks/useAcoes";
import { useElegibilidades } from "@/hooks/useElegibilidades";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCompactCurrency, formatDate, formatRelativeDate } from "@/lib/format";

interface EmpresaMin { id: string; nome: string; cnpj: string }
interface AcaoMin { id: string; nome: string; tipo: string }

export default function Elegibilidade() {
  const acoesQ = useAcoes();
  const elegsQ = useElegibilidades();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCtx, setWizardCtx] = useState<{ empresa: EmpresaMin; acao: AcaoMin; elegibilidadeId?: string } | null>(null);

  const handleOpenWizard = (empresa: EmpresaMin, acao: AcaoMin, elegibilidadeId?: string) => {
    setWizardCtx({ empresa, acao, elegibilidadeId });
    setWizardOpen(true);
  };

  // Para a aba "Recentes" — busca últimas 50 qualificações com nomes
  const recentesQ = useQuery({
    queryKey: ["elegibilidade-recentes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("elegibilidade")
        .select(`
          id, empresa_id, acao_id, elegivel, valor_potencial_estimado,
          qualificada_em, status_qualificacao, score_elegibilidade, justificativa,
          empresas(id, nome, cnpj),
          acoes_tributarias(id, nome, tipo)
        `)
        .order("qualificada_em", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as Array<{
        id: string;
        empresa_id: string;
        acao_id: string;
        elegivel: boolean;
        valor_potencial_estimado: number | null;
        qualificada_em: string | null;
        status_qualificacao: string | null;
        score_elegibilidade: number | null;
        justificativa: string | null;
        empresas: EmpresaMin | null;
        acoes_tributarias: AcaoMin | null;
      }>;
    },
  });

  const acoes = acoesQ.data ?? [];
  const elegs = elegsQ.data ?? [];
  const totalQualificadas = elegs.length;
  const totalElegiveis = elegs.filter((e) => e.elegivel).length;
  const valorPotencialTotal = elegs.reduce((s, e) => s + (e.valor_potencial_estimado || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Elegibilidade"
        description="Qualifique empresas para ações tributárias via critérios estruturados. Clique em uma célula da matriz para abrir o wizard."
        icon={<FileCheck className="h-7 w-7" />}
        helpTutorialTab="fluxo"
        helpTooltip="Fluxo: Qualificar elegibilidade"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 shadow-card">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Qualificações</p>
          <p className="text-2xl font-heading mt-1 tabular-nums">{totalQualificadas}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalElegiveis} elegíveis · {totalQualificadas - totalElegiveis} não elegíveis
          </p>
        </Card>
        <Card className="p-4 shadow-card">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Valor potencial total</p>
          <p className="text-2xl font-heading mt-1 tabular-nums">{formatCompactCurrency(valorPotencialTotal)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Soma de todas as elegibilidades positivas</p>
        </Card>
        <Card className="p-4 shadow-card">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Ações com critérios</p>
          <p className="text-2xl font-heading mt-1 tabular-nums">—</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cadastre em <strong>Ações Tributárias → Critérios</strong>
          </p>
        </Card>
      </div>

      <Tabs defaultValue="matriz">
        <TabsList>
          <TabsTrigger value="matriz" className="gap-1.5">
            <Grid3x3 className="h-3.5 w-3.5" />Matriz
          </TabsTrigger>
          <TabsTrigger value="recentes" className="gap-1.5">
            <List className="h-3.5 w-3.5" />Qualificações recentes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="matriz" className="mt-4">
          <MatrizView acoes={acoes} onOpenWizard={handleOpenWizard} />
        </TabsContent>

        <TabsContent value="recentes" className="mt-4">
          <Card className="shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Empresa</th>
                    <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Ação</th>
                    <th className="text-center py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Resultado</th>
                    <th className="text-center py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Score</th>
                    <th className="text-right py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Valor</th>
                    <th className="text-left py-2.5 px-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {recentesQ.isLoading && (
                    <tr><td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Carregando...</td></tr>
                  )}
                  {!recentesQ.isLoading && (recentesQ.data?.length ?? 0) === 0 && (
                    <tr><td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Sem qualificações ainda. Abra a aba Matriz pra começar.
                    </td></tr>
                  )}
                  {(recentesQ.data || []).map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => {
                        if (r.empresas && r.acoes_tributarias) {
                          handleOpenWizard(r.empresas, r.acoes_tributarias, r.id);
                        }
                      }}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{r.empresas?.nome || "—"}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{r.empresas?.cnpj}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-sm">
                        {r.acoes_tributarias?.nome || "—"}
                        {r.acoes_tributarias?.tipo && (
                          <span className="text-[10px] text-muted-foreground ml-1.5">· {r.acoes_tributarias.tipo}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge
                          variant="outline"
                          className={r.elegivel
                            ? "bg-success/10 text-success border-success/30"
                            : "bg-destructive/10 text-destructive border-destructive/30"}
                        >
                          {r.elegivel ? "Elegível" : "Não elegível"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-center text-sm tabular-nums">
                        {r.score_elegibilidade != null ? `${r.score_elegibilidade}%` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-sm tabular-nums">
                        {formatCompactCurrency(r.valor_potencial_estimado)}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">
                        {r.qualificada_em ? (
                          <>
                            {formatDate(r.qualificada_em)}
                            <span className="block text-[10px]">{formatRelativeDate(r.qualificada_em)}</span>
                          </>
                        ) : (
                          <span className="italic">legado</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {wizardOpen && wizardCtx && (
        <QualificacaoWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          empresa={wizardCtx.empresa}
          acao={wizardCtx.acao}
          elegibilidadeId={wizardCtx.elegibilidadeId}
          onSaved={() => {
            // Reabastecer queries
            elegsQ.refetch();
            recentesQ.refetch();
          }}
        />
      )}
    </div>
  );
}
