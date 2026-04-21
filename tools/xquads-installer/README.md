# xquads-installer

Instala os 177 agentes do repo [ohmyjahh/xquads-squads](https://github.com/ohmyjahh/xquads-squads) como subagentes do Claude Code (convertendo YAML Synkra → frontmatter Claude Code).

## Uso

```bash
cd tools/xquads-installer
npm install

# 1. Clone o repo-fonte dentro desta pasta
git clone --depth 1 https://github.com/ohmyjahh/xquads-squads.git

# 2. Execute o installer
node install.mjs           # instala em ~/.claude/agents/xquads/
node install.mjs --dry-run # só lista, não grava
node install.mjs --flat    # grava em ~/.claude/agents/ direto (sem subdir)
```

Output: 177 agentes (`xquads/brand-*`, `xquads/copy-*`, etc.) prontos pra usar via
`Agent({ subagent_type: "<agent-id>" })`.

Para **atualizar** (puxar novidades do upstream):

```bash
cd xquads-squads && git pull
cd .. && node install.mjs   # reprocessa
```
