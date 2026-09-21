<#
  generate.py 실행 래퍼. .venv를 따로 활성화할 필요 없다.

    .\run.ps1 --list
    .\run.ps1 hard-dance -n 8
    .\run.ps1 --all -n 3

  !! 이 파일은 반드시 UTF-8 BOM으로 저장한다.
     Windows PowerShell 5.1은 BOM 없는 UTF-8을 cp949로 읽어서 한글이 전부 깨진다.
#>

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Host "가상환경이 없다. 먼저 실행한다:" -ForegroundColor Red
    Write-Host "  powershell -ExecutionPolicy Bypass -File setup.ps1"
    exit 1
}

& $venvPy (Join-Path $PSScriptRoot "generate.py") @args
exit $LASTEXITCODE
