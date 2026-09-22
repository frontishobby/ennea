/**
 * 플레이필드 렌더 (PixiJS).
 *
 * 큰 정사각형 하나가 전부다. 네 변이 판정선이고, 이산 노트는 바깥에서 밀려와
 * **앞면이 변에 닿는 순간**이 판정 시점이다 — 선과 선이 만나는 순간이라 눈으로 읽기 쉽다.
 * 커서 노트만 사각형 안에서 줄어들며 내려앉는다.
 *
 * 여기서는 시간을 **인자로만** 받는다. 렌더가 시계를 읽으면 rAF 지터가 판정에 섞인다.
 */
import { Application, Container, Graphics } from 'pixi.js'
import { tokenColor } from '../design/theme.ts'
import type { Grade } from './judge.ts'
import {
  CURSOR_RADIUS,
  FIELD_CENTER,
  fieldToStage,
  HIT_RADIUS,
  laneBox,
  laneOf,
  LANES,
  radiusOf,
  SQ_BOTTOM,
  SQ_LEFT,
  SQ_RADIUS,
  SQ_RIGHT,
  SQ_TOP,
  SQUARE,
  STAGE_H,
  STAGE_W,
  targetOf,
} from './layout.ts'
import type { NoteState } from './session.ts'

/**
 * 이산 노트는 **일정한 리드 타임**으로 온다. 변까지의 거리가 달라서(좌우 460px,
 * 위아래 180px) 속도는 달라지지만, 반응 시간이 같은 쪽이 플레이에 중요하다.
 */
const LANE_LEAD_MS = 900
/**
 * 커서는 구역이 서로 붙어 있고(120px 간격) 밀도가 높아서(초당 3~4개) 길고 크게 잡으면
 * 사각형들이 서로 덮는다. 애초에 **연속 입력**이라 매 노트에 반응하는 게 아니라 궤적을
 * 따라가는 것이므로 짧고 작아도 된다.
 */
const CURSOR_LEAD_MS = 800
/**
 * 원근. 커서 노트는 필드 한가운데를 소실점 삼아 **멀리서 날아온다** — 처음에는 중앙 근처에
 * 작게 떠 있다가 자기 자리로 퍼지며 커진다.
 *
 * 화면에 비친 크기 비율은 s(u) = DEPTH_MIN / (DEPTH_MIN + u(1 − DEPTH_MIN)) 이고,
 * u 는 남은 시간 비율이다. s(1) = DEPTH_MIN, s(0) = 1 — 판정 순간에 제자리·제크기가 된다.
 * 이건 z 가 시간에 선형일 때의 진짜 원근 식이라 뒤로 갈수록 빨라지는 가속이 공짜로 붙는다.
 */
const DEPTH_MIN = 0.16
/**
 * 도착 자리 윤곽의 최소/최대 진하기. 날아온 노트가 여기 내려앉는 순간이 판정 시점이다.
 * 처음부터 충분히 보여야 한다 — 조준 게임에서 "어디로 갈지"는 미리 알아야 하는 정보고,
 * 날아오는 노트는 "언제"만 알려준다.
 */
const LANDING_ALPHA = { min: 0.2, max: 0.55 }
/** 판정 지점을 채우기 시작하는 시점(ms). 정확한 순간을 윤곽만으로는 읽기 어렵다. */
const CURSOR_FILL_MS = 180
/** 판정 후 잔상이 남는 시간(ms). */
const AFTERGLOW_MS = 180

export const APPROACH_MS = Math.max(LANE_LEAD_MS, CURSOR_LEAD_MS)

export interface Palette {
  cursor: number
  click: number
  scroll: number
  line: number
  bone: number
  field: number
}

export const readPalette = (): Palette => ({
  cursor: tokenColor('--cursor', 0xffc24a),
  click: tokenColor('--click', 0xff5f8d),
  scroll: tokenColor('--scroll', 0x4ce0c4),
  line: tokenColor('--line', 0x3b2a82),
  bone: tokenColor('--bone', 0xefe9ff),
  field: tokenColor('--ink-800', 0x1d1443),
})

