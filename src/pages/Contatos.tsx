import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Contact,
  Search,
  Phone,
  Smartphone,
  PhoneCall,
  MessageCircle,
  Mail,
  Linkedin,
  Building2,
  UserRound,
  Crown,
  Gavel,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { EmpresaContato, PapelContato, OrigemContato } from "@/lib/contatos";
import {
  PAPEL_CONTATO,
  ORIGEM_CONTATO_META,
  humanizePapel,
  papelColor,
  humanizeOrigem,
  origemColor,
  formatPhoneBR,
  telLink,
  waLink,
  mailtoLink,
  linkedinUrl,
  mensagemWhatsappPadrao,
} from "@/lib/contatos";

type ContatoRow = EmpresaContato & {
  empresas: { id: string; nome: string; uf: string | null; municipio: string | null } | null;
};

// PostgrestFilterBuilder é profundo demais pra encadear vários filtros
// condicionais (TS 2589 "type instantiation excessively deep"). Tipo relaxado
// local só com os métodos usados — mesmo padrão de useEmpresas.ts.
type QB = {
  or: (filter: string) => QB;
  eq: (c: string, v: unknown) => QB;
  not: (c: string, op: string, v: unknown) => QB;
  neq: (c: string, v: unknown) => QB;
  ilike: (c: string, v: string) => QB;
};

const PAGE_SIZE = 30;
const UFS = [
  "RN",
  "PB",
  "PE",
  "CE",
  "PI",
  "RN",
  "AL",
  "SE",
  "BA",
  "MA",
  "SP",
  "RJ",
  "MG",
  "ES",
  "PR",
  "SC",
  "RS",
  "GO",
  "DF",
  "MT",
  "MS",
  "TO",
  "PA",
  "AM",
  "RO",
  "RR",
  "AC",
  "AP",
].filter((v, i, a) => a.indexOf(v) === i);

