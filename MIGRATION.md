# Guia de Migração — FreireTax

Passo a passo para continuar o projeto em outra máquina Windows.
Tempo estimado: **20–30 minutos**.

---

## 🚨 Antes de começar (na máquina antiga)

Confirme que **tudo** está sincronizado:

```bash
# 1. FreireTax
cd "C:\Users\Gabriel\OneDrive\Área de Trabalho\FREIRETAX\FreireTax"
git status            # deve mostrar "working tree clean"
git log origin/main..HEAD    # não deve mostrar commits locais

# 2. Obsidian vault
cd "C:\Users\Gabriel\OneDrive\Documentos\Obsidian Vault"
git status
```

Se houver alterações não comitadas, faça `git add -A && git commit -m "wip" && git push` antes.

---

## 🖥️ Na nova máquina — instalação base

### 1. Dependências do sistema

Via `winget` (PowerShell como admin):

```powershell
winget install --id=OpenJS.NodeJS.LTS -e
winget install --id=Git.Git -e
winget install --id=astral-sh.uv -e          # pra obsidian MCP
winget install --id=Anthropic.Claude -e      # Claude Desktop (opcional)
winget install --id=Obsidian.Obsidian -e
```

Reinicia o terminal depois de instalar.

Verifique:

```powershell
node --version   # v20+ (ou v24 como a máquina anterior)
git --version
uvx --version
```

### 2. Claude Code CLI

Se já tem, pule. Se não:

```powershell
# (instruções dependem de como está distribuído no momento — siga docs oficiais)
# Login na conta que estava na máquina anterior
claude-code login
```

### 3. Supabase CLI (opcional, pra deploys)

