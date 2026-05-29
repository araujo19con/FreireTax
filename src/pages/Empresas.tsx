import { useEffect, useMemo, useState, DragEvent, lazy, Suspense } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderPlus, Folder, FolderOpen, X, Gavel, Users, Sparkles, Upload } from "lucide-react";
import { BulkEnrichDialog } from "./empresas/BulkEnrichDialog";
import { ImportarParaPastaDialog } from "./empresas/ImportarParaPastaDialog";

import { PageHeader } from "@/components/PageHeader";
import { EmpresaDialog } from "@/components/EmpresaDialog";

import { EmpresasHeader } from "./empresas/EmpresasHeader";
import { EmpresasToolbar, type EmpresasView } from "./empresas/EmpresasToolbar";
import { EmpresasTableView } from "./empresas/EmpresasTableView";
import { EmpresasCardView } from "./empresas/EmpresasCardView";
import { EmpresasKanbanView } from "./empresas/EmpresasKanbanView";
import { EmpresaDetailSheet } from "./empresas/EmpresaDetailSheet";
const EmpresasMapView = lazy(() =>
  import("./empresas/EmpresasMapView").then((m) => ({ default: m.EmpresasMapView }))
);

import {
  useEmpresas,
  useCreateEmpresa,
  useUpdateEmpresa,
  useDeleteEmpresa,
  useBulkDeleteEmpresas,
  useEnrichEmpresa,
  fetchAllEmpresas,
  type Empresa,
  type EmpresaFilters,
  type EmpresaSort,
} from "@/hooks/useEmpresas";
import {
  usePastas,
  usePastaItems,
  useCreatePasta,
  useDeletePasta,
  useAddEmpresaToPasta,
  useRemoveEmpresaFromPasta,
  useBulkAddEmpresasToPasta,
} from "@/hooks/usePastas";
import { useAcoes } from "@/hooks/useAcoes";
import {
  useElegibilidades,
  useCreateElegibilidade,
  useDeleteElegibilidade,
} from "@/hooks/useElegibilidades";
import { formatCNPJ } from "@/lib/format";

