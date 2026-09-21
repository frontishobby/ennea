# songgen — ACE-Step 곡 생성

ENNEA용 인스트루멘털 트랙을 로컬 GPU에서 뽑는다. 윈도우 + NVIDIA 기준.

**목표 길이 2:00~2:20**, 보컬 없음, 드럼이 또렷한 EDM.
보컬이 중역대(250Hz~2kHz)를 채우면 커서 노트로 쓸 스네어 온셋이 지저분해진다 (PLAN §6).

## 왜 ACE-Step인가

- Apache 2.0 오픈웨이트 — 쿼터도, ToS 변경 리스크도 없다
- **WAV 원본을 직접 뽑는다** — 채보는 무손실로 생성해야 한다 (PLAN §5)
- 디퓨전 방식이라 빠르다. 4080에서 2분 트랙이 10초 안쪽
- 프롬프트와 시드가 곡을 재현한다 — `manifest.json`에 다 남긴다

학습 데이터 출처는 모델 카드에 공개돼 있지 않다. Apache 2.0은 *모델*에 대한 라이선스지
학습 데이터 문제를 면제해주지 않는다. 무료 게임이라 실질 리스크는 낮다고 보지만 알고 쓴다.

## 요구사항

- Windows 10/11, NVIDIA GPU (4080 = VRAM 16GB, 넉넉하다. 최소 8GB)
- **Python 3.10 또는 3.11** — 3.13+는 설치가 깨질 수 있다
- git, 최신 NVIDIA 드라이버
- 디스크 30GB 정도 (체크포인트 + PyTorch + 출력 WAV)

## 세팅

**PowerShell 창을 먼저 열고** 그 안에서 돌린다. 탐색기에서 더블클릭하면
끝나는 순간 창이 닫혀서 결과를 못 읽는다.

```powershell
cd tools\songgen
powershell -ExecutionPolicy Bypass -File setup.ps1
```

`.venv` 생성 → PyTorch(cu126) → ACE-Step → 환경 점검까지 한 번에 간다.
끝에 Enter 대기로 멈춘다 (`-NoPause` 로 끌 수 있다).

성공하면 마지막에 이렇게 나온다:

```
확인
  python   3.11.9
  torch    2.x.x+cu126
  acestep  설치됨
  gpu      NVIDIA GeForce RTX 4080
  vram     16.0 GB

세팅 완료. 다음:
```

**"세팅 완료"가 안 보이면 끝난 게 아니다.** 환경 점검은 따로 돌려볼 수 있다:

```powershell
.\.venv\Scripts\python.exe check_env.py
```

`torch`/`acestep`/`cuda` 상태와 오류 원인이 JSON으로 나온다.

### `.ps1` 파일은 UTF-8 **BOM**으로 저장한다

Windows PowerShell 5.1(`powershell.exe`)은 **BOM 없는 UTF-8 파일을 현재 코드페이지(한국어는 cp949)로
읽는다.** 그래서 BOM이 없으면 스크립트는 정상 동작하는데 한글만 전부 깨진다 —
`세팅` 이 `꽭똿` 처럼 나온다.

편집기가 BOM을 떼지 않게 확인한다 (VS Code 우하단 인코딩 → `UTF-8 with BOM`).
PowerShell 7(`pwsh`)은 BOM이 없어도 UTF-8로 읽으므로 이 문제가 없다.

한글 문자열은 PowerShell 안에서만 쓴다. `python -c` 인자로 넘기면 코드페이지 변환을
한 번 더 타서 또 깨질 수 있다 — 환경 점검은 `check_env.py`가 ASCII JSON만 뱉고
메시지는 PowerShell이 찍는다.

### `$ErrorActionPreference` 를 `Stop` 으로 두지 않는다

Windows PowerShell 5.1은 **네이티브 명령이 stderr 에 한 줄만 써도 그걸 종료 오류로
올린다.** pip 도 torch 임포트도 경고를 stderr 로 뱉기 때문에, `Stop` 이면 아무 메시지
없이 스크립트가 죽는다. 두 스크립트 모두 `Continue` 로 두고 `$LASTEXITCODE` 를 매번
직접 본다. (`$PSNativeCommandUseErrorActionPreference` 는 PS 7.3+ 전용이라 5.1에선
아무 효과가 없다.)

