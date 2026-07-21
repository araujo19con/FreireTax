// HTML do relatório de teses para impressão/PDF.
// Mesma estratégia do PropostaDialog: <table> com thead/tfoot, que o Chrome
// re-imprime nativamente a cada quebra de página (position:fixed só ancora na 1ª).

export interface RelatorioEmpresa {
  nome: string;
  cnpj: string;
  uf: string;
  municipio: string;
  regime: string;
  regimeConhecido: boolean;
  jaAjuizadas: Array<{ tese: string; numero: string; grau: string; orgao: string }>;
  sugeridas: Array<{ tese: string; numero: string }>;
  podeEntrar: string[];
}

interface Escritorio {
  nome: string;
  advogado: string;
  endereco: string;
  telefone: string;
  site: string;
}

const esc = (s: string) =>
  (s || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );

export function renderRelatorioTesesHTML(
  dados: RelatorioEmpresa[],
  escritorio: Escritorio
): string {
  const logoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%">
      <circle cx="60" cy="60" r="55" fill="none" stroke="#3a3f48" stroke-width="2.5"/>
      <text x="60" y="80" font-family="Georgia,'Times New Roman',serif" font-size="60"
            font-style="italic" font-weight="500" fill="#3a3f48" text-anchor="middle"
            letter-spacing="-2">FP</text>
    </svg>`;
  const bandaTopo = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 240" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="0" y="0" width="2100" height="240" fill="#d3b58a"/>
      <rect x="588" y="0" width="462" height="240" fill="#3a3f48"/>
      <polygon points="1344,0 1680,0 1620,240 1284,240" fill="#c98253"/>
    </svg>`;
  const bandaRodape = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2100 240" preserveAspectRatio="none" width="100%" height="100%">
      <rect x="0" y="0" width="2100" height="240" fill="#d3b58a"/>
      <rect x="252" y="0" width="798" height="240" fill="#3a3f48"/>
      <polygon points="1218,0 1512,0 1572,240 1278,240" fill="#c98253"/>
    </svg>`;

  const hoje = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const totOfertas = dados.reduce((a, d) => a + d.podeEntrar.length, 0);
  const totAjuizadas = dados.reduce((a, d) => a + d.jaAjuizadas.length, 0);

  const secoes = dados
    .map((d, i) => {
      const ajuizadas = d.jaAjuizadas.length
        ? `<ul class="lista">${d.jaAjuizadas
            .map(
              (t) =>
                `<li><span class="tese">${esc(t.tese)}</span>
                   <span class="proc">${esc(t.numero)}${t.orgao ? " · " + esc(t.orgao) : ""}</span></li>`
            )
            .join("")}</ul>`
        : `<p class="vazio">Nenhuma tese identificada como já ajuizada.</p>`;

      const sugeridas = d.sugeridas.length
        ? `<div class="bloco alerta">
             <h4>A confirmar</h4>
             <ul class="lista">${d.sugeridas
               .map(
                 (t) =>
                   `<li><span class="tese">${esc(t.tese)}</span>
                      <span class="proc">${esc(t.numero)}</span></li>`
               )
               .join("")}</ul>
             <p class="nota">Processos tributários da empresa cuja tese ainda depende de confirmação documental.</p>
           </div>`
        : "";

      const oferta = d.podeEntrar.length
        ? `<ol class="lista-oferta">${d.podeEntrar.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`
        : `<p class="vazio">Nenhuma tese adicional aplicável no catálogo atual.</p>`;

      return `
      <section class="empresa${i > 0 ? " quebra" : ""}">
        <div class="emp-head">
          <h2>${esc(d.nome)}</h2>
          <p class="emp-meta">
            CNPJ ${esc(d.cnpj)}${d.uf ? " &nbsp;·&nbsp; " + esc(d.municipio ? d.municipio + "/" + d.uf : d.uf) : ""}
            &nbsp;·&nbsp; <strong>${esc(d.regime)}</strong>
          </p>
        </div>

        <div class="numeros">
          <div class="num"><span class="n">${d.jaAjuizadas.length}</span><span class="rot">já ajuizada(s)</span></div>
          <div class="num destaque"><span class="n">${d.podeEntrar.length}</span><span class="rot">a oferecer</span></div>
        </div>

        <div class="bloco ok">
          <h4>Teses já ajuizadas</h4>
          ${ajuizadas}
        </div>

        ${sugeridas}

        <div class="bloco oferta">
          <h4>Teses aplicáveis ainda não ajuizadas</h4>
          ${oferta}
          ${
            d.regimeConhecido
              ? `<p class="nota">Filtrado pelo regime de tributação da empresa (${esc(d.regime)}).</p>`
              : `<p class="nota">Regime tributário não informado — a lista não pôde ser filtrada por regime.</p>`
          }
        </div>
      </section>`;
    })
    .join("");

  const css = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1f1f1f; line-height: 1.5; font-size: 10.5pt; }

    table.folha { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.folha thead { display: table-header-group; }
    table.folha tfoot { display: table-footer-group; }
    table.folha td { padding: 0; vertical-align: top; }

    .banda { display: block; width: 100%; height: 10mm; line-height: 0; }
    .header-area { padding: 6mm 18mm 4mm; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #c0c0c0; }
    .header-area .logo { width: 22mm; height: 22mm; flex-shrink: 0; }
    .header-area .text { line-height: 1.15; color: #4a4a4a; flex: 1; }
    .header-area .nome { font-size: 12pt; color: #3a3f48; font-weight: 600; }
    .header-area .sub { font-size: 8pt; color: #7a7a7a; }

    .footer-area { padding: 3mm 18mm 4mm; border-top: 1px solid #c0c0c0; font-size: 7.5pt; color: #8a8a8a; text-align: center; }

    .corpo { padding: 7mm 18mm 5mm; }

    h1.titulo { font-size: 15pt; color: #3a3f48; margin: 0 0 1mm; letter-spacing: .3px; }
    .subtitulo { font-size: 9pt; color: #7a7a7a; margin: 0 0 6mm; }
    .resumo { background: #faf7f2; border-left: 3px solid #c98253; padding: 3mm 4mm; margin-bottom: 7mm; font-size: 9.5pt; }

    section.empresa { margin-bottom: 8mm; }
    section.quebra { page-break-before: always; padding-top: 4mm; }
    .emp-head { border-bottom: 2px solid #3a3f48; padding-bottom: 1.5mm; margin-bottom: 3mm; }
    .emp-head h2 { font-size: 12.5pt; color: #3a3f48; margin: 0; }
    .emp-meta { font-size: 8.5pt; color: #7a7a7a; margin: 1mm 0 0; }

    .numeros { display: flex; gap: 4mm; margin-bottom: 4mm; }
    .num { flex: 1; text-align: center; border: 1px solid #e0dbd2; border-radius: 2mm; padding: 2.5mm; }
    .num .n { display: block; font-size: 17pt; color: #3a3f48; font-weight: 600; line-height: 1; }
    .num .rot { display: block; font-size: 7.5pt; color: #8a8a8a; text-transform: uppercase; letter-spacing: .5px; margin-top: 1mm; }
    .num.destaque { background: #fdf6ee; border-color: #c98253; }
    .num.destaque .n { color: #c98253; }

    .bloco { margin-bottom: 4mm; padding: 3mm 4mm; border-radius: 2mm; page-break-inside: avoid; }
    .bloco h4 { margin: 0 0 2mm; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .6px; }
    .bloco.ok { background: #f4f7f4; border-left: 3px solid #4a7c59; }
    .bloco.ok h4 { color: #4a7c59; }
    .bloco.alerta { background: #fdfaf2; border-left: 3px solid #c9a227; }
    .bloco.alerta h4 { color: #9a7b0f; }
    .bloco.oferta { background: #faf7f2; border-left: 3px solid #c98253; }
    .bloco.oferta h4 { color: #c98253; }

    ul.lista, ol.lista-oferta { margin: 0; padding-left: 5mm; }
    ul.lista li, ol.lista-oferta li { margin-bottom: 1.5mm; font-size: 9.5pt; }
    .tese { font-weight: 600; }
    .proc { display: block; font-family: 'Courier New', monospace; font-size: 8pt; color: #8a8a8a; }
    .vazio { margin: 0; font-size: 9pt; color: #9a9a9a; font-style: italic; }
    .nota { margin: 2mm 0 0; font-size: 7.5pt; color: #9a9a9a; }
  `;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório de teses — ${esc(escritorio.nome)}</title><style>${css}</style></head><body>
<table class="folha">
  <thead><tr><td>
    <div class="banda">${bandaTopo}</div>
    <div class="header-area">
      <div class="logo">${logoSvg}</div>
      <div class="text">
        <div class="nome">${esc(escritorio.nome)}</div>
        <div class="sub">${esc(escritorio.endereco)} &nbsp;·&nbsp; ${esc(escritorio.telefone)}</div>
      </div>
    </div>
  </td></tr></thead>

  <tfoot><tr><td>
    <div class="footer-area">
      ${esc(escritorio.advogado)} &nbsp;·&nbsp; ${esc(escritorio.site)}
    </div>
    <div class="banda">${bandaRodape}</div>
  </td></tr></tfoot>

  <tbody><tr><td>
    <div class="corpo">
      <h1 class="titulo">Relatório de Teses Tributárias</h1>
      <p class="subtitulo">Emitido em ${esc(hoje)}</p>
      <div class="resumo">
        <strong>${dados.length}</strong> empresa(s) analisada(s) &nbsp;·&nbsp;
        <strong>${totAjuizadas}</strong> tese(s) já ajuizada(s) identificada(s) &nbsp;·&nbsp;
        <strong>${totOfertas}</strong> oportunidade(s) de tese ainda não ajuizada(s).
        <br><span style="font-size:8pt;color:#8a8a8a">
          As teses já ajuizadas foram identificadas por consulta ao PJe pelo CNPJ da empresa,
          com validação pelo objeto da petição inicial.
        </span>
      </div>
      ${secoes}
    </div>
  </td></tr></tbody>
</table>
</body></html>`;
}
