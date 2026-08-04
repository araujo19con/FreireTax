# Wrapper do backup para o Agendador de Tarefas do Windows.
# Carrega as credenciais (pje-env.local.ps1) e roda o backup off-site do banco.
# Aponte FREIRETAX_BACKUP_DEST para uma pasta SINCRONIZADA (OneDrive/Google Drive)
# para a cópia off-site do 3-2-1; senão cai numa pasta local ./backups.
$ErrorActionPreference = "Stop"
$root = "C:\Users\Gabriel\Desktop\FREIRETAX\tax-trakker"
Set-Location $root
. "$root\tools\pje-env.local.ps1"
$dest = if ($env:FREIRETAX_BACKUP_DEST) { $env:FREIRETAX_BACKUP_DEST } else { "$root\backups" }
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
# cnpj_cache é regenerável (BrasilAPI) — exclui p/ enxugar o backup.
python "$root\tools\backup_db.py" --out $dest --keep 30 --exclude cnpj_cache
