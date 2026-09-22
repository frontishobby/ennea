/**
 * 플레이필드 좌표 (PLAN §3). 1280×720 논리 좌표계.
 *
 * 화면 가운데에 큰 정사각형 하나. **좌우 변이 클릭 판정선이다.**
 * 클릭 노트는 바깥에서 안쪽으로 밀려와 앞면이 변에 닿는 순간이 판정 시점이다.
 *
 * 스크롤은 쓰지 않는다. 커서 노트 판정 ±50ms 안에 스크롤을 두면 휠을 굴릴 때 마우스가
 * 흔들려 커서를 놓치는데(PLAN §7⑥), osu 에서 들여온 채보는 커서가 빽빽해서 안전한 틈이
 * 없다. 포맷에는 타입이 남아 있으니 나중에 스피너·브레이크 구간용으로 되살릴 수 있다.
 *
 * 안쪽 3×3 격자는 그리지 않는다. 커서 노트는 3×3 이 아니라 **연속 좌표**다.
 */
import { CURVE } from '../design/curve.ts'
import { FIELD_H, FIELD_W, type Note } from '../chart.ts'

export const STAGE_W = 1280
export const STAGE_H = 720

export const SQUARE = 560
export const SQ_LEFT = (STAGE_W - SQUARE) / 2
export const SQ_TOP = (STAGE_H - SQUARE) / 2
export const SQ_RIGHT = SQ_LEFT + SQUARE
export const SQ_BOTTOM = SQ_TOP + SQUARE

export const radiusOf = (size: number) => size * CURVE
export const SQ_RADIUS = radiusOf(SQUARE)

/**
 * 필드(4:3)를 정사각형 안에 **균등 배율**로 넣는다. 비균등으로 늘리면 가로 점프가
 * 짧아져서 수입해온 에임 패턴이 망가진다. 가로를 꽉 채우고 위아래가 조금 빈다.
 */
export const FIELD_SCALE = SQUARE / FIELD_W
export const FIELD_PX_W = FIELD_W * FIELD_SCALE
export const FIELD_PX_H = FIELD_H * FIELD_SCALE
export const FIELD_X = SQ_LEFT
export const FIELD_Y = SQ_TOP + (SQUARE - FIELD_PX_H) / 2

export interface Point {
  x: number
  y: number
}

/** 채보의 필드 좌표 → 화면 논리 좌표 */
export const fieldToStage = (x: number, y: number): Point => ({
  x: FIELD_X + x * FIELD_SCALE,
  y: FIELD_Y + y * FIELD_SCALE,
})

/**
 * 커서 판정 반경. **필드 단위**로 정의한다 — 화면 px 로 박아두면 정사각형 크기를 바꿀
 * 때마다 난이도가 같이 바뀐다.
 *
 * osu! CS4 서클이 필드 단위로 약 71 이라 그보다 넉넉하다 — osu 는 **내가 클릭하는 순간**을
 * 고르지만 여기는 시각이 정해져 있어 더 가혹하기 때문이다.
 */
export const HIT_RADIUS_FIELD = 91
export const HIT_RADIUS = HIT_RADIUS_FIELD * FIELD_SCALE

/** 커서 자체의 반지름(화면 px). 게임 세계는 전부 둥근 정사각형이고 플레이어만 원이다. */
export const CURSOR_RADIUS = 15

export type LaneKey = 'clickL' | 'clickR'

export interface Lane {
  size: number
  /** 판정 시각의 중심 x. 이때 노트 앞면이 변에 닿는다. */
  hit: number
  /** 나타나는 중심 x. 화면 밖. */
  spawn: number
  cross: number
}

const CLICK_NOTE = 44

export const LANES: Record<LaneKey, Lane> = {
  clickL: { size: CLICK_NOTE, hit: SQ_LEFT - CLICK_NOTE / 2, spawn: -CLICK_NOTE / 2, cross: STAGE_H / 2 },
  clickR: { size: CLICK_NOTE, hit: SQ_RIGHT + CLICK_NOTE / 2, spawn: STAGE_W + CLICK_NOTE / 2, cross: STAGE_H / 2 },
}

export const laneOf = (note: Note): LaneKey | null =>
  note.type === 'click' ? (note.btn === 'L' ? 'clickL' : 'clickR') : null

export interface Box extends Point {
  size: number
}

/** 판정 시각의 노트 자리(화면 좌표). 잔상·번쩍임이 여기 뜬다. */
export function targetOf(note: Note): Box {
  if (note.type === 'cursor') {
    const p = fieldToStage(note.x, note.y)
    return { x: p.x, y: p.y, size: HIT_RADIUS * 2 }
  }
  const lane = LANES[laneOf(note) ?? 'clickL']
  return { x: lane.hit, y: lane.cross, size: lane.size }
}

/** 남은 시간에 따른 클릭 노트 중심. u = 1 이면 spawn, 0 이면 판정선. */
export function laneBox(lane: Lane, u: number): Box {
  return { x: lane.hit + (lane.spawn - lane.hit) * u, y: lane.cross, size: lane.size }
}

/** 커서가 그 점에 닿았는가. 화면 좌표끼리 잰다. */
export function withinHit(cursor: Point, note: CursorLike): boolean {
  const p = fieldToStage(note.x, note.y)
  const dx = cursor.x - p.x
  const dy = cursor.y - p.y
  return dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS
}

interface CursorLike {
  x: number
  y: number
}
