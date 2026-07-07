# Enriquecimento de CNPJs com Contatos de Sócios — Status & Próximos Passos

**Data**: 2026-06-15 | **Estado**: 20.998 contatos em 5.280 empresas | **PJe**: 794/7.052 (11%)

---

## 🎯 O que foi feito HOJE (C)

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

- [ ] Apollo/Vibe enriquecimento (comprá-los = descartado via teste; cobertura baixa pra PME BR)
- [ ] LinkedIn manual para empresas > 50 func (usando org-enrich Apollo grátis)
- [ ] Dashboard de cobertura por setor/UF (já tem base no DB)

---

## 📁 Arquivos-chave

```
tools/
  pje_rn_skiptrace.py       (core do skip-trace)
  pje_progress.py           (painel ao vivo)
  lote.ps1                  (roda skiptrace)
  run-lote-background.ps1   ← NOVO (runner amigável)
  pje-env.local.ps1         (env vars SUPABASE_URL + SERVICE_ROLE_KEY)

src/
  components/ContatosCoverageCard.tsx  ← NOVO (dashboard)
  pages/Contatos.tsx                   (multi-select + ações em lote)
```

---

## 🔐 Segurança

⚠️ **SERVICE_ROLE_KEY foi exposta no chat 08/06** — rotacionada? Confirme em Dashboard → Settings → API → Reset service_role.

---

## 📝 Changelog

- **15/06 (hoje)**
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
