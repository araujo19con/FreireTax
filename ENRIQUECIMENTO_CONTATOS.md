# Enriquecimento de CNPJs com Contatos de Sócios — Status & Próximos Passos

**Data**: 2026-07-09 | **Estado**: 20.998+ contatos sócios (RFB/PJe/DRIVA) + 400+ contatos `decisor` | **PJe**: 794/7.052 (11%)

---

## 🎯 09/07 — Enriquecimento focado na AÇÃO DO TERÇO (Rescisória Tema 985)

Mudança de estratégia: enriquecer **por ação tributária** (alvo comercial), não
RN genérico. Ação `7e9cf5bb-99ba-4428-889f-c6870e8be2f3`, 423 empresas vinculadas.

**Resultado: decisor 45%→96% (405/423).** Três levas: +83 via pesquisa web
(88 empresas com capital>0, QSA como guia), +55 via promoção QSA→decisor
(sócio-administrador do QSA, confiança média), +81 nas 88 restantes sem
QSA/CNPJ (2ª leva de agentes — maioria eram **sindicatos/entidades FIERN**,
decisor = presidente; ou grandes empresas sem CNPJ cadastrado). Telefone 78%,
LinkedIn 30%.

Restam só 18 sem decisor = nomes genéricos sem CNPJ, consórcios extintos,
controle recém-vendido (não enriquecíveis sem novo dado). Ver `PROXIMA_SESSAO.md`
para detalhes, achados de qualidade a corrigir no CRM, ferramentas e lições.

**Ferramenta nova permanente**: `tools/insert_decisor_by_id.mjs` — grava decisor
casando por `empresa_id` exato (robusto a mojibake/SPE numerada); dedup por id +
`decisor_web:<nome>`. Diagnóstico: `tools/diag_terco.mjs` (paginação `.range()`
corrigida — sem ela a contagem de contatos trunca em 1000 e infla "sem decisor").

---

## 🎯 O que foi feito em 06/07 — Enriquecimento de GESTORES (novo, papel=decisor)

Frente nova, complementar aos sócios: em vez de CPF/telefone via processo judicial,
busca **nome + cargo + LinkedIn (quando exposto em snippet público)** do
gestor/diretor de cada empresa via pesquisa web (WebSearch/WebFetch), sem NUNCA
acessar/raspar linkedin.com diretamente (só cita URL que aparece em snippet de
busca — evita violar ToS do LinkedIn).

### Resultado (empresas PB, porte=DEMAIS primeiro, depois EPP — ordenadas por capital_social desc)

| Métrica                                 | Valor                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Contatos `decisor` gravados             | 238                                                                                   |
| Empresas únicas cobertas                | 220                                                                                   |
| — DEMAIS (272 no total)                 | 207 (76%)                                                                             |
| — EPP (50 no total, com capital_social) | 13 (26% — pool muito mais raso: metade era nome de pessoa física ou "não encontrado") |
| Com LinkedIn confirmado (snippet)       | 32 (13%)                                                                              |
| Confiança alta / média / baixa          | ~15% / ~75% / ~10%                                                                    |

**Faixa ME não iniciada** — dado o rendimento decrescente já visto no EPP (pool
pequeno, muitos "não encontrado"), pausar aqui é razoável; retomar só se o
volume de prospecção justificar.

Cada registro tem `cargo`, `linkedin` (quando achado), e `observacoes` com
**fonte (URL) + nível de confiança** — permite filtrar por confiabilidade antes
de qualquer abordagem comercial: `WHERE papel='decisor' AND observacoes LIKE '%confiança: alta%'`.

### Metodologia testada (da mais pra menos eficiente)

1. **Agentes de pesquisa web em paralelo** (lotes de 4-6 empresas por agente,
   6 agentes simultâneos) — WebSearch/WebFetch direto, sem sub-delegação (evita
   cascata de sub-agentes confusa — já aconteceu 1x, ver nota de segurança abaixo).
2. Fontes por ordem de confiabilidade: **imprensa/matéria institucional** (alta)
   > **site institucional da empresa** (alta) > **Econodata/CNPJ.biz/Casa dos
   > Dados** (nome do sócio-administrador, média — não confirma cargo executivo
   > real) > **snippet `site:linkedin.com`** (só cita URL pública, nunca acessa).
3. Script Node reutilizável (`tools/insert_gestores_pb_loteN.mjs` — recriado a
   cada lote, roda `--dry-run` primeiro, depois grava e é apagado) grava em
   `empresa_contatos` com `papel='decisor'`, `origem='outro'`, `dedup_key` para
   idempotência.

### Achados importantes