Usamos `npx supabase` — não precisa instalar global. Só precisa do token:
- `sbp_1a8356097e6a8ff2a449294b6367dbd9597773c2` (ou gere novo em https://supabase.com/dashboard/account/tokens)

---

## 📦 Clonar os repos

Sugestão: use `~/projects` em vez de OneDrive pra dev (evita conflitos de sync com node_modules).

```powershell
mkdir "$env:USERPROFILE\projects"
cd "$env:USERPROFILE\projects"

# 1. FreireTax (produto)
git clone https://github.com/araujo19con/FreireTax.git
cd FreireTax
npm install
```

Aguarde ~2 min. Depois configure `.env`:

```powershell
Copy-Item .env.example .env
# Edite .env preenchendo com os valores:
#   VITE_SUPABASE_PROJECT_ID="fxsuwvgcybjbuqqcuskt"
#   VITE_SUPABASE_URL="https://fxsuwvgcybjbuqqcuskt.supabase.co"
#   VITE_SUPABASE_PUBLISHABLE_KEY="<anon key completa do Supabase dashboard>"
```

A anon key está em: https://supabase.com/dashboard/project/fxsuwvgcybjbuqqcuskt/settings/api → seção **"Project API Keys"** → campo `anon` / `public`.

Teste:

```powershell
npm run dev
# Abre http://localhost:8080 e loga com suas credenciais
```

### Obsidian Vault (opcional)

```powershell
cd "$env:USERPROFILE\Documents"
git clone https://github.com/araujo19con/obsidian-vault.git
# Abra Obsidian → "Open folder as vault" → aponte para este diretório
```

No Obsidian, habilite de novo os plugins (já estão no vault via `.obsidian/`):
- **Local REST API** — vai precisar **gerar uma nova API key** (Settings → Local REST API → Regenerate) e atualizar o `mcp.json` (ver seção MCP abaixo)

---

## 🤖 Configurar Claude Code na máquina nova

### Agentes xquads (177 agentes)

```powershell
# 1. Clone o repo do xquads
cd "$env:USERPROFILE\projects"
git clone --depth 1 https://github.com/ohmyjahh/xquads-squads.git

# 2. Copia o instalador (que está no OneDrive da máquina antiga) OU recria
# Se não tiver o instalador, crie:
mkdir xquads-installer
cd xquads-installer
```

Crie `package.json`:
```json
{
  "name": "xquads-installer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "js-yaml": "^4.1.0" }
}
```

O `install.mjs` completo está em `FreireTax/tools/xquads-installer/` — **commite ele no repo antes** de migrar, ou copie manualmente via OneDrive.

```powershell
npm install
node install.mjs        # instala 177 agentes em ~/.claude/agents/xquads/
```

### MCP servers (Obsidian + n8n)

Crie/edite `C:\Users\<seu-user>\.claude\mcp.json`:

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": { "MCP_MODE": "stdio" }
    },
    "obsidian": {
      "command": "uvx",
      "args": ["mcp-obsidian"],
      "env": {
        "OBSIDIAN_API_KEY": "<cole aqui a nova key gerada no Local REST API>",
        "OBSIDIAN_HOST": "127.0.0.1",
        "OBSIDIAN_PORT": "27124"
      }
    }
  }
}
```

Reinicie o Claude Code depois.

### Memórias do projeto

As memórias do projeto estão em:
```
C:\Users\<old-user>\.claude\projects\C--Users-<old-user>-OneDrive--rea-de-Trabalho-FREIRETAX\memory\
```

Copia o arquivo `MEMORY.md` e os `.md` linkados pra mesma estrutura na máquina nova. Isso preserva context sobre xquads, obsidian, decisões anteriores.

---

## ✅ Checklist final

Rode `npm run dev` no FreireTax e teste:

- [ ] Login com suas credenciais funciona
- [ ] `/empresas` — lista carrega, filtros funcionam, RFB em lote disponível
- [ ] `/elegibilidade` — matriz renderiza, wizard abre
- [ ] `/minhas-tarefas` — Kanban/Lista/Timeline, templates acessíveis
- [ ] `/minha-semana` — grid dos 7 dias
- [ ] `/tarefas/equipe` — dashboard de carga
- [ ] `/tarefas/templates` — CRUD visível

---

## 📋 Sumário do que está espalhado

| Item | Local atual | Migra como |
|---|---|---|
| Código FreireTax | GitHub `araujo19con/FreireTax` | `git clone` |
| Obsidian vault | GitHub `araujo19con/obsidian-vault` | `git clone` + abrir no Obsidian |
| Env vars | `.env` local (não commitado) | Copiar manualmente ou regenerar anon key |
| Agentes xquads (177) | `~/.claude/agents/xquads/` | Reinstalar via installer |
| MCP configs | `~/.claude/mcp.json` | Recriar com nova Obsidian key |
| Memórias | `~/.claude/projects/.../memory/` | Copiar arquivos |
| Node modules | `FreireTax/node_modules` | `npm install` regenera |
| Supabase (projeto) | Cloud | Já está online, nada a fazer |

Chaves/tokens que você vai precisar anotar/regenerar:
- Anon key Supabase — dashboard → Settings → API
- Personal Access Token Supabase (se for fazer deploys) — `sbp_...` em https://supabase.com/dashboard/account/tokens
- API key Obsidian Local REST API — gerar nova no plugin

---

## 🛠️ Comandos úteis pós-migração

```powershell
# Dev server
cd projects/FreireTax
npm run dev                    # http://localhost:8080

# Deploy edge function (precisa do Supabase PAT como env)
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase functions deploy enriquecer-cnpj --project-ref fxsuwvgcybjbuqqcuskt --no-verify-jwt

# Build de produção
npm run build

# Lint + typecheck + testes
npm run lint
npx tsc --noEmit
npm run test
```

---

## 🆘 Problemas comuns

**"Module not found" após clone:** rode `npm install`.

**CORS error ao chamar edge function:** a função tá com `--no-verify-jwt` — se der erro "invalid JWT", rode o deploy de novo com essa flag.

**Obsidian MCP não conecta:** verifique que o Obsidian está aberto E o plugin Local REST API está ativo. API key no `mcp.json` tem que bater com a do plugin.

**RFB enrichment falha:** confira que o CNPJ é válido (módulo 11). Erros transitórios da BrasilAPI geralmente resolvem retentando.

---

*Atualizado: 2026-04-21*
