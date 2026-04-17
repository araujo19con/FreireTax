import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface AcaoFormData {
  nome: string;
  tipo: string;
  status: string;
  vinculo: string;
}

interface AcaoDialogProps {
  onSave: (data: AcaoFormData) => void;
  trigger?: React.ReactNode;
  initialData?: Partial<AcaoFormData>;
  title?: string;
  acoesIniciais?: { id: string; nome: string }[];
}

export function AcaoDialog({ onSave, trigger, initialData, title = "Nova Ação", acoesIniciais = [] }: AcaoDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AcaoFormData>({
    nome: initialData?.nome || "",
    tipo: initialData?.tipo || "INICIAL",
    status: initialData?.status || "Ativa",
    vinculo: initialData?.vinculo || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) {
      toast.error("Nome da ação é obrigatório");
      return;
    }
    if (form.tipo === "RESCISÓRIA" && !form.vinculo) {
      toast.error("Ação rescisória deve ser vinculada a uma ação inicial");
      return;
    }
    onSave(form);
    toast.success(`Ação "${form.nome}" salva com sucesso!`);
    setOpen(false);
    setForm({ nome: "", tipo: "INICIAL", status: "Ativa", vinculo: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nova Ação
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="nome-acao">Nome da Ação</Label>
            <Input id="nome-acao" placeholder="Ex: Exclusão do ICMS da base de cálculo do PIS/COFINS" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tipo">Tipo</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v, vinculo: v === "INICIAL" ? "" : form.vinculo })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INICIAL">Inicial</SelectItem>
                <SelectItem value="RESCISÓRIA">Rescisória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.tipo === "RESCISÓRIA" && (
            <div className="space-y-2">
              <Label htmlFor="vinculo">Ação Inicial Vinculada</Label>
              <Select value={form.vinculo} onValueChange={(v) => setForm({ ...form, vinculo: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a ação inicial..." />
                </SelectTrigger>
                <SelectContent>
                  {acoesIniciais.map((a) => (
                    <SelectItem key={a.id} value={a.nome}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="status-acao">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Ativa">Ativa</SelectItem>
                <SelectItem value="Em análise">Em análise</SelectItem>
                <SelectItem value="Inativa">Inativa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit">Salvar</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
