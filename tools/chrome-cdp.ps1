<#
.SYNOPSIS
Abre o Chrome REAL com porta de depuracao (CDP) p/ o skip-trace anexar nele.

POR QUE: o Chromium do Playwright nao consegue apresentar o certificado A3 no
login Keycloak SSO (eproc/Projudi). O Chrome normal SIM (usa o cert store do Windows).
Entao: abrimos o Chrome com --remote-debugging-port, voce loga com o A3 nele,
e o scraper (--cdp) se conecta nessa instancia.

USO:
  .\tools\chrome-cdp.ps1 -Tj rs      # eproc RS (default)
  .\tools\chrome-cdp.ps1 -Tj sc      # eproc SC
  .\tools\chrome-cdp.ps1 -Tj sp      # eproc SP
  .\tools\chrome-cdp.ps1 -Tj pr      # Projudi PR
  # 1) loga com o A3 na aba que abrir
  # 2) noutro terminal roda o comando que o script imprime (1a vez --inspect)

O perfil e separado (.chrome-cdp-profile) p/ nao mexer no seu Chrome do dia a dia.
NUNCA fechar pelo scraper (no CDP nao ha browser.close()) -> fecharia suas abas.
#>
param(
    [ValidateSet("rs", "sc", "sp", "pr", "trf4", "trf2", "trf6", "trf5")]
    [string]$Tj = "rs",
    [int]$Port = 9222
)

$ErrorActionPreference = "Stop"

$targets = @{
    rs = @{ url = "https://eproc1g.tjrs.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj rs --inspect --cdp" }
    sc = @{ url = "https://eproc1g.tjsc.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj sc --inspect --cdp" }
    sp = @{ url = "https://eproc1g.tjsp.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj sp --inspect --cdp" }
    pr = @{ url = "https://projudi.tjpr.jus.br/projudi/"; cmd = "python tools\projudi_skiptrace.py --inspect --cdp" }
    trf4 = @{ url = "https://eproc1g.trf4.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj trf4 --inspect --cdp" }
    trf2 = @{ url = "https://eproc1g.trf2.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj trf2 --inspect --cdp" }
    trf6 = @{ url = "https://eproc1g.trf6.jus.br/eproc/"; cmd = "python tools\eproc_skiptrace.py --tj trf6 --inspect --cdp" }
    trf5 = @{ url = "https://pje1g.trf5.jus.br/pje/login.seam"; cmd = "python tools\pje_rn_skiptrace.py --tj trf5 --limit 150 --cdp" }
}
$t = $targets[$Tj]

# acha o chrome.exe
$cands = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    Write-Host "Chrome nao encontrado nos caminhos padrao. Ajuste o script." -ForegroundColor Red
    exit 1
}

$profileDir = Join-Path $PSScriptRoot "..\.chrome-cdp-profile"
$profileDir = [System.IO.Path]::GetFullPath($profileDir)

Write-Host "Abrindo Chrome com CDP na porta $Port (TJ=$($Tj.ToUpper()))..." -ForegroundColor Cyan
Write-Host "  chrome: $chrome" -ForegroundColor Gray
Write-Host "  perfil: $profileDir" -ForegroundColor Gray
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host "  1. No Chrome que abrir, LOGUE com o A3 em $($t.url)"
Write-Host "  2. Noutro terminal rode (1a vez --inspect p/ calibrar; depois troque --inspect por --limit 150):" -ForegroundColor Yellow
Write-Host "     $($t.cmd)" -ForegroundColor Green
Write-Host ""

& $chrome "--remote-debugging-port=$Port" "--user-data-dir=$profileDir" $t.url
