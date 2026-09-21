/**
 * 논리 해상도는 1280x720 고정 (PLAN §3).
 *
 * 스케일은 1배를 넘지 않는다. 화면이 더 커도 스테이지는 1280x720에서 멈추고
 * 남는 영역은 전부 레터박스/필러박스다. 업스케일을 허용하면 기기마다 3x3
 * 그리드의 물리적 크기가 달라진다 — 감도가 같아도 체감 난이도가 달라지고,
 * 스프라이트도 정수배가 아닌 배율에서 뭉개진다.
 *
 * 뷰포트가 1280x720보다 작을 때만 비율을 유지한 채 줄인다.
 */
export const STAGE_WIDTH = 1280
export const STAGE_HEIGHT = 720

export function stageScale(
  width: number = window.innerWidth,
  height: number = window.innerHeight,
): number {
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT, 1)
}
