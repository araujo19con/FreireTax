import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Handshake, FileText, ArrowUpRight } from "lucide-react";
import { regimeShort, regimeColor } from "@/lib/regimeTributario";

export interface EmpresaAcao {
  id: string;
  nome: string;
  cnpj: string;
  porte: string | null;
  uf: string | null;
  situacao_cadastral: string | null;
  regime_tributario: string | null;
  municipio: string | null;
}

export interface ElegAcao {
  id: string;
  empresa_id: string;
  acao_id: string;
  elegivel: boolean;
  justificativa: string | null;
}

export interface ProspMin {
  id: string;
  elegibilidade_id: string | null;
  empresa_id: string;
  acao_id: string;
  status_prospeccao: string;
}

interface Item {
  el: ElegAcao;
  empresa: EmpresaAcao | undefined;
  prosp: ProspMin | undefined;
}

interface Props {
  acaoId: string;
  empresasMap: Map<string, EmpresaAcao>;
  elegs: ElegAcao[];
  prospeccoes: ProspMin[];
  onProspectar: (elegId: string, empresaId: string) => void;
  onOpenProcesso: (elegId: string) => void;
}

type Tab = "todas" | "elegiveis" | "aguardando" | "em_prospeccao";

const PROSP_STATUS_COLOR: Record<string, string> = {
  "Não iniciado":     "bg-muted text-muted-foreground",
  "Contato feito":    "bg-info/10 text-info",
  "Proposta enviada": "bg-warning/10 text-warning",
  "Em negociação":    "bg-primary/10 text-primary",
  "Contrato assinado":"bg-success/10 text-success",
  "Perdido":          "bg-destructive/10 text-destructive",
};

export function AcaoEmpresasPanel({ acaoId, empresasMap, elegs, prospeccoes, onProspectar, onOpenProcesso }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("todas");

  const items = useMemo<Item[]>(() => elegs.map(el => ({
    el,
    empresa: empresasMap.get(el.empresa_id),
    prosp: prospeccoes.find(p =>
      p.elegibilidade_id === el.id ||
      (p.empresa_id === el.empresa_id && p.acao_id === acaoId)
    ),
  })), [elegs, empresasMap, prospeccoes, acaoId]);

  const stats = useMemo(() => ({
    total:         items.length,
    elegiveis:     items.filter(i => i.el.elegivel).length,
    aguardando:    items.filter(i => i.el.elegivel && !i.prosp).length,
    emProspeccao:  items.filter(i => !!i.prosp && i.prosp.status_prospeccao !== "Perdido").length,
  }), [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (activeTab === "elegiveis")     list = list.filter(i => i.el.elegivel);
    else if (activeTab === "aguardando")    list = list.filter(i => i.el.elegivel && !i.prosp);
    else if (activeTab === "em_prospeccao") list = list.filter(i => !!i.prosp && i.prosp.status_prospeccao !== "Perdido");
    if (q.trim()) {
      const lower = q.toLowerCase();
      list = list.filter(i =>
        (i.empresa?.nome ?? "").toLowerCase().includes(lower) ||
        (i.empresa?.cnpj ?? "").includes(lower)
      );
    }
    return list;
  }, [items, activeTab, q]);

  type StatChip = { tab: Tab; label: string; count: number; base: string; active: string };
  const chips: StatChip[] = [
    { tab: "todas",         label: "Total",         count: stats.total,        base: "bg-muted/60 text-foreground hover:bg-muted",                   active: "bg-muted ring-2 ring-foreground/20" },
    { tab: "elegiveis",     label: "Elegíveis",     count: stats.elegiveis,    base: "bg-success/10 text-success hover:bg-success/20",               active: "bg-success/20 ring-2 ring-success/30" },
    { tab: "aguardando",    label: "Aguardando",    count: stats.aguardando,   base: "bg-warning/10 text-warning hover:bg-warning/20",               active: "bg-warning/20 ring-2 ring-warning/30" },
    { tab: "em_prospeccao", label: "Em prospecção", count: stats.emProspeccao, base: "bg-primary/10 text-primary hover:bg-primary/20",               active: "bg-primary/20 ring-2 ring-primary/30" },
  ];

  return (
    <div className="space-y-3">
      {/* Stats chips como filtro rápido */}
      <div className="flex flex-wrap gap-2">
        {chips.map(chip => (
          <button
            key={chip.tab}
            onClick={() => setActiveTab(chip.tab)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${activeTab === chip.tab ? chip.active : chip.base}`}
          >
            {chip.label}
            <span className="font-bold tabular-nums">{chip.count}</span>
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar nome ou CNPJ..."
          value={q}
          onChange={e => setQ(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Tabela */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma empresa neste filtro.</p>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="overflow-y-auto max-h-[460px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0 z-10">
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden sm:table-cell">Porte · UF</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden md:table-cell">Regime</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Status</th>
                  <th className="py-2 px-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const { el, empresa, prosp } = item;
                  return (
                    <tr
                      key={el.id}
                      className={`border-t border-border transition-colors hover:bg-muted/20 ${idx % 2 !== 0 ? "bg-muted/5" : ""}`}
                    >
                      {/* Nome + CNPJ */}
                      <td className="py-2 px-3">
                        <div className="font-medium truncate max-w-[180px] leading-tight">{empresa?.nome ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{empresa?.cnpj ?? "—"}</div>
                      </td>

                      {/* Porte · UF */}
                      <td className="py-2 px-2 hidden sm:table-cell whitespace-nowrap">
                        <span className="text-muted-foreground">{empresa?.porte ?? "—"}</span>
                        {empresa?.uf && <span className="ml-1 font-medium">{empresa.uf}</span>}
                      </td>

                      {/* Regime */}
                      <td className="py-2 px-2 hidden md:table-cell">
                        {empresa?.regime_tributario ? (
                          <Badge variant="outline" className={`text-[10px] border ${regimeColor(empresa.regime_tributario)}`}>
                            {regimeShort(empresa.regime_tributario)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Status prospecção */}
                      <td className="py-2 px-2">
                        {!el.elegivel ? (
                          <Badge variant="outline" className="text-[10px] border-0 bg-destructive/10 text-destructive">Não elegível</Badge>
                        ) : prosp ? (
                          <Badge variant="outline" className={`text-[10px] border-0 ${PROSP_STATUS_COLOR[prosp.status_prospeccao] ?? "bg-muted text-muted-foreground"}`}>
                            {prosp.status_prospeccao}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-0 bg-warning/10 text-warning">Aguardando</Badge>
                        )}
                      </td>

                      {/* Botões de ação */}
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            title="Processo"
                            onClick={() => onOpenProcesso(el.id)}
                          >
                            <FileText className="h-3 w-3" />
                          </Button>
                          {el.elegivel && !prosp && (
                            <Button
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => onProspectar(el.id, el.empresa_id)}
                            >
                              <Handshake className="h-3 w-3" />Prospectar
                            </Button>
                          )}
                          {el.elegivel && prosp && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => navigate("/prospeccao")}
                            >
                              <ArrowUpRight className="h-3 w-3" />Ver
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