export default function Empresas() {
  // --- Filters, search, sort, view, paging
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<EmpresaFilters>({});
  const [sort, setSort] = useState<EmpresaSort>("recent");
  const [view, setView] = useState<EmpresasView>("table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // reset page when search / filters / sort / view change
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filtersKey, sort, pageSize]);

  // Sinaliza pro empty state distinguir "pool vazio" (sem dados ainda) de
  // "filtro zerou resultado". CTA muda em cada caso.
  const hasActiveFilters =
    debouncedSearch.trim() !== "" ||
    Object.entries(filters).some(([, v]) => {
      if (v == null) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "string") return v.trim() !== "";
      return true; // boolean true ou number
    });

  const clearAllFilters = () => {
    setFilters({});
    setSearch("");
  };

  // --- Data queries
  const empresasQ = useEmpresas({ search: debouncedSearch, filters, sort, page, pageSize });
  const pastasQ = usePastas();
  const pastaItemsQ = usePastaItems();
  const acoesQ = useAcoes();
  const elegsQ = useElegibilidades();

  // --- Mutations
  const createEmp = useCreateEmpresa();
  const updateEmp = useUpdateEmpresa();
  const deleteEmp = useDeleteEmpresa();
  const bulkDeleteEmp = useBulkDeleteEmpresas();
  const enrichEmp = useEnrichEmpresa();

  const createPasta = useCreatePasta();
  const deletePasta = useDeletePasta();
  const addEmpPasta = useAddEmpresaToPasta();
  const removeEmpPasta = useRemoveEmpresaFromPasta();
  const bulkAddEmpPasta = useBulkAddEmpresasToPasta();

  const createEleg = useCreateElegibilidade();
  const _deleteEleg = useDeleteElegibilidade();

  // --- Local UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailEmpresa, setDetailEmpresa] = useState<Empresa | null>(null);
  const [empresaToEdit, setEmpresaToEdit] = useState<Empresa | null>(null);
  const [empresaToDelete, setEmpresaToDelete] = useState<Empresa | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkMovePastaOpen, setBulkMovePastaOpen] = useState(false);
  const [bulkVincularAcaoOpen, setBulkVincularAcaoOpen] = useState(false);
  const [bulkTargetPastaId, setBulkTargetPastaId] = useState<string>("");
  const [bulkTargetAcaoId, setBulkTargetAcaoId] = useState<string>("");

  const [pastaDialogOpen, setPastaDialogOpen] = useState(false);
  const [newPastaName, setNewPastaName] = useState("");
  const [importPastaTarget, setImportPastaTarget] = useState<{ id: string; nome: string } | null>(
    null
  );
  const [bulkEnrichOpen, setBulkEnrichOpen] = useState(false);

  // drag-drop to pasta/ação
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverPastaId, setDragOverPastaId] = useState<string | null>(null);
  const [dragOverAcaoId, setDragOverAcaoId] = useState<string | null>(null);

  // elegibilidade dialog triggered by drop
  const [elegDialogOpen, setElegDialogOpen] = useState(false);
  const [elegEmpresaId, setElegEmpresaId] = useState("");
  const [elegAcaoId, setElegAcaoId] = useState("");
  const [elegElegivel, setElegElegivel] = useState("true");
  const [elegJustificativa, setElegJustificativa] = useState("");

  // --- Derived
  const rows = empresasQ.data?.rows ?? [];
  const total = empresasQ.data?.total ?? 0;
  const pastas = useMemo(() => pastasQ.data ?? [], [pastasQ.data]);
  const pastaItems = useMemo(() => pastaItemsQ.data ?? [], [pastaItemsQ.data]);
  const acoes = acoesQ.data ?? [];
  const elegs = elegsQ.data ?? [];

  const pastaNamesByEmpresa = useMemo(() => {
    const byEmp = new Map<string, string[]>();
    for (const item of pastaItems) {
      const pasta = pastas.find((p) => p.id === item.pasta_id);
      if (!pasta) continue;
      const arr = byEmp.get(item.empresa_id) || [];
      arr.push(pasta.nome);
      byEmp.set(item.empresa_id, arr);
    }
    return byEmp;
  }, [pastaItems, pastas]);

  const empresaIdsInPasta = (pastaId: string) =>
    new Set(pastaItems.filter((i) => i.pasta_id === pastaId).map((i) => i.empresa_id));

  const empresaIdsInAcao = (acaoId: string) =>
    new Set(elegs.filter((e) => e.acao_id === acaoId).map((e) => e.empresa_id));

  // --- Selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allIds = rows.map((r) => r.id);
      const allSel = allIds.every((id) => prev.has(id));
      if (allSel) {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...allIds]);
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // --- Drag-drop handlers
  const handleDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData("empresaId", id);
    e.dataTransfer.effectAllowed = "copy";
    setDraggingId(id);
  };
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverPastaId(null);
    setDragOverAcaoId(null);
  };

  const handleDropPasta = async (e: DragEvent, pastaId: string) => {
    e.preventDefault();
    setDragOverPastaId(null);
    const id = e.dataTransfer.getData("empresaId");
    if (!id) return;
    const already = pastaItems.some((i) => i.pasta_id === pastaId && i.empresa_id === id);
    if (already) {
      toast.info("Empresa já está nesta pasta");
      return;
    }
    await addEmpPasta.mutateAsync({ empresaId: id, pastaId });
    toast.success("Empresa adicionada à pasta");
  };

  const handleDropAcao = (e: DragEvent, acaoId: string) => {
    e.preventDefault();
    setDragOverAcaoId(null);
    const id = e.dataTransfer.getData("empresaId");
    if (!id) return;
    const already = elegs.some((el) => el.acao_id === acaoId && el.empresa_id === id);
    if (already) {
      toast.info("Empresa já vinculada a esta ação");
      return;
    }
    setElegEmpresaId(id);
    setElegAcaoId(acaoId);
    setElegElegivel("true");
    setElegJustificativa("");
    setElegDialogOpen(true);
  };

  // --- CRUD handlers
  const handleCreate = async (data: Record<string, unknown>) => {
    await createEmp.mutateAsync(data);
  };

  const handleEdit = async (id: string, data: Record<string, unknown>) => {
    await updateEmp.mutateAsync({ id, data });
  };

  const handleDelete = (emp: Empresa) => setEmpresaToDelete(emp);
  const confirmDelete = async () => {
    if (!empresaToDelete) return;
    await deleteEmp.mutateAsync({ id: empresaToDelete.id, nome: empresaToDelete.nome });
    if (detailEmpresa?.id === empresaToDelete.id) setDetailEmpresa(null);
    setEmpresaToDelete(null);
  };

  // --- Bulk actions
  const handleBulkMovePasta = () => {
    if (selectedIds.size === 0) return;
    setBulkTargetPastaId(pastas[0]?.id || "");
    setBulkMovePastaOpen(true);
  };

  const confirmBulkMovePasta = async () => {
    if (!bulkTargetPastaId) {
      toast.error("Selecione uma pasta");
      return;
    }
    await bulkAddEmpPasta.mutateAsync({
      empresaIds: Array.from(selectedIds),
      pastaId: bulkTargetPastaId,
    });
    setBulkMovePastaOpen(false);
    clearSelection();
  };

  const handleBulkVincularAcao = () => {
    if (selectedIds.size === 0) return;
    setBulkTargetAcaoId(acoes[0]?.id || "");
    setBulkVincularAcaoOpen(true);
  };

  const confirmBulkVincularAcao = async () => {
    if (!bulkTargetAcaoId) {
      toast.error("Selecione uma ação");
      return;
    }
    // Cria elegibilidades em lote — para empresas que ainda não têm vínculo com a ação
    const alreadyLinked = new Set(
      elegs.filter((e) => e.acao_id === bulkTargetAcaoId).map((e) => e.empresa_id)
    );
    const toLink = Array.from(selectedIds).filter((id) => !alreadyLinked.has(id));
    if (!toLink.length) {
      toast.info("Todas as empresas selecionadas já estão vinculadas");
      setBulkVincularAcaoOpen(false);
      return;
    }

    let ok = 0,
      fail = 0;
    for (const empresaId of toLink) {
      try {
        await createEleg.mutateAsync({
          empresa_id: empresaId,
          acao_id: bulkTargetAcaoId,
          elegivel: true,
          justificativa: "Vínculo em lote",
        });
        ok++;
      } catch {
        fail++;
      }
    }
    toast.success(`${ok} vínculo(s) criado(s)${fail ? ` · ${fail} falharam` : ""}`);
    setBulkVincularAcaoOpen(false);
    clearSelection();
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setBulkDeleteOpen(true);
  };

  const confirmBulkDelete = async () => {
    await bulkDeleteEmp.mutateAsync(Array.from(selectedIds));
    setBulkDeleteOpen(false);
    clearSelection();
  };

  // --- Export
  const [exporting, setExporting] = useState(false);
  const handleExport = async (format: "csv" | "xlsx") => {
    if (exporting) return;
    setExporting(true);
    try {
      // Quando há seleção: exporta apenas selecionadas (já carregadas em rows).
      // Sem seleção: busca TODAS as empresas que casam com os filtros atuais
      // (não só a página visível) — pode ser milhares.
      let selected: Empresa[];
      if (selectedIds.size > 0) {
        selected = rows.filter((r) => selectedIds.has(r.id));
      } else {
        toast.info("Buscando todas as empresas do filtro…");
        selected = await fetchAllEmpresas({ search: debouncedSearch, filters, sort });
      }

      if (selected.length === 0) {
        toast.warning("Nenhuma empresa para exportar");
        return;
      }

      const data = selected.map((e) => ({
        Nome: e.nome,
        "Razão Social": e.razao_social || "",
        "Nome Fantasia": e.nome_fantasia || "",
        CNPJ: formatCNPJ(e.cnpj),
        Status: e.status,
        "Situação Cadastral": e.situacao_cadastral || "",
        Porte: e.porte || "",
        UF: e.uf || "",
        Município: e.municipio || "",
        "CNAE Principal": e.cnae_principal
          ? `${e.cnae_principal} — ${e.cnae_principal_desc || ""}`
          : "",
        "Simples Nacional": e.opcao_simples ? "Sim" : e.opcao_simples === false ? "Não" : "",
        "Capital Social": e.capital_social ?? "",
        "Valor Potencial": e.valor_potencial_total ?? "",
        "Data Abertura": e.data_abertura || "",
        Telefone: e.telefone_receita || "",
        "E-mail": e.email_receita || "",
        Endereço: [e.logradouro, e.numero_endereco, e.bairro, e.cep].filter(Boolean).join(", "),
        Pastas: (pastaNamesByEmpresa.get(e.id) || []).join("; "),
        "Última RFB": e.receita_atualizada_em || "",
        Observações: e.obs || "",
      }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Empresas");

      const today = new Date().toISOString().slice(0, 10);
      const filename = `empresas-${today}.${format}`;

      if (format === "xlsx") {
        XLSX.writeFile(wb, filename);
      } else {
        const csv = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success(
        `${data.length} empresa${data.length === 1 ? "" : "s"} exportada${data.length === 1 ? "" : "s"}`
      );
    } catch (e) {
      toast.error("Erro ao exportar: " + (e instanceof Error ? e.message : "falha"));
    } finally {
      setExporting(false);
    }
  };

  // --- Render
  const loading = empresasQ.isLoading || pastasQ.isLoading || acoesQ.isLoading;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Empresas"
        description="Gerencie empresas: busque, filtre, arraste para pastas ou ações tributárias."
        helpTutorialTab="fluxo"
        helpTooltip="Fluxo: Cadastrar empresas"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setBulkEnrichOpen(true)}
              title="Atualizar dados da Receita Federal em lote"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Atualizar RFB
            </Button>
            <Button variant="outline" onClick={() => setPastaDialogOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              Nova Pasta
            </Button>
            <EmpresaDialog
              onSave={(data) => {
                void handleCreate(data);
              }}
            />
          </>
        }
      />

      <EmpresasHeader />

      <div className="flex items-start gap-5">
        {/* LEFT — Pastas sidebar (oculta no modo mapa) */}
        <aside
          className={`sticky top-4 hidden w-56 shrink-0 space-y-1.5 lg:block ${view === "mapa" ? "!hidden" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pastas
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPastaDialogOpen(true)}
              aria-label="Criar nova pasta"
              title="Criar nova pasta"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              !filters.pastaId
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
            onClick={() => setFilters({ ...filters, pastaId: null })}
          >
            <Folder className="h-4 w-4" />
            <span>Todas</span>
          </button>

          {pastas.length === 0 && (
            <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
              <FolderPlus className="mx-auto mb-1 h-5 w-5 opacity-50" />
              Crie uma pasta
            </div>
          )}

          {pastas.map((p) => {
            const idsInPasta = empresaIdsInPasta(p.id);
            const isOver = dragOverPastaId === p.id;
            const isSelected = filters.pastaId === p.id;
            return (
              <div key={p.id}>
                <div
                  className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-all ${
                    isOver
                      ? "scale-[1.02] bg-primary/10 ring-2 ring-primary"
                      : isSelected
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted/50"
                  }`}
                  onClick={() => setFilters({ ...filters, pastaId: isSelected ? null : p.id })}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setDragOverPastaId(p.id);
                  }}
                  onDragLeave={() => setDragOverPastaId(null)}
                  onDrop={(e) => {
                    void handleDropPasta(e, p.id);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isOver ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{p.nome}</span>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {idsInPasta.size}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImportPastaTarget({ id: p.id, nome: p.nome });
                      }}
                      aria-label={`Importar empresas para ${p.nome}`}
                      title={`Importar empresas por planilha para ${p.nome}`}
                    >
                      <Upload className="h-2.5 w-2.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Excluir pasta ${p.nome}`}
                          title={`Excluir pasta ${p.nome}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir pasta "{p.nome}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            As empresas não serão removidas — só o vínculo.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              if (filters.pastaId === p.id)
                                setFilters({ ...filters, pastaId: null });
                              deletePasta.mutate(p.id);
                            }}
                          >
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {isOver && draggingId && (
                  <div className="mx-3 mt-1 rounded border border-dashed border-primary py-1 text-center text-[10px] font-medium text-primary">
                    Solte para adicionar
                  </div>
                )}

                {isSelected && idsInPasta.size > 0 && (
                  <div className="ml-6 mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                    {rows
                      .filter((r) => idsInPasta.has(r.id))
                      .map((emp) => (
                        <div
                          key={emp.id}
                          className="flex items-center justify-between rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
                        >
                          <span className="truncate">{emp.nome}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 shrink-0 text-destructive hover:text-destructive"
                            onClick={() =>
                              removeEmpPasta.mutate({ empresaId: emp.id, pastaId: p.id })
                            }
                            aria-label={`Remover ${emp.nome} da pasta ${p.nome}`}
                            title={`Remover ${emp.nome} desta pasta`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* CENTER — Toolbar + View */}
        <div className="min-w-0 flex-1 space-y-4">
          <EmpresasToolbar
            search={search}
            onSearchChange={setSearch}
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
            selectedIds={Array.from(selectedIds)}
            onBulkMovePasta={handleBulkMovePasta}
            onBulkVincularAcao={handleBulkVincularAcao}
            onBulkDelete={handleBulkDelete}
            onExport={(format) => {
              void handleExport(format);
            }}
            onClearSelection={clearSelection}
            totalCount={total}
          />

          {view === "table" && (
            <EmpresasTableView
              rows={rows}
              loading={loading}
              total={total}
              page={page}
              pageSize={pageSize}
              selectedIds={selectedIds}
              pastaNamesByEmpresa={pastaNamesByEmpresa}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearAllFilters}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onOpenDetail={setDetailEmpresa}
              onEnrichir={(e) => enrichEmp.mutate({ id: e.id, cnpj: e.cnpj })}
              onEdit={setEmpresaToEdit}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              draggingId={draggingId}
            />
          )}

          {view === "cards" && (
            <EmpresasCardView
              rows={rows}
              loading={loading}
              total={total}
              page={page}
              pageSize={pageSize}
              selectedIds={selectedIds}
              pastaNamesByEmpresa={pastaNamesByEmpresa}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearAllFilters}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onToggleSelect={toggleSelect}
              onOpenDetail={setDetailEmpresa}
              onEnrichir={(e) => enrichEmp.mutate({ id: e.id, cnpj: e.cnpj })}
              onEdit={setEmpresaToEdit}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              draggingId={draggingId}
            />
          )}

          {view === "kanban" && (
            <EmpresasKanbanView
              rows={rows}
              loading={loading}
              selectedIds={selectedIds}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearAllFilters}
              onToggleSelect={toggleSelect}
              onOpenDetail={setDetailEmpresa}
              onEnrichir={(e) => enrichEmp.mutate({ id: e.id, cnpj: e.cnpj })}
              onEdit={setEmpresaToEdit}
            />
          )}

          {view === "mapa" && (
            <Suspense
              fallback={
                <div className="flex h-96 items-center justify-center text-sm text-muted-foreground">
                  Carregando mapa…
                </div>
              }
            >
              <EmpresasMapView onOpenDetail={setDetailEmpresa} />
            </Suspense>
          )}
        </div>

        {/* RIGHT — Ações sidebar (oculta no modo mapa) */}
        <aside
          className={`sticky top-4 hidden w-56 shrink-0 space-y-1.5 lg:block ${view === "mapa" ? "!hidden" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ações Tributárias
            </h3>
          </div>

          {acoes.length === 0 && (
            <div className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
              <Gavel className="mx-auto mb-1 h-5 w-5 opacity-50" />
              Nenhuma ação cadastrada
            </div>
          )}

          {acoes.map((a) => {
            const idsInAcao = empresaIdsInAcao(a.id);
            const isOver = dragOverAcaoId === a.id;
            const isSelected = filters.acaoId === a.id;

            return (
              <div
                key={a.id}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-all ${
                  isOver
                    ? "scale-[1.02] bg-accent/20 ring-2 ring-accent"
                    : isSelected
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/50"
                }`}
                onClick={() => setFilters({ ...filters, acaoId: isSelected ? null : a.id })}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDragOverAcaoId(a.id);
                }}
                onDragLeave={() => setDragOverAcaoId(null)}
                onDrop={(e) => handleDropAcao(e, a.id)}
                title={`Filtrar por: ${a.nome}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Gavel className={`h-4 w-4 shrink-0 ${isOver ? "text-accent-foreground" : ""}`} />
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-medium">{a.nome}</span>
                    <span className="text-[10px] text-muted-foreground">{a.tipo}</span>
                  </div>
                </div>
                <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                  <Users className="mr-0.5 h-2.5 w-2.5" />
                  {idsInAcao.size}
                </Badge>

                {isOver && draggingId && (
                  <div className="absolute -bottom-5 left-0 right-0 mx-3 rounded border border-dashed border-accent bg-background py-1 text-center text-[10px] font-medium text-accent-foreground">
                    Solte para vincular
                  </div>
                )}
              </div>
            );
          })}
        </aside>
      </div>

      {/* Bulk enrich dialog */}
      <BulkEnrichDialog open={bulkEnrichOpen} onOpenChange={setBulkEnrichOpen} />

      {/* Detail Sheet */}
      <EmpresaDetailSheet
        empresa={detailEmpresa}
        onClose={() => setDetailEmpresa(null)}
        onEnrichir={(e) => enrichEmp.mutate({ id: e.id, cnpj: e.cnpj })}
        onEdit={(e) => setEmpresaToEdit(e)}
        onDelete={handleDelete}
      />

      {/* Edit dialog — controlado */}
      {empresaToEdit && (
        <EmpresaDialog
          key={empresaToEdit.id}
          open={!!empresaToEdit}
          onOpenChange={(o) => {
            if (!o) setEmpresaToEdit(null);
          }}
          onSave={(data) => {
            void (async () => {
              await handleEdit(empresaToEdit.id, data);
              setEmpresaToEdit(null);
            })();
          }}
          initialData={
            empresaToEdit as unknown as Parameters<typeof EmpresaDialog>[0]["initialData"]
          }
          title="Editar Empresa"
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!empresaToDelete} onOpenChange={(v) => !v && setEmpresaToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja remover "{empresaToDelete?.nome}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} empresa(s)?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmBulkDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk move to pasta */}
      <Dialog open={bulkMovePastaOpen} onOpenChange={setBulkMovePastaOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Mover {selectedIds.size} empresa(s) para pasta
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pasta destino</Label>
              <Select value={bulkTargetPastaId} onValueChange={setBulkTargetPastaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {pastas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pastas.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhuma pasta cadastrada. Crie uma primeiro.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMovePastaOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void confirmBulkMovePasta();
              }}
              disabled={!bulkTargetPastaId || pastas.length === 0}
            >
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk vincular ação */}
      <Dialog open={bulkVincularAcaoOpen} onOpenChange={setBulkVincularAcaoOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Vincular {selectedIds.size} empresa(s) a ação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ação tributária</Label>
              <Select value={bulkTargetAcaoId} onValueChange={setBulkTargetAcaoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {acoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Cria elegibilidades marcadas como "elegível" em lote. Empresas já vinculadas serão
                ignoradas.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkVincularAcaoOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void confirmBulkVincularAcao();
              }}
              disabled={!bulkTargetAcaoId || acoes.length === 0}
            >
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import to pasta via spreadsheet */}
      {importPastaTarget && (
        <ImportarParaPastaDialog
          open={!!importPastaTarget}
          onOpenChange={(v) => {
            if (!v) setImportPastaTarget(null);
          }}
          pastaId={importPastaTarget.id}
          pastaNome={importPastaTarget.nome}
        />
      )}

      {/* Create folder dialog */}
      <Dialog open={pastaDialogOpen} onOpenChange={setPastaDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Nova Pasta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome da Pasta</Label>
              <Input
                value={newPastaName}
                onChange={(e) => setNewPastaName(e.target.value)}
                placeholder="Ex: Empresas de Serviço"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPastaDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!newPastaName.trim()) {
                  toast.error("Nome obrigatório");
                  return;
                }
                createPasta.mutate(newPastaName.trim());
                setNewPastaName("");
                setPastaDialogOpen(false);
              }}
            >
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Elegibilidade dialog (drag-drop) */}
      <Dialog open={elegDialogOpen} onOpenChange={setElegDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Vincular Empresa à Ação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Empresa:</span>{" "}
                <span className="font-medium">
                  {rows.find((r) => r.id === elegEmpresaId)?.nome || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Ação:</span>{" "}
                <span className="font-medium">{acoes.find((a) => a.id === elegAcaoId)?.nome}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Elegível?</Label>
              <Select value={elegElegivel} onValueChange={setElegElegivel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim — Elegível</SelectItem>
                  <SelectItem value="false">Não — Não elegível</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Justificativa</Label>
              <Textarea
                value={elegJustificativa}
                onChange={(e) => setElegJustificativa(e.target.value)}
                placeholder="Motivo da decisão (opcional)"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setElegDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  await createEleg.mutateAsync({
                    empresa_id: elegEmpresaId,
                    acao_id: elegAcaoId,
                    elegivel: elegElegivel === "true",
                    justificativa: elegJustificativa || "",
                  });
                  setElegDialogOpen(false);
                })();
              }}
            >
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
