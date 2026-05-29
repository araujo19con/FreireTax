import { describe, it, expect } from "vitest";
import {
  renderVariaveis,
  renderSecoes,
  sanitizeProposalHtml,
  ESCRITORIO_DEFAULT,
  type ProposalContext,
  type ProposalSection,
} from "./proposta";

const baseCtx: ProposalContext = {
  empresa: { nome: "Acme S.A.", cnpj: "11.222.333/0001-81" },
  contato: { nome: "Maria Silva", cargo: "CFO", email: "m@acme.com" },
  acao: { nome: "Rescisória Tema 985" },
  prospeccao: { valor_potencial: 150_000 },
  honorarios: { entrada: 10_000, exito_percentual: 20 },
  escritorio: ESCRITORIO_DEFAULT,
};

describe("renderVariaveis — interpolação básica", () => {
  it("substitui variáveis simples", () => {
    expect(renderVariaveis("Olá {{contato.nome}}!", baseCtx)).toBe("Olá Maria Silva!");
  });
  it("preserva placeholder quando o path não existe", () => {
    expect(renderVariaveis("{{nao.existe}}", baseCtx)).toBe("{{nao.existe}}");
  });
  it("retorna em branco quando html vazio", () => {
    expect(renderVariaveis("", baseCtx)).toBe("");
  });
  it("renderiza — para valores null", () => {
    const ctx: ProposalContext = { ...baseCtx, contato: { nome: "X", cargo: null } };
    expect(renderVariaveis("{{contato.cargo}}", ctx)).toBe("—");
  });
});

describe("renderVariaveis — formatação numérica", () => {
  // Intl.NumberFormat("pt-BR") usa non-breaking space (U+00A0) entre R$ e
  // o número. Usamos /\s/ pra ficar resiliente ao código exato do separador.
  it("formata honorarios.entrada em BRL", () => {
    expect(renderVariaveis("{{honorarios.entrada}}", baseCtx)).toMatch(/^R\$\s10\.000,00$/);
  });
  it("formata honorarios.exito_percentual sem símbolo (template adiciona %)", () => {
    expect(renderVariaveis("{{honorarios.exito_percentual}}", baseCtx)).toBe("20");
  });
  it("formata prospeccao.valor_potencial em BRL", () => {
    expect(renderVariaveis("{{prospeccao.valor_potencial}}", baseCtx)).toMatch(
      /^R\$\s150\.000,00$/
    );
  });
});

describe("renderVariaveis — XSS escape (camada 1)", () => {
  it("escapa < e > em valores de string", () => {
    const ctx: ProposalContext = {
      ...baseCtx,
      empresa: { ...baseCtx.empresa, nome: "<script>alert(1)</script>" },
    };
    const out = renderVariaveis("Empresa: {{empresa.nome}}", ctx);
    expect(out).toBe("Empresa: &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("escapa aspas pra impedir quebra de atributo", () => {
    const ctx: ProposalContext = {
      ...baseCtx,
      empresa: { ...baseCtx.empresa, nome: `" onerror="alert(1)` },
    };
    const out = renderVariaveis(`<img alt="{{empresa.nome}}">`, ctx);
    expect(out).not.toContain(`onerror="`);
    expect(out).toContain("&quot;");
  });

  it("escapa & corretamente (não reverte entities pré-existentes)", () => {
    const ctx: ProposalContext = {
      ...baseCtx,
      empresa: { ...baseCtx.empresa, nome: "Tom & Jerry & Co" },
    };
    expect(renderVariaveis("{{empresa.nome}}", ctx)).toBe("Tom &amp; Jerry &amp; Co");
  });

  it("não escapa valores numéricos formatados (BRL contém R$)", () => {
    // R$ contém $ que não é HTML — não precisa escape
    expect(renderVariaveis("{{honorarios.entrada}}", baseCtx)).toMatch(/^R\$\s10\.000,00$/);
  });
});

describe("renderSecoes", () => {
  it("aplica renderVariaveis em título e conteúdo de todas as seções", () => {
    const secoes: ProposalSection[] = [
      {
        ordem: 1,
        titulo: "Proposta para {{empresa.nome}}",
        conteudo: "Valor: {{honorarios.entrada}}",
      },
    ];
    const out = renderSecoes(secoes, baseCtx);
    expect(out[0].titulo).toBe("Proposta para Acme S.A.");
    expect(out[0].conteudo).toMatch(/^Valor: R\$\s10\.000,00$/);
  });
  it("não muta o array original", () => {
    const secoes: ProposalSection[] = [{ ordem: 1, titulo: "{{empresa.nome}}", conteudo: "" }];
    renderSecoes(secoes, baseCtx);
    expect(secoes[0].titulo).toBe("{{empresa.nome}}");
  });
});

describe("sanitizeProposalHtml (camada 2 — defense in depth)", () => {
  it("remove tags <script>", () => {
    expect(sanitizeProposalHtml("<script>alert(1)</script><p>ok</p>")).toBe("<p>ok</p>");
  });
  it("remove atributos on* (event handlers)", () => {
    const out = sanitizeProposalHtml('<a href="#" onclick="alert(1)">link</a>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("link");
  });
  it("bloqueia javascript: em href", () => {
    const out = sanitizeProposalHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
  it("preserva tags seguras (p, strong, em, ul, etc)", () => {
    const html = "<p><strong>Importante</strong>: <em>ler</em></p>";
    expect(sanitizeProposalHtml(html)).toBe(html);
  });
  it("preserva mailto: e tel: e https: em href", () => {
    expect(sanitizeProposalHtml('<a href="mailto:a@b.com">x</a>')).toContain("mailto:a@b.com");
    expect(sanitizeProposalHtml('<a href="tel:+5511999999999">x</a>')).toContain(
      "tel:+5511999999999"
    );
    expect(sanitizeProposalHtml('<a href="https://a.com">x</a>')).toContain("https://a.com");
  });
});