## 사용

```powershell
.\run.ps1 --list                      # 프리셋 8개 확인
.\run.ps1 hard-dance -n 8             # 8개 뽑기
.\run.ps1 --all -n 3                  # 전 프리셋 3개씩 (24개)
.\run.ps1 hard-dance --seed 12345     # 특정 시드 재현
.\run.ps1 --all -n 2 --dry-run        # 계획만 확인
```

**첫 실행은 체크포인트를 내려받느라 몇 분 걸린다.** `checkpoints/`에 들어가고 그 뒤로는 안 받는다.

결과는 `out/<프리셋>/<프리셋>-<시드>.wav`.

### 옵션

| 플래그 | 용도 |
|---|---|
| `-n, --count` | 프리셋당 개수 (기본 4) |
| `--seed A B C` | 시드 지정. 재현할 때 쓴다 |
| `--duration 130` | 길이 고정. 기본은 시드로 120~140초 중 결정 |
| `--steps 40` | 디퓨전 스텝. 낮추면 빠르고 거칠다 (기본 60) |
| `--guidance 12` | 프롬프트를 얼마나 세게 따를지 (기본 15) |
| `--cpu-offload` | VRAM 부족할 때. 4080이면 필요 없다 |

## 비슷한 것 더 뽑기 — `--like`

`--seed` 와 `--like` 는 다른 물건이다.

- **`--seed 1451544524`** 는 복사다. 같은 시드 + 같은 파라미터 = 바이트까지 같은 파일. 재현용
- **`--like 1451544524`** 는 retake 다. 원본 시드의 노이즈에 두 번째 시드를 `--variance` 만큼 섞는다.
  **얼마나 다를지를 숫자로 조절한다.** 프롬프트·길이·스텝은 `manifest.json` 에서 그대로 가져오므로
  앵커가 정확하다. 원본 WAV 는 필요 없다

```powershell
.\run.ps1 --like 1451544524 -n 6                  # variance 0.2 (기본): 같은 곡의 다른 테이크
.\run.ps1 --like 1451544524 -n 4 --variance 0.4   # 같은 곡의 다른 편곡
.\run.ps1 --like 1451544524 --repaint 64-96       # 64~96초 구간만 다시 (원본 WAV 필요)
.\run.ps1 --like 1451544524 --steps 120           # 같은 앵커, 더 정교하게
```

| variance | 결과 |
|---|---|
| 0.1 | 같은 곡, 신스 레이어만 조금 다름 |
| 0.2~0.3 | 같은 곡의 다른 편곡 |
| 0.5 | 같은 분위기의 다른 곡 |
| 0.8 | 사실상 남 |

파일명에 혈통이 남는다: `future-core-1451544524-r794978651.wav`, repaint 는 `-p64_96-<seed>`.
`manifest.json` 에도 `task`, `retakeSeed`, `variance`, `repaint` 가 기록된다.

### 채보용으로 "더 좋게"

**듣기 좋은 것과 채보가 나오는 것은 다른 질문이다.** 채보 생성기를 먼저 돌려 대역 적합도를 본다:

```powershell
npm run chart -- tools\songgen\out\future-core\future-core-1451544524.wav --slug test --no-register --preview
```

```
  ✗ low   1187개   32% / 39%  → scroll 노트 생략  그리드에 안 붙는다
  ✓ mid    656개   65% / 39%  → cursor 노트 생성
  ✓ high   440개   71% / 39%  → click 노트 생성
```

low ✗ 는 **킥이 없다**는 뜻이다. 프롬프트에 "four on the floor kick" 을 써도 모델이 베이스 벽을 만들 수 있다.
그럴 땐 음악 쪽을 고친다 — `--like` 로 형제를 뽑되 프롬프트를 손봐서 (`punchy kick drum on every beat,
tight sub bass, minimal bass sustain`) 저역이 성기고 때리는 소리가 되게 한다. 그리고 다시 적합도를 본다.
BPM 도 프롬프트를 안 지킨다 (160 → 실제 145.8). `songs.json` 의 bpm 은 생성기가 실측으로 채운다.

