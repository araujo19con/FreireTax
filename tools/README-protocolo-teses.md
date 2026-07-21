# Protocolo de análise de teses no PJe

Descobre, por CNPJ, **quais teses tributárias a empresa já ajuizou** — para saber
quais ainda dá pra oferecer (o "gap" que aparece no card da empresa).

## Como se pede (UI)

Empresa → aba **Ações** → card "Protocolo de teses no PJe" → botão **Analisar teses**.

Isso apenas **enfileira** (`empresas.teses_status = 'pendente'`). O scraper roda
localmente porque precisa do **certificado A3** no Chrome real — a aplicação web
não tem como fazer isso.

## Como se executa (local)

```powershell
. .\tools\pje-env.local.ps1
.\tools\chrome-cdp.ps1 -Tj trf5        # abre o Chrome real; faça o LOGIN A3
python tools\pje_teses_empresa.py --fila --cdp --gravar
```

`--fila` consome as empresas pendentes (mais antigas primeiro, `--limit` controla
quantas) e move o status: `pendente → processando → concluido | erro`. O resultado
vai para `empresa_processos_tributarios` e aparece na mesma aba.

## O que o protocolo padrão varre

`--fila` usa `--graus 1gf,2gf,1x`:

| Grau  | Instância                                          | O quê                                                                     |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `1gf` | `pje1g.trf5.jus.br`                                | TRF5 **PJe 2.x**, 1º grau                                                 |
| `2gf` | `pje2g.trf5.jus.br`                                | TRF5 **PJe 2.x**, 2º grau                                                 |
| `1x`  | `pje.jf{uf}.jus.br` — **conforme a UF da empresa** | **PJe 1.x** da Seção Judiciária (processos antigos, que o 2.x não mostra) |
| `2x`  | `pje.trf5.jus.br`                                  | PJe 1.x, 2º grau (opcional)                                               |

Seções do TRF5 cobertas pelo `1x`: **RN, PB, PE, AL, SE, CE**. Empresa de UF fora
disso tem o grau `1x` pulado (com aviso). Cada instância é um domínio próprio →
**pede seu próprio login A3** quando alcançada.

Os graus estaduais (`1g`/`2g` = TJRN) existem mas **não entram no protocolo padrão**:
as teses tributárias são federais.

### PJe 1.x — particularidades (calibrado em 21/07/2026)

O 1.x é um sistema **diferente** do 2.x, não só outro host. O que muda:

- **Login**: usa **PJeOffice** (assinador desktop, porta local 8800) — não o SSO
  PDPJ do 2.x. O PJeOffice precisa estar **rodando** (fica na bandeja). A tela
  "Verificação de Ambiente" reclama de Firefox/plugin Java: é legado do applet e
  pode ser ignorada **desde que o assinador seja detectado**.
- **Login por seção**: cada `pje.jf{uf}` é um domínio próprio ⇒ um A3 por seção.
- **Campos do formulário são outros** (por isso a busca voltava vazia):

  |        | PJe 2.x                                 | PJe 1.x                                          |
  | ------ | --------------------------------------- | ------------------------------------------------ |
  | CNPJ   | `…:documentoParte` (+ radio de máscara) | `…:cpfCpnjRadioCPFCNPJ:cpfCpnjCNPJ`              |
  | Nome   | `…:nomeParte`                           | `…:nomeParteDecoration:nomeParte`                |
  | Buscar | `input[value=Pesquisar]` (submit)       | `…:searchButton` (`type=button`, AJAX RichFaces) |

- **É LENTO**: a consulta leva **20-30s** (o 2.x responde em segundos). O
  `_esperar()` detecta os dois tipos de overlay e só conclui "0 resultado" após
  ~30s sem sinal de carregamento. Consequência: lotes com `1x` demoram bem mais.
- **Layout da lista é outro**: o 2.x tem colunas fixas (5=classe, 6=ativo,
  7=passivo); o 1.x traz os polos **rotulados** na própria célula
  (`IMPETRANTE Fulano` / `IMPETRADO Ministério…`). `_linha_campos()` resolve os
  dois — sem isso todo processo do 1.x era descartado como "ré".
- **WAF/captcha**: navegação programática pode cair num desafio anti-bot
  ("What code is in the image?"). Se acontecer, resolva o captcha **manualmente**
  na janela do Chrome; a sessão libera em seguida.
