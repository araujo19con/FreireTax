# MCP do PJe — Tax Trakker

Servidor MCP (stdio, JSON-RPC 2.0 sem SDK externo) que expõe o motor de
levantamento de teses (`pje_teses_empresa.py`) como ferramentas para agentes.

Arquivo: `tools/pje_mcp_server.py` · Config: `.mcp.json` na raiz do projeto.

## Ferramentas

| Tool                    | O que faz                                                        | Precisa de scraping? |
| ----------------------- | ---------------------------------------------------------------- | -------------------- |
| `pje_status`            | Chrome CDP vivo? sinal de login A3?                              | não                  |
| `pje_processos_empresa` | processos/teses já detectados de 1 CNPJ (lê o CRM)               | não                  |
| `pje_relatorio_teses`   | resumo de teses para uma lista de CNPJs (lê o CRM)               | não                  |
| `pje_detectar_teses`    | roda a detecção **ao vivo** no PJe (2.x + 1.x) p/ 1 CNPJ e grava | **sim** (CDP + A3)   |
| `pje_classificar_pdf`   | classifica a tese de uma inicial em PDF (do disco)               | não                  |

## Ativar no Claude Code

O `.mcp.json` na raiz já registra o server (`pje`). Ao reabrir o Claude Code
neste projeto, ele pergunta se confia no MCP do projeto — aprove. Depois,
`/mcp` lista o servidor `pje` e suas ferramentas.

Alternativa por CLI (equivalente):

```bash
claude mcp add pje -- python tools/pje_mcp_server.py
```

## Credenciais

O server carrega `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` automaticamente de
`tools/pje-env.local.ps1` (gitignored) se não estiverem no ambiente. Nada de
segredo vai para o `.mcp.json` (que é versionado).

## Pré-requisitos do scraping (só para `pje_detectar_teses`)

1. Chrome aberto em modo CDP na porta 9222 (`tools/chrome-cdp.ps1`).
2. Login A3 feito nas instâncias PJe: `pje1g.trf5.jus.br` (2.x federal) e/ou
   `pje.jfrn.jus.br` (1.x, Seção RN). Sem login, a detecção retorna erro
   "sessão A3 não ativa".
3. Porta do CDP configurável via env `PJE_CDP_PORT` (default 9222).

Os tools de leitura (`pje_status`, `pje_processos_empresa`, `pje_relatorio_teses`,
`pje_classificar_pdf`) funcionam sem login — só leem o CRM / o disco.
