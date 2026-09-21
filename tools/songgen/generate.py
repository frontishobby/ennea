"""
ENNEA 곡 생성 — ACE-Step 배치 러너.

프롬프트와 시드를 manifest.json에 남긴다. 같은 시드로 같은 트랙이 다시 나오므로
"이 곡 드럼만 더 선명하게 다시" 같은 작업이 가능하다. 채보를 chartHash로 재현하는
것과 같은 규칙을 음원에도 건다.

  python generate.py --list                        프리셋 목록
  python generate.py hard-dance -n 8               8개 뽑기
  python generate.py --all -n 3                    전 프리셋 3개씩
  python generate.py hard-dance --seed 42          특정 시드 재현 (바이트까지 동일)

  python generate.py --like 1451544524 -n 6        그 트랙과 비슷한 것 6개 (retake)
  python generate.py --like 1451544524 --variance 0.4
  python generate.py --like 1451544524 --repaint 64-96   그 구간만 다시

--seed 와 --like 는 다른 물건이다.
  --seed  는 복사다. 같은 시드 + 같은 파라미터 = 같은 파일. 재현용이지 변형이 아니다.
  --like  는 retake 다. 원본 시드의 노이즈에 두 번째 시드를 variance 만큼 섞는다.
          얼마나 다를지를 숫자로 조절한다. 프롬프트·길이는 manifest 에서 그대로 가져온다.
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
    task: str = "text2music"
    retake_seed: int | None = None
    variance: float = 0.5
    src_audio: str | None = None
    repaint: tuple[float, float] | None = None

    @property
    def stem(self) -> str:
        """파일명에 혈통을 남긴다 — 무엇의 변형인지 나중에 알아야 한다."""
        if self.task == "repaint" and self.repaint:
            a, b = self.repaint
            return f"{self.preset_id}-{self.seed}-p{a:g}_{b:g}-{self.retake_seed}"
        if self.task == "retake":
            return f"{self.preset_id}-{self.seed}-r{self.retake_seed}"
        return f"{self.preset_id}-{self.seed}"

    @property
    def label(self) -> str:
        if self.task == "repaint" and self.repaint:
            return f"repaint {self.repaint[0]:g}-{self.repaint[1]:g}s of {self.seed} (variance {self.variance})"
        if self.task == "retake":
            return f"retake of {self.seed} (variance {self.variance})"
        return f"seed {self.seed}"


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


def find_take(manifest: dict, seed: int, preset: str | None) -> dict | None:
    """시드로 원본 테이크를 찾는다. 같은 시드가 여럿이면 마지막 것."""
    hits = [
        t
        for t in manifest.get("takes", [])
        if t.get("seed") == seed and (preset is None or t.get("preset") == preset)
    ]
    return hits[-1] if hits else None


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
    parser.add_argument(
        "--like",
        type=int,
        metavar="SEED",
        help="그 시드의 트랙과 비슷한 것을 뽑는다 (retake). 프롬프트·길이는 manifest 에서 가져온다",
    )
    parser.add_argument(
        "--variance",
        type=float,
        default=0.2,
        help="--like 와 함께. 0.1 같은 곡 다른 테이크 / 0.3 다른 편곡 / 0.5 같은 분위기 다른 곡 (기본 0.2)",
    )
    parser.add_argument(
        "--repaint",
        metavar="시작-끝",
        help="--like 와 함께. 그 구간(초)만 다시 뽑는다. 원본 WAV 가 필요하다. 예: --repaint 64-96",
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

    manifest = read_manifest()

    # ── retake / repaint ──────────────────────────────────────────
    if args.like is not None:
        base = find_take(manifest, args.like, args.preset)
        if not base:
            print(f"manifest.json 에 시드 {args.like} 가 없다. 그 트랙을 이 폴더에서 뽑았는지 확인한다.", file=sys.stderr)
            return 1

        span: tuple[float, float] | None = None
        task = "retake"
        src: str | None = None
        if args.repaint:
            try:
                a, b = (float(x) for x in args.repaint.split("-", 1))
            except ValueError:
                print("--repaint 는 '시작-끝' 형식이다. 예: --repaint 64-96", file=sys.stderr)
                return 1
            if not 0 <= a < b <= base["durationSec"]:
                print(f"--repaint 구간이 트랙 길이(0~{base['durationSec']:g}s) 밖이다.", file=sys.stderr)
                return 1
            span = (a, b)
            task = "repaint"
            src = str((ROOT / base["file"]).resolve())
            if not Path(src).exists():
                print(f"원본 WAV 가 없다: {src}\nrepaint 는 원본이 필요하다. retake 는 시드만으로 된다.", file=sys.stderr)
                return 1

        retakes = args.seed or [random.randrange(1, 2**31 - 1) for _ in range(args.count)]
        jobs = [
            Job(
                preset_id=base["preset"],
                prompt=base["prompt"],
                lyrics=base["lyrics"],
                seed=base["seed"],
                duration=float(base["durationSec"]),
                steps=args.steps or int(base["inferStep"]),
                guidance=args.guidance if args.guidance is not None else float(base["guidanceScale"]),
                task=task,
                retake_seed=rs,
                variance=args.variance,
                src_audio=src,
                repaint=span,
            )
            for rs in retakes
        ]
        return run(jobs, manifest, args)

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

    return run(jobs, manifest, args)


def run(jobs: list[Job], manifest: dict, args: argparse.Namespace) -> int:
    total_audio = sum(job.duration for job in jobs)
    print(f"\n{len(jobs)}개 트랙, 오디오 합계 {total_audio / 60:.1f}분")
    print("RTF 30배 기준 대략 " + f"{total_audio / 30:.0f}초 예상 (4080)\n")

    if args.dry_run:
        for job in jobs:
            print(f"  {job.preset_id:<16} {job.label:<44} {job.duration:.0f}s  -> {job.stem}.wav")
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

    for n, job in enumerate(jobs, 1):
        out_path = args.out / job.preset_id / f"{job.stem}.wav"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"[{n}/{len(jobs)}] {job.preset_id} {job.label} {job.duration:.0f}s")
        call: dict = {
            "format": "wav",
            "audio_duration": job.duration,
            "prompt": job.prompt,
            "lyrics": job.lyrics,
            "infer_step": job.steps,
            "guidance_scale": job.guidance,
            "manual_seeds": [job.seed],
            "save_path": str(out_path),
            "batch_size": 1,
            "task": job.task,
        }
        if job.retake_seed is not None:
            # 원본 시드의 노이즈에 이 시드의 노이즈를 variance 만큼 섞는다.
            call["retake_seeds"] = [job.retake_seed]
            call["retake_variance"] = job.variance
        if job.src_audio:
            call["src_audio_path"] = job.src_audio
        if job.repaint:
            call["repaint_start"], call["repaint_end"] = job.repaint

        started = time.perf_counter()
        produced = pipeline(**call)
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
                "task": job.task,
                **(
                    {"retakeSeed": job.retake_seed, "variance": job.variance}
                    if job.retake_seed is not None
                    else {}
                ),
                **({"repaint": list(job.repaint)} if job.repaint else {}),
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
