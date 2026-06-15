# Sync backup files from Docker container to Windows .\backups\ folder
$Docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$Root = "f:\file_D\Kanyapat\web_yang\new_engrids_rubberv3\engrids_rubberv3"
$BackupsDir = "$Root\backups"
$LogFile = "$Root\backup-sync.log"
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
if (-not (Test-Path $BackupsDir)) { New-Item -ItemType Directory -Path $BackupsDir | Out-Null }
$out = & $Docker cp rub_backup_v3:/backups/. "$BackupsDir\" 2>&1
if ($LASTEXITCODE -eq 0) {
    Add-Content $LogFile "$ts OK - synced to $BackupsDir"
    Write-Host "Synced to $BackupsDir" -ForegroundColor Green
    Get-ChildItem $BackupsDir -Filter "*.sql" | Sort-Object LastWriteTime -Descending | Format-Table Name, @{L="Size(KB)";E={[int]($_.Length/1KB)}}, LastWriteTime
} else {
    Add-Content $LogFile "$ts FAIL - $out"
    Write-Host "docker cp failed: $out" -ForegroundColor Red
    exit 1
}
