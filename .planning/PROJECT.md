# Tax Trakker — GSD Project

## Visão Geral

CRM jurídico-tributário para **Freire Pignataro Advogados**. Gerencia empresas (clientes/prospects), ações tributárias (teses), elegibilidade, prospecção, tarefas e agenda.

Deployed em: `freire-tax.vercel.app`

## Stack

- **Frontend**: Vite + React 18 + TypeScript + React Router v6
- **UI**: shadcn/ui + Tailwind + lucide-react
- **Data**: @tanstack/react-query + Supabase (Postgres + Edge Functions Deno)
- **Build/Deploy**: Bun + Vercel (auto-deploy no push `main`)

## Objetivo deste ciclo

Estabilizar o sistema antes de adicionar features: corrigir bugs críticos (segurança, integridade de dados, performance) e depois implementar os módulos funcionais mais urgentes para o escritório.

## Prioridades declaradas

1. Bugs críticos de segurança e integridade de dados
2. Relatórios exportáveis personalizados
3. Prazos processuais com alertas
4. Módulo de honorários / recebimentos

## Ritmo

Fases pequenas: 1–3 dias cada, entregáveis testáveis por fase.

## Contexto do codebase

Ver `.planning/codebase/` para análise completa (2026-05-29):

- **CONCERNS.md** — bugs, débito técnico, riscos
- **FEATURE_GAPS.md** — gaps funcionais priorizados
- **ARCHITECTURE.md** / **STRUCTURE.md** — estrutura e padrões
- **STACK.md** / **INTEGRATIONS.md** — dependências e integrações
- **CONVENTIONS.md** / **TESTING.md** — convenções e cobertura de testes

## Restrições conhecidas

- `types.ts` desatualizado — ~60 `as any` casts como workaround
- Acoes.tsx com 1800 linhas — god component a ser refatorado gradualmente
- `xlsx@0.18.5` com licença AGPL — avaliar migração para `exceljs`
- RFB slim table cobre apenas RN+PB por padrão