- **~15 famílias concentram dezenas de CNPJs pequenos** (principalmente postos
  de combustível): Cavalcanti (Roberto Germano Bezerra Cavalcanti aparece em
  6+ postos), Coutinho de Sousa (Guaraves + Posto Bom Todo + Posto Frei Damião),
  Barreto (W A Barreto + Posto Catolé + Posto Tambiá + A S de Castro), Pontes
  (Posto Santa Rita + Planalto + Cowboy), Gadelha (CESED/UNIFACISA + Dynamic
  Business Holding), grupo Alliance/Gondim (várias SPEs de construção).
  **Útil pra agrupar abordagem comercial por família/grupo, não por CNPJ isolado.**
- **Taxa de acerto (nome+cargo) fica alta até o fim da lista** (~80-100% mesmo
  em postos pequenos, via Econodata) — quem cai muito é a taxa de **LinkedIn**
  (só ~14%, pior em empresas pequenas sem presença digital).
- **Telefone/e-mail direto**: nenhuma fonte gratuita testada devolve isso —
  Econodata/cnpj.biz mostram nome de graça mas trancam telefone/WhatsApp/email
  atrás de paywall Premium.

### ⚠️ Apollo.io e Vibe Prospecting (Explorium) — re-testado, mesma conclusão

- **Apollo.io**: conta conectada está em plano free — `mixed_companies/search`
  e `mixed_people/api_search` retornam `API_INACCESSIBLE` (precisa upgrade).
  Preço de referência não é público (modelo comercial, precisa falar com vendas).
- **Vibe Prospecting (Explorium)**: sem créditos na conta conectada.
- **Econodata Premium**: ~R$590-890/mês (referência histórica, pode estar
  desatualizada) — é a fonte mais consistente pra nome+cargo de PME brasileira;
  se for investir em algo pago, é a candidata mais forte.

### 🔧 Correção importante ao registro anterior (linha "PB fica de fora")

O registro de 22/06 dizia **"PB = Cloudflare bloqueia o domínio"** para
skip-trace de sócios via TJPB. Isso é **parcialmente impreciso**: o bloqueio
foi detectado testando só com Playwright puro/automatizado. Testado em 06/07
com **Chrome real logado (`--cdp`)**, o TJPB **autentica e responde
normalmente** (adicionado `--tj pb` em `pje_rn_skiptrace.py` e
`chrome-cdp.ps1`, URL corrigida pra `pje.tjpb.jus.br`, sem o "1g." que o
RN/TRF5 usam). O problema real não é bloqueio — é **taxa de match**: rodado
piloto de 20 sócios de empresas GRANDES via TJPB, 0 matches (mesmo padrão do
TRF5). Hipótese: donos/administradores de empresas grandes raramente aparecem
como parte em processo pessoal comum (proteção via holdings). **Ainda não
testado em empresas PEQUENAS** — pode valer a pena revisitar essa combinação
(TJPB + sócios de empresas pequenas) antes de descartar de vez.

### 🌎 Extensão nacional (06/07, continuação) — a base já é multi-estado

