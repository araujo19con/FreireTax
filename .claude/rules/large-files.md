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

| Arquivo | Linhas | O que tem | Como navegar |
|---------|--------|-----------|--------------|
| `src/integrations/supabase/types.ts` | 1.624 | Types autogerados Supabase | `Grep` pelo nome da tabela (ex: `tarefas: \{`) — nunca ler inteiro |
| `src/pages/Prospeccao.tsx` | 1.046 | Kanban + dialogs + filtros de prospecção | Grepar componente (`KanbanColumn`, `ProspeccaoCard`, etc.) |
| `src/pages/Acoes.tsx` | 923 | Lista teses + editor de regras + pool elegível | Grepar seção (`RegrasEditor`, `PoolTable`) |
| `src/pages/Empresas.tsx` | 810 | Tabela + dialog + filtros RFB | Grepar `EmpresaDialog` ou filtros |
| `src/pages/Dashboard.tsx` | 757 | KPIs + gráficos Recharts | Grepar `Kpi` ou nome do gráfico |
| `src/pages/AnaliseRFB.tsx` | 701 | Filtros RFB cross-tabela | Grepar `FilterChip` ou `rfbFilter` |
| `src/components/ui/sidebar.tsx` | 637 | shadcn Sidebar primitive | Não editar. Compor por cima em `AppSidebar.tsx`. |

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
