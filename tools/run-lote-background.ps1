<#
.SYNOPSIS
Roda o skip-trace PJe em background com monitoramento ao vivo.

.DESCRIPTION
- Dispara lote.ps1 em um novo window (Chrome abre pra login A3)
- Abre outro window com pje_progress.py (painel ao vivo)
- Logs salvos em pje_lote_$(timestamp).log

.PARAMETER Limite
Quantos sócios processar (default: 150)

.EXAMPLE
.\tools\run-lote-background.ps1 -Limite 200
#>

param([int]$Limite = 150)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "pje_lote_${timestamp}.log"

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "PJe Skip-Trace Background Runner" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Configuração:" -ForegroundColor Yellow
Write-Host "   Limite de sócios: $Limite"
Write-Host "   Log: $logFile"
Write-Host ""
Write-Host "⚠️  IMPORTANTE:" -ForegroundColor Red
Write-Host "   1. Um Chrome abrirá — faça login com CERTIFICADO A3 uma vez"
Write-Host "   2. O lote rodará em background (demora ~${Limite} minutos, ~100 sócios/dia)"
Write-Host "   3. Monitore o progresso no painel ao vivo que abrir"
Write-Host ""
Write-Host "💡 Dica: Se atingir limite diário do TJRN, aguarde próximo dia." -ForegroundColor Green
Write-Host ""

# Confirmar antes de começar
$confirm = Read-Host "Pronto para iniciar? (S/n)"
if ($confirm -ne "S" -and $confirm -ne "") {
    Write-Host "Cancelado." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "⏱️  Iniciando lote... (window 1: lote.ps1)" -ForegroundColor Cyan

# Window 1: Lote (será interativo para login A3)
$logeScript = @"
cd '$((Get-Location).Path)'
`$VerbosePreference = 'SilentlyContinue'
Write-Host '█ Lote PJe iniciado — Chrome abrirá para login A3' -ForegroundColor Cyan
Write-Host ''
try {
    . '$PSScriptRoot\pje-env.local.ps1'
    python -u '$PSScriptRoot\pje_rn_skiptrace.py' --limit $Limite 2>&1 | Tee-Object -FilePath '$logFile' -Append
    Write-Host ''
    Write-Host '✓ Lote concluído!' -ForegroundColor Green
} catch {
    Write-Host '✗ Erro durante lote: ' + `$_.Exception.Message -ForegroundColor Red
}
Write-Host ''
Write-Host 'Window pode ser fechado ou deixado aberto para referência.' -ForegroundColor Gray
Read-Host 'Pressione ENTER para sair'
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $logeScript

Write-Host "⏱️  Abrindo painel de progresso... (window 2: pje_progress.py)" -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Window 2: Progress (monitoramento)
$progressScript = @"
cd '$((Get-Location).Path)'
. '$PSScriptRoot\pje-env.local.ps1'
Write-Host '█ Painel de progresso PJe' -ForegroundColor Cyan
Write-Host ''
python '$PSScriptRoot\pje_progress.py'
Write-Host ''
Read-Host 'Pressione ENTER para sair'
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $progressScript

Write-Host ""
Write-Host "✓ Lote iniciado em background!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Dois windows abertos:" -ForegroundColor Cyan
Write-Host "   1. Lote (Chrome + processamento)" -ForegroundColor Gray
Write-Host "   2. Progresso (painel ao vivo)" -ForegroundColor Gray
Write-Host ""
Write-Host "📝 Log: ./$logFile" -ForegroundColor Gray
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
