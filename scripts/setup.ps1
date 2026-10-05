# 개발 환경 준비 (Windows PowerShell). Python 3.10 이상 필요.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"
if (-not (Test-Path $venv)) { py -3 -m venv $venv }
& (Join-Path $venv "Scripts\python.exe") -m pip install -r (Join-Path $root "requirements.txt")
Write-Host "준비 완료. 검증: .\scripts\check.ps1"
