# ENNEA

마우스 기반 리듬게임. 3×3 그리드로 날아오는 노트를 커서로 받고, 클릭과 스크롤로 별도 레인을 처리한다.

- 서버 없음 — GitHub Pages 정적 호스팅
- 1v1 대전은 P2P(WebRTC)
- 채보는 음원에서 오프라인으로 자동 생성
- PWA — 오프라인 플레이 지원

이름은 그리스어 9 (3×3 그리드).

설계와 구현 계획은 [PLAN.md](PLAN.md).

## 스택

Svelte 5 · TypeScript · Vite · PixiJS · Web Audio API · Trystero

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # svelte-check
npm run build
npm run gen:covers   # 플레이스홀더 자켓 재생성
```

## 배포

`main`에 푸시하면 GitHub Actions가 빌드해서 **https://ennea.duckdns.org** 에 올린다.
`npm run check`가 먼저 돌기 때문에 타입이 깨진 채로는 배포되지 않는다.

커스텀 도메인이라 사이트가 루트에서 서빙되고, 따라서 `base`는 `/`다.
`<user>.github.io/ennea/` 형태로 서빙할 일이 생기면 그때만 `BASE_PATH=/ennea/ npm run build`.

도메인은 `static/CNAME`으로도 고정해 둔다 — 저장소 설정만 믿으면 재배포 때 풀리는 경우가 있다.

## 디자인 규칙

**모든 도형은 곡률이 같은 정사각형이다.** 반지름 = 짧은 변 × 0.22.
위계는 크기로만 만들고 반지름으로는 만들지 않는다.

- CSS: `--curve: 22%` (정사각형), 정사각형이 아니면 높이에 맞는 px 스텝
- PixiJS: `radiusFor(size)` — `src/lib/design/curve.ts`. 두 값은 항상 같아야 한다
- 폰트: **Rubik**. 기하학적 골격에 모서리만 일정하게 둥근 서체라 이 규칙과 같은 말을 한다. `@fontsource-variable`로 자체 호스팅 (오프라인 PWA)
- 색: 테마로 분리. `paper`(기본, 흰색/회색) · `graphite`(중성 다크) · `ultraviolet`(딥 바이올렛).
  모든 테마가 같은 토큰 이름을 쓰고, 그중 셋은 노트 타입(커서/클릭/스크롤) 색이다 — 메뉴와 플레이필드가 같은 색 언어를 쓴다
- UI 언어는 영어

## 현재 상태

M0 스캐폴딩 · M1 타이밍 코어 · M3 채보 생성기까지. 실제 곡 한 곡으로 플레이된다.

- 1280×720 고정 스테이지 + 레터박스 셸 (1배를 넘겨 확대하지 않는다)
- 곡 선택 — 1024×1024 자켓 캐러셀(좌우 순환), 난이도 easy/normal/hard, 미리듣기
- 설정 — 테마 전환 (감도는 M2, 캘리브레이션 화면은 아직)
- **플레이 — 판정이 돈다.** AudioClock 기준 판정, rAF 렌더, 이벤트 timeStamp 입력
- 채보 생성기 — 음원 WAV 하나에서 난이도 셋. `tools/chartgen/README.md`
- 곡 생성기 — ACE-Step 로컬 실행 (윈도우+NVIDIA). `tools/songgen/README.md`

`static/songs/prism/` 이 실제 곡이고, 나머지 여덟은 `placeholder: true` 로 표시된 자리표시자다
(곡 선택 레이아웃용). M8 에서 채운다.

### 검증

```bash
npm run game:test          # 판정 — 완벽한 입력이면 전부 PERFECT 인가
npm run chart:selftest     # 채보 생성기 — 합성 신호(정박/드리프트/셋잇단)
npm run check              # svelte-check + tsc
node tools/probe.mjs http://localhost:5173/ /tmp/shots Enter   # 스크린샷 + 콘솔 오류
```

`?autoplay=1` 을 붙이면 노트 시각에 맞춰 입력이 자동으로 들어간다. 실제 입력과 같은 경로라
**정확도가 100% 가 아니면 시계가 틀린 것이다** — 브라우저에서 AudioClock 을 검증하는 방법이고,
나중에 레퍼런스 고스트에도 쓴다.
