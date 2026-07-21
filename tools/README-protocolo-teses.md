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
- **Petição inicial**: fica fora dos 15 documentos exibidos (é a mais antiga), por
  isso é localizada via filtro _Tipo de documento = Petição Inicial_ + o botão
  **do painel de documentos** (`<prefixo>:searchButton`, prefixo dinâmico).
  ⚠️ Quando a inicial é **PDF anexo**, o `documentoHTML` traz só `"Em PDF."` + o
  carimbo de assinatura — o endpoint do binário **não foi localizado**. Nesses
  casos a classificação se apoia no assunto da fonte, não no corpo da peça.

## Como a tese é decidida (qualidade)

1. **Filtro**: só a empresa como **autora** em classe de tese (MS, procedimento
   comum, declaratória…). Descarta ré, embargos/execução/cumprimento.
2. **Petição inicial** é a fonte do objeto real (o assunto CNJ do DataJud engana).
3. **Corroboração**: a tese só é **cravada** (`acao_id`) se o assunto do DataJud
   **confirmar** o que a petição indicou. Sem confirmação (assunto vazio ou
   divergente) ela fica só como `metadados.tese_sugerida` — aparece na UI como
   "tese sugerida (revisar)" e **não** entra no cálculo do gap.
4. Objeto administrativo pontual (CND/certidão) **não é tese** — descartado.

Na UI: verde = cravada · amarelo = sugerida (revisar) · itálico = "tese a mapear"
(tributário fora do catálogo).

## Limitações conhecidas

- **Limite diário** de abertura de autos no TRF5: quando estoura, a petição não é
  lida e a tese cai para "a mapear". Rode em lotes ao longo dos dias.
- A **sessão A3 federal expira rápido** — rode os lotes em sequência.
- A extração da petição pega a **1ª página** do PDF.js; termos que só aparecem
  adiante podem escapar (por isso a corroboração existe).
