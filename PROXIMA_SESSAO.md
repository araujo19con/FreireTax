# Próxima Sessão — Enriquecimento

## Status Atual (FIM 09/07/2026)

### 🎯 Foco desta rodada: AÇÃO DO TERÇO (Rescisória Tema 985)

Mudança de estratégia: em vez de continuar RN genérico (rendimento decrescente,
ver rodadas 5-13 abaixo), o foco passou a ser **as empresas vinculadas à ação
Rescisória do Tema 985** (`acao_id 7e9cf5bb-99ba-4428-889f-c6870e8be2f3`), que é
o alvo comercial concreto.

**Resultado da rodada (09/07): decisor 45%→96%.**

| Métrica (ação do terço, 423 empresas) | Início | Final         |
| ------------------------------------- | ------ | ------------- |
| Com decisor (`papel=decisor`)         | ~197   | **405 (96%)** |
| Com telefone (qualquer contato)       | —      | 328 (78%)     |
| Com LinkedIn                          | —      | 126 (30%)     |

Três levas nesta sessão:

1. **+83 decisores** via pesquisa web — 15 lotes de agentes paralelos sobre as
   88 empresas com capital_social>0 (as mais encontráveis), QSA como guia.
2. **+55 decisores** via promoção QSA→decisor — empresas com sócio-administrador
   pessoa física no QSA; confiança "média", fonte "QSA Receita Federal", custo
   zero de pesquisa.
3. **+81 decisores** nas 88 restantes (sem QSA / sem CNPJ) — outra leva de 15
   lotes de agentes. Descoberta: a maioria era **sindicato/associação/entidade
   do Sistema FIERN** (SESC, SEBRAE, SINDUSCON, SINDLEITE, SINDCAFÉ, SINDVEST,
   SINDIPOSTOS, IEL/SESI/SENAI, etc.) → decisor = **presidente da entidade**
   (dado público) — ou grandes empresas sem CNPJ no cadastro (Lojas Riachuelo,
   Neoenergia Cosern, Arena das Dunas, Masterboi, grupo Saga, Unimeds de outras
   praças).

### Restam 18 empresas da ação SEM decisor (fim da linha por ora)

Não enriquecíveis sem novo dado: **nomes genéricos sem CNPJ/UF** ("CRISTALINA",
"FM NORDESTE", "A&C COMÉRCIO"), **consórcios/SPEs extintos** (Consórcio Ponte da
Redinha), **controle recém-vendido** (Midway Mall vendido dez/2025 → Ancar
Ivanhoe; superintendente atual não confirmado). Só avançam com CNPJ correto
cadastrado ou confirmação manual.

### Achados de qualidade a revisar no CRM (sinalizados pelos agentes)

- **Jornal Correio da Paraíba**: CNPJ cadastrado `91.118.320/2001-50` parece
  errado — razão social corresponde a `09.111.832/0001-50` (João Pessoa/PB).
- **SAGA (Goiás/DF/MT/etc.)**: várias unidades cadastradas com `uf=RN`, mas o
  grupo opera em GO/MT/MG/DF/RO — provável erro de UF no cadastro.
- **Brasimport** (RN): situação RFB **INAPTA** — relevante pra priorização.
- Alguns registros são duplicata/variante de empresa já coberta (INTERFORT =
  Interfort Segurança; A&S = Grupo Proteg; REDEMAIS = Supermercado Veneza).

## Ferramentas desta rodada (permanentes)

| Arquivo                          | O que faz                                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/insert_decisor_by_id.mjs` | Grava contatos `papel=decisor` casando por **empresa_id exato** (elimina bugs de match por nome: mojibake, séries numeradas de SPE). Lê `--file` ou `--glob`. Sempre `--dry-run` antes. Dedup por `empresa_id` + `decisor_web:<nome>`. |
| `tools/diag_terco.mjs`           | Diagnóstico read-only da cobertura da ação. **Bug de paginação corrigido** (busca de contatos agora usa `.range()` interno — sem isso truncava em 1000 e inflava a lista de "sem decisor").                                            |

## Lições desta rodada

1. **Match por empresa_id, não por nome.** Nomes no DB têm mojibake ("PONTANEGRA
   AUTOMÃVEIS", "ESPACIAL AUTOPEÃAS") e séries que confundem `ilike`. Os lotes
   carregam o `id` do banco → inserir por id é robusto e idempotente.
2. **QSA já é meio caminho.** ~66% das empresas da ação já têm QSA (sócios RFB).
   A pesquisa web não parte do zero: valida quem é o decisor atual e acha
   LinkedIn/telefone. Para PME sem web, promover o sócio-administrador do QSA a
   decisor (confiança média) é aceitável e instantâneo.
3. **Agentes web em paralelo rendem ~100% de match nas empresas com capital>0**
   (grandes/médias com presença digital). Achados de qualidade: detectaram
   sócio falecido (Morada Cemitérios), homônimos (AeC ≠ call center AeC), grupo
   controlador correto (SPE Moura Dubeux → Diego Villar).
4. **Cuidado com índice de lote nos prompts de agente**: um agente leu o índice
   errado e pulou um batch (detectado na verificação de cobertura por id — SEMPRE
   conferir cobertura por `empresa_id` contra a worklist, não confiar no rótulo).
5. **Paginação `.range()` é obrigatória** em qualquer contagem sobre
   `empresa_contatos` (tabela grande) — senão trunca em 1000.

## Comando de retomada (próxima rodada)

```bash
cd "/c/Users/Gabriel/OneDrive/Área de Trabalho/FREIRETAX/FreireTax"
set -a && . ./tools/.env.local && set +a
node tools/diag_terco.mjs   # re-mapeia cobertura da ação do terço (96% decisor)
# A ação do terço está praticamente fechada (405/423). Próximos passos possíveis:
#  a) Estender o MESMO método a OUTRA ação tributária (trocar ACAO no diag +
#     regenerar batches por empresa_id — pipeline: diag -> agentes -> insert_decisor_by_id).
#  b) Corrigir os achados de qualidade sinalizados (CNPJ Correio PB, UF das SAGAs).
#  c) Enriquecer TELEFONE/EMAIL dos decisores já achados (hoje 78% tel / poucos email)
#     — via A3/PJe (sócios) ou Econodata Premium se orçamento permitir.
```

---

## (Histórico) Rodadas RN 5-13 — enriquecimento genérico de gestores

- **RN contatos `decisor`**: ~420 inseridos (~28% cobertura porte=DEMAIS)
- **Limite natural**: empresas RN < R$16mi capital = presença web insuficiente
- Rodada 13: 15 nomes genéricos, 0 matches (confirmou limite)
- Pausado em favor do foco por AÇÃO (mais eficiente comercialmente).

**A3 / PJe skiptrace** (CPF+endereço+raramente telefone de sócios): trilha lenta
(~100/dia por tribunal, telefone raro ~8-12%). RN operacional; RS/SC/PR prontos
via CDP+Chrome real (ver ENRIQUECIMENTO_CONTATOS.md). Não usada nesta rodada —
a trilha web de decisor rende mais rápido e sem A3.
