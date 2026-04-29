import PizZip from "pizzip";
import { readFileSync, writeFileSync, copyFileSync } from "fs";

const buf = readFileSync("public/template-proposta-padrao.docx");
const zip = new PizZip(buf);
const docXml = zip.file("word/document.xml").asText();

function modifyParagraph(xml, marker, transform) {
  const idx = xml.indexOf(`<w:t>${marker}</w:t>`);
  if (idx === -1) { console.warn(`  Marker '${marker}' não encontrado`); return xml; }
  const pStart = xml.lastIndexOf("<w:p ", idx);
  const pEnd = xml.indexOf("</w:p>", idx) + "</w:p>".length;
  if (pStart === -1 || pEnd <= pStart) return xml;
  const original = xml.substring(pStart, pEnd);
  const modified = transform(original);
  if (modified !== original) console.log(`  ✓ Modificado parágrafo de '${marker}'`);
  return xml.substring(0, pStart) + modified + xml.substring(pEnd);
}

let modified = modifyParagraph(docXml, "titulo", (p) =>
  p.replace(/<w:rPr>(?!\s*<w:b\/>)/g, "<w:rPr><w:b/><w:bCs/>")
);
modified = modifyParagraph(modified, "conteudo_texto", (p) => {
  if (p.includes('<w:ind ') && p.includes('w:firstLine=')) return p;
  if (p.includes("<w:pPr>")) return p.replace("</w:pPr>", '<w:ind w:firstLine="708"/></w:pPr>');
  return p;
});

zip.file("word/document.xml", modified);
const out = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync("template-fixed.tmp.docx", out);
copyFileSync("template-fixed.tmp.docx", "public/template-proposta-padrao.docx");
console.log(`Tamanho final: ${out.length} bytes`);
