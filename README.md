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

GitHub Pages 프로젝트 사이트로 배포할 때는 `BASE_PATH=/ennea/ npm run build`.

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

M0 스캐폴딩 + 곡 선택 화면까지.

- 1280×720 고정 스테이지 + 레터박스 셸
- 곡 선택 — 1024×1024 자켓 캐러셀(좌우 순환), 난이도 선택(easy/normal/hard), 기록 슬롯
- 설정 — 테마 전환 (감도·오디오 오프셋은 M1/M2에서 합류)
- 플레이 화면 — 3×3 그리드와 레인만 그린 빈 씬. 오디오·판정·노트는 M1

`static/songs.json`과 `static/songs/*/cover.svg`는 **플레이스홀더**다. 음원과 채보는 아직 없고,
파일 안에 `placeholder: true`로 표시돼 있다. 곡 선택 화면 하단에도 그대로 표시된다. M8에서 교체한다.
