# ENNEA — 작업 규칙

## 계정 (엄수)

이 저장소는 **frontishobby 계정 전용**이다. `david02324`를 절대 쓰지 않는다.

로컬 git identity가 이미 고정되어 있다:

```
user.name  = frontishobby
user.email = 92085928+frontishobby@users.noreply.github.com
```

전역 설정(개인 계정)이 새지 않는지 커밋 전에 확인한다.
푸시는 `gh auth switch --user frontishobby` 후에 한다.

## 커밋

**AI author / Co-Authored-By 트레일러를 넣지 않는다.** `Generated with Claude Code` 류도 금지.

## 고정 제약

- **논리 해상도 1280×720 고정.** 모든 게임 좌표·속도·판정 거리는 이 좌표계에서만 계산한다. 뷰포트에는 비율 유지 스케일 + 레터박스
- **Svelte + TypeScript.** UI 셸은 Svelte, 게임 캔버스는 PixiJS
- **백엔드 없음.** 인증·DB·서버 로직을 추가하지 않는다. 필요해지면 PLAN.md §14 순서를 따른다
- **PWA 필수** — Service Worker로 곡·채보를 영구 캐시한다 (GitHub Pages는 Cache-Control 제어 불가)

## 절대 깨면 안 되는 것

- **판정은 `AudioContext.currentTime` 기준, 렌더는 rAF.** 둘을 섞지 않는다
- **입력 타임스탬프는 이벤트의 `event.timeStamp`를 그대로 쓴다.** rAF에서 읽으면 최대 16ms 오차
- **채보 노트의 `t`는 정수 ms.** 부동소수점을 넣으면 chartHash가 흔들린다
- **기록·리플레이는 `chartHash` 단위로 매단다.** `songId` 단위로 쌓으면 생성기 개선 시 과거 기록이 오염된다
- **채보는 오프라인 생성.** 런타임 생성은 부동소수점 차이로 1v1 공정성을 깬다

자세한 근거는 PLAN.md.
