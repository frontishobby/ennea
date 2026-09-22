/**
 * 플레이필드 좌표 (PLAN §3). 1280×720 논리 좌표계.
 *
 * 위치 무관 노트(클릭·스크롤)를 3×3 안에 그리면 "저기로 가야 하나?" 혼동이 생기므로
 * 그리드 밖 네 방향에 각자 과녁을 둔다. 모든 과녁은 같은 곡률의 정사각형이다.
 */
import { CURVE } from '../design/curve.ts'
import type { Note } from '../chart.ts'

export const CELL = 132
export const CELL_GAP = 12
export const GRID = CELL * 3 + CELL_GAP * 2
export const GRID_LEFT = (1280 - GRID) / 2
export const GRID_TOP = (720 - GRID) / 2

export const TARGET = 88

export interface Box {
  cx: number
  cy: number
  size: number
}

export const cellBox = (x: number, y: number): Box => ({
  cx: GRID_LEFT + x * (CELL + CELL_GAP) + CELL / 2,
  cy: GRID_TOP + y * (CELL + CELL_GAP) + CELL / 2,
  size: CELL,
})

export const LANE: Record<'clickL' | 'clickR' | 'scrollUp' | 'scrollDown', Box> = {
  clickL: { cx: 330, cy: 360, size: TARGET },
  clickR: { cx: 950, cy: 360, size: TARGET },
  scrollUp: { cx: 640, cy: 76, size: TARGET },
  scrollDown: { cx: 640, cy: 644, size: TARGET },
}

/** 노트가 향하는 과녁. */
export function targetOf(note: Note): Box {
  switch (note.type) {
    case 'cursor':
      return cellBox(note.x, note.y)
    case 'click':
      return note.btn === 'L' ? LANE.clickL : LANE.clickR
    case 'scroll':
      return note.dir === 'up' ? LANE.scrollUp : LANE.scrollDown
  }
}

export const radiusOf = (size: number) => size * CURVE

/** 커서가 그 칸 안에 있는가. 커서 노트는 타이밍이 아니라 위치로 판정한다. */
export function insideCell(x: number, y: number, cellX: number, cellY: number): boolean {
  const b = cellBox(cellX, cellY)
  return Math.abs(x - b.cx) <= b.size / 2 && Math.abs(y - b.cy) <= b.size / 2
}
