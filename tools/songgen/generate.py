"""
ENNEA 곡 생성 — ACE-Step 배치 러너.

프롬프트와 시드를 manifest.json에 남긴다. 같은 시드로 같은 트랙이 다시 나오므로
"이 곡 드럼만 더 선명하게 다시" 같은 작업이 가능하다. 채보를 chartHash로 재현하는
것과 같은 규칙을 음원에도 건다.

  python generate.py --list                 프리셋 목록
  python generate.py hard-dance -n 8        8개 뽑기
  python generate.py --all -n 3             전 프리셋 3개씩
  python generate.py hard-dance --seed 42   특정 시드 재현
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRESET_FILE = ROOT / "presets.json"
MANIFEST_FILE = ROOT / "manifest.json"
OUT_DIR = ROOT / "out"
CHECKPOINT_DIR = ROOT / "checkpoints"

MODEL = "ACE-Step-v1-3.5B"


@dataclass
class Job:
    preset_id: str
    prompt: str
    lyrics: str
    seed: int
    duration: float
    steps: int
    guidance: float


def write_wav(uri, src, sample_rate: int = 48000, **_ignored) -> None:
    """torchaudio.save 대체. WAV만 쓴다 — ACE-Step이 그것밖에 안 쓴다."""
    import numpy as np
    import soundfile as sf

    data = src.detach().cpu().numpy() if hasattr(src, "detach") else np.asarray(src)
    data = np.squeeze(data)
    # torchaudio는 (채널, 샘플), soundfile은 (샘플, 채널) 순서다.
    # 채널은 많아야 2라서 첫 축이 짧으면 채널 축으로 본다.
    if data.ndim == 2 and data.shape[0] <= 8 and data.shape[0] < data.shape[1]:
        data = data.T
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    if peak > 1.0:
        print(f"      (피크 {peak:.2f} — [-1, 1]로 클립)")
        data = np.clip(data, -1.0, 1.0)
    # PCM_24: 정수 PCM이라 어디서나 읽히고, 채보 분석에는 넘치는 해상도다.
    sf.write(str(uri), data, int(sample_rate), subtype="PCM_24")


def install_wav_writer() -> str:
    """
    torchaudio 2.9부터 save()가 무조건 TorchCodec으로 넘어간다. TorchCodec은
    윈도우에서 FFmpeg 공유 라이브러리를 따로 요구해서 설치가 번거로운데,
    ACE-Step이 저장하는 건 WAV 하나뿐이라 soundfile로 직접 쓰면 그만이다.

    torchcodec이 이미 깔려 있으면 건드리지 않는다.
    """
    import torchaudio

    try:
        import torchcodec  # noqa: F401

        return "torchcodec"
    except ImportError:
        pass

    try:
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "WAV를 저장할 수 없다. soundfile 이 없고 torchcodec 도 없다.\n"
            "  .venv\\Scripts\\python.exe -m pip install soundfile"
        ) from exc

    torchaudio.save = write_wav
    return "soundfile"


def load_presets() -> tuple[dict, dict[str, dict]]:
    data = json.loads(PRESET_FILE.read_text(encoding="utf-8"))
    return data.get("defaults", {}), {p["id"]: p for p in data["presets"]}


def read_manifest() -> dict:
    if not MANIFEST_FILE.exists():
        return {"version": 1, "model": MODEL, "takes": []}
    return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))


def write_manifest(manifest: dict) -> None:
    MANIFEST_FILE.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ACE-Step으로 ENNEA용 인스트루멘털 트랙을 뽑는다.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("preset", nargs="?", help="프리셋 id (--list로 확인)")
    parser.add_argument("-n", "--count", type=int, default=4, help="프리셋당 개수 (기본 4)")
    parser.add_argument(
        "--seed", type=int, nargs="+", help="시드 지정. 주면 --count 대신 이 시드들로 뽑는다"
    )
    parser.add_argument("--duration", type=float, help="초 단위 길이 고정 (기본: 시드로 결정)")
    parser.add_argument("--steps", type=int, help="디퓨전 스텝. 낮추면 빠르고 거칠다")
    parser.add_argument("--guidance", type=float, help="guidance scale")
    parser.add_argument("--all", action="store_true", help="모든 프리셋을 돈다")
    parser.add_argument("--list", action="store_true", help="프리셋 목록만 출력")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="출력 폴더")
    parser.add_argument("--bf16", choices=["true", "false"], default="true")
    parser.add_argument("--cpu-offload", action="store_true", help="VRAM이 모자랄 때")
    parser.add_argument("--dry-run", action="store_true", help="계획만 보고 생성하지 않는다")
    args = parser.parse_args()

    defaults, presets = load_presets()

    if args.list:
        print(f"\n프리셋 {len(presets)}개\n")
        for preset in presets.values():
            print(f"  {preset['id']:<16} {preset.get('bpm', '?'):>4} BPM")
            print(f"  {'':<16} {preset['prompt']}\n")
        return 0

    if args.all:
        targets = list(presets.values())
    elif args.preset:
        if args.preset not in presets:
            print(f"'{args.preset}' 프리셋이 없다. --list로 확인한다.", file=sys.stderr)
            return 1
        targets = [presets[args.preset]]
    else:
        parser.error("프리셋 id를 주거나 --all / --list 를 쓴다")

    low, high = defaults.get("durationRange", [120, 140])
    steps = args.steps or defaults.get("inferStep", 60)
    guidance = args.guidance if args.guidance is not None else defaults.get("guidanceScale", 15.0)
    lyrics = defaults.get("lyrics", "[inst]")

    jobs: list[Job] = []
    for preset in targets:
        seeds = args.seed or [random.randrange(1, 2**31 - 1) for _ in range(args.count)]
        for seed in seeds:
            # 길이도 시드에서 뽑는다 — (프리셋, 시드) 한 쌍이면 트랙이 완전히 재현된다.
            duration = args.duration or float(round(random.Random(seed).uniform(low, high)))
            jobs.append(
                Job(
                    preset_id=preset["id"],
                    prompt=preset["prompt"],
                    lyrics=preset.get("lyrics", lyrics),
                    seed=seed,
                    duration=duration,
                    steps=steps,
                    guidance=guidance,
                )
            )

    total_audio = sum(job.duration for job in jobs)
    print(f"\n{len(jobs)}개 트랙, 오디오 합계 {total_audio / 60:.1f}분")
    print("RTF 30배 기준 대략 " + f"{total_audio / 30:.0f}초 예상 (4080)\n")

    if args.dry_run:
        for job in jobs:
            print(f"  {job.preset_id:<16} seed {job.seed:<12} {job.duration:.0f}s")
        return 0

    try:
        from acestep.pipeline_ace_step import ACEStepPipeline
    except ImportError:
        print(
            "acestep이 설치돼 있지 않다. setup.ps1을 먼저 돌리고 .venv를 활성화한다.",
            file=sys.stderr,
        )
        return 1

    writer = install_wav_writer()

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"모델 로딩 중 (WAV 저장: {writer}) — 첫 실행이면 체크포인트를 내려받느라 몇 분 걸린다.")
    pipeline = ACEStepPipeline(
        checkpoint_dir=str(CHECKPOINT_DIR),
        dtype="bfloat16" if args.bf16 == "true" else "float32",
        # 윈도우는 Triton이 없어 torch.compile이 자주 깨진다. 켜고 싶으면 직접 바꾼다.
        torch_compile=False,
        cpu_offload=args.cpu_offload,
    )

    manifest = read_manifest()
    for n, job in enumerate(jobs, 1):
        out_path = args.out / job.preset_id / f"{job.preset_id}-{job.seed}.wav"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"[{n}/{len(jobs)}] {job.preset_id} seed {job.seed} {job.duration:.0f}s")
        started = time.perf_counter()
        produced = pipeline(
            format="wav",
            audio_duration=job.duration,
            prompt=job.prompt,
            lyrics=job.lyrics,
            infer_step=job.steps,
            guidance_scale=job.guidance,
            manual_seeds=[job.seed],
            save_path=str(out_path),
            batch_size=1,
        )
        elapsed = time.perf_counter() - started

        # 버전에 따라 save_path를 디렉터리로 해석하기도 한다.
        if not out_path.exists() and isinstance(produced, (list, tuple)) and produced:
            out_path = Path(str(produced[0]))

        print(f"      -> {out_path.name}  {elapsed:.1f}초  (RTF {job.duration / elapsed:.1f}x)")

        manifest["takes"].append(
            {
                "file": str(out_path.relative_to(ROOT)).replace("\\", "/"),
                "preset": job.preset_id,
                "prompt": job.prompt,
                "lyrics": job.lyrics,
                "seed": job.seed,
                "durationSec": job.duration,
                "inferStep": job.steps,
                "guidanceScale": job.guidance,
                "model": MODEL,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "keep": None,
            }
        )
        # 트랙마다 저장한다. 중간에 끊겨도 뽑은 것까지는 기록이 남는다.
        write_manifest(manifest)

    print(f"\n완료. {args.out} 를 듣고 쓸 것만 manifest.json에서 keep: true로 표시한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