export default function Contatos() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [papel, setPapel] = useState<PapelContato | "todos">("todos");
  const [origem, setOrigem] = useState<OrigemContato | "todos">("todos");
  const [uf, setUf] = useState<string>("todas");
  const [soWhats, setSoWhats] = useState(false);
  const [comTel, setComTel] = useState(false);
  const [soCel, setSoCel] = useState(false);
  const [soPje, setSoPje] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);

  // debounce da busca
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [papel, origem, uf, soWhats, comTel, soCel, soPje]);

  const filtros = useMemo(
    () => ({ search, papel, origem, uf, soWhats, comTel, soCel, soPje, page }),
    [search, papel, origem, uf, soWhats, comTel, soCel, soPje, page]
  );

  const usaUf = uf !== "todas";
  const termoBusca = search.replace(/[%,()*]/g, " ").trim();

  const { data, isFetching } = useQuery({
    queryKey: ["contatos-global", filtros],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      let q = supabase
        .from("empresa_contatos")
        .select(
          `id, nome, cargo, papel, email, telefone, tipo_telefone, whatsapp, linkedin,
           is_contador, principal, origem, empresa_id,
           empresas${usaUf ? "!inner" : ""}(id, nome, uf, municipio)`,
          { count: "exact" }
        )
        .order("principal", { ascending: false })
        .order("nome", { ascending: true, nullsFirst: false })
        .range(from, from + PAGE_SIZE - 1) as unknown as QB;

      if (termoBusca)
        q = q.or(
          `nome.ilike.*${termoBusca}*,email.ilike.*${termoBusca}*,telefone.ilike.*${termoBusca}*,cargo.ilike.*${termoBusca}*`
        );
      if (papel !== "todos") q = q.eq("papel", papel);
      if (origem !== "todos") q = q.eq("origem", origem);
      if (soWhats) q = q.eq("whatsapp", true);
      if (comTel) q = q.not("telefone", "is", null).neq("telefone", "");
      if (soCel) q = q.eq("tipo_telefone", "movel");
      if (soPje) q = q.ilike("observacoes", "%PJe/TJRN%");
      if (usaUf) q = q.eq("empresas.uf", uf);

      const { data, error, count } = await (q as unknown as PromiseLike<{
        data: ContatoRow[] | null;
        error: { message: string } | null;
        count: number | null;
      }>);
      if (error) throw new Error(error.message);
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const exportarCsv = async () => {
    setExporting(true);
    try {
      const PG = 1000;
      const all: ContatoRow[] = [];
      for (let offset = 0; ; offset += PG) {
        let q = supabase
          .from("empresa_contatos")
          .select(
            `nome, cargo, papel, email, telefone, tipo_telefone, whatsapp, linkedin, origem,
             empresas${usaUf ? "!inner" : ""}(nome, uf, municipio)`
          )
          .order("nome", { ascending: true, nullsFirst: false })
          .range(offset, offset + PG - 1) as unknown as QB;

        if (termoBusca)
          q = q.or(
            `nome.ilike.*${termoBusca}*,email.ilike.*${termoBusca}*,telefone.ilike.*${termoBusca}*,cargo.ilike.*${termoBusca}*`
          );
        if (papel !== "todos") q = q.eq("papel", papel);
        if (origem !== "todos") q = q.eq("origem", origem);
        if (soWhats) q = q.eq("whatsapp", true);
        if (comTel) q = q.not("telefone", "is", null).neq("telefone", "");
        if (soCel) q = q.eq("tipo_telefone", "movel");
        if (soPje) q = q.ilike("observacoes", "%PJe/TJRN%");
        if (usaUf) q = q.eq("empresas.uf", uf);

        const { data, error } = await (q as unknown as PromiseLike<{
          data: ContatoRow[] | null;
          error: { message: string } | null;
        }>);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < PG) break;
      }
      if (!all.length) {
        toast.info("Nenhum contato para exportar com esses filtros.");
        return;
      }
      const head = [
        "Nome",
        "Empresa",
        "UF",
        "Município",
        "Papel",
        "Origem",
        "Cargo",
        "Telefone",
        "Tipo",
        "WhatsApp",
        "Email",
        "LinkedIn",
      ];
      const esc = (v: string | null | undefined) => {
        const s = v ?? "";
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = all.map((c) =>
        [
          c.nome,
          c.empresas?.nome,
          c.empresas?.uf,
          c.empresas?.municipio,
          humanizePapel(c.papel),
          humanizeOrigem(c.origem),
          c.cargo,
          formatPhoneBR(c.telefone),
          c.tipo_telefone,
          c.whatsapp ? "sim" : "",
          c.email,
          c.linkedin,
        ]
          .map(esc)
          .join(";")
      );
      const csv = "﻿" + [head.join(";"), ...lines].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contatos_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${all.length} contato${all.length === 1 ? "" : "s"} exportado(s).`);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao exportar contatos.");
    } finally {
      setExporting(false);
    }
  };

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const temFiltro =
    !!search ||
    papel !== "todos" ||
    origem !== "todos" ||
    uf !== "todas" ||
    soWhats ||
    comTel ||
    soCel ||
    soPje;

  const limpar = () => {
    setSearchInput("");
    setSearch("");
    setPapel("todos");
    setOrigem("todos");
    setUf("todas");
    setSoWhats(false);
    setComTel(false);
    setSoCel(false);
    setSoPje(false);
    setPage(0);
  };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Contatos"
        description="Busque e acione qualquer contato — decisores, sócios e canais de todas as empresas."
        icon={<Contact className="h-7 w-7" />}
      />

      {/* Busca + filtros */}
      <Card className="space-y-3 p-4 shadow-card">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nome, telefone, email ou cargo..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={papel} onValueChange={(v) => setPapel(v as PapelContato | "todos")}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Papel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os papéis</SelectItem>
              {PAPEL_CONTATO.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={origem} onValueChange={(v) => setOrigem(v as OrigemContato | "todos")}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as origens</SelectItem>
              {(Object.keys(ORIGEM_CONTATO_META) as OrigemContato[]).map((o) => (
                <SelectItem key={o} value={o}>
                  {ORIGEM_CONTATO_META[o].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={uf} onValueChange={setUf}>
            <SelectTrigger className="h-8 w-[100px] text-xs">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">UF: todas</SelectItem>
              {UFS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={soWhats ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setSoWhats((v) => !v)}
          >
            <MessageCircle className="mr-1 h-3.5 w-3.5" /> Só WhatsApp
          </Button>

          <Button
            variant={comTel ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setComTel((v) => !v)}
          >
            <Phone className="mr-1 h-3.5 w-3.5" /> Com telefone
          </Button>

          <Button
            variant={soCel ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setSoCel((v) => !v)}
            title="Só celulares (DDD + 9 dígitos) — separa o WhatsApp possível do fixo/switchboard"
          >
            <Smartphone className="mr-1 h-3.5 w-3.5" /> Só celular
          </Button>

          <Button
            variant={soPje ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setSoPje((v) => !v)}
            title="Sócios enriquecidos via PJe (CPF/endereço/telefone das petições)"
          >
            <Gavel className="mr-1 h-3.5 w-3.5" /> Só PJe
          </Button>

          {temFiltro && (
            <Button variant="ghost" size="sm" className="h-8" onClick={limpar}>
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8"
            onClick={() => void exportarCsv()}
            disabled={exporting || total === 0}
            title="Exportar a lista filtrada em CSV"
          >
            {exporting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Exportar
          </Button>

          <span className="text-xs tabular-nums text-muted-foreground">
            {total} contato{total === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      {/* Resultados */}
      {!isFetching && rows.length === 0 ? (
        <EmptyState
          icon={temFiltro ? Search : Contact}
          title={temFiltro ? "Nenhum contato encontrado" : "Nenhum contato ainda"}
          description={
            temFiltro
              ? "Ajuste a busca ou os filtros."
              : "Importe contatos da DRIVA ou enriqueça empresas pela Receita."
          }
          action={temFiltro ? { label: "Limpar filtros", icon: X, onClick: limpar } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <ContatoLinha key={c.id} c={c} />
          ))}
        </div>
      )}

      {/* Paginação */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContatoLinha({ c }: { c: ContatoRow }) {
  const empresaNome = c.empresas?.nome ?? "—";
  const tel = telLink(c.telefone);
  const wa = c.whatsapp ? waLink(c.telefone, mensagemWhatsappPadrao(empresaNome, c.nome)) : null;
  const mail = mailtoLink(c.email, `Freire Pignataro Advogados — ${empresaNome}`);
  const lkd = linkedinUrl(c.linkedin);

  return (
    <Card className="flex items-center justify-between gap-3 p-3 shadow-card transition-colors hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {c.principal && (
            <Crown className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Principal" />
          )}
          <span className="truncate text-sm font-medium">
            {c.nome || <span className="italic text-muted-foreground">Canal sem nome</span>}
          </span>
          <Badge variant="secondary" className={`text-[10px] ${papelColor(c.papel)}`}>
            {humanizePapel(c.papel)}
          </Badge>
          <Badge variant="outline" className={`text-[9px] ${origemColor(c.origem)}`}>
            {humanizeOrigem(c.origem)}
          </Badge>
          {c.is_contador && (
            <Badge variant="outline" className="text-[9px] text-orange-600">
              contador
            </Badge>
          )}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{empresaNome}</span>
          {c.empresas?.uf && (
            <span className="shrink-0">
              · {c.empresas.municipio ? `${c.empresas.municipio}/` : ""}
              {c.empresas.uf}
            </span>
          )}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {c.cargo && (
            <span className="flex items-center gap-1">
              <UserRound className="h-3 w-3" />
              {c.cargo}
            </span>
          )}
          {c.telefone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {formatPhoneBR(c.telefone)}
            </span>
          )}
          {c.email && (
            <span className="flex items-center gap-1 truncate">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.email}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {tel && (
          <IconLink href={tel} title="Ligar">
            <PhoneCall className="h-4 w-4" />
          </IconLink>
        )}
        {wa && (
          <IconLink href={wa} title="WhatsApp" external className="text-green-600">
            <MessageCircle className="h-4 w-4" />
          </IconLink>
        )}
        {mail && (
          <IconLink href={mail} title="Email">
            <Mail className="h-4 w-4" />
          </IconLink>
        )}
        {lkd && (
          <IconLink href={lkd} title="LinkedIn" external className="text-[#0a66c2]">
            <Linkedin className="h-4 w-4" />
          </IconLink>
        )}
      </div>
    </Card>
  );
}

function IconLink({
  href,
  title,
  children,
  external,
  className,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
  external?: boolean;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className={`h-8 w-8 ${className ?? ""}`}
      title={title}
    >
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label={title}
      >
        {children}
      </a>
    </Button>
  );
}
