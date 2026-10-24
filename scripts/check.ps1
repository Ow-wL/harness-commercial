# 검증 (Windows PowerShell).  사용: .\scripts\check.ps1 (전체)  /  --fast  /  --only KEY,...  /  --list
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host ".venv 없음. 먼저 실행: .\scripts\setup.ps1" -ForegroundColor Red
    exit 2
}
# 자식 프로세스의 정상 stderr 출력(경고·진행 표시·테스트 실패 상세)으로 검증이 멈추지 않게 한다.
# Windows PowerShell 5.1은 출력을 리다이렉트(*> 파일 등)하면 native stderr 줄을 ErrorRecord로 감싸고, "Stop"이면 첫 줄에서
# 스크립트를 끝낸다(로그가 끊기고 종료 코드도 1이 된다). 이 호출만 Continue로 두고, 감싼 줄은 원래 텍스트로 되돌려 같은 출력 흐름에 낸다.
# 종료 코드는 자식(check.py)의 $LASTEXITCODE 그대로 돌려준다
$ErrorActionPreference = "Continue"
# Python 실행 자체가 실패하면 LASTEXITCODE가 갱신되지 않으므로 성공으로 끝나지 않게 기본값을 둔다
$global:LASTEXITCODE = 1
& $py (Join-Path $root "scripts\check.py") @args 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_ }
}
exit $LASTEXITCODE
