import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CalendarCheck, Send, XCircle, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";
import { format, addMinutes } from "date-fns";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";

type Reuniao = Database["public"]["Tables"]["reunioes"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileSlim = Pick<Profile, "id" | "nome" | "email" | "ativo">;
type Status = Database["public"]["Enums"]["reuniao_status"];

const reuniaoSchema = z.object({
  titulo: z.string().trim().min(3, "Título precisa de ao menos 3 caracteres"),
  advogadoId: z.string().uuid("Selecione o advogado"),
  leadNome: z.string().trim().min(2, "Nome do lead obrigatório"),
  leadEmail: z.string().trim().email("Email do lead inválido"),
  dataInicio: z.string().min(1, "Data/hora obrigatória"),
  duracaoMin: z.number().int().min(15, "Duração mínima de 15 minutos").max(60 * 12, "Duração máxima de 12h"),
  linkReuniao: z.string().url("Link inválido").optional().or(z.literal("")),
});

const STATUSES: { value: Status; label: string }[] = [
  { value: "agendada", label: "Agendada" },
  { value: "realizada", label: "Realizada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "no_show", label: "No-show" },
  { value: "reagendada", label: "Reagendada" },
];

interface ReuniaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reuniao?: Reuniao | null;
  defaultProspeccaoId?: string;
  defaultLeadNome?: string;
  defaultLeadEmail?: string;
  defaultEmpresaId?: string;
  onSaved?: () => void;
}

export function ReuniaoDialog({
  open, onOpenChange, reuniao,
  defaultProspeccaoId, defaultLeadNome, defaultLeadEmail, defaultEmpresaId,
  onSaved,
}: ReuniaoDialogProps) {
  const { user } = useAuth();

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [advogadoId, setAdvogadoId] = useState("");
  const [leadNome, setLeadNome] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [duracaoMin, setDuracaoMin] = useState(60);
  const [local, setLocal] = useState("");
  const [linkReuniao, setLinkReuniao] = useState("");
  const [status, setStatus] = useState<Status>("agendada");
  const [empresaId, setEmpresaId] = useState("");
  const [prospeccaoId, setProspeccaoId] = useState("");
  const [notas, setNotas] = useState("");

  const [advogados, setAdvogados] = useState<ProfileSlim[]>([]);
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([]);
  const [prospeccoes, setProspeccoes] = useState<Array<{
    id: string;
    contato_nome: string | null;
    contato_email: string | null;
    status_prospeccao: string | null;
    empresa_id: string | null;
    acao_id: string | null;
    empresa_nome: string | null;
    acao_nome: string | null;
  }>>([]);
  const [saving, setSaving] = useState(false);
  const [enviandoConvite, setEnviandoConvite] = useState(false);

  const loadRelations = useCallback(async () => {
    const [{ data: p }, { data: e }, { data: pr }, { data: a }, { data: el }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, ativo").eq("ativo", true).order("nome"),
      supabase.from("empresas").select("id, nome").order("nome"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("prospeccoes").select("id, contato_nome, contato_email, status_prospeccao, elegibilidade_id, empresa_id, acao_id").order("created_at", { ascending: false }) as any),
      supabase.from("acoes_tributarias").select("id, nome"),
      supabase.from("elegibilidade").select("id, empresa_id, acao_id"),
    ]);

    const empMap = new Map((e ?? []).map((x) => [x.id, x.nome] as const));
    const acaoMap = new Map((a ?? []).map((x) => [x.id, x.nome] as const));
    const elegMap = new Map((el ?? []).map((x) => [x.id, x] as const));

    type ProspRaw = {
      id: string;
      contato_nome: string | null;
      contato_email: string | null;
      status_prospeccao: string | null;
      elegibilidade_id: string | null;
      empresa_id: string | null;
      acao_id: string | null;
    };
    const prospEnriched = ((pr ?? []) as ProspRaw[]).map((row) => {
      const eleg = row.elegibilidade_id ? elegMap.get(row.elegibilidade_id) : null;
      const empresa_id = row.empresa_id || eleg?.empresa_id || null;
      const acao_id = row.acao_id || eleg?.acao_id || null;
      return {
        id: row.id,
        contato_nome: row.contato_nome,
        contato_email: row.contato_email,
        status_prospeccao: row.status_prospeccao,
        empresa_id,
        acao_id,
        empresa_nome: empresa_id ? empMap.get(empresa_id) ?? null : null,
        acao_nome: acao_id ? acaoMap.get(acao_id) ?? null : null,
      };
    });

    setAdvogados((p ?? []) as ProfileSlim[]);
    setEmpresas(e ?? []);
    setProspeccoes(prospEnriched);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTitulo(reuniao?.titulo ?? "");
    setDescricao(reuniao?.descricao ?? "");
    setAdvogadoId(reuniao?.advogado_id ?? user?.id ?? "");
    setLeadNome(reuniao?.lead_nome ?? defaultLeadNome ?? "");
    setLeadEmail(reuniao?.lead_email ?? defaultLeadEmail ?? "");
    setDataInicio(reuniao?.data_inicio ? format(new Date(reuniao.data_inicio), "yyyy-MM-dd'T'HH:mm") : "");
    if (reuniao?.data_inicio && reuniao?.data_fim) {
      const diff = (new Date(reuniao.data_fim).getTime() - new Date(reuniao.data_inicio).getTime()) / 60000;
      setDuracaoMin(Math.round(diff));
    } else {
      setDuracaoMin(60);
    }
    setLocal(reuniao?.local ?? "");
    setLinkReuniao(reuniao?.link_reuniao ?? "");
    setStatus(reuniao?.status ?? "agendada");
    setEmpresaId(reuniao?.empresa_id ?? defaultEmpresaId ?? "");
    setProspeccaoId(reuniao?.prospeccao_id ?? defaultProspeccaoId ?? "");
    setNotas(reuniao?.notas ?? "");

    loadRelations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reuniao?.id]);

  // quando muda a prospecção, pré-preencher email/nome
  const handleProspeccaoChange = (id: string) => {
    if (id === "none") {
      setProspeccaoId("");
      return;
    }
    setProspeccaoId(id);
    const p = prospeccoes.find((p) => p.id === id);
    if (p) {
      if (p.contato_nome && !leadNome) setLeadNome(p.contato_nome);
      if (p.contato_email && !leadEmail) setLeadEmail(p.contato_email);
      // Auto-preenche empresa quando ainda não selecionada
      if (p.empresa_id && !empresaId) setEmpresaId(p.empresa_id);
    }
  };

  const validate = () => {
    const parsed = reuniaoSchema.safeParse({
      titulo,
      advogadoId,
      leadNome,
      leadEmail,
      dataInicio,
      duracaoMin,
      linkReuniao,
    });
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Dados inválidos";
    return null;
  };

  const enviarConvite = async (reuniaoId: string, metodo: "REQUEST" | "CANCEL" = "REQUEST") => {
    setEnviandoConvite(true);
    try {
      // invoke() envolve a resposta: quando non-2xx, error é genérico mas
      // `data` ainda contém o body JSON do erro. Extraímos o detalhe pra
      // mostrar a causa real (ex: SMTP não configurado).
      const { data, error } = await supabase.functions.invoke<{ error?: string; detail?: string }>(
        "enviar-convite-reuniao",
        { body: { reuniao_id: reuniaoId, metodo } },
      );
      if (error || data?.error) {
        const detalhe = data?.error ?? error?.message ?? "desconhecido";
        const extra = data?.detail ? ` (${data.detail})` : "";
        const full = detalhe + extra;

        // Erro típico: SMTP não configurado. Oferece Calendar como alternativa.
        if (/GMAIL|SMTP|senha.*app/i.test(full)) {
          toast.error(
            "Envio por email não configurado no servidor. Use 'Criar no Google Calendar' — o Calendar convida os emails automaticamente.",
            { duration: 8000 },
          );
        } else {
          toast.error("Erro ao enviar convite: " + full);
        }
        return;
      }
      toast.success(metodo === "CANCEL" ? "Cancelamento enviado por email" : "Convite enviado para advogado e lead");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "desconhecido";
      toast.error("Erro ao enviar convite: " + msg);
    } finally {
      setEnviandoConvite(false);
    }
  };

  const abrirGoogleCalendar = () => {
    if (!titulo.trim()) return toast.error("Informe o título");
    if (!dataInicio) return toast.error("Informe a data de início");

    const inicio = new Date(dataInicio);
    const fim = addMinutes(inicio, duracaoMin || 60);

    const advogado = advogados.find((a) => a.id === advogadoId);
    const attendees = [advogado?.email, leadEmail].filter(Boolean);

    // Monta descrição com contexto útil que vai pro evento
    const desc: string[] = [];
    if (descricao.trim()) desc.push(descricao.trim());
    if (leadNome.trim()) desc.push(`Lead: ${leadNome.trim()}`);
    if (advogado?.nome) desc.push(`Responsável: ${advogado.nome}`);
    if (notas.trim()) desc.push(`\nNotas: ${notas.trim()}`);

    const url = buildGoogleCalendarUrl({
      title: titulo.trim(),
      description: desc.join("\n"),
      start: inicio,
      end: fim,
      location: local.trim() || undefined,
      attendees,
    });

    window.open(url, "_blank", "noopener,noreferrer");
    toast.info("Google Calendar aberto em nova aba. Ative 'Adicionar Google Meet' no evento e cole o link aqui.");
  };

  const handleSave = async (opts: { enviar: boolean }) => {
    const err = validate();
    if (err) return toast.error(err);
    if (!user) return toast.error("Sessão expirada");

    const inicio = new Date(dataInicio);
    // Aviso (não bloqueia) se a data estiver claramente no passado — comum em
    // registro retroativo de reuniões realizadas. Mas se estiver tentando enviar
    // convite para o passado, isso é quase sempre erro.
    if (opts.enviar && inicio.getTime() < Date.now() - 5 * 60 * 1000) {
      toast.error("Não é possível enviar convite para reunião no passado. Ajuste a data ou use 'Salvar sem enviar'.");
      return;
    }

    setSaving(true);
    const fim = addMinutes(inicio, duracaoMin);

    const payload = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      advogado_id: advogadoId,
      lead_nome: leadNome.trim(),
      lead_email: leadEmail.trim(),
      data_inicio: inicio.toISOString(),
      data_fim: fim.toISOString(),
      local: local.trim() || null,
      link_reuniao: linkReuniao.trim() || null,
      status,
      empresa_id: empresaId || null,
      prospeccao_id: prospeccaoId || null,
      notas: notas.trim() || null,
    };

    let savedId: string | null = null;
    if (reuniao?.id) {
      const { error } = await supabase.from("reunioes").update(payload).eq("id", reuniao.id);
      if (error) { setSaving(false); return toast.error("Erro ao salvar: " + error.message); }
      savedId = reuniao.id;
      logAudit({ tabela: "reunioes", acao: "Editou reunião", registro_id: savedId, detalhes: { titulo } });
    } else {
      const { data, error } = await supabase.from("reunioes").insert({ ...payload, created_by: user.id }).select().single();
      if (error) { setSaving(false); return toast.error("Erro ao criar: " + error.message); }
      savedId = data.id;
      logAudit({ tabela: "reunioes", acao: "Criou reunião", registro_id: savedId, detalhes: { titulo } });
    }

    setSaving(false);
    toast.success(reuniao?.id ? "Reunião atualizada" : "Reunião criada");

    if (opts.enviar && savedId) {
      await enviarConvite(savedId);
    }

    onSaved?.();
    onOpenChange(false);
  };

  const cancelarReuniao = async () => {
    if (!reuniao?.id) return;
    const { error } = await supabase.from("reunioes").update({ status: "cancelada" }).eq("id", reuniao.id);
    if (error) return toast.error("Erro ao cancelar: " + error.message);
    await enviarConvite(reuniao.id, "CANCEL");
    logAudit({ tabela: "reunioes", acao: "Cancelou reunião", registro_id: reuniao.id });
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <CalendarCheck className="h-4 w-4" />
            {reuniao?.id ? "Editar Reunião" : "Agendar Reunião"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Título *</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Reunião de apresentação de proposta" />
          </div>

          <div className="space-y-2">
            <Label>Descrição / Pauta</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Pontos a discutir..." />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Advogado responsável *</Label>
              <Select value={advogadoId} onValueChange={setAdvogadoId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {advogados.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome} ({p.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reuniao-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger id="reuniao-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vincular a prospecção</Label>
            <Select value={prospeccaoId || "none"} onValueChange={handleProspeccaoChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nenhuma —</SelectItem>
                {prospeccoes.map((p) => {
                  const empresaNome = p.empresa_nome?.trim();
                  const acaoNome = p.acao_nome?.trim();
                  const contato = p.contato_nome?.trim();
                  let principal: string;
                  if (empresaNome && acaoNome) principal = `${empresaNome} — ${acaoNome}`;
                  else if (empresaNome) principal = empresaNome;
                  else if (contato) principal = contato;
                  else principal = "Prospecção sem dados";
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="truncate">{principal}</span>
                      {contato && empresaNome && (
                        <span className="text-muted-foreground text-[11px] ml-1.5">· {contato}</span>
                      )}
                      {p.status_prospeccao && (
                        <span className="text-muted-foreground text-[11px] ml-1.5">· {p.status_prospeccao}</span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nome do lead *</Label>
              <Input value={leadNome} onChange={(e) => setLeadNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email do lead *</Label>
              <Input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="contato@empresa.com" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Vincular a empresa</Label>
            <Select value={empresaId || "none"} onValueChange={(v) => setEmpresaId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nenhuma —</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Data e hora *</Label>
              <Input type="datetime-local" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Duração (min) *</Label>
              <Input type="number" min={15} step={15} value={duracaoMin} onChange={(e) => setDuracaoMin(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Local (físico)</Label>
            <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex: Sede do escritório, Sala 2" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>Link da reunião (Meet, Zoom, Teams...)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={abrirGoogleCalendar}
                disabled={!titulo.trim() || !dataInicio}
                title="Abre o Google Calendar preenchido — adicione 'Google Meet' lá e cole o link gerado aqui"
              >
                <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
                Criar no Google Calendar
              </Button>
            </div>
            <Input value={linkReuniao} onChange={(e) => setLinkReuniao(e.target.value)} placeholder="https://meet.google.com/..." />
            <p className="text-[10px] text-muted-foreground">
              Dica: clique em "Criar no Google Calendar" → ative "Adicionar Google Meet" no evento → copie o link de volta pra cá.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Notas internas</Label>
            <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observações que NÃO vão para o email..." />
          </div>

          {reuniao?.ics_enviado_em && (
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              Último convite enviado em: {format(new Date(reuniao.ics_enviado_em), "dd/MM/yyyy HH:mm")}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {reuniao?.id && status !== "cancelada" && (
            <Button variant="outline" type="button" onClick={cancelarReuniao} disabled={saving || enviandoConvite} className="sm:mr-auto">
              <XCircle className="mr-2 h-3 w-3" aria-hidden="true" />Cancelar reunião
            </Button>
          )}
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button variant="secondary" type="button" onClick={() => handleSave({ enviar: false })} disabled={saving || enviandoConvite}>
            {saving ? "Salvando..." : "Salvar sem enviar"}
          </Button>
          <Button type="button" onClick={() => handleSave({ enviar: true })} disabled={saving || enviandoConvite}>
            <Send className="mr-2 h-3 w-3" aria-hidden="true" />
            {enviandoConvite ? "Enviando..." : "Salvar e enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