export class Playfield {
  readonly app: Application
  #palette: Palette
  /** 사각형 안에서 벌어지는 것 — 커서 노트와 그 채움. 경계로 잘린다. */
  #inside = new Container()
  #cursorNotes = new Graphics()
  #fills = new Graphics()
  /** 사각형 밖에서 밀려오는 이산 노트. 자르지 않는다. */
  #laneNotes = new Graphics()
  #cursor = new Graphics()
  #flash = new Graphics()
  /** 판정 잔상: 자리 → 남은 시간·등급 */
  #glow = new Map<string, { until: number; grade: Grade; color: number }>()

  private constructor(app: Application, palette: Palette) {
    this.app = app
    this.#palette = palette
    // 커서 접근 사각형은 구역보다 커서 경계를 넘는다. 사각형이 플레이 영역의
    // 경계이므로 마스크로 잘라 안쪽 일로만 보이게 한다.
    const mask = new Graphics()
      .roundRect(SQ_LEFT, SQ_TOP, SQUARE, SQUARE, SQ_RADIUS)
      .fill({ color: 0xffffff })
    this.#inside.addChild(this.#fills, this.#cursorNotes)
    this.#inside.mask = mask

    const layer = new Container()
    layer.addChild(this.#board(), mask, this.#inside, this.#flash, this.#laneNotes, this.#cursor)
    app.stage.addChild(layer)
  }

  static async create(host: HTMLElement, scale: number): Promise<Playfield> {
    const app = new Application()
    await app.init({
      width: STAGE_W,
      height: STAGE_H,
      backgroundAlpha: 0,
      antialias: true,
      // 스테이지가 CSS 로 축소될 수 있으니 실제 차지하는 크기로 그린다.
      resolution: Math.min((window.devicePixelRatio || 1) * scale, 3),
      autoDensity: true,
    })
    host.appendChild(app.canvas)
    return new Playfield(app, readPalette())
  }

  destroy(): void {
    this.app.destroy(true, { children: true })
  }

  /**
   * 큰 정사각형과 네 판정선. 한 번만 그린다.
   * 변마다 색이 달라서 어느 변이 어느 입력인지 보면 안다 — 모서리 둥근 구간을 뺀
   * 직선 부분에만 색을 얹는다.
   */
  #board(): Graphics {
    const g = new Graphics()
    const p = this.#palette
    g.roundRect(SQ_LEFT, SQ_TOP, SQUARE, SQUARE, SQ_RADIUS)
    // 옅게 채워 면으로 읽히게 한다. 윤곽만이면 허공에 선이 떠 있는 것처럼 보인다.
    g.fill({ color: p.field, alpha: 0.7 })
    g.stroke({ width: 2, color: p.line, alpha: 0.85 })

    const a = SQ_RADIUS
    g.moveTo(SQ_LEFT, SQ_TOP + a).lineTo(SQ_LEFT, SQ_BOTTOM - a)
    g.moveTo(SQ_RIGHT, SQ_TOP + a).lineTo(SQ_RIGHT, SQ_BOTTOM - a)
    g.stroke({ width: 4, color: p.click, alpha: 0.9 })

    // 위아래 변은 판정선이 아니다 (스크롤을 쓰지 않는다). 윤곽만 남긴다.
    return g
  }