- **Fim da busca**: o 1.x não expõe overlay detectável e mantém uma linha
  **fantasma** antes do resultado (medido: 16s com 1 linha falsa). O fim é
  marcado pelo contador **"Foram encontrados: N"** — espera-se renderizar as N
  linhas. Também é preciso **Limpar** antes de cada busca (o 1.x não zera a
  tabela entre consultas, e a lista antiga era lida como resultado novo).
- **Assunto da fonte**: a tela de detalhe traz o assunto oficial
  (`DIREITO TRIBUTÁRIO|Crédito Tributário|…`), usado com **prioridade sobre o
  DataJud**. É um ganho de precisão — o DataJud erra com frequência.
- **Petição inicial (texto COMPLETO)**: a inicial não está nos 15 documentos
  exibidos (é a mais antiga) e o `documentoHTML` só diz `"Em PDF."`. A peça é
  obtida pelo **Paginador** (`_peticao_pdf_1x`), receita validada ao vivo:
  1. `paginator.seam?idProcesso=N`
  2. `selecionarFimPaginador()` → salta para o documento **mais antigo**; a inicial
     costuma estar na **penúltima** página, então volta até achar tipo "Petição"
  3. na lista de binários, os candidatos são **ranqueados** (peso alto para
     "Petição Inicial"; penalidade para procuração/contrato social/comprovante/
     parecer) e testados em ordem até um passar em `peticao_valida()`.
     ⚠️ **Não** use a regra antiga "a peça é a que não se chama `Doc. NN - …`":
     ela escolhia exatamente os anexos. Numa auditoria das 8 peças da P J,
     **nenhuma** era a inicial — vieram 3 procurações, 2 pareceres da Receita e
     1 cartão CNPJ, e a tese "acertava" por acidente.
  4. clicar dispara `POST → 302 → GET download.seam` (`application/pdf`). O corpo
     **não** pode ser lido do evento (o visualizador consome o recurso): captura-se
     a **URL** e re-busca com `page.request.get()`; o texto sai por `pypdf`.

  Resultado medido: iniciais reais de **13 a 15 mil caracteres**, abrindo com o
  endereçamento ("JUÍZO FEDERAL DE UMA DAS VARAS DA SEÇÃO JUDICIÁRIA DO RN…") —
  bem mais que o 2.x, que só lê a 1ª página via PDF.js.

## Como a tese é decidida (qualidade)

1. **Filtro**: só a empresa como **autora** em classe de tese (MS, procedimento
   comum, declaratória…). Descarta ré, embargos/execução/cumprimento.
2. **Petição inicial** é a fonte do objeto real (o assunto CNJ do DataJud engana).
   O que chega tem de ser a **peça**, não um anexo: os binários são ranqueados e
   cada candidato passa por `peticao_valida()`, que exige o **endereçamento**
   ("JUÍZO FEDERAL…", "EXCELENTÍSSIMO…") no cabeçalho. Se nenhum passa, o texto
   volta **vazio** e a tese é decidida só pelo assunto — com a fonte rotulada como
   tal. Não classificar é melhor que classificar por anexo: procuração, contrato
   social, parecer COSIT e cartão CNPJ acompanham TODA inicial e citam tributos,
   então dariam falsa precisão.
3. **Corroboração**: a tese só é **cravada** (`acao_id`) se o assunto do DataJud
   **confirmar** o que a petição indicou. Sem confirmação (assunto vazio ou
   divergente) ela fica só como `metadados.tese_sugerida` — aparece na UI como
   "tese sugerida (revisar)" e **não** entra no cálculo do gap.
4. Objeto administrativo pontual (CND/certidão) **não é tese** — descartado.
5. **Uma empresa não entra duas vezes na mesma tese**: se 2+ processos caem na
   mesma, mantém o de melhor evidência e os demais viram sugestão para revisão.
6. **Uma inicial pode carregar mais de uma tese** (ex.: MS que pede exclusão de
   ICMS _e_ de ISS da base do PIS/COFINS). As demais ficam em
   `metadados.teses_extras` — a ficha e o relatório descontam todas da oferta.
7. **Rescisória só existe no 2º grau** (competência originária do tribunal). Há
   teses que dependem da classe processual, não só das palavras.

Na UI: verde = cravada · amarelo = sugerida (revisar) · itálico = "tese a mapear"
(tributário fora do catálogo).

### Ao criar uma regra nova