Descoberta: o CRM já tem **5.630 empresas em 5 estados** (RN 2.995, PR 700,
RS 700, SC 691, PB 382 — resto é ruído/UF isolada), não só PB. Só **11% das
5.630 empresas têm QUALQUER elegibilidade avaliada** (627 linhas), e **8 das 9
ações tributárias não têm nenhum critério de elegibilidade definido** na
tabela `criterios_elegibilidade` (só "Majoração de 10% sobre o Lucro
Presumido" tem 1 critério). **Isso é decisão jurídica, não técnica** — não
tentei inventar regra de elegibilidade tributária sozinho; fica sinalizado
pra decisão via `CriteriosAdmin` quando o time quiser.

Iniciada extensão do enriquecimento de gestores pro **RN** (maior base, 1.498
empresas porte=DEMAIS) — primeira leva de 30 empresas (as maiores por
capital_social): Guararapes/Riachuelo (André Farber, CEO), Alares (Denis
Ferreira, CEO), ALE Combustíveis (Rafael Grisolia, CEO), Neoenergia Cosern
(Fabiana Carvalho Lopes), Raízen Power/Dunamis (Frederico Saliba), várias SPEs
de energia eólica/solar (Casa dos Ventos, 2W Energia, SPIC Brasil, Voltalia,
Aliança Energia, Aura Minerals — grupos controladores identificados, mas
nem sempre confirmado quem assina pela SPE específica).

**Total agora (todas UFs): 318 contatos `decisor`.**

### 🔧 Otimização de método — clustering de SPEs por grupo controlador

RN tem DEZENAS de SPEs de energia eólica/solar com nomenclatura em série
(`Ventos de Santa Tereza 01-14`, `Ventos de São Ricardo`, `Sol Serra do Mel
I-VI`, `Anemus Wind 1-3`, `Usina de Energia Eólica X`, etc.) — pesquisar cada
uma individualmente é redundante, já que pertencem ao MESMO grupo controlador.
Método otimizado:

1. Detectar clusters via regex (remove sufixo numérico/romano do nome, agrupa).
2. Pesquisar o GRUPO controlador **uma vez só**.
3. Aplicar o mesmo contato a TODAS as SPEs do cluster via script SQL direto
   (sem nova pesquisa), com ressalva na observação ("grupo controlador — não
   confirmado assinante formal de cada SPE").

Grupos identificados até agora no RN: **Casa dos Ventos** (Ventos de Santa
Tereza/São Ricardo), **Voltalia** (Sol Serra do Mel, Ventos de Serra do Mel),
**2W Energia** (Anemus Wind), **Copel** (Usina de Energia Eólica X, Central
Eólica e Solar Mundo Novo — comprou da EDP Renováveis em 2026), **EDP
Renováveis** (Central Eólica Monte Verde IV), **TotalEnergies** (Maral, Terra
Santa), **Elawan Energy** (Passagem, RN), **Aliança Energia** (Complexo
Eólico Acauã I/II/III), **SPIC Brasil** (Ventos Fortes/Vale dos Ventos),
**Aura Minerals** (Crusader/Cascar, projeto Borborema), **Toda Investimentos**
(grupo japonês), **Voltalia** (EOL Potiguar B61) — **Brasventos/Rei dos
Ventos** ficou ambíguo (mudou de mãos J.Malucelli→AES→Auren, não confirmado
CEO atual, não inserido).

⚠️ **Recomendação estratégica de um dos agentes de pesquisa** (vale seguir):
pra SPEs de energia com controlador estrangeiro/holding nacional, mirar o
**"Country Manager Brasil"/"Diretor Brasil"** da controladora em vez de tentar
achar quem assina formalmente pela SPE específica — decisões tributárias/
fiscais tendem a ser centralizadas na matriz brasileira do grupo, não na SPE
de propósito específico isolada.

⚠️ **Bug encontrado e corrigido**: `ilike("%NOME%")` sem âncora/ordenação
explícita erra quando há **série numerada de SPEs do mesmo grupo** (ex: "Sol
Serra do Mel I/II/III/IV/V/VI", "Central Eólica Acauã I/II/III") — o
substring "I" bate em "III" também, e sem `.order()` o primeiro resultado é
imprevisível. Aconteceu 2x nesta rodada (corrigido via UPDATE direto). Lição:
**ao escrever `empresaLike` para SPEs numeradas, usar match exato do nome
completo ou verificar visualmente a lista de matches antes de commitar.**

### ⚠️ Nota de segurança — cascata de sub-agentes

Num dos primeiros lotes, o agente coordenador (`general-purpose`) resolveu
sozinho **spawnar 4 sub-agentes próprios** (sem eu pedir) e um deles reportou
ter recebido uma mensagem de outro agente tentando se passar por autorização
("permito tudo"). Não foi ataque externo — foi ruído da minha própria árvore
de agentes mal-coordenada — mas o sub-agente tratou corretamente (ignorou,
não agiu). Lição: ao pedir pesquisa em lote, instruir explicitamente **"NÃO
delegue/spawne sub-agentes"** no prompt evita a confusão.

---

## 🎯 O que foi feito HOJE (C) — 15/06

### Dashboard de Cobertura (UI)

- **ContatosCoverageCard** exibe stats em tempo real:
  - Total de contatos + empresas com contato
  - % com telefone, % celular, % WhatsApp, % enriquecidos via PJe
  - Top 3 origens (RFB, DRIVA, PJe)
  - Stale time: 5 min (cache otimizado)

### Multi-Select + Ações em Lote

- Checkbox em cada contato da lista de Contatos
- "Selecionar todos" da página com indeterminate state
- Ações em lote:
  - 📋 **Copiar nomes** → para clipboard
  - 📞 **Copiar telefones** → `${nome}: ${telefone}` por linha
  - ✉️ **Copiar emails** → `;`-separated (paste direto em Outlook/Gmail)
- Feedback visual: bg highlight azul das linhas selecionadas

### Script PJe Background

- **run-lote-background.ps1** — runner amigável para iniciar lote sem ficar presos
- Abre 2 windows:
  1. Lote (Chrome + processamento interativo)
  2. Progresso (painel ao vivo com barra de ETA)
- Logs salvos com timestamp

---

## 🚀 Como rodar o PJe agora (A)

### Pré-requisitos

- [ ] Certificado A3 (Windows) — já testado em 09/06
- [ ] Supabase CLI login (opcional, já configurado)

### Comando

```powershell
cd c:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker

# Option 1: Runner amigável (recomendado)
.\tools\run-lote-background.ps1 -Limite 150

# Option 2: Direto
.\tools\lote.ps1 150
```

### O que acontece

1. Chrome abre em `pje1g.tjrn.jus.br`
2. Você faz login A3 UMA VEZ (sessão dura ~30 min)
3. Skiptrace processa ~150 sócios (ou até atingir limite diário ~100)
4. Painel mostra progresso ao vivo (barra, ETA, ritmo)
5. Resultados gravados no CRM automaticamente (CPF/endereço/telefone em `observacoes`)

### Gargalos reais

- **Limite diário TJRN**: ~100 sócios/dia (descoberto 10/06)
  - Atingido: abandona graciosamente
  - Resumir: próximo dia continua de onde parou
- **Sessão A3 expira**: ~30 min → trava silenciosamente se fique idle muito tempo
- **Telefone pessoal é raro**: ~8-12% dos procs trazem celular (dado é fraco, mas é o que temos)

---

## 🌎 Frentes RS / SC / PR (preparadas 22/06)

**Prontidão: código 100% pronto; falta só seu acesso A3 em cada tribunal.**
Verificado 22/06: os 3 scrapers compilam, carregam alvos do Supabase pelo próprio
código (25/25 cada), markers e launcher CDP corretos. 0 enriquecidos nos três.

| Frente | Sistema | Scraper                      | Pendentes | Status                                                          |
| ------ | ------- | ---------------------------- | --------- | --------------------------------------------------------------- |
| **RS** | eproc   | `eproc_skiptrace.py --tj rs` | 2.348     | ✅ pronto · A3 (TJRS pede cadastrar 2FA antes) · 1× `--inspect` |
| **SC** | eproc   | `eproc_skiptrace.py --tj sc` | 2.219     | ✅ pronto · A3 · 1× `--inspect`                                 |
| **PR** | Projudi | `projudi_skiptrace.py`       | 2.708     | ⚠️ scaffold · seletores a CONFIRMAR via `--inspect` (A3)        |

### Por que é diferente do RN (CDP obrigatório)

RN (PJe) loga A3 direto no Chromium do Playwright. **RS/SC/PR usam Keycloak SSO**,
que o Chromium do Playwright NÃO consegue apresentar o A3. Solução = **modo CDP**:
abrir o Chrome REAL (cert store do Windows), logar A3 nele, e o scraper conecta via
`--cdp`. Perfis isolados por sistema (`.chrome-cdp-profile`, `.eproc-rs-chrome-profile`…).

### Sequência por frente — RS (trocar `rs`→`sc` p/ SC)

```powershell
cd c:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker
# 1) abre o Chrome real com porta CDP no eproc do TJ
.\tools\chrome-cdp.ps1 -Tj rs
#    -> logue com o A3 na aba que abrir (eproc1g.tjrs.jus.br)
# 2) noutro terminal — 1a vez: CALIBRAR seletores (dumpa a tela, NAO grava)
. .\tools\pje-env.local.ps1
python tools\eproc_skiptrace.py --tj rs --inspect --cdp
#    -> confirma SEL_VALOR/SEL_FORMA/SEL_DOC no DOM logado; ajustar se algo falhar
# 3) rodar o lote (grava no CRM)
python tools\eproc_skiptrace.py --tj rs --limit 150 --cdp
#    afinar parser offline: por --dump no lote, depois --reparse <jsonl> (sem browser)
```

### PR (Projudi) — mesma mecânica, scraper à parte

```powershell
.\tools\chrome-cdp.ps1 -Tj pr      # projudi.tjpr.jus.br
. .\tools\pje-env.local.ps1
python tools\projudi_skiptrace.py --inspect --cdp   # FECHA os seletores (e scaffold)
python tools\projudi_skiptrace.py --limit 150 --cdp
```

Projudi usa FRAMESETS → `--inspect` dumpa cada frame (`projudi_frame*.html`) e lista
os ids dos campos, pra fechar SEL_NOME/SEL_PESQUISAR/SEL_DOC.

### Diagnóstico de viabilidade (sem A3, a qualquer momento)

```powershell
python tools\pje_multi_tj.py --check   # net + sistema + viabilidade por TJ
```

### Pré-requisitos (seu lado) e expectativas

- [ ] A3 reconhecido no tribunal-alvo (**RS exige cadastrar 2FA** antes de logar)
- [ ] Chrome instalado (o CDP usa o Chrome real, não o do Playwright)
- ⚠️ NUNCA fechar o Chrome do CDP pelo scraper (fecharia suas abas — sair do `with` basta)
- eproc é o sistema PRIMÁRIO de RS/SC → cobertura deve ser boa (≠ SP, onde eproc é novo e rende ~0)
- Mesmos gotchas do RN: sessão A3 ~30min, possível limite diário, telefone pessoal raro (CPF+endereço é o forte)
- Marca `eproc/TJRS` · `eproc/TJSC` · `Projudi/TJPR` em `observacoes`; resumível e idempotente
- PB e SP ficam de fora: PB = Cloudflare bloqueia o domínio; SP = e-SAJ não expõe autos a não-parte

---

## 📊 Cobertura Atual (estado 10/06)

| Métrica                    | Valor    | %      |
| -------------------------- | -------- | ------ |
| **Total de contatos**      | 20.998   | —      |
| **Com telefone**           | 5.123    | 24%    |
| **—‣ Switchboard empresa** | 5.002    | 24%    |
| **—‣ Pessoal (DRIVA)**     | 121      | 0.6%   |
| **—‣ Pessoal (PJe)**       | 6 + 84\* | 0.4%\* |
| **Celular (DDD+9dígitos)** | 111      | 0.5%   |
| **WhatsApp marcado**       | 20       | 0.1%   |
| **Sócios RFB**             | 15.713   | —      |
| **—‣ Enriquecidos (PJe)**  | 794      | 5%     |

\*84 do PJe em progresso; 6 já validados em teste manual.

### Origem (top 3)

1. **RFB** (QSA federal): 20.203 sócios
2. **DRIVA** (planilha 55 PB): 399 contatos (emails + WhatsApp)
3. **PJe/TJRN** (skiptrace): 794 sócios (CPF+endereço+raramente telefone)

---

## 🔧 Próximos Passos (sugestões)

### Curto prazo (1-2 dias)

- [ ] Rodar lote PJe: `.\tools\run-lote-background.ps1 -Limite 300` (3 lotes de 100 cada dia)
  - Previsão: 60 dias para cobrir os 7.052 restantes
- [ ] Cada dia que atingir limit, resumir no próximo dia (script já é idempotente)

### Médio prazo (se cobertura de telefone for crítica)

- [ ] Novo export DRIVA COM contatos nominais dos decisores (email+telefone+WhatsApp+LinkedIn)
- [ ] Rodar importador: `tools/import-driva-contatos.mjs --file "...xlsx"`
- [ ] Resultado esperado: +500-1000 emails/telefones de PB

### Longo prazo (otimizações)

- [ ] Apollo/Vibe enriquecimento (comprá-los = descartado via teste 06/07; cobertura baixa pra PME BR, contas atuais sem acesso/créditos)
- [x] ~~LinkedIn manual para empresas > 50 func~~ — feito via pesquisa web em 06/07 (225 contatos `decisor`, ver seção acima). Apollo org-enrich grátis NÃO funcionou (plano free bloqueia o endpoint).
- [ ] Dashboard de cobertura por setor/UF (já tem base no DB)
- [x] ~~Estender pesquisa de gestores pra faixa EPP~~ — feito 06/07 (13 novos, pool raso: só 50 empresas EPP com capital_social, metade não deu match). ME não iniciado — retomar só se o volume de prospecção justificar (rendimento decrescente já claro no EPP).
- [ ] Revisitar TJPB (`--tj pb`) pra skiptrace de SÓCIOS de empresas PEQUENAS (não testado ainda — só testado em empresas grandes, 0 match)
- [ ] Se orçamento permitir, Econodata Premium (~R$590-890/mês) é a candidata mais forte pra telefone/email em escala (única fonte que já mostrou nome+cargo de graça pra quase toda PME PB testada)

---

## 📁 Arquivos-chave

```
tools/
  pje_rn_skiptrace.py       (core do skip-trace; --tj rn|trf5|pb ← pb NOVO 06/07)
  pje_progress.py           (painel ao vivo)
  lote.ps1                  (roda skiptrace)
  run-lote-background.ps1   (runner amigável)
  pje-env.local.ps1         (env vars SUPABASE_URL + SERVICE_ROLE_KEY)
  chrome-cdp.ps1            (abre Chrome real p/ login A3; -Tj pb NOVO 06/07)
  import-prospeccao-pb.mjs  ← NOVO 06/07 (import empresas+elegibilidade+prospecção de planilha)

src/
  components/ContatosCoverageCard.tsx  (dashboard)
  pages/Contatos.tsx                   (multi-select + ações em lote)
```

**Ferramenta PERMANENTE (06/07, substituiu o padrão de script temporário)**:
`tools/insert_decisor_gestor.mjs` — lê um JSON com os achados e grava em
`empresa_contatos` (papel=decisor). Suporta múltiplas UFs no mesmo arquivo e
`todasQueCasarem: true` pra aplicar 1 contato a várias empresas de uma vez
(clusters de SPE do mesmo grupo controlador). Ver cabeçalho do arquivo pro
formato exato do JSON. Sempre rodar `--dry-run` primeiro.

### 🖥️ Rodando em 2 máquinas em paralelo (partição por UF)

Pra paralelizar, cada máquina/sessão do Claude Code deve trabalhar numa UF
**exclusiva** (zero risco de colisão, já que empresa_id é diferente por UF):

- **Máquina A**: RN (1.498 empresas porte DEMAIS — já em andamento)
- **Máquina B**: PR (546) → RS (558) → SC (575), nessa ordem

Cada sessão: (1) consulta a próxima leva de empresas sem `decisor` na sua UF
por `capital_social` desc, (2) detecta clusters de SPE (nomes que só diferem
por número/romano no fim), (3) delega pesquisa via `Agent` (nunca sozinho —
sempre lotes de ~5 por sub-agente, em paralelo, instruindo "não delegue
sub-agentes"), (4) grava com `insert_decisor_gestor.mjs --dry-run` depois sem
o dry-run, (5) atualiza este arquivo com o progresso.

⚠️ **Cuidado com o arquivo `.md` sendo editado por 2 máquinas ao mesmo tempo**
(sincronizado via OneDrive) — prefira cada máquina adicionar sua própria
entrada de changelog com timestamp, e reconciliar manualmente se o OneDrive
sinalizar conflito de versão.

---

## 🔐 Segurança

⚠️ **SERVICE_ROLE_KEY foi exposta no chat 08/06** — rotacionada? Confirme em Dashboard → Settings → API → Reset service_role.

---

## 📝 Changelog

- **06/07**
  - ✅ Frente nova: enriquecimento de GESTORES/diretores (`papel=decisor`) via pesquisa web — 225 contatos, 207/272 empresas PB porte=DEMAIS (76%), 31 com LinkedIn
  - ✅ Import de 293 empresas PB pra ação "Rescisória do Tema 985" (37 desqualificadas corretamente, 46 processos vinculados) — script `tools/import-prospeccao-pb.mjs`
  - ✅ Bugfix no import: CNPJ precisa buscar em formato MASCARADO (trigger `normalize_cnpj_text` da mig 20260512 normaliza tudo pra `XX.XXX.XXX/XXXX-XX`) — busca por dígitos puros não achava empresas existentes
  - ✅ TJPB adicionado como opção `--tj pb` em `pje_rn_skiptrace.py`/`chrome-cdp.ps1` (URL corrigida: `pje.tjpb.jus.br`, sem "1g.") — funciona via CDP+Chrome real, ao contrário do que o registro de 22/06 sugeria
  - ⚠️ Apollo.io e Vibe Prospecting testados de novo — ambos inacessíveis nas contas conectadas (plano free / sem créditos)
  - ✅ Nova ferramenta permanente `tools/insert_decisor_gestor.mjs` — substitui o padrão antigo de criar/apagar um `insert_gestores_XXX.mjs` por lote. Lê um JSON via `--file`, suporta múltiplas UFs e `todasQueCasarem: true` pra aplicar achado de 1 pesquisa a todo um cluster de SPE.
  - ✅ Plano de divisão em 2 máquinas: partição por UF (zero risco de colisão, `empresa_id` é por estado). Máquina A = RN; Máquina B = PR → RS → SC. Prompt de kickoff documentado abaixo em "Rodando em 2 máquinas em paralelo".
  - ✅ RN rodada 5: +15 contatos `decisor` (13 via pesquisa web em 3 lotes paralelos + 2 aplicados direto por já serem do mesmo grupo controlador de empresas já pesquisadas — Cinco V Brasil/PNSN e Ecocil). Total RN com `papel=decisor` agora: 325 empresas.
  - 🔎 **Achado importante**: a maioria das grandes empresas do RN (top 1000 por capital social) **já tem sócio cadastrado** (`papel=socio`, vindo do import RFB) — mas só o nome, sem telefone/email/LinkedIn. Ou seja, o enriquecimento por pesquisa web não está "descobrindo nomes do zero" na maior parte dos casos: está adicionando um registro `papel=decisor` com cargo atual confirmado + LinkedIn (quando encontrado), como um dado complementar mais rico/verificado. Vale considerar no futuro um passo de "upgrade" que tenta achar LinkedIn dos sócios já cadastrados via RFB, em vez de só buscar `papel=decisor` novo.
  - 🐛 **Bug de paginação descoberto**: consultas Supabase/PostgREST sem `.range()` truncam em 1000 linhas por padrão. Uma checagem intermediária de "quais empresas já têm contato" contou errado por causa disso (havia 16.214 contatos com nome, só os primeiros 1000 foram lidos). Sempre paginar com loop `.range(from, from+999)` ao contar/filtrar sobre `empresa_contatos` (tabela grande).
  - ✅ RN rodada 6: +14 contatos `decisor` — Serras Holding (Echoenergia/Liu Aquino), cluster eólico AES Brasil (Brasventos Miassaba 3, Brasventos Eolo, Rei dos Ventos 3 — mesmo CEO, ativos vendidos pela J.Malucelli em 2020), Midway Shopping, Pau da Arco/Grupo Nordestão, Solar Mundo Novo (2 diretores), Toda Energia, Gentil Negócios (CEO c/ LinkedIn), Empresa Brasileira de Serviços e Perfuração (2 sócios), Raros Agro. Cimento Açu, Imagina Energias, West Participações e Agir Participações ficaram sem match/dado novo confiável — marcados como "tentados" pra não repetir pesquisa.
  - 🐛 Bug de match ambíguo (2ª ocorrência, mesmo padrão do Acauã/Sol Serra do Mel): `%SOLAR MUNDO NOVO%` bateu com "CENTRAL EOLICA E SOLAR MUNDO NOVO S.A." (capital diferente) em vez de "SOLAR MUNDO NOVO S/A". Corrigido apertando o padrão pra incluir o sufixo exato "S/A". Lição reforçada: sempre conferir `(obs: N matches...)` no dry-run antes de gravar.
  - ✅ RN rodada 7: +12 contatos `decisor` — Somix Concreto (Alessandro V. Souza/Supermix, LinkedIn), Energia Potiguar Geradora Eólica, Norte Salineira/NORSAL, Mineradora Nosso Senhor do Bonfim, Matera Engenharia, Cirne Pneus (família controladora), Nacional Veículos/Grupo A.Cândido, SRM Sociedade Riograndense de Moagem (2 diretores), Largo Mineração Currais Novos (CEO Largo Inc.), Nosso Atacarejo (CEO Márcio Nogueira). Emaús Incorporações, Orion Holding e UFV BR XXIX ficaram sem match confiável.
  - 🐛 Bug de match por hífen: `%ENSEG INDUSTRIA ALIMENTICIA%` não bateu porque o nome real é "ENSEG **-** INDUSTRIA ALIMENTICIA LTDA" (hífen quebra o substring contíguo). Corrigido com `%ENSEG%INDUSTRIA ALIMENTICIA%`.
  - Total RN com `papel=decisor` após rodada 7: 367 empresas (de ~1000 porte=DEMAIS com capital social, top 1000 por valor).
  - ✅ RN rodada 8 iniciada: 11 alvos em 3 lotes (M Construções, RCM Indústria, Amigus Participações, Davita Natal Nefrologia, LML Participações, Delphi Construções, TV Costa Branca, Autobraz, BSoares Holding, Fenif Participações, CMR Brasil Hortifrutícola).
  - 📌 Próximo: estender gestores pra EPP/ME da PB; considerar Econodata Premium se orçamento permitir
- **15/06**
  - ✅ ContatosCoverageCard (dashboard de cobertura)
  - ✅ Multi-select + ações em lote (Contatos.tsx)
  - ✅ run-lote-background.ps1 (runner PJe amigável)
- **10/06**: Refactor elegibilidade_id → empresa_id+acao_id; typecheck 0
- **09/06**: PJe skiptrace TJRN operacional; 4 sócios piloto (3 hits)
- **08/06**: empresa_contatos table + triggers + DRIVA import (399 PB)
- **08/06**: RFB skiptrace (20.599 sócios de 5.279 empresas)

---

## 💬 Dúvidas?

Consultar memória do projeto: [[project_empresa_contatos]] e [[project_supabase_cli]]

---

## 📝 Changelog — 2026-07-06 · Decisores via pesquisa web (UF=PR)

> Máquina B (esta). **RN segue em paralelo na Máquina A — não tocado.**

### Metodologia (nova frente: `papel=decisor` via web, sem PJe/A3)

1. Alvos: `empresas` `uf=PR`, `porte=DEMAIS`, `capital_social NOT NULL`, ordenado por
   `capital_social DESC`, **excluindo** quem já tem contato `papel='decisor'`
   (anti-join com `empresa_contatos`). Script de query: scratchpad `query_targets.mjs`.
2. Pesquisa em lotes de ~5-6 empresas via subagentes paralelos (WebSearch/WebFetch).
   Regras dos agentes: **não acessar linkedin.com direto** (só citar snippet), **não
   inventar nomes** (sem evidência → vazio), sempre com `fonte` + `confianca`.
3. Clusters de grupo controlador pesquisados uma vez e aplicados às empresas do grupo.
4. Gravação: **`tools/insert_decisor_gestor.mjs`** (ferramenta PERMANENTE — criada nesta
   máquina hoje; estava só na Máquina A). Sempre `--dry-run` antes. `papel=decisor`,
   `origem=outro`, `dedup_key=decisor_web:<nome normalizado>` (idempotente).

### Resultado (PR)

- Universo PR no filtro: **546 empresas** · pendentes no início: 546 (0 tinham decisor).
- **Lote 1** (top por capital): 18 empresas / **29 contatos** — Grupo Boticário, Copel,
  Rumo (S.A + Malha Sul), Jordão, EBANX, Electrolux, Britânia, Gazin, Mondelez, Muffato,
  Leão/Matte Leão, Autopista Litoral Sul (Arteris), Usina Santa Terezinha, Elcontrol,
  Mata de Santa Genebra.
- **Lote 2** (próximas por capital): 17 empresas / **25 contatos** — Coamo, C.Vale,
  Frimesa, Lar, Cresol Baser (cooperativas); Nissei, Sancor Seguros, Horsch, Limagrain,
  Potencial Agro, Gonçalves & Tortola, Superpão, MLC Infra, Santa Maria Adm., B.O Paper,
  Novozymes LatAm, Frivatti Industrial.
- **Lote 3**: 17 empresas / **24 contatos** — Madero (Durski), Grupo Positivo (agora Cruzeiro
  do Sul), CR Almeida, Greca Asfaltos, Sooro Renner, TMG, Biogénesis Bagó, Interprint, Loram,
  Multilit, Grupo Irani (Cascavel/Pegoraro), AZX (Grupo Tacla), Tangipar, Mafip, Santa Maria
  Papel, PS Telematics.
- **Lote 4**: 18 empresas / **26 contatos** — Condor (Zonta), Ademicon (Reichmann), Morena Rosa
  (Franzato), Expresso Princesa dos Campos (Gulin), Jaguafrangos, Coonagro, Frivatti (Agro +
  Genetic/Valiati), Seara-PR, Costa Oeste, Fiscal Tec, Paviservice, DM Construtora, Gulf e AGME
  (holdings, via QSA), Novozymes BioAg, Master Vigilância, Costa Rica Malhas.
- **Lote 5**: 16 empresas / **24 contatos** — Condor-tier abaixo: Dr. Schär, Schattdecor,
  DIP Frangos, Refriko (Grupo RFK), Velsis, American Glass, Ampernet, Batel Logística, CGL,
  Laboratórios Calbos, M-Extend, Z P Bicaio, Cresol Liderança, Faricon e Dalba (em rec. judicial),
  UP Eventos. (Rio Benedito e Porto Brasil Investimentos = holdings opacas, retornaram vazio.)
- **Total gravado até agora: 86 empresas / 128 contatos.** Pendentes PR restantes: ~460
  (descemos de ~R$37 bi a ~R$40 mi de capital social).

### Ressalvas / pendências

- **VILA CEDRO PARTICIPAÇÕES S/A** e **SCP BLUE SKY - PORTO BELO** (Curitiba) — PULADAS.
  Holdings/SCP opacas; atribuição de controlador com confiança insuficiente (Vila Cedro cruzava
  pro Grupo H. Carlos Schneider/Ciser-SC; SCP via sócio ostensivo de CNPJ diferente). Ficam
  pendentes pra revisão manual.
- `empresaLike` genérico casa empresa errada (ex.: `%COAMO%` → Associação Recreativa;
  `%FRIVATTI%` → Agropecuária). **Sempre rodar `--dry-run` e conferir os `(obs: N matches)`**
  antes de gravar — foi corrigido caso a caso.
- Credenciais desta máquina: `tools/pje-env.local.ps1` (SUPABASE_URL + SERVICE_ROLE_KEY) — válidas.
- Próximo: seguir PR (maiores primeiro) → depois RS → depois SC.