  /**
   * @param songMs 지금 곡 시각 (렌더용)
   * @param notes  전체 노트 상태
   * @param head   아직 판정 안 난 가장 이른 인덱스
   */
  draw(songMs: number, notes: NoteState[], head: number, cursor: { x: number; y: number }): void {
    const p = this.#palette
    const g = this.#cursorNotes
    const lanes = this.#laneNotes
    const f = this.#flash
    const fill = this.#fills
    g.clear()
    lanes.clear()
    f.clear()
    fill.clear()

    // 커서 구역 채움은 윤곽 아래에 깔아야 해서 먼저 모은다.
    const fills: { x: number; y: number; alpha: number }[] = []

    for (let i = head; i < notes.length; i++) {
      const s = notes[i]!
      const lead = s.note.t - songMs
      if (lead > APPROACH_MS) break // 정렬돼 있으므로 뒤는 아직 안 보인다
      if (s.judged) continue

      if (s.note.type === 'cursor') {
        if (lead > CURSOR_LEAD_MS) continue
        const c = fieldToStage(s.note.x, s.note.y)
        const u = Math.max(0, lead) / CURSOR_LEAD_MS
        const base = HIT_RADIUS * 2

        // 도착 자리를 먼저 희미하게 깔아둔다. 이게 없으면 "언제 도착하는가"를 읽을 수 없다.
        g.roundRect(c.x - base / 2, c.y - base / 2, base, base, radiusOf(base))
        g.stroke({
          width: 2,
          color: p.cursor,
          alpha: LANDING_ALPHA.min + (LANDING_ALPHA.max - LANDING_ALPHA.min) * (1 - u),
        })

        // 날아오는 노트. 중앙에서 멀리 있다가 제자리로 퍼진다.
        const persp = DEPTH_MIN / (DEPTH_MIN + u * (1 - DEPTH_MIN))
        const size = base * persp
        const x = FIELD_CENTER.x + (c.x - FIELD_CENTER.x) * persp
        const y = FIELD_CENTER.y + (c.y - FIELD_CENTER.y) * persp
        g.roundRect(x - size / 2, y - size / 2, size, size, radiusOf(size))
        g.stroke({ width: 3, color: p.cursor, alpha: Math.min(1, (1 - u) * 3.2) })

        if (lead < CURSOR_FILL_MS)
          fills.push({ x: c.x, y: c.y, alpha: 0.3 * (1 - Math.max(0, lead) / CURSOR_FILL_MS) })
        continue
      }

      // 클릭 노트: 바깥에서 밀려와 앞면이 변에 닿는다.
      const lane = LANES[laneOf(s.note)!]
      const u = Math.max(0, lead) / LANE_LEAD_MS
      const b = laneBox(lane, u)
      lanes.roundRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size, radiusOf(b.size))
      lanes.fill({ color: p.click, alpha: 0.9 })
    }

    const hitSize = HIT_RADIUS * 2
    for (const { x, y, alpha } of fills) {
      fill.roundRect(x - HIT_RADIUS, y - HIT_RADIUS, hitSize, hitSize, radiusOf(hitSize))
      fill.fill({ color: p.cursor, alpha })
    }
    this.#drawFlash(songMs)

    // 커서는 진짜 좌표 그대로. 판정의 주체라 여기가 거짓말하면 안 된다.
    // 유일한 원이다 — 나머지가 전부 둥근 정사각형이라 이것만으로 구분된다.
    const c = this.#cursor
    c.clear()
    c.circle(cursor.x, cursor.y, CURSOR_RADIUS)
    c.fill({ color: p.cursor, alpha: 0.95 })
  }

  /** 판정 직후 그 자리를 번쩍인다. 맞았는지 즉시 알아야 한다. */
  mark(songMs: number, note: NoteState['note'], grade: Grade): void {
    const b = targetOf(note)
    const color =
      grade === 'miss'
        ? this.#palette.click
        : grade === 'perfect'
          ? this.#palette.bone
          : this.#palette.cursor
    this.#glow.set(`${b.x},${b.y},${b.size}`, { until: songMs + AFTERGLOW_MS, grade, color })
  }

  #drawFlash(songMs: number): void {
    const f = this.#flash
    for (const [key, v] of this.#glow) {
      const left = v.until - songMs
      if (left <= 0) {
        this.#glow.delete(key)
        continue
      }
      const [cx, cy, base] = key.split(',').map(Number) as [number, number, number]
      const u = left / AFTERGLOW_MS
      const size = base * (1 + (1 - u) * 0.45)
      f.roundRect(cx - size / 2, cy - size / 2, size, size, radiusOf(size))
      f.fill({ color: v.color, alpha: 0.3 * u })
    }
  }
}
