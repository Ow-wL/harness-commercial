# 전체 검증 (Windows PowerShell).  사용: .\scripts\check.ps1   또는  .\scripts\check.ps1 --fast
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host ".venv 없음. 먼저 실행: .\scripts\setup.ps1" -ForegroundColor Red
    exit 2
}
& $py (Join-Path $root "scripts\check.py") @args
exit $LASTEXITCODE
