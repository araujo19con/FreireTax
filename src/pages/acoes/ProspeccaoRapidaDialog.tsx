import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Handshake } from "lucide-react";

const STATUS_OPTIONS = [
  "Contato feito",
  "Proposta enviada",
  "Em negociação",
  "Contrato assinado",
  "Serviço iniciado",
  "Perdido",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  acaoId: string;
  empresaNome: string;
  onSuccess: () => void;
}

export function ProspeccaoRapidaDialog({
  open,
  onOpenChange,
  empresaId,
  acaoId,
  empresaNome,
  onSuccess,
}: Props) {
  const { user } = useAuth();
  const [status, setStatus] = useState("Contato feito");
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleClose = (v: boolean) => {
    if (!saving) {
      onOpenChange(v);
      if (!v) {
        setStatus("Contato feito");
        setObservacoes("");
      }
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      // Pré-check: no máximo uma prospecção ativa (status <> 'Perdido') por
      // empresa+ação. Evita duplicar e o erro 23505 do índice único parcial.
      const { data: ativa } = await supabase
        .from("prospeccoes")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("acao_id", acaoId)
        .neq("status_prospeccao", "Perdido")
        .limit(1)
        .maybeSingle();
      if (ativa) {
        toast.info(`Já existe prospecção ativa para ${empresaNome} nesta tese.`);
        onSuccess();
        handleClose(false);
        return;
      }

      const { error } = await supabase.from("prospeccoes").insert({
        empresa_id: empresaId,
        acao_id: acaoId,
        status_prospeccao: status,
        notas_prospeccao: observacoes || null,
        user_id: user?.id,
        // Criador assume a responsabilidade — mesmo padrão do create em
        // Prospeccao.tsx, senão o card não aparece no "Meu trabalho" de ninguém.
        responsavel_id: user?.id,
      });
      if (error) {
        if (error.code === "23505") {
          toast.info(`Já existe prospecção ativa para ${empresaNome} nesta tese.`);
          onSuccess();
          handleClose(false);
          return;
        }
        throw error;
      }
      toast.success(`Prospecção iniciada para ${empresaNome}`);
      logAudit({
        tabela: "prospeccoes",
        acao: "Criou prospecção rápida",
        detalhes: { empresa: empresaNome, status },
      });
      onSuccess();
      handleClose(false);
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "erro desconhecido";
      toast.error("Erro ao criar prospecção: " + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <Handshake className="h-4 w-4" />
            Iniciar Prospecção
          </DialogTitle>
          <p className="truncate text-sm text-muted-foreground">{empresaNome}</p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Status inicial</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              Observação inicial{" "}
              <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea
              placeholder="Contexto, próximos passos, contato identificado..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={saving}
          >
            {saving ? "Salvando..." : "Iniciar prospecção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
