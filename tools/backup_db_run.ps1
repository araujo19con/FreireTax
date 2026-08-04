# Wrapper do backup para o Agendador de Tarefas do Windows.
# Carrega as credenciais (pje-env.local.ps1) e roda o backup off-site do banco.
# Robusto: se o destino off-site (Google Drive) estiver indisponível, cai numa
# pasta LOCAL (melhor um backup local do que nenhum) e registra tudo num log.
$ErrorActionPreference = "Stop"
$root = "C:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker"
$localDir = Join-Path $root "backups"
$log = Join-Path $localDir "backup.log"
if (-not (Test-Path $localDir)) { New-Item -ItemType Directory -Force -Path $localDir | Out-Null }
function Log($m) { "$([DateTime]::Now.ToString('s'))  $m" | Tee-Object -FilePath $log -Append }

try {
    Set-Location $root
    . "$root\tools\pje-env.local.ps1"

    # destino off-site preferencial (Google Drive); cai no local se indisponível.
    $dest = if ($env:FREIRETAX_BACKUP_DEST) { $env:FREIRETAX_BACKUP_DEST } else { $localDir }
    if (-not (Test-Path $dest)) { try { New-Item -ItemType Directory -Force -Path $dest | Out-Null } catch {} }
    if (-not (Test-Path $dest)) {
        Log "AVISO: destino '$dest' indisponivel (Drive offline?) -> usando local '$localDir'"
        $dest = $localDir
    }

    Log "inicio -> $dest"
    # cnpj_cache e regeneravel (BrasilAPI) — exclui p/ enxugar o backup.
    python "$root\tools\backup_db.py" --out $dest --keep 30 --exclude cnpj_cache 2>&1 | Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
    Log "fim (exit=$code)"
    exit $code
} catch {
    Log "ERRO: $($_.Exception.Message)"
    exit 1
}
