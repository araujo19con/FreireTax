#!/usr/bin/env bash
# Push do FreireTax como araujo19con (dono do repo), sem deixar a conta trocada.
#
# Por que existe: este PC tem várias contas gh no keyring; a ATIVA costuma ser
# jaganhojingles-cpu, que NÃO tem acesso de escrita a araujo19con/FreireTax (403).
# araujo19con já está logado no keyring — então basta ativar, dar push e restaurar.
#
# Uso:  bash tools/git-deploy.sh [branch]   (branch default: main)
#       ou, via alias configurado:  git deploy
set -u

OWNER="araujo19con"
BRANCH="${1:-main}"

# conta ativa atual, pra restaurar no fim (fallback jaganhojingles-cpu)
PREV="$(gh api user --jq .login 2>/dev/null || echo jaganhojingles-cpu)"

restore() { gh auth switch --hostname github.com --user "$PREV" >/dev/null 2>&1 || true; }
trap restore EXIT

echo "→ ativando conta $OWNER…"
if ! gh auth switch --hostname github.com --user "$OWNER" >/dev/null 2>&1; then
  echo "ERRO: conta $OWNER não está logada no gh. Rode: gh auth login --hostname github.com --web"
  exit 1
fi

echo "→ git push origin $BRANCH (como $OWNER)…"
git push origin "$BRANCH"
rc=$?

if [ $rc -eq 0 ]; then
  echo "✓ push ok — Vercel auto-deploya a $BRANCH em ~1-2 min."
else
  echo "✗ push falhou (rc=$rc)."
fi
echo "→ conta ativa restaurada para $PREV."
exit $rc
