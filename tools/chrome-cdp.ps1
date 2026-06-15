<#
.SYNOPSIS
Abre o Chrome REAL com porta de depuração (CDP) p/ o skip-trace anexar nele.

POR QUÊ: o Chromium do Playwright não consegue apresentar o certificado A3 no
login Keycloak SSO (TJSP/eproc). O Chrome normal SIM (usa o cert store do Windows).
Então: abrimos o Chrome com --remote-debugging-port, você loga com o A3 nele
normalmente, e o eproc_skiptrace.py --cdp se conecta nessa instância.

USO:
  .\tools\chrome-cdp.ps1            # abre Chrome com porta 9222, perfil separado
  # 1) loga no eproc (ex: https://eproc1g.tjsp.jus.br/eproc/) com o A3
  # 2) noutro terminal:  python tools\eproc_skiptrace.py --tj sp --inspect --cdp

O perfil é separado (.chrome-cdp-profile) p/ não mexer no seu Chrome do dia a dia.
#>
param([int]$Port = 9222)

$ErrorActionPreference = "Stop"

# acha o chrome.exe
$cands = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    Write-Host "Chrome não encontrado nos caminhos padrão. Ajuste o script." -ForegroundColor Red
    exit 1
}

$profileDir = Join-Path $PSScriptRoot "..\.chrome-cdp-profile"
$profileDir = [System.IO.Path]::GetFullPath($profileDir)

Write-Host "Abrindo Chrome com CDP na porta $Port..." -ForegroundColor Cyan
Write-Host "  chrome: $chrome" -ForegroundColor Gray
Write-Host "  perfil: $profileDir" -ForegroundColor Gray
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host "  1. No Chrome que abrir, va em https://eproc1g.tjsp.jus.br/eproc/ e LOGUE com o A3"
Write-Host "  2. Noutro terminal rode:" -ForegroundColor Yellow
Write-Host "     python tools\eproc_skiptrace.py --tj sp --inspect --cdp" -ForegroundColor Green
Write-Host ""

& $chrome "--remote-debugging-port=$Port" "--user-data-dir=$profileDir" "https://eproc1g.tjsp.jus.br/eproc/"
