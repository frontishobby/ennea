"""
setup.ps1이 호출하는 환경 점검.

ASCII JSON만 출력한다 — 한글이 프로세스 경계를 넘으면 코드페이지 변환을
타서 깨진다. 사람이 읽는 메시지는 전부 PowerShell 쪽에서 찍는다.

단독 실행도 된다:  .venv/Scripts/python.exe check_env.py
"""

import json
import sys

info = {
    "python": sys.version.split()[0],
    "torch": None,
    "cuda": False,
    "gpu": None,
    "vram": None,
    "acestep": False,
    "errors": [],
}

try:
    import torch

    info["torch"] = torch.__version__
    info["cuda"] = bool(torch.cuda.is_available())
    if info["cuda"]:
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
except Exception as exc:
    info["errors"].append(f"torch: {type(exc).__name__}: {exc}"[:200])

try:
    import importlib.util

    info["acestep"] = importlib.util.find_spec("acestep") is not None
except Exception as exc:
    info["errors"].append(f"acestep: {type(exc).__name__}: {exc}"[:200])

# ensure_ascii=True 가 기본이라 비ASCII는 \uXXXX 로 이스케이프된다.
print(json.dumps(info))
