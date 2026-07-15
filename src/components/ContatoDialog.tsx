import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PhoneOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";
import {
  PAPEL_CONTATO,
  TELEFONE_STATUS,
  derivePapel,
  telefoneStatusInvalida,
  type EmpresaContato,
  type PapelContato,
  type TipoTelefone,
  type TelefoneStatus,
} from "@/lib/contatos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  contato?: EmpresaContato | null; // null/undefined => novo
  onSaved?: () => void;
}

const TIPOS_TELEFONE: { value: TipoTelefone; label: string }[] = [
  { value: "desconhecido", label: "Não sei" },
  { value: "movel", label: "Celular" },
  { value: "fixo", label: "Fixo" },
];

export function ContatoDialog({ open, onOpenChange, empresaId, contato, onSaved }: Props) {
  const { user } = useAuth();
  const editing = !!contato;

  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [papel, setPapel] = useState<PapelContato>("outro");
  const [papelTocado, setPapelTocado] = useState(false);
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipoTelefone, setTipoTelefone] = useState<TipoTelefone>("desconhecido");
  const [whatsapp, setWhatsapp] = useState(false);
  const [telefoneStatus, setTelefoneStatus] = useState<TelefoneStatus>("nao_testado");
  const [telefoneStatusNota, setTelefoneStatusNota] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [isContador, setIsContador] = useState(false);
  const [principal, setPrincipal] = useState(false);
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(contato?.nome ?? "");
    setCargo(contato?.cargo ?? "");
    setPapel(contato?.papel ?? "outro");
    setPapelTocado(editing);
    setEmail(contato?.email ?? "");
    setTelefone(contato?.telefone ?? "");
    setTipoTelefone(contato?.tipo_telefone ?? "desconhecido");
    setWhatsapp(contato?.whatsapp ?? false);
    setTelefoneStatus(contato?.telefone_status ?? "nao_testado");
    setTelefoneStatusNota(contato?.telefone_status_nota ?? "");
    setLinkedin(contato?.linkedin ?? "");
    setIsContador(contato?.is_contador ?? false);
    setPrincipal(contato?.principal ?? false);
    setObservacoes(contato?.observacoes ?? "");
  }, [open, contato, editing]);

  // Sugere papel a partir do cargo enquanto o usuário não escolher manualmente.
  useEffect(() => {
    if (papelTocado) return;
    setPapel(derivePapel(cargo, isContador, !!nome.trim()));
  }, [cargo, isContador, nome, papelTocado]);

  const salvar = async () => {
    if (!empresaId) return;
    const temAlgo = nome.trim() || email.trim() || telefone.trim();
    if (!temAlgo) {
      toast.error("Informe ao menos nome, email ou telefone.");
      return;
    }
    setSaving(true);

    const payload = {
      empresa_id: empresaId,
      nome: nome.trim() || null,
      cargo: cargo.trim() || null,
      papel,
      email: email.trim() || null,
      telefone: telefone.trim() || null,
      tipo_telefone: tipoTelefone,
      whatsapp,
      telefone_status: telefoneStatus,
      telefone_status_nota: telefoneStatusNota.trim() || null,
      linkedin: linkedin.trim() || null,
      is_contador: isContador,
      principal,
      observacoes: observacoes.trim() || null,
    };

    if (editing && contato) {
      const { error } = await supabase
        .from("empresa_contatos")
        .update(payload)
        .eq("id", contato.id);
      setSaving(false);
      if (error) return toast.error("Erro ao salvar: " + error.message);
      toast.success("Contato atualizado");
      void logAudit({
        tabela: "empresa_contatos",
        acao: "Editou contato",
        registro_id: contato.id,
        detalhes: { empresa_id: empresaId },
      });
    } else {
      const { data, error } = await supabase
        .from("empresa_contatos")
        .insert({ ...payload, origem: "manual", created_by: user?.id ?? null })
        .select()
        .single();
      setSaving(false);
      if (error) return toast.error("Erro ao salvar: " + error.message);
      toast.success("Contato adicionado");
      void logAudit({
        tabela: "empresa_contatos",
        acao: "Adicionou contato",
        registro_id: data.id,
        detalhes: { empresa_id: empresaId },
      });
    }

    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {editing ? "Editar contato" : "Novo contato"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: João Silva"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cargo</Label>
              <Input
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                placeholder="Ex: Sócio-Administrador"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Papel na empresa</Label>
            <Select
              value={papel}
              onValueChange={(v) => {
                setPapel(v as PapelContato);
                setPapelTocado(true);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPEL_CONTATO.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@empresa.com.br"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(84) 99999-9999"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={tipoTelefone}
                onValueChange={(v) => setTipoTelefone(v as TipoTelefone)}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_TELEFONE.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={whatsapp} onCheckedChange={(v) => setWhatsapp(!!v)} />
            Este número tem WhatsApp
          </label>

          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <Label className="flex items-center gap-1.5 text-xs">
              <PhoneOff className="h-3.5 w-3.5" />
              Status do telefone
            </Label>
            <Select
              value={telefoneStatus}
              onValueChange={(v) => setTelefoneStatus(v as TelefoneStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TELEFONE_STATUS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {telefoneStatus !== "nao_testado" && (
              <Input
                value={telefoneStatusNota}
                onChange={(e) => setTelefoneStatusNota(e.target.value)}
                placeholder="Nota (opcional): liguei 3x, número trocou, pediu retorno..."
                className="text-xs"
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              Resultado da tentativa por telefone — <strong>não</strong> conta como contato feito na
              prospecção.
              {telefoneStatusInvalida(telefoneStatus) &&
                " Como o número está errado/inexistente, ele para de ser sugerido no funil automaticamente."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">LinkedIn</Label>
            <Input
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/..."
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Textarea
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Melhor horário, quem indicou, contexto..."
            />
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isContador} onCheckedChange={(v) => setIsContador(!!v)} />É o
              contador (terceirizado) — não é decisor
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={principal} onCheckedChange={(v) => setPrincipal(!!v)} />
              Definir como contato <strong>principal</strong> da empresa
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
