import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmpresaDetailSheet } from "./EmpresaDetailSheet";
import type { Empresa } from "@/hooks/useEmpresas";

interface EmpresaQuickSheetProps {
  empresaId: string | null;
  onClose: () => void;
}

/**
 * Abre EmpresaDetailSheet buscando a empresa por ID.
 * Usado em painéis que não têm o objeto Empresa completo em memória
 * (Ações Tributárias, Prospecção, Matriz Elegibilidade).
 * Ações de editar/enriquecer/deletar redirecionam para /empresas.
 */
export function EmpresaQuickSheet({ empresaId, onClose }: EmpresaQuickSheetProps) {
  const navigate = useNavigate();

  const { data: empresa, isLoading } = useQuery({
    queryKey: ["empresa-quick", empresaId],
    enabled: !!empresaId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("*")
        .eq("id", empresaId!)
        .maybeSingle();
      if (error) throw error;
      return data as Empresa | null;
    },
  });

  // Sheet de loading (exibido enquanto dados chegam)
  if (empresaId && isLoading) {
    return (
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary shrink-0" />
              <Skeleton className="h-5 w-48" />
            </SheetTitle>
            <Skeleton className="h-3 w-32 mt-1" />
          </SheetHeader>
          <div className="p-6 space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <EmpresaDetailSheet
      empresa={empresa ?? null}
      onClose={onClose}
      onEdit={() => { onClose(); navigate("/empresas"); }}
      onEnrichir={() => { onClose(); navigate("/empresas"); }}
      onDelete={() => { onClose(); navigate("/empresas"); }}
    />
  );
}
