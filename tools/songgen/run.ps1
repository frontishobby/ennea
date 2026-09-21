<#
  generate.py 실행 래퍼. .venv를 따로 활성화할 필요 없다.

    .\run.ps1 --list
    .\run.ps1 hard-dance -n 8
    .\run.ps1 --all -n 3

  !! 이 파일은 반드시 UTF-8 BOM으로 저장한다.
     Windows PowerShell 5.1은 BOM 없는 UTF-8을 cp949로 읽어서 한글이 전부 깨진다.
#>

# Stop 으로 두면 안 된다. PS 5.1은 네이티브 명령이 stderr 에 한 줄만 써도
# 종료 오류로 올리는데, torch 임포트는 경고를 stderr 로 자주 뱉는다.
# 그러면 생성이 아무 메시지 없이 중간에 죽는다.
$ErrorActionPreference = "Continue"

$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Host "가상환경이 없다. 먼저 실행한다:" -ForegroundColor Red
    Write-Host "  powershell -ExecutionPolicy Bypass -File setup.ps1"
    try { Read-Host "Enter 를 누르면 창이 닫힌다" | Out-Null } catch { }
    exit 1
}

& $venvPy (Join-Path $PSScriptRoot "generate.py") @args
$code = $LASTEXITCODE

# 실패했을 때만 멈춘다. 창이 바로 닫혀서 오류를 못 읽는 일이 없게.
if ($code -ne 0) {
    Write-Host ""
    Write-Host "실패 (exit $code)" -ForegroundColor Red
    try { Read-Host "Enter 를 누르면 창이 닫힌다" | Out-Null } catch { }
}

exit $code
