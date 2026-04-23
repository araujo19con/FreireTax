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
import { ESCRITORIO_DEFAULT, renderVariaveis } from "./proposta";

function fmtBRL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Pré-processa XML de Word pra consertar placeholders quebrados em múltiplos
 * runs. Word adiciona <w:proofErr/> (spell-check) e separa cada caractere
 * digitado em diferentes momentos em runs próprios — então `{empresa_nome}`
 * digitado no Word vira algo como:
 *   <w:r><w:t>{</w:t></w:r>
 *   <w:proofErr w:type="spellStart"/>
 *   <w:r><w:t>empresa_nome</w:t></w:r>
 *   <w:proofErr w:type="spellEnd"/>
 *   <w:r><w:t>}</w:t></w:r>
 * docxtemplater não consegue casar `{...}` quebrado assim. Esta função:
 * 1) Remove todas as tags <w:proofErr/>
 * 2) Mescla pares de <w:t>...</w:t></w:r><w:r...><w:rPr>...</w:rPr><w:t>...</w:t>
 *    iterativamente até nada mais merge.
 */
function fixSplitPlaceholders(xml: string): string {
  // 1) Remove proofErr (auto-fechado, com qualquer atributo)
  let out = xml.replace(/<w:proofErr[^/]*\/>/g, "");

  // 2) Merge SELETIVO: só junta dois runs adjacentes quando o texto resultante
  //    ajuda a completar um placeholder ({...}). Não exige backref de atributos
  //    (que variam por deploy / Word version) nem rPr idêntico — usa o
  //    primeiro run como base. Faz N iterações até estabilizar.
  const adjacentRunsPair =
    /<w:r([^>]*)>((?:<w:rPr>[^]*?<\/w:rPr>)?)<w:t([^>]*)>([^<]*)<\/w:t><\/w:r><w:r[^>]*>(?:<w:rPr>[^]*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g;

  const helpsPlaceholder = (a: string, b: string): boolean => {
    // a termina sem fechar { ainda aberto, OU b começa fechando } pendente,
    // OU um deles é exatamente '{' ou '}', OU a junção forma {x}
    const opens = (a.match(/\{/g) || []).length - (a.match(/\}/g) || []).length;
    const closes = (b.match(/\}/g) || []).length - (b.match(/\{/g) || []).length;
    if (opens > 0 && closes >= 0) return true;
    if (a === "{" || b === "}" || a.endsWith("{") || b.startsWith("}")) return true;
    // A junção forma um placeholder válido?
    if (/\{[#/]?[a-zA-Z_][a-zA-Z0-9_]*\}/.test(a + b)) return true;
    return false;
  };

  let prev = "";
  let iterations = 0;
  while (out !== prev && iterations < 100) {
    prev = out;
    out = out.replace(adjacentRunsPair, (match, attr, rpr, tAttr, t1, t2) => {
      if (!helpsPlaceholder(t1, t2)) return match;
      return `<w:r${attr}>${rpr}<w:t${tAttr}>${t1}${t2}</w:t></w:r>`;
    });
    iterations++;
  }

  return out;
}

function htmlParaTexto(html: string): string {
  // Tira tags HTML mantendo quebras de linha por <p>/<br>.
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n");
  return (tmp.textContent || tmp.innerText || "").trim();
}

/**
 * Quebra HTML em array de parágrafos (cada item é texto plano).
 * Cada <p> vira um item; quebras simples <br> ficam dentro do mesmo item.
 * Usado pra alimentar o loop {#paragrafos}{texto}{/paragrafos} no template,
 * garantindo que cada parágrafo no Word seja um <w:p> de verdade
 * (e portanto receba o pPr completo, incluindo recuo de 1ª linha).
 */
function htmlParaParagrafos(html: string): Array<{ texto: string }> {
  if (!html) return [];
  // Divide por </p> e processa cada bloco
  const blocos = html.split(/<\/p>/i);
  const out: Array<{ texto: string }> = [];
  for (const bloco of blocos) {
    if (!bloco.trim()) continue;
    const tmp = document.createElement("div");
    // Mantém <br> como newline, listas com bullet
    tmp.innerHTML = bloco
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li>/gi, "• ")
      .replace(/<\/li>/gi, "\n");
    const txt = (tmp.textContent || tmp.innerText || "").trim();
    if (txt) out.push({ texto: txt });
  }
  return out.length > 0 ? out : [{ texto: "" }];
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
  // 1) Baixa o template — cache-bust pra evitar versão antiga em CDN/browser
  const cacheBust = `${params.templateUrl}${params.templateUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
  console.info("[propostaDocx] Fetching template:", cacheBust);
  const resp = await fetch(cacheBust, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Template não encontrado em ${params.templateUrl} (HTTP ${resp.status})`);
  }
  const buf = await resp.arrayBuffer();
  console.info("[propostaDocx] Template baixado:", buf.byteLength, "bytes");

  // 2) Abre o .docx (zip + xml interno) com pizzip
  const zip = new PizZip(buf);

  // 2.1) Conserta placeholders quebrados em multiple runs em todos os XMLs
  // do Word (document, headers, footers). Word adiciona <w:proofErr/> e
  // separa cada caractere em runs próprios, impedindo docxtemplater de
  // casar `{empresa_nome}`. fixSplitPlaceholders() resolve isso.
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("word/") && name.endsWith(".xml") &&
              (name.includes("document") || name.includes("header") || name.includes("footer"))
  );
  let totalPlaceholdersIntegros = 0;
  for (const fname of xmlFiles) {
    const file = zip.file(fname);
    if (!file) continue;
    const original = file.asText();
    const fixed = fixSplitPlaceholders(original);
    if (fixed !== original) {
      zip.file(fname, fixed);
      console.info(`[propostaDocx] ${fname}: XML modificado pelo fix (${original.length} → ${fixed.length} chars)`);
    } else if (fname.endsWith("document.xml")) {
      console.warn(`[propostaDocx] ${fname}: fix NÃO modificou o XML — possível problema no regex ou formato inesperado`);
    }
    // Conta placeholders íntegros para debug
    const phs = (fixed.match(/\{[#/]?[a-zA-Z_]+\}/g) || []);
    totalPlaceholdersIntegros += phs.length;
    if (phs.length > 0) console.info(`[propostaDocx] ${fname}: ${phs.length} placeholders íntegros`, [...new Set(phs)]);
    // Se for document.xml e ainda estiver quebrado, dump um trecho pra debug
    if (fname.endsWith("document.xml") && phs.length === 0) {
      // Procura por sequência típica de placeholder quebrado
      const idx = fixed.indexOf("empresa_nome");
      if (idx >= 0) {
        console.warn(`[propostaDocx] Trecho ao redor de 'empresa_nome' (não casou regex):`,
          fixed.substring(Math.max(0, idx - 300), Math.min(fixed.length, idx + 200)));
      } else {
        console.warn(`[propostaDocx] 'empresa_nome' não encontrado no XML — template não tem placeholders mesmo`);
      }
    }
  }
  if (totalPlaceholdersIntegros === 0) {
    throw new Error(
      "Template não contém placeholders ({empresa_nome}, {contato_nome}, etc.) — " +
      "o arquivo .docx baixado é o template oficial do escritório SEM marcadores. " +
      "Edite o template no Word e adicione os placeholders, ou troque o caminho em /propostas/templates."
    );
  }

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

    // Loop de seções: template usa {#secoes}{titulo}{#paragrafos}{texto}{/paragrafos}{/secoes}
    // Cada parágrafo do conteúdo vira um <w:p> separado no Word, ganhando o
    // recuo de 1ª linha do template. Variáveis {{empresa.nome}} etc são
    // substituídas via renderVariaveis ANTES de quebrar em parágrafos.
    secoes: params.secoes.map((s) => ({
      titulo: renderVariaveis(s.titulo, params.context),
      paragrafos: htmlParaParagrafos(renderVariaveis(s.conteudo, params.context)),
      // Compatibilidade: mantém conteudo_texto pra templates antigos que
      // ainda não foram migrados pra estrutura de loop
      conteudo_texto: htmlParaTexto(renderVariaveis(s.conteudo, params.context)),
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
