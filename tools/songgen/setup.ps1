#Requires -Version 5.1
<#
  ENNEA 곡 생성 환경 세팅 (Windows + NVIDIA GPU)

  실행:  powershell -ExecutionPolicy Bypass -File setup.ps1

  하는 일: .venv 생성 -> PyTorch(cu126) -> ACE-Step -> 환경 점검.
  체크포인트는 여기서 받지 않는다. generate.py 첫 실행 때 checkpoints/ 로 들어온다.

  !! 이 파일은 반드시 UTF-8 BOM으로 저장한다.
     Windows PowerShell 5.1은 BOM 없는 UTF-8을 cp949로 읽어서 한글이 전부 깨진다.
     편집기가 BOM을 떼지 않게 확인한다 (VS Code: "UTF-8 with BOM").
#>

param([switch]$NoPause)

# ErrorActionPreference 를 Stop 으로 두지 않는다.
# PS 5.1은 네이티브 명령이 stderr 에 한 줄만 써도 그걸 종료 오류로 올린다.
# pip 도 torch 임포트도 경고를 stderr 로 뱉기 때문에, Stop 이면 아무 메시지 없이
# 스크립트가 죽는다. 대신 아래에서 $LASTEXITCODE 를 매번 직접 본다.
$ErrorActionPreference = "Continue"

Set-Location $PSScriptRoot

function Finish([int]$Code) {
    if (-not $NoPause) {
        Write-Host ""
        try { Read-Host "Enter 를 누르면 창이 닫힌다" | Out-Null } catch { }
    }
    exit $Code
}

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
    Finish 1
}

# 2. Python
$python = Find-Python
if (-not $python) {
    Write-Host "Python을 찾을 수 없다. 3.11을 설치한다 (설치 화면에서 PATH 등록 체크)." -ForegroundColor Red
    Write-Host "https://www.python.org/downloads/"
    Finish 1
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
    Finish 1
}

# 4. 패키지
Write-Host ""
Write-Host "pip 업그레이드..." -ForegroundColor Cyan
& $venvPy -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { Write-Host "pip 업그레이드 실패" -ForegroundColor Red; Finish 1 }

Write-Host ""
Write-Host "PyTorch (CUDA 12.6) 설치... 2GB 넘는다, 시간이 걸린다." -ForegroundColor Cyan
& $venvPy -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { Write-Host "PyTorch 설치 실패" -ForegroundColor Red; Finish 1 }

Write-Host ""
Write-Host "ACE-Step 설치..." -ForegroundColor Cyan
& $venvPy -m pip install "git+https://github.com/ace-step/ACE-Step.git"
if ($LASTEXITCODE -ne 0) { Write-Host "ACE-Step 설치 실패" -ForegroundColor Red; Finish 1 }

# torchaudio 2.9+ 는 save() 를 TorchCodec 으로 넘긴다. TorchCodec 은 윈도우에서
# FFmpeg 공유 라이브러리를 따로 요구하므로, generate.py 가 soundfile 로 직접 쓴다.
Write-Host ""
Write-Host "soundfile 확인..." -ForegroundColor Cyan
& $venvPy -m pip install soundfile
if ($LASTEXITCODE -ne 0) { Write-Host "soundfile 설치 실패" -ForegroundColor Red; Finish 1 }

# 5. 환경 점검
# check_env.py 는 ASCII JSON만 뱉는다. 여러 줄 파이썬 코드를 -c 인자로 넘기면
# PS 5.1의 네이티브 인자 처리에서 깨질 수 있어 파일로 분리했다.
Write-Host ""
Write-Host "확인" -ForegroundColor Cyan

$raw = & $venvPy (Join-Path $PSScriptRoot "check_env.py") 2>$null
$exitCode = $LASTEXITCODE
$line = @($raw) | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1

if ($exitCode -ne 0 -or -not $line) {
    Write-Host "환경 점검이 응답하지 않았다 (exit $exitCode)." -ForegroundColor Red
    Write-Host "직접 돌려보고 오류를 확인한다:"
    Write-Host "  .\.venv\Scripts\python.exe check_env.py"
    Finish 1
}

$info = $null
try { $info = $line | ConvertFrom-Json } catch { }
if (-not $info) {
    Write-Host "환경 점검 출력을 읽지 못했다:" -ForegroundColor Red
    Write-Host "  $line"
    Finish 1
}

Write-Host "  python   $($info.python)"
Write-Host "  torch    $(if ($info.torch) { $info.torch } else { '없음' })"
Write-Host "  acestep  $(if ($info.acestep) { '설치됨' } else { '없음' })"
Write-Host "  wav      $(if ($info.torchcodec) { 'torchcodec' } elseif ($info.soundfile) { 'soundfile' } else { '저장 불가' })"
if ($info.cuda) {
    Write-Host "  gpu      $($info.gpu)"
    Write-Host "  vram     $($info.vram) GB"
} else {
    Write-Host "  gpu      못 잡음" -ForegroundColor Red
}
foreach ($e in @($info.errors)) {
    if ($e) { Write-Host "  !! $e" -ForegroundColor Red }
}

if (-not $info.soundfile -and -not $info.torchcodec) {
    Write-Host ""
    Write-Host "WAV를 저장할 방법이 없다. soundfile 을 설치한다:" -ForegroundColor Red
    Write-Host "  .\.venv\Scripts\python.exe -m pip install soundfile"
    Finish 1
}
if (-not $info.torch -or -not $info.acestep) {
    Write-Host ""
    Write-Host "설치가 덜 됐다. 위 오류를 보고 다시 실행한다." -ForegroundColor Red
    Finish 1
}
if (-not $info.cuda) {
    Write-Host ""
    Write-Warning "패키지는 깔렸는데 CUDA를 못 잡았다. NVIDIA 드라이버를 최신으로 올린다."
    Write-Warning "이 상태로도 돌긴 하지만 CPU라 곡 하나에 수십 분 걸린다."
    Finish 1
}

Write-Host ""
Write-Host "세팅 완료. 다음:" -ForegroundColor Green
Write-Host "  .\run.ps1 --list"
Write-Host "  .\run.ps1 hard-dance -n 4"
Finish 0
