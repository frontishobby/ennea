#Requires -Version 5.1
<#
  ENNEA 곡 생성 환경 세팅 (Windows + NVIDIA GPU)

  실행:  powershell -ExecutionPolicy Bypass -File setup.ps1

  하는 일: .venv 생성 -> PyTorch(cu126) -> ACE-Step -> CUDA 확인.
  체크포인트는 여기서 받지 않는다. generate.py 첫 실행 때 checkpoints/ 로 들어온다.

  !! 이 파일은 반드시 UTF-8 BOM으로 저장한다.
     Windows PowerShell 5.1은 BOM 없는 UTF-8을 cp949로 읽어서 한글이 전부 깨진다.
     편집기가 BOM을 떼지 않게 확인한다 (VS Code: "UTF-8 with BOM").
#>

$ErrorActionPreference = "Stop"
# PS 7.4+ 는 네이티브 명령의 0 아닌 종료코드를 종료 오류로 올린다.
# 아래에서 $LASTEXITCODE 를 직접 보고 판단하므로 꺼둔다.
$PSNativeCommandUseErrorActionPreference = $false

Set-Location $PSScriptRoot

Write-Host ""
Write-Host "ENNEA songgen 세팅" -ForegroundColor Cyan
Write-Host ""

function Find-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in @("3.11", "3.10", "3.12")) {
            try {
                $out = & py "-$v" -c "import sys; print(sys.version.split()[0])" 2>$null
                if ($LASTEXITCODE -eq 0 -and $out) {
                    return [pscustomobject]@{ Exe = "py"; Args = @("-$v"); Version = "$out".Trim() }
                }
            } catch { }
        }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        try {
            $out = & python -c "import sys; print(sys.version.split()[0])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $out) {
                return [pscustomobject]@{ Exe = "python"; Args = @(); Version = "$out".Trim() }
            }
        } catch { }
    }
    return $null
}

# 1. git — ACE-Step을 깃 저장소에서 바로 설치한다
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "git이 없다. https://git-scm.com/download/win 에서 설치하고 다시 실행한다." -ForegroundColor Red
    exit 1
}

# 2. Python
$python = Find-Python
if (-not $python) {
    Write-Host "Python을 찾을 수 없다. 3.11을 설치한다 (설치 화면에서 PATH 등록 체크)." -ForegroundColor Red
    Write-Host "https://www.python.org/downloads/"
    exit 1
}
Write-Host "Python $($python.Version)"
if ($python.Version -match "^3\.(1[3-9]|[2-9]\d)") {
    Write-Warning "ACE-Step은 3.10/3.11에서 가장 안정적이다. 설치가 깨지면 3.11을 따로 깐다."
}

# 3. 가상환경
if (Test-Path ".venv") {
    Write-Host ".venv 가 이미 있다 — 재사용한다."
} else {
    Write-Host "가상환경 생성 중..."
    & $python.Exe @($python.Args + @("-m", "venv", ".venv"))
}
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
    Write-Host "가상환경 생성 실패. .venv 폴더를 지우고 다시 실행한다." -ForegroundColor Red
    exit 1
}

# 4. 패키지
Write-Host ""
Write-Host "pip 업그레이드..." -ForegroundColor Cyan
& $venvPy -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { Write-Host "pip 업그레이드 실패" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "PyTorch (CUDA 12.6) 설치... 2GB 넘는다, 시간이 걸린다." -ForegroundColor Cyan
& $venvPy -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { Write-Host "PyTorch 설치 실패" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "ACE-Step 설치..." -ForegroundColor Cyan
& $venvPy -m pip install "git+https://github.com/ace-step/ACE-Step.git"
if ($LASTEXITCODE -ne 0) { Write-Host "ACE-Step 설치 실패" -ForegroundColor Red; exit 1 }

# 5. 확인
# 파이썬 쪽은 ASCII JSON만 뱉는다. 한글이 프로세스 경계를 넘으면
# 코드페이지 때문에 또 깨진다 — 메시지는 전부 PowerShell에서 찍는다.
Write-Host ""
Write-Host "확인" -ForegroundColor Cyan
$raw = & $venvPy -c @"
import json, importlib.util
info = {'torch': None, 'cuda': False, 'gpu': None, 'vram': None, 'acestep': False}
try:
    import torch
    info['torch'] = torch.__version__
    info['cuda'] = torch.cuda.is_available()
    if info['cuda']:
        info['gpu'] = torch.cuda.get_device_name(0)
        info['vram'] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
except Exception:
    pass
info['acestep'] = importlib.util.find_spec('acestep') is not None
print(json.dumps(info))
"@

$line = @($raw) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
if (-not $line) {
    Write-Host "확인 단계 실패 — 파이썬이 응답하지 않았다." -ForegroundColor Red
    exit 1
}
$info = $line | ConvertFrom-Json

Write-Host "  torch    $($info.torch)"
Write-Host "  acestep  $(if ($info.acestep) { '설치됨' } else { '없음' })"
if ($info.cuda) {
    Write-Host "  gpu      $($info.gpu)"
    Write-Host "  vram     $($info.vram) GB"
} else {
    Write-Host "  gpu      못 잡음" -ForegroundColor Red
    Write-Warning "CUDA를 못 잡았다. NVIDIA 드라이버를 최신으로 올리고 다시 확인한다."
}

if (-not $info.acestep -or -not $info.cuda) { exit 1 }

Write-Host ""
Write-Host "끝. 다음:" -ForegroundColor Green
Write-Host "  .\run.ps1 --list"
Write-Host "  .\run.ps1 hard-dance -n 4"
Write-Host ""
