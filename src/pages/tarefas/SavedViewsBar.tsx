import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BookmarkPlus, ChevronDown, Trash2, Bookmark } from "lucide-react";
import { useViewsSalvas, useCreateViewSalva, useDeleteViewSalva, type ViewSalva } from "@/hooks/useTarefasExtras";
import { toast } from "sonner";

export interface TarefasFiltros {
  search: string;
  prioridade: string;
  escopo: "minhas" | "todas";
  view: "kanban" | "lista" | "timeline";
}

interface SavedViewsBarProps {
  currentFilters: TarefasFiltros;
  onApply: (f: TarefasFiltros) => void;
}

export function SavedViewsBar({ currentFilters, onApply }: SavedViewsBarProps) {
  const { data: views = [] } = useViewsSalvas();
  const createView = useCreateViewSalva();
  const deleteView = useDeleteViewSalva();
  const [saveOpen, setSaveOpen] = useState(false);
  const [nome, setNome] = useState("");

  const handleSave = async () => {
    if (!nome.trim()) { toast.error("Dê um nome pra view"); return; }
    await createView.mutateAsync({
      nome: nome.trim(),
      filtros: currentFilters as unknown as Record<string, unknown>,
    });
    setNome("");
    setSaveOpen(false);
  };

  const handleApply = (v: ViewSalva) => {
    onApply(v.filtros as unknown as TarefasFiltros);
    toast.success(`View "${v.nome}" aplicada`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            Views
            {views.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px]">{views.length}</Badge>}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">Views salvas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {views.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Nenhuma view salva ainda
            </DropdownMenuItem>
          ) : views.map((v) => {
            const f = v.filtros as unknown as TarefasFiltros;
            return (
              <DropdownMenuItem key={v.id} className="flex items-start gap-2 py-2 cursor-pointer" onSelect={() => handleApply(v)}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{v.nome}</p>
                  <div className="flex gap-1 flex-wrap mt-0.5">
                    {f?.view && <Badge variant="outline" className="text-[9px] h-4">{f.view}</Badge>}
                    {f?.escopo && <Badge variant="outline" className="text-[9px] h-4">{f.escopo}</Badge>}
                    {f?.prioridade && f.prioridade !== "all" && <Badge variant="outline" className="text-[9px] h-4">{f.prioridade}</Badge>}
                    {f?.search && <Badge variant="outline" className="text-[9px] h-4">"{f.search.slice(0, 10)}"</Badge>}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover view "{v.nome}"?</AlertDialogTitle>
                      <AlertDialogDescription>Não afeta tarefas, apenas remove o filtro salvo.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteView.mutate(v.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSaveOpen(true); }} className="text-primary cursor-pointer">
            <BookmarkPlus className="mr-2 h-3.5 w-3.5" />
            Salvar view atual
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Salvar view atual</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome da view</Label>
              <Input
                placeholder="Ex: Minhas urgentes desta semana"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 p-2 rounded bg-muted/30">
              <div>Filtros atuais:</div>
              <div>· Escopo: <strong>{currentFilters.escopo}</strong></div>
              <div>· View: <strong>{currentFilters.view}</strong></div>
              {currentFilters.prioridade !== "all" && <div>· Prioridade: <strong>{currentFilters.prioridade}</strong></div>}
              {currentFilters.search && <div>· Busca: <strong>"{currentFilters.search}"</strong></div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createView.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
