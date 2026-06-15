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
