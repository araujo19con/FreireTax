import { useState, useEffect, useMemo } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  fetchMunicipiosIBGE,
  filterMunicipiosByUF,
  type IBGEMunicipio,
} from "@/lib/municipiosBrasil";

interface MunicipioMultiSelectProps {
  selectedUFs: string[];
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
}

export function MunicipioMultiSelect({
  selectedUFs,
  value,
  onChange,
  className,
}: MunicipioMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [allMunicipios, setAllMunicipios] = useState<IBGEMunicipio[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchMunicipiosIBGE()
      .then(setAllMunicipios)
      .catch((e) => {
        console.error("[MunicipioMultiSelect] falha ao buscar IBGE:", e);
        setError("Erro ao carregar municípios.");
      })
      .finally(() => setLoading(false));
  }

  // Carrega lista IBGE na primeira abertura
  useEffect(() => {
    if (!open || allMunicipios.length > 0) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allMunicipios.length]);

  const options = useMemo(
    () => filterMunicipiosByUF(allMunicipios, selectedUFs),
    [allMunicipios, selectedUFs],
  );

  function toggle(nome: string) {
    onChange(value.includes(nome) ? value.filter((v) => v !== nome) : [...value, nome]);
  }

  function remove(nome: string) {
    onChange(value.filter((v) => v !== nome));
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Badges dos selecionados */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((nome) => (
            <Badge
              key={nome}
              variant="secondary"
              className="text-[10px] gap-0.5 pr-1"
            >
              {nome}
              <button
                type="button"
                onClick={() => remove(nome)}
                className="ml-0.5 rounded-full hover:bg-muted"
                aria-label={`Remover ${nome}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full h-8 justify-between text-xs font-normal"
          >
            <span className="text-muted-foreground truncate">
              {value.length === 0
                ? "Buscar município…"
                : `${value.length} selecionado${value.length > 1 ? "s" : ""}`}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[260px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar município…" className="text-xs h-8" />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-4 gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando municípios…
                </div>
              )}
              {error && (
                <div className="py-3 px-3 text-xs text-destructive flex flex-col gap-1.5">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={load}
                    className="text-xs underline text-muted-foreground hover:text-foreground text-left"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
              {!loading && !error && (
                <>
                  <CommandEmpty className="text-xs py-3 text-center text-muted-foreground">
                    Nenhum município encontrado.
                  </CommandEmpty>
                  <CommandGroup>
                    {options.map((m) => {
                      const selected = value.includes(m.nome);
                      return (
                        <CommandItem
                          key={m.id}
                          value={m.nome}
                          onSelect={() => toggle(m.nome)}
                          className="text-xs"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3.5 w-3.5",
                              selected ? "opacity-100" : "opacity-0",
                            )}
                          />
                          {m.nome}
                          {selectedUFs.length === 0 && (
                            <span className="ml-auto text-[10px] text-muted-foreground">{m.uf}</span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
