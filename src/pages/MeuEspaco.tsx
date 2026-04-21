import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, ClipboardList, Calendar } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import MinhaSemana from "./MinhaSemana";
import MinhasTarefas from "./MinhasTarefas";
import MinhaAgenda from "./MinhaAgenda";

/**
 * Hub único que consolida Semana + Tarefas + Agenda em abas.
 * - Default: aba `semana` (visão agregada do dia-a-dia).
 * - URL sincronizada via ?tab=tarefas|agenda|semana (preserva ao recarregar,
 *   permite compartilhar link direto para uma aba específica).
 * - As páginas individuais continuam acessíveis pelas URLs antigas
 *   (/minha-semana, /minhas-tarefas, /minha-agenda) para não quebrar
 *   bookmarks existentes.
 */
type TabKey = "semana" | "tarefas" | "agenda";

const VALID_TABS: TabKey[] = ["semana", "tarefas", "agenda"];

export default function MeuEspaco() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: TabKey = VALID_TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : "semana";

  // Se vier sem ?tab, normaliza pra ?tab=semana (deep-link friendly)
  useEffect(() => {
    if (rawTab !== tab) {
      const next = new URLSearchParams(params);
      next.set("tab", tab);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Meu Espaço"
        description="Semana, tarefas e agenda num só lugar."
        icon={<CalendarDays className="h-7 w-7" />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="semana" className="gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Semana
          </TabsTrigger>
          <TabsTrigger value="tarefas" className="gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Tarefas
          </TabsTrigger>
          <TabsTrigger value="agenda" className="gap-1.5">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Agenda
          </TabsTrigger>
        </TabsList>

        <TabsContent value="semana" className="mt-4">
          <MinhaSemana embedded />
        </TabsContent>
        <TabsContent value="tarefas" className="mt-4">
          <MinhasTarefas embedded />
        </TabsContent>
        <TabsContent value="agenda" className="mt-4">
          <MinhaAgenda embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
