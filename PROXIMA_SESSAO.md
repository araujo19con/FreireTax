# Próxima Sessão — RN Enriquecimento (Rodada 14+)

## Status Atual (FIM 06/07/2026)

- **RN contatos `decisor`**: ~420 inseridos (~28% cobertura porte=DEMAIS)
- **Rodadas completadas**: 5-13 (8 rodadas)
- **Limite natural encontrado**: empresas RN < R$16mi capital = presença web insuficiente
- **Rodada 13 resultado**: 15 nomes genéricos, 0 matches (confirmou limite)

## Problemas Detectados

1. **Nomes imprecisos**: agentes retornam nomes que não batem DB (ex: "Câmara Cascudo" vs. "CASCUDO & SOARES")
2. **ROI decrescente**: match rate caiu 30% → 13% em rodadas 12-13
3. **Falta CNPJ-first lookup**: pesquisar por CNPJ ao invés de nome direto

## Opções Estratégicas

### A) Pausa RN, continuar PR/RS/SC (Máquina B)

- ✅ ROI melhor (menos dataset explorado)
- ✅ Máquina B já tem prompt de kickoff em scratchpad
- ⏱️ RN retoma depois

**Próximo passo:** Lançar máquina B com PR (546 empresas porte=DEMAIS)

### B) Continuar RN com CNPJ-lookup

- ✅ Resolveria problema "nome impreciso"
- ❌ Precisa integrar lookup CNPJ→BD→pesquisa executivo
- ⏱️ ~2-3h implementação + testes

### C) Upgrade Econodata/Apollo

- ✅ 100% cobertura automática
- ❌ Custo (~R$600+/mês)
- ⏱️ ~30min integração API

## Arquivos Organizados

| Arquivo                                                    | O que é                    | Status                |
| ---------------------------------------------------------- | -------------------------- | --------------------- |
| `ENRIQUECIMENTO_CONTATOS.md`                               | Living doc (main)          | ✅ Atualizado 06/07   |
| `OTIMIZACOES_IMPLEMENTADAS.md`                             | Guia 4 otimizações         | ✅ Novo 06/07         |
| `AGENT_PROMPT_TEMPLATE.md`                                 | Prompt mínimo reutilizável | ✅ Novo 06/07         |
| `tools/insert_decisor_gestor.mjs`                          | Tool permanente + skip-log | ✅ Integrado skip-log |
| `tools/detect_spe_clusters.mjs`                            | Auto-detector SPE          | ✅ Testado            |
| `supabase/migrations/20260706000000_empresas_skip_log.sql` | Skip-log table             | ✅ Pronta pra push    |
| `.env.local` (tools/)                                      | Service role key           | ✅ Criado             |

## Checklist Próxima Sessão

- [ ] Decidir: A (PR/RS/SC), B (CNPJ-lookup RN), ou C (upgrade API)
- [ ] Se A: copiar prompt kickoff de scratchpad, lançar máquina B
- [ ] Se B: implementar CNPJ-first lookup em `insert_decisor_gestor.mjs`
- [ ] Se C: integrar Econodata/Apollo API
- [ ] Aplicar migration `empresas_skip_log` se ainda não feito (`rtk supabase db push`)
- [ ] Continuar rodada 14+ com escolha acima

## Comando de Retomada

```bash
cd "/c/Users/Gabriel/OneDrive/Área de Trabalho/FREIRETAX/FreireTax"
# Leia este arquivo
# Escolha estratégia A/B/C acima
# Se A: execute prompt de máquina B em outra sessão
# Se B/C: execute rodada 14 com novo pipeline
rtk node tools/insert_decisor_gestor.mjs --file tools/lote_rn14.json
```

---

**Tudo commitado e pronto.** Próxima sessão é escolha + execução.
