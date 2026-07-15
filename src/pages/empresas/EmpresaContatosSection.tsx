import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Phone,
  MessageCircle,
  MessageSquareText,
  Mail,
  Linkedin,
  Star,
  Plus,
  Pencil,
  Trash2,
  UserRound,
  PhoneCall,
  PhoneOff,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/useAuth";
import { ContatoDialog } from "@/components/ContatoDialog";
import { TemplateSelectorDialog } from "@/components/TemplateSelectorDialog";
import type { TemplateVars } from "@/lib/templateEngine";
import {
  type EmpresaContato,
  humanizePapel,
  papelColor,
  humanizeOrigem,
  origemColor,
  rankContatos,
  formatPhoneBR,
  telLink,
  waLink,
  mailtoLink,
  linkedinUrl,
  mensagemWhatsappPadrao,
  TELEFONE_STATUS,
  telefoneStatusMeta,
  telefoneStatusInvalida,
  humanizeTelefoneStatus,
  type TelefoneStatus,
} from "@/lib/contatos";

/** Tese de maior valor potencial vinculada à empresa — usada pra personalizar
 *  a mensagem (o chamador já tem essa info via useEmpresaRelations, sem query nova). */
export interface TeseDestaque {
  nome: string;
  valorPotencial: number | null;
}

interface Props {
  empresaId: string;
  empresaNome: string;
  empresaCnpj?: string | null;
  teseDestaque?: TeseDestaque | null;
  /** dispara no pai pra invalidar queries (snapshot de contato em empresas) */
  onChanged?: () => void;
}

export function EmpresaContatosSection({
  empresaId,
  empresaNome,
  empresaCnpj,
  teseDestaque,
  onChanged,
}: Props) {
  const { profile } = useAuth();
  const [contatos, setContatos] = useState<EmpresaContato[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmpresaContato | null>(null);

  // Mensagem LinkedIn personalizada — 1 dialog reaproveitado pra qualquer contato
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgVars, setMsgVars] = useState<TemplateVars>({});
  const [msgLinkedin, setMsgLinkedin] = useState<string | null>(null);

  const abrirMensagemLinkedin = (c: EmpresaContato) => {
    setMsgVars({
      empresa: empresaNome,
      cnpj: empresaCnpj ?? null,
      contato_nome: c.nome,
      tese: teseDestaque?.nome ?? null,
      valor_potencial: teseDestaque?.valorPotencial ?? null,
      advogado_responsavel: profile?.nome ?? null,
    });
    setMsgLinkedin(linkedinUrl(c.linkedin));
    setMsgOpen(true);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("empresa_contatos")
      .select("*")
      .eq("empresa_id", empresaId);
    if (error) toast.error("Erro ao carregar contatos");
    setContatos((data ?? []).sort(rankContatos));
    setLoading(false);
  }, [empresaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = () => {
    void load();
    onChanged?.();
  };

  const novo = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const editar = (c: EmpresaContato) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const definirPrincipal = async (c: EmpresaContato) => {
    const { error } = await supabase
      .from("empresa_contatos")
      .update({ principal: true })
      .eq("id", c.id);
    if (error) return toast.error("Erro ao definir principal");
    toast.success(`${c.nome ?? "Contato"} é o principal agora`);
    void logAudit({
      tabela: "empresa_contatos",
      acao: "Definiu contato principal",
      registro_id: c.id,
      detalhes: { empresa_id: empresaId },
    });
    afterChange();
  };

  const setStatusTelefone = async (c: EmpresaContato, status: TelefoneStatus) => {
    if (c.telefone_status === status) return;
    // categoriza o resultado da tentativa direto no card — NÃO é toque de
    // prospecção. O trigger deriva telefone_invalido de numero_errado/nao_existe.
    const { error } = await supabase
      .from("empresa_contatos")
      .update({ telefone_status: status })
      .eq("id", c.id);
    if (error) return toast.error("Erro ao atualizar status do telefone");
    toast.success(`Telefone: ${humanizeTelefoneStatus(status)}`);
    void logAudit({
      tabela: "empresa_contatos",
      acao: "Alterou status do telefone",
      registro_id: c.id,
      detalhes: { empresa_id: empresaId, status },
    });
    afterChange();
  };

  const remover = async (c: EmpresaContato) => {
    const { error } = await supabase.from("empresa_contatos").delete().eq("id", c.id);
    if (error) return toast.error("Erro ao remover contato");
    toast.success("Contato removido");
    void logAudit({
      tabela: "empresa_contatos",
      acao: "Removeu contato",
      registro_id: c.id,
      detalhes: { empresa_id: empresaId },
    });
    afterChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Contatos {contatos.length > 0 && `(${contatos.length})`}
        </h3>
        <Button size="sm" variant="outline" className="h-7" onClick={novo}>
          <Plus className="mr-1 h-3 w-3" /> Adicionar
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded-md bg-muted" />
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        </div>
      ) : contatos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <UserRound className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Adicione manualmente ou importe da base DRIVA.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={novo}>
            <Plus className="mr-1 h-3 w-3" /> Adicionar contato
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {contatos.map((c) => (
            <ContatoCard
              key={c.id}
              c={c}
              empresaNome={empresaNome}
              onEdit={() => editar(c)}
              onDelete={() => void remover(c)}
              onPrincipal={() => void definirPrincipal(c)}
              onSetStatusTelefone={(s) => void setStatusTelefone(c, s)}
              onMensagemLinkedin={() => abrirMensagemLinkedin(c)}
            />
          ))}
        </div>
      )}

      <ContatoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        empresaId={empresaId}
        contato={editing}
        onSaved={afterChange}
      />

      <TemplateSelectorDialog
        open={msgOpen}
        onOpenChange={setMsgOpen}
        vars={msgVars}
        initialCategoria="abertura"
        canalFiltro="linkedin"
        linkedinProfileUrl={msgLinkedin}
      />
    </div>
  );
}