O casamento é por **palavra inteira** (`\bTOKEN\b`). Duas armadilhas que já
custaram classificação errada:

- **Token truncado nunca casa**: `CREDIT` não casa em "créditos", `HOSPITA` não
  casa em "hospitalar". Escreva a palavra completa e todas as variantes.
- **Plural do CNJ**: o assunto vem quase sempre no plural — `CONTRIBUICAO` não
  casa em "Contribuições". Inclua as duas formas.
- Sigla genérica **não** distingue tese: `RAT` aparece em toda petição
  previdenciária ("CPP, terceiros e RAT"). Use o que é próprio da tese
  (atividade preponderante, grau de risco, FAP).
- Chaves disponíveis: `all` (todos), `any` (pelo menos um), `any2` (segundo grupo
  obrigatório — para exigir duas ideias, cada uma com várias grafias), `hint`
  (sobe a confiança), `classe` (restringe à classe processual).

## Limitações conhecidas

- **Limite diário** de abertura de autos no TRF5: quando estoura, a petição não é
  lida e a tese cai para "a mapear". Rode em lotes ao longo dos dias.
- A **sessão A3 federal expira rápido** — rode os lotes em sequência.
- No 2.x a extração pega a **1ª página** via PDF.js; no 1.x a peça vem completa
  (~8 páginas, pypdf). Por isso a corroboração existe.
- **O DataJud não publica as partes** — só classe/assunto/movimentos por número.
  Não dá para pré-filtrar empresas por CNPJ por lá; o scrape do PJe é a única
  porta de entrada (testado e descartado em 21/07/2026).

## Cobertura — dois furos que davam "empresa sem tese" por engano

- **Filial não ajuíza tese.** O CNPJ no CRM costuma ser o do estabelecimento, mas
  a tese é ajuizada pela **matriz** (mesma pessoa jurídica). Buscar só pelo CNPJ
  da filial devolvia ZERO justamente nas maiores empresas da base — Riachuelo,
  Guararapes e M. Dias Branco vieram todas vazias. `_cnpjs_a_buscar()` acrescenta
  o CNPJ da matriz (raiz + `0001` + DV por mod 11) quando o alvo é filial.
- **A lista é paginada (~15 por página).** Sem virar página, só a 1ª era lida —
  e o viés é perverso: as execuções fiscais (onde a empresa é **ré**) são as mais
  recentes e ocupam a 1ª página, enquanto a tese que ela ajuizou é mais antiga e
  cai nas seguintes. Resultado típico: "15 linhas, 15 descartadas como ré, 0
  candidatos". Pior, o `_esperar` ficava aguardando as linhas renderizadas
  alcançarem o contador do PJe — alvo inatingível numa página só, 108 s de
  timeout por busca.

## Eficiência

- `"Foram encontrados: 0"` é resposta **completa**. Tratar o zero como "sem
  contador" fazia cada empresa sem processo gastar o timeout inteiro (90 s) —
  e essa é a maioria da base.
- A petição inicial é **imutável**: fica em `tools/.cache/peticoes/<numero>.json`.
  Como o catálogo cresce a cada objeto confirmado, **reanalisar é a operação mais
  frequente** — com cache ela custa ~0. Só grava extração bem-sucedida; use
  `--sem-cache` se suspeitar de extração truncada.
- Espera **condicional** (`_ate`) em vez de sleep fixo em todo o fluxo do PJe.
- DataJud em **lote paralelo** (`datajud_lote`, 5 threads): são consultas HTTP
  independentes por processo; em série, empresa com 13 candidatos pagava 13 idas
  e voltas enfileiradas.

### Como medir (o ciclo que achou tudo isso)

```powershell
python tools\pje_teses_empresa.py --cnpjs "a,b,c" --graus 1x --cdp --gravar
python tools\pje_eficiencia.py --ultimas 3
```

O scraper cronometra cada fase em `tools/.cache/telemetria.jsonl`;
`pje_eficiencia.py` agrega e aponta o gargalo. **Rode a cada 3 empresas** — foi
assim que apareceram a filial (ciclo 2) e a paginação (ciclo 3).

⚠️ **Escolha empresas GRANDES para medir.** Em ordem alfabética a varredura gasta
os ciclos em microempresa que nunca litigou, e os dois furos acima ficariam
escondidos por centenas de execuções — nenhuma delas exercita matriz ou página 2.
