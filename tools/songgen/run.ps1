<#
  generate.py 실행 래퍼. .venv를 따로 활성화할 필요 없다.

    .\run.ps1 --list
    .\run.ps1 hard-dance -n 8
    .\run.ps1 --all -n 3
#>

$ErrorActionPreference = "Stop"
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Error "가상환경이 없다. 먼저: powershell -ExecutionPolicy Bypass -File setup.ps1"
    exit 1
}

& $venvPy (Join-Path $PSScriptRoot "generate.py") @args
exit $LASTEXITCODE