## WAV 저장 경로

torchaudio 2.9부터 `save()`가 무조건 TorchCodec으로 넘어간다. TorchCodec은 윈도우에서
FFmpeg 공유 라이브러리를 따로 요구해서, 안 깔려 있으면 생성은 다 끝내놓고 **저장에서만**
터진다:

```
ImportError: TorchCodec is required for save_with_torchcodec.
```

`generate.py`가 `torchaudio.save`를 soundfile 직접 쓰기로 갈아끼워서 우회한다
(`write_wav`). ACE-Step이 저장하는 건 WAV 하나뿐이라 이걸로 충분하다.
`torchcodec`이 이미 깔려 있으면 건드리지 않는다.

출력은 48kHz PCM_24다. 정수 PCM이라 어디서나 읽히고, 온셋 검출에는 넘치는 해상도다.
피크가 1.0을 넘으면 클립하고 그 사실을 찍는다.

## 작업 흐름

ACE-Step은 **시드에 극도로 민감하고 결과가 들쭉날쭉하다** — 모델 카드가 직접 인정한다.
한 방을 기대하지 말고 많이 뽑아서 고른다.

1. `.\run.ps1 --all -n 4` 로 32개 뽑는다 (4080에서 10분 남짓)
2. `out/` 을 전부 듣고 쓸 만한 걸 고른다
3. `manifest.json`에서 그 트랙의 `keep`을 `true`로 바꾼다
4. 채보 생성은 **WAV 원본으로** 돌린다 (M3)
5. 배포용 Opus는 따로 뽑는다 (PLAN §5):

```powershell
ffmpeg -i out\hard-dance\hard-dance-12345.wav -c:a libopus -b:a 128k -vbr on -application audio -ac 2 audio.webm
```

분석 소스(WAV)와 배포 소스(Opus)를 분리하는 게 핵심이다.

## manifest.json

트랙마다 프롬프트·시드·길이·스텝·guidance를 남긴다. 커밋한다.

```json
{
  "file": "out/hard-dance/hard-dance-12345.wav",
  "preset": "hard-dance",
  "prompt": "hard dance, electronic, 150 BPM, punchy kick, ...",
  "seed": 12345,
  "durationSec": 131,
  "keep": null
}
```

길이도 시드에서 뽑으므로 **(프리셋, 시드) 한 쌍이면 트랙이 완전히 재현된다.**
채보를 `chartHash`로 재현하는 것과 같은 규칙을 음원에도 건 것이다.

## 프리셋 추가

`presets.json`에 항목을 넣는다. 프롬프트는 콤마로 나눈 태그 나열이고 BPM을 안에 적는다.

```json
{
  "id": "breakcore",
  "bpm": 180,
  "prompt": "breakcore, 180 BPM, chopped amen break, sharp snare rolls, distorted kick, instrumental"
}
```

**퍼커션을 반드시 명시한다** — 온셋 검출이 먹고 사는 게 그거다.
킥/스네어/하이햇이 또렷하다고 유도할수록 채보 품질이 올라간다.
드럼이 흐린 장르(어쿠스틱, 재즈, 발라드, 앰비언트)는 애초에 채보가 안 나온다.

## 커밋하지 않는 것

`.venv/`, `checkpoints/`, `out/` 은 무시된다. 저장소 루트 `.gitignore`에도 `*.wav`가 있다.

**음원 바이너리를 저장소에 자주 갈아끼우면 git 히스토리에 영구히 쌓여 clone이 무거워진다**
(PLAN §12). 채택한 곡의 Opus만 `static/songs/`에 한 번 넣거나, 아예 별도 저장소로 뺀다.
`AUDIO_BASE_URL` 한 줄이라 나중에 옮기는 건 싸다 — 히스토리에서 빼는 게 비싸다.
