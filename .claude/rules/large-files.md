---
paths:
  - "src/pages/**"
  - "src/integrations/supabase/types.ts"
  - "src/components/ui/sidebar.tsx"
---

# Regra: Leitura de arquivos grandes

Este projeto tem vários arquivos >500 linhas. Ler eles inteiros queima 5-40k tokens por leitura. Siga o protocolo:

## Protocolo obrigatório

1. **Antes de `Read` completo**, rode `Grep` procurando o símbolo/seção que você quer editar.
2. Se precisar ler, use `offset` + `limit` (janela de 100-200 linhas em volta do alvo).
3. Só leia o arquivo inteiro se for **reescrita total** (raro).

## Arquivos alvo e o que tem neles

Contagens atualizadas em 2026-05-28 (refresh com `wc -l src/**/*.tsx | sort -rn | head -20`).

| Arquivo                                          | Linhas | O que tem                                      | Como navegar                                                       |
| ------------------------------------------------ | ------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| `src/integrations/supabase/types.ts`             | 1.624  | Types autogerados Supabase                     | `Grep` pelo nome da tabela (ex: `tarefas: \{`) — nunca ler inteiro |
| `src/pages/Prospeccao.tsx`                       | ~1.686 | Kanban + dialogs + filtros de prospecção       | Grepar componente (`KanbanColumn`, `ProspeccaoCard`, etc.)         |
| `src/pages/Importacao.tsx`                       | ~1.594 | Importação de empresas via XLSX                | Grepar `parseRow`, `enrichCNPJ`                                    |
| `src/pages/empresas/EmpresasMapView.tsx`         | ~1.166 | Mapa Brasil + painel lateral + filtros geo     | Grepar `MapPanel`, `useUFCounts`, `fetchBulkEmpresas`              |
| `src/pages/Acoes.tsx`                            | ~1.167 | Lista teses + editor de regras + pool elegível | Grepar seção (`RegrasEditor`, `handleDesqualificar`)               |
| `src/pages/Empresas.tsx`                         | ~1.054 | Tabela + dialog + filtros RFB                  | Grepar `EmpresaDialog` ou filtros                                  |
| `src/components/EmpresaDialog.tsx`               | ~953   | CRUD empresa + busca CNPJ + validação          | Grepar `submit`, `enrich`, `validate`                              |
| `src/pages/acoes/ImportacaoProspeccaoDialog.tsx` | ~869   | Importação em massa de prospecções             | Grepar `processBatch`                                              |
| `src/pages/empresas/EmpresaDetailSheet.tsx`      | ~874   | Detail sheet de empresa                        | Grepar tab (`ResumoTab`, `ContatosTab`)                            |
| `src/pages/acoes/AcaoEmpresasPanel.tsx`          | ~858   | Painel de empresas por ação                    | Grepar `presetChips`, `handleExport`                               |
| `src/components/PropostaDialog.tsx`              | ~860   | Proposta + timbrado + PDF print                | Grepar `renderSecoes`, `print`                                     |
| `src/pages/elegibilidade/CriteriosAdmin.tsx`     | ~843   | Admin de critérios de elegibilidade            | Grepar `validateRegra`, `defaultRegraFor`                          |
| `src/components/EmpresaFilterPopover.tsx`        | ~828   | Filtros RFB (fonte ÚNICA — não duplicar)       | Grepar `applyFilters`, `Faixa`                                     |
| `src/pages/AnaliseRFB.tsx`                       | ~785   | Filtros RFB cross-tabela                       | Grepar `FilterChip` ou `rfbFilter`                                 |
| `src/pages/Dashboard.tsx`                        | ~773   | KPIs + gráficos Recharts (usa `fetchAllRows`)  | Grepar `Kpi` ou nome do gráfico                                    |
| `src/pages/acoes/AcaoEmpresasFilterPopover.tsx`  | ~729   | Filtros do painel de ação                      | Grepar `faixasNoIntervalo`                                         |
| `src/components/TarefaDialog.tsx`                | ~717   | CRUD tarefa + anexos + subtarefas              | Grepar `uploadAnexo`                                               |
| `src/pages/tarefas/EquipeView.tsx`               | ~519   | Carga equipe + Horas registradas (tabs)        | Grepar `CargaTab`, `HorasTab`                                      |
| `src/components/ui/sidebar.tsx`                  | 637    | shadcn Sidebar primitive                       | Não editar. Compor por cima em `AppSidebar.tsx`.                   |

## Types do Supabase — atalho

```
Database["public"]["Tables"]["<tabela>"]["Row"]       // select shape
Database["public"]["Tables"]["<tabela>"]["Insert"]    // insert shape
Database["public"]["Enums"]["<enum>"]                 // enums (status, porte, etc.)
```

Para descobrir colunas de uma tabela sem abrir `types.ts`:

```
Grep pattern: "<nome_tabela>: \{$" path: src/integrations/supabase/types.ts -A 80
```

## Quando é OK ler inteiro

- Arquivo tem <300 linhas
- Você vai reescrever 70%+ do arquivo
- É a primeira investigação do projeto e nada mais foi lido ainda
