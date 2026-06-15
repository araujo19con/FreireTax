import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Smartphone, MessageCircle, Gavel, BarChart3, Loader2 } from "lucide-react";

export function ContatosCoverageCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["contatos-coverage"],
    queryFn: async () => {
      // Stats globais de cobertura
      const [
        { count: totalContatos },
        { count: comTelefone },
        { count: comCelular },
        { count: comWhatsapp },
        { count: comPje },
        { data: origemStats },
        { data: empresasComContato },
      ] = await Promise.all([
        supabase.from("empresa_contatos").select("id", { count: "exact", head: true }),
        supabase
          .from("empresa_contatos")
          .select("id", { count: "exact", head: true })
          .not("telefone", "is", null)
          .neq("telefone", ""),
        supabase
          .from("empresa_contatos")
          .select("id", { count: "exact", head: true })
          .eq("tipo_telefone", "movel"),
        supabase
          .from("empresa_contatos")
          .select("id", { count: "exact", head: true })
          .eq("whatsapp", true),
        supabase
          .from("empresa_contatos")
          .select("id", { count: "exact", head: true })
          .ilike("observacoes", "%PJe/TJRN%"),
        supabase
          .from("empresa_contatos")
          .select("origem", { head: false })
          .then((r) => {
            if (r.data) {
              const counts: Record<string, number> = {};
              r.data.forEach((row: { origem: string }) => {
                counts[row.origem] = (counts[row.origem] ?? 0) + 1;
              });
              return { data: Object.entries(counts).map(([k, v]) => ({ origem: k, count: v })) };
            }
            return { data: [] };
          }),
        supabase
          .from("empresa_contatos")
          .select("empresa_id", { head: false })
          .then((r) => {
            if (r.data) {
              const unique = new Set(r.data.map((row: { empresa_id: string }) => row.empresa_id));
              return { data: Array.from(unique) };
            }
            return { data: [] };
          }),
      ]);

      const total = totalContatos ?? 0;
      const telefone = comTelefone ?? 0;
      const celular = comCelular ?? 0;
      const whatsapp = comWhatsapp ?? 0;
      const pje = comPje ?? 0;
      const empresas = empresasComContato?.length ?? 0;

      return {
        total,
        telefone,
        celular,
        whatsapp,
        pje,
        empresas,
        origemStats: (origemStats ?? []) as { origem: string; count: number }[],
        pctTelefone: total > 0 ? Math.round((telefone / total) * 100) : 0,
        pctCelular: total > 0 ? Math.round((celular / total) * 100) : 0,
        pctWhatsapp: total > 0 ? Math.round((whatsapp / total) * 100) : 0,
        pctPje: total > 0 ? Math.round((pje / total) * 100) : 0,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  if (isLoading || !data) {
    return (
      <Card className="flex items-center justify-center p-6 shadow-card">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">Carregando cobertura...</span>
      </Card>
    );
  }

  const [origem1, origem2, origem3] = data.origemStats
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return (
    <Card className="space-y-3 p-4 shadow-card">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Cobertura de Enriquecimento</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {/* Total */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="text-2xl font-bold">{data.total.toLocaleString("pt-BR")}</div>
          <div className="text-[10px] uppercase text-muted-foreground">Contatos</div>
        </div>

        {/* Empresas */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="text-2xl font-bold">{data.empresas.toLocaleString("pt-BR")}</div>
          <div className="text-[10px] uppercase text-muted-foreground">Empresas</div>
        </div>

        {/* Telefone */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="flex items-center justify-center gap-0.5">
            <Phone className="h-3 w-3" />
            <span className="text-xl font-bold">{data.pctTelefone}%</span>
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">Telefone</div>
          <div className="text-[9px] text-muted-foreground">{data.telefone}</div>
        </div>

        {/* Celular */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="flex items-center justify-center gap-0.5">
            <Smartphone className="h-3 w-3" />
            <span className="text-xl font-bold">{data.pctCelular}%</span>
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">Celular</div>
          <div className="text-[9px] text-muted-foreground">{data.celular}</div>
        </div>

        {/* WhatsApp */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="flex items-center justify-center gap-0.5">
            <MessageCircle className="h-3 w-3 text-green-600" />
            <span className="text-xl font-bold">{data.pctWhatsapp}%</span>
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">WhatsApp</div>
          <div className="text-[9px] text-muted-foreground">{data.whatsapp}</div>
        </div>

        {/* PJe */}
        <div className="space-y-1 rounded bg-muted/50 p-2 text-center">
          <div className="flex items-center justify-center gap-0.5">
            <Gavel className="h-3 w-3 text-orange-600" />
            <span className="text-xl font-bold">{data.pctPje}%</span>
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">PJe</div>
          <div className="text-[9px] text-muted-foreground">{data.pje}</div>
        </div>
      </div>

      {/* Origens principais */}
      {data.origemStats.length > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="text-xs font-medium text-muted-foreground">Origem (top 3)</div>
          <div className="flex flex-wrap gap-1">
            {[origem1, origem2, origem3].map(
              (item) =>
                item && (
                  <Badge key={item.origem} variant="secondary" className="text-[9px]">
                    {item.origem}: {item.count}
                  </Badge>
                )
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
