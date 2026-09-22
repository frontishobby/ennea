/**
 * 플레이필드 좌표 (PLAN §3). 1280×720 논리 좌표계.
 *
 * 화면 가운데에 큰 정사각형 하나. **네 변이 곧 판정선이다.**
 *   왼쪽 변 = 좌클릭, 오른쪽 변 = 우클릭, 윗변 = 스크롤↑, 아랫변 = 스크롤↓
 * 이산 노트는 바깥에서 안쪽으로 밀려와 앞면이 변에 닿는 순간이 판정 시점이다.
 * 위치 무관 입력을 사각형 밖에서 처리하므로 "저기로 가야 하나" 혼동이 없다 (PLAN §3).
 *
 * 안쪽 3×3 은 **그리지 않는다.** 커서 노트가 뜰 때 그 자리만 보여주면 되고,
 * 격자를 상시로 그리면 노트를 가린다.
 */
import { CURVE } from '../design/curve.ts'
import type { Note } from '../chart.ts'

export const STAGE_W = 1280
export const STAGE_H = 720

export const SQUARE = 360
export const SQ_LEFT = (STAGE_W - SQUARE) / 2
export const SQ_TOP = (STAGE_H - SQUARE) / 2
export const SQ_RIGHT = SQ_LEFT + SQUARE
export const SQ_BOTTOM = SQ_TOP + SQUARE

export const radiusOf = (size: number) => size * CURVE
export const SQ_RADIUS = radiusOf(SQUARE)

/** 커서 노트가 앉는 3×3 구역. 사각형을 셋으로 나눈 것뿐이고 선은 그리지 않는다. */
export const CELL = SQUARE / 3

export interface Box {
  cx: number
  cy: number
  size: number
}

export const cellBox = (x: number, y: number): Box => ({
  cx: SQ_LEFT + (x + 0.5) * CELL,
  cy: SQ_TOP + (y + 0.5) * CELL,
  size: CELL,
})

export type LaneKey = 'clickL' | 'clickR' | 'scrollUp' | 'scrollDown'

export interface Lane {
  size: number
  /** 노트가 움직이는 축 */
  axis: 'x' | 'y'
  /** 판정 시각의 중심 좌표(진행 축). 이때 노트 앞면이 변에 닿는다. */
  hit: number
  /** 나타나는 중심 좌표(진행 축). 화면 밖. */
  spawn: number
  /** 진행 축과 직교하는 고정 좌표 */
  cross: number
  tone: 'click' | 'scroll'
}

const CLICK_NOTE = 44
const SCROLL_NOTE = 40

export const LANES: Record<LaneKey, Lane> = {
  clickL: { size: CLICK_NOTE, axis: 'x', hit: SQ_LEFT - CLICK_NOTE / 2, spawn: -CLICK_NOTE / 2, cross: STAGE_H / 2, tone: 'click' },
  clickR: { size: CLICK_NOTE, axis: 'x', hit: SQ_RIGHT + CLICK_NOTE / 2, spawn: STAGE_W + CLICK_NOTE / 2, cross: STAGE_H / 2, tone: 'click' },
  scrollUp: { size: SCROLL_NOTE, axis: 'y', hit: SQ_TOP - SCROLL_NOTE / 2, spawn: -SCROLL_NOTE / 2, cross: STAGE_W / 2, tone: 'scroll' },
  scrollDown: { size: SCROLL_NOTE, axis: 'y', hit: SQ_BOTTOM + SCROLL_NOTE / 2, spawn: STAGE_H + SCROLL_NOTE / 2, cross: STAGE_W / 2, tone: 'scroll' },
}

export const laneOf = (note: Note): LaneKey | null =>
  note.type === 'click' ? (note.btn === 'L' ? 'clickL' : 'clickR')
  : note.type === 'scroll' ? (note.dir === 'up' ? 'scrollUp' : 'scrollDown')
  : null

/** 판정 시각의 노트 자리. 잔상·번쩍임이 여기 뜬다. */
export function targetOf(note: Note): Box {
  if (note.type === 'cursor') return cellBox(note.x, note.y)
  const lane = LANES[laneOf(note)!]
  return lane.axis === 'x'
    ? { cx: lane.hit, cy: lane.cross, size: lane.size }
    : { cx: lane.cross, cy: lane.hit, size: lane.size }
}

/** 남은 시간에 따른 노트 중심. u = 1 이면 spawn, 0 이면 판정선. */
export function laneBox(lane: Lane, u: number): Box {
  const pos = lane.hit + (lane.spawn - lane.hit) * u
  return lane.axis === 'x'
    ? { cx: pos, cy: lane.cross, size: lane.size }
    : { cx: lane.cross, cy: pos, size: lane.size }
}

/** 커서가 그 구역 안에 있는가. 커서 노트는 타이밍이 아니라 위치로 판정한다. */
export function insideCell(x: number, y: number, cellX: number, cellY: number): boolean {
  const b = cellBox(cellX, cellY)
  return Math.abs(x - b.cx) <= b.size / 2 && Math.abs(y - b.cy) <= b.size / 2
}