function ContatoCard({
  c,
  empresaNome,
  onEdit,
  onDelete,
  onPrincipal,
  onSetStatusTelefone,
  onMensagemLinkedin,
}: {
  c: EmpresaContato;
  empresaNome: string;
  onEdit: () => void;
  onDelete: () => void;
  onPrincipal: () => void;
  onSetStatusTelefone: (s: TelefoneStatus) => void;
  onMensagemLinkedin: () => void;
}) {
  const tel = telLink(c.telefone);
  const wa = c.whatsapp ? waLink(c.telefone, mensagemWhatsappPadrao(empresaNome, c.nome)) : null;
  const mail = mailtoLink(c.email, `Freire Pignataro Advogados — ${empresaNome}`);
  const lkd = linkedinUrl(c.linkedin);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors hover:bg-muted/30 ${
        c.principal ? "border-primary/40 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {c.principal && (
              <Crown className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Contato principal" />
            )}
            <span className="truncate text-sm font-medium">
              {c.nome || <span className="italic text-muted-foreground">Canal sem nome</span>}
            </span>
            <Badge variant="secondary" className={`text-[10px] ${papelColor(c.papel)}`}>
              {humanizePapel(c.papel)}
            </Badge>
            {c.is_contador && (
              <Badge variant="outline" className="text-[10px] text-orange-600">
                contador
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[9px] ${origemColor(c.origem)}`}
              title={`Procedência: ${humanizeOrigem(c.origem)}`}
            >
              {humanizeOrigem(c.origem)}
            </Badge>
          </div>
          {c.cargo && <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.cargo}</p>}

          <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {c.telefone && (
              <span
                className={`flex items-center gap-1.5 ${c.telefone_invalido ? "text-destructive" : ""}`}
              >
                <Phone className="h-3 w-3" />
                <span className={c.telefone_invalido ? "line-through" : ""}>
                  {formatPhoneBR(c.telefone)}
                </span>
                {c.tipo_telefone !== "desconhecido" && (
                  <span className="text-[10px] opacity-60">
                    ({c.tipo_telefone === "movel" ? "cel" : "fixo"})
                  </span>
                )}
                {c.telefone_status !== "nao_testado" && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${telefoneStatusMeta(c.telefone_status).color}`}
                    title={c.telefone_status_nota ?? humanizeTelefoneStatus(c.telefone_status)}
                  >
                    {telefoneStatusMeta(c.telefone_status).short}
                  </Badge>
                )}
              </span>
            )}
            {c.email && (
              <span className="flex items-center gap-1.5 truncate">
                <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{c.email}</span>
              </span>
            )}
          </div>
        </div>

        {/* Ações rápidas */}
        <div className="flex shrink-0 items-center gap-0.5">
          {tel && (
            <IconLink href={tel} title="Ligar">
              <PhoneCall className="h-3.5 w-3.5" />
            </IconLink>
          )}
          {wa && (
            <IconLink href={wa} title="WhatsApp" external className="text-green-600">
              <MessageCircle className="h-3.5 w-3.5" />
            </IconLink>
          )}
          {mail && (
            <IconLink href={mail} title="Email">
              <Mail className="h-3.5 w-3.5" />
            </IconLink>
          )}
          {lkd && (
            <IconLink
              href={lkd}
              title="Abrir perfil no LinkedIn"
              external
              className="text-[#0a66c2]"
            >
              <Linkedin className="h-3.5 w-3.5" />
            </IconLink>
          )}
          {lkd && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[#0a66c2]"
              title="Gerar mensagem personalizada de LinkedIn"
              aria-label="Gerar mensagem personalizada de LinkedIn"
              onClick={onMensagemLinkedin}
            >
              <MessageSquareText className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Rodapé de gestão */}
      <div className="mt-2 flex items-center justify-end gap-1 border-t border-border/60 pt-2">
        {!c.principal && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onPrincipal}>
            <Star className="mr-1 h-3 w-3" /> Tornar principal
          </Button>
        )}
        {c.telefone && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-6 px-2 text-[11px] ${
                  c.telefone_status === "nao_testado"
                    ? "text-muted-foreground"
                    : telefoneStatusInvalida(c.telefone_status)
                      ? "text-destructive hover:text-destructive"
                      : "text-amber-600 hover:text-amber-600"
                }`}
                title="Status do telefone (não conta como toque de prospecção)"
              >
                <PhoneOff className="mr-1 h-3 w-3" />
                {c.telefone_status === "nao_testado"
                  ? "Status tel."
                  : telefoneStatusMeta(c.telefone_status).short}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                Status do telefone
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={c.telefone_status}
                onValueChange={(v) => onSetStatusTelefone(v as TelefoneStatus)}
              >
                {TELEFONE_STATUS.map((s) => (
                  <DropdownMenuRadioItem key={s.value} value={s.value} className="text-xs">
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onEdit}
          aria-label="Editar"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
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
      className={`h-7 w-7 ${className ?? ""}`}
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
