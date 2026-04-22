// Geração de Word (.docx) a partir do template oficial do escritório.
// Usa docxtemplater + pizzip — fidelidade 100% ao layout do Word
// (header/footer/timbrado se mantêm intactos, só preenche variáveis).
//
// Placeholders suportados no .docx:
//   {empresa_nome}, {empresa_cnpj}, {empresa_razao_social}
//   {contato_nome}, {contato_cargo}, {contato_email}, {contato_telefone}
//   {acao_nome}
//   {honorarios_entrada}, {honorarios_exito}
//   {prospeccao_valor_potencial}
//   {titulo_proposta}, {introducao}
//   {signatario_nome}, {signatario_cargo}
//   {data_proposta}
//   {escritorio_nome}, {escritorio_advogado}
//   {#secoes}{titulo}\n{conteudo_texto}{/secoes}  (loop de seções)

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { saveAs } from "file-saver";
import type { ProposalSection, ProposalContext } from "./proposta";
import { ESCRITORIO_DEFAULT } from "./proposta";

function fmtBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 2,
  }).format(n);
}

function htmlParaTexto(html: string): string {
  // Tira tags HTML mantendo quebras de linha por <p>/<br>.
  // O .docx final fica em texto cru — formatação rica do template é preservada
  // pelo próprio Word (estilos de parágrafo aplicados via {styles} no template).
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n");
  // Remove tags restantes
  return (tmp.textContent || tmp.innerText || "").trim();
}

export interface PropostaDocxParams {
  templateUrl: string;          // URL/path do .docx (ex: /template-proposta-padrao.docx)
  filename: string;              // nome do arquivo de saída
  context: ProposalContext;      // dados pra preencher
  titulo: string;
  destinatarioEmpresa: string;
  destinatarioAtt: string;
  textoIntroducao: string;
  secoes: ProposalSection[];
  signatarioNome: string;
  signatarioCargo: string;
}

/**
 * Carrega o .docx template, preenche placeholders e dispara download.
 * Lança erro com mensagem clara se template não puder ser carregado/processado.
 */
export async function gerarPropostaDocx(params: PropostaDocxParams): Promise<void> {
  // 1) Baixa o template
  const resp = await fetch(params.templateUrl);
  if (!resp.ok) {
    throw new Error(`Template não encontrado em ${params.templateUrl} (HTTP ${resp.status})`);
  }
  const buf = await resp.arrayBuffer();

  // 2) Abre o .docx (zip + xml interno) com pizzip
  const zip = new PizZip(buf);

  // 3) Configura docxtemplater
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  // 4) Monta o objeto de variáveis pro template
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const data = {
    // Empresa
    empresa_nome: params.context.empresa.nome || params.destinatarioEmpresa,
    empresa_cnpj: params.context.empresa.cnpj,
    empresa_razao_social: params.context.empresa.razao_social || params.context.empresa.nome,

    // Contato
    contato_nome: params.context.contato.nome || params.destinatarioAtt,
    contato_cargo: params.context.contato.cargo || "",
    contato_email: params.context.contato.email || "",
    contato_telefone: params.context.contato.telefone || "",

    // Ação
    acao_nome: params.context.acao.nome,

    // Honorários
    honorarios_entrada: fmtBRL(params.context.honorarios.entrada),
    honorarios_exito: params.context.honorarios.exito_percentual != null
      ? `${params.context.honorarios.exito_percentual}%`
      : "—",

    // Prospecção
    prospeccao_valor_potencial: fmtBRL(params.context.prospeccao.valor_potencial),

    // Cabeçalho da proposta
    titulo_proposta: params.titulo,
    destinatario_empresa: params.destinatarioEmpresa,
    destinatario_att: params.destinatarioAtt,
    introducao: params.textoIntroducao,

    // Loop de seções: no .docx use {#secoes}{titulo}\n{conteudo_texto}{/secoes}
    secoes: params.secoes.map((s) => ({
      titulo: s.titulo,
      conteudo_texto: htmlParaTexto(s.conteudo),
    })),

    // Assinatura + escritório
    signatario_nome: params.signatarioNome,
    signatario_cargo: params.signatarioCargo,
    escritorio_nome: ESCRITORIO_DEFAULT.nome,
    escritorio_advogado: ESCRITORIO_DEFAULT.advogado,

    // Data
    data_proposta: today,
  };

  // 5) Renderiza
  try {
    doc.render(data);
  } catch (e) {
    // docxtemplater retorna erros estruturados — humaniza pra mostrar pro usuário
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    if (err?.properties?.errors) {
      const msgs = err.properties.errors.map((x: { properties?: { explanation?: string; id?: string } }) =>
        x.properties?.explanation ?? x.properties?.id ?? "erro").join("; ");
      throw new Error(`Erro nos placeholders do template: ${msgs}`);
    }
    throw e;
  }

  // 6) Gera o blob e dispara download
  const out = doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  saveAs(out, params.filename);
}

/**
 * Gera nome de arquivo limpo a partir do contexto.
 * Ex: "Proposta — ACME Tech — Lucro Presumido — 2026-04-22.docx"
 */
export function gerarNomeArquivoDocx(params: { empresaNome: string; acaoNome?: string | null }): string {
  const sanit = (s: string) => s.replace(/[^\w\s\-áéíóúàâêôãõçÁÉÍÓÚÀÂÊÔÃÕÇ]/g, "").trim();
  const data = new Date().toISOString().slice(0, 10);
  const partes = ["Proposta", sanit(params.empresaNome)];
  if (params.acaoNome) partes.push(sanit(params.acaoNome));
  partes.push(data);
  return partes.join(" — ").slice(0, 200) + ".docx";
}
