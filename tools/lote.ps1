# Roda um lote do skip-trace PJe (grava no CRM).
# Uso:  .\tools\lote.ps1 100   (default 60)
# Abre o Chrome; logue no TJRN com o A3 UMA vez por sessao (cai ~30min).
param([int]$Limite = 60)
. "$PSScriptRoot\pje-env.local.ps1"
python -u "$PSScriptRoot\pje_rn_skiptrace.py" --limit $Limite
