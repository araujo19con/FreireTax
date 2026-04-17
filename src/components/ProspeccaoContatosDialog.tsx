import { useCallback, useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Phone, Mail, MessageCircle, Linkedin, MapPin, Video, MoreHorizontal,
  Plus, Trash2, Calendar, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Contato = Database["public"]["Tables"]["prospeccao_contatos"]["Row"];
type Canal = Database["public"]["Enums"]["canal_contato"];
type Tipo = Database["public"]["Enums"]["tipo_contato"];

const CANAIS: { value: Canal; label: string; icon: typeof Phone }[] = [
  { value: "email",              label: "Email",              icon: Mail },
  { value: "telefone",           label: "Telefone",           icon: Phone },
  { value: "whatsapp",           label: "WhatsApp",           icon: MessageCircle },
  { value: "linkedin",           label: "LinkedIn",           icon: Linkedin },
  { value: "reuniao_online",     label: "Reunião Online",     icon: Video },
  { value: "reuniao_presencial", label: "Reunião Presencial", icon: MapPin },
  { value: "outro",              label: "Outro",              icon: MoreHorizontal },
];

const TIPOS: { value: Tipo; label: string; color: string }[] = [
  { value: "outbound",       label: "Contato nosso",       color: "bg-primary/10 text-primary" },
  { value: "resposta_lead",  label: "Resposta do lead",    color: "bg-success/10 text-success" },
  { value: "reuniao",        label: "Reunião realizada",   color: "bg-info/10 text-info" },
  { value: "breakup",        label: "Último toque (breakup)", color: "bg-destructive/10 text-destructive" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospeccaoId: string | null;
  prospeccaoLabel?: string;           // ex: "ACME LTDA — Tema 985"
  onSaved?: () => void;                // recalcula no pai
}

export function ProspeccaoContatosDialog({ open, onOpenChange, prospeccaoId, prospeccaoLabel, onSaved }: Props) {
  const { user } = useAuth();
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(false);

  // form novo contato
  const [canal, setCanal] = useState<Canal>("email");
  const [tipo, setTipo] = useState<Tipo>("outbound");
  const [dataContato, setDataContato] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [resultado, setResultado] = useState("");
  const [notas, setNotas] = useState("");
  const [proximoContato, setProximoContato] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("prospeccao_contatos")
      .select("*")
      .eq("prospeccao_id", id)
      .order("data_contato", { ascending: false });
    if (error) toast.error("Erro ao carregar histórico de contatos");
    setContatos(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open || !prospeccaoId) return;
    load(prospeccaoId);
    // reset form
    setCanal("email");
    setTipo("outbound");
    setDataContato(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setResultado("");
    setNotas("");
    setProximoContato("");
  }, [open, prospeccaoId, load]);

  const adicionar = async () => {
    if (!prospeccaoId || !user) return;
    if (!dataContato) return toast.error("Data do contato é obrigatória");

    setSaving(true);
    const { data, error } = await supabase.from("prospeccao_contatos").insert({
      prospeccao_id: prospeccaoId,
      user_id: user.id,
      data_contato: new Date(dataContato).toISOString(),
      canal,
      tipo,
      resultado: resultado.trim() || null,
      notas: notas.trim() || null,
      proximo_contato_em: proximoContato ? new Date(proximoContato).toISOString() : null,
    }).select().single();
    setSaving(false);

    if (error) return toast.error("Erro ao registrar: " + error.message);

    toast.success(`Toque #${contatos.length + 1} registrado`);
    logAudit({ tabela: "prospeccao_contatos", acao: "Registrou contato", registro_id: data.id, detalhes: { canal, tipo, prospeccao_id: prospeccaoId } });
    setContatos([data, ...contatos]);
    setResultado("");
    setNotas("");
    setProximoContato("");
    // dispara recálculo no pai (numero_contatos etc.)
    onSaved?.();
  };

  const remover = async (id: string) => {
    const { error } = await supabase.from("prospeccao_contatos").delete().eq("id", id);
    if (error) return toast.error("Erro ao remover");
    setContatos((curr) => curr.filter((c) => c.id !== id));
    onSaved?.();
  };

  const renderCanalIcon = (c: Canal) => {
    const def = CANAIS.find((x) => x.value === c);
    const Icon = def?.icon ?? MoreHorizontal;
    return <Icon className="h-3 w-3" />;
  };

  const canalLabel = (c: Canal) => CANAIS.find((x) => x.value === c)?.label ?? c;
  const tipoDef = (t: Tipo) => TIPOS.find((x) => x.value === t);

  const total = contatos.length;
  const pctCadencia = Math.min(100, Math.round((total / 7) * 100));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            Histórico de Contatos
          </DialogTitle>
          {prospeccaoLabel && (
            <p className="text-xs text-muted-foreground">{prospeccaoLabel}</p>
          )}
        </DialogHeader>

        {/* Contador de cadência 7 toques */}
        <div className="rounded-lg border border-border p-3 bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium">
                Cadência: <span className={total >= 7 ? "text-success" : total >= 5 ? "text-warning" : ""}>
                  Toque {total}/7
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {total < 5
                  ? `Hormozi: leads B2B precisam de 5-8 toques. Faltam ${Math.max(0, 5 - total)} para o mínimo.`
                  : total < 7
                    ? "Zona ideal de conversão. Continue."
                    : "Cadência completa. Considere 'Breakup' se não houve resposta."}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-heading font-bold">{pctCadencia}%</p>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                total >= 7 ? "bg-success" : total >= 5 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${pctCadencia}%` }}
            />
          </div>
        </div>

        {/* Form novo contato */}
        <div className="space-y-3 p-3 rounded-lg border border-border bg-card">
          <p className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" />Registrar novo toque
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Canal</Label>
              <Select value={canal} onValueChange={(v) => setCanal(v as Canal)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANAIS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="flex items-center gap-2">
                        <c.icon className="h-3 w-3" />{c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as Tipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Quando aconteceu *</Label>
              <Input type="datetime-local" value={dataContato} onChange={(e) => setDataContato(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" />Próximo contato em
              </Label>
              <Input type="datetime-local" value={proximoContato} onChange={(e) => setProximoContato(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Resultado (1 linha)</Label>
            <Input
              placeholder="Ex: respondeu interessado, pediu retorno semana que vem..."
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <Textarea
              rows={2}
              placeholder="Detalhes da conversa, objeções, próximos passos..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          <Button size="sm" onClick={adicionar} disabled={saving} className="w-full">
            <Plus className="mr-1 h-3 w-3" />
            {saving ? "Salvando..." : `Registrar toque #${total + 1}`}
          </Button>
        </div>

        <Separator />

        {/* Histórico */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Histórico ({total})</p>

          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
          ) : contatos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum contato ainda. Registre o primeiro toque acima.
            </p>
          ) : contatos.map((c, idx) => {
            const td = tipoDef(c.tipo);
            const contatoNumero = total - idx;
            return (
              <div key={c.id} className="p-3 rounded-md border border-border hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-mono">#{contatoNumero}</Badge>
                      <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                        {renderCanalIcon(c.canal)}
                        {canalLabel(c.canal)}
                      </Badge>
                      {td && (
                        <Badge variant="secondary" className={`text-[10px] ${td.color}`}>
                          {td.label}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(c.data_contato), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    {c.resultado && (
                      <p className="text-sm font-medium">{c.resultado}</p>
                    )}
                    {c.notas && (
                      <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{c.notas}</p>
                    )}
                    {c.proximo_contato_em && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-primary">
                        <ArrowRight className="h-3 w-3" />
                        Próximo: {format(new Date(c.proximo_contato_em), "dd/MM HH:mm", { locale: ptBR })}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remover(c.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
