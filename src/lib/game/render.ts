/**
 * 플레이필드 렌더 (PixiJS).
 *
 * 노트는 과녁 위로 **줄어들며 겹쳐 오는 정사각형 윤곽**이다. 윤곽이 과녁과 정확히
 * 포개지는 순간이 판정 시점 — 눈으로 일치를 읽기 가장 쉬운 형태고, 한 과녁에 여러
 * 노트가 몰려도 동심 사각형으로 겹쳐서 밀도를 견딘다.
 *
 * 여기서는 시간을 **인자로만** 받는다. 렌더가 시계를 읽으면 rAF 지터가 판정에 섞인다.
 */
import { Application, Container, Graphics } from 'pixi.js'
import { tokenColor } from '../design/theme.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../shell/viewport.ts'
import type { Grade } from './judge.ts'
import { CELL, CELL_GAP, GRID_LEFT, GRID_TOP, LANE, radiusOf, targetOf } from './layout.ts'
import type { NoteState } from './session.ts'

/**
 * 타입마다 접근이 다르다.
 *
 * 커서 노트는 칸이 서로 붙어 있고(간격 144px) 밀도가 높아서(초당 3~4개) 크고 긴 접근을
 * 쓰면 사각형들이 그리드를 덮어 어느 칸인지 안 읽힌다. 커서는 애초에 **연속 입력**이라
 * 매 노트에 반응하는 게 아니라 궤적을 따라가는 것이므로 짧고 작아도 된다.
 * 클릭·스크롤은 과녁이 멀찍이 떨어져 있어 동심으로 겹쳐도 읽힌다.
 */
const APPROACH: Record<'cursor' | 'click' | 'scroll', { ms: number; scale: number }> = {
  cursor: { ms: 600, scale: 1.8 },
  click: { ms: 900, scale: 3.0 },
  scroll: { ms: 900, scale: 3.0 },
}
export const APPROACH_MS = Math.max(...Object.values(APPROACH).map((a) => a.ms))
/** 커서 칸을 채우기 시작하는 시점(ms). 정확한 순간을 윤곽만으로는 읽기 어렵다. */
const CURSOR_FILL_MS = 180
/** 판정 후 잔상이 남는 시간(ms). */
const AFTERGLOW_MS = 180

export interface Palette {
  cursor: number
  click: number
  scroll: number
  line: number
  bone: number
}

export const readPalette = (): Palette => ({
  cursor: tokenColor('--cursor', 0xffc24a),
  click: tokenColor('--click', 0xff5f8d),
  scroll: tokenColor('--scroll', 0x4ce0c4),
  line: tokenColor('--line', 0x3b2a82),
  bone: tokenColor('--bone', 0xefe9ff),
})

const colorOf = (p: Palette, t: NoteState['note']['type']) =>
  t === 'cursor' ? p.cursor : t === 'click' ? p.click : p.scroll

export class Playfield {
  readonly app: Application
  #palette: Palette
  #notes = new Graphics()
  #cursor = new Graphics()
  #flash = new Graphics()
  /** 판정 잔상: 과녁 키 → 남은 시간·등급 */
  #glow = new Map<string, { until: number; grade: Grade; color: number }>()

  private constructor(app: Application, palette: Palette) {
    this.app = app
    this.#palette = palette
    const layer = new Container()
    layer.addChild(this.#board(), this.#flash, this.#notes, this.#cursor)
    app.stage.addChild(layer)
  }

  static async create(host: HTMLElement, scale: number): Promise<Playfield> {
    const app = new Application()
    await app.init({
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
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

  /** 그리드와 네 과녁. 한 번만 그린다. */
  #board(): Graphics {
    const g = new Graphics()
    const p = this.#palette
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++)
        g.roundRect(
          GRID_LEFT + col * (CELL + CELL_GAP),
          GRID_TOP + row * (CELL + CELL_GAP),
          CELL,
          CELL,
          radiusOf(CELL),
        )
    g.stroke({ width: 2, color: p.cursor, alpha: 0.24 })

    for (const key of ['clickL', 'clickR'] as const) {
      const b = LANE[key]
      g.roundRect(b.cx - b.size / 2, b.cy - b.size / 2, b.size, b.size, radiusOf(b.size))
    }
    g.stroke({ width: 2, color: p.click, alpha: 0.4 })

    for (const key of ['scrollUp', 'scrollDown'] as const) {
      const b = LANE[key]
      g.roundRect(b.cx - b.size / 2, b.cy - b.size / 2, b.size, b.size, radiusOf(b.size))
    }
    g.stroke({ width: 2, color: p.scroll, alpha: 0.4 })
    return g
  }

  /**
   * @param songMs 지금 곡 시각 (렌더용)
   * @param notes  전체 노트 상태
   * @param head   아직 판정 안 난 가장 이른 인덱스
   */
  draw(
    songMs: number,
    notes: NoteState[],
    head: number,
    cursor: { x: number; y: number },
  ): void {
    const p = this.#palette
    const g = this.#notes
    g.clear()

    const fills: { b: ReturnType<typeof targetOf>; alpha: number }[] = []
    for (let i = head; i < notes.length; i++) {
      const s = notes[i]!
      const lead = s.note.t - songMs
      if (lead > APPROACH_MS) break // 정렬돼 있으므로 뒤는 아직 안 보인다
      if (s.judged) continue
      const a = APPROACH[s.note.type]
      if (lead > a.ms) continue
      const b = targetOf(s.note)
      // 1 → scale. lead 0 에서 과녁과 정확히 포개진다.
      const k = Math.max(0, lead) / a.ms
      const size = b.size * (1 + (a.scale - 1) * k)
      g.roundRect(b.cx - size / 2, b.cy - size / 2, size, size, radiusOf(size))
      g.stroke({ width: 3, color: colorOf(p, s.note.type), alpha: Math.min(1, (1 - k) * 2.2) })
      // 커서는 칸 안이 차오르며 "지금"을 알린다. 윤곽 위에 겹치지 않게 따로 모아 먼저 그린다.
      if (s.note.type === 'cursor' && lead < CURSOR_FILL_MS)
        fills.push({ b, alpha: 0.3 * (1 - Math.max(0, lead) / CURSOR_FILL_MS) })
    }
    const f = this.#flash
    f.clear()
    for (const { b, alpha } of fills) {
      f.roundRect(b.cx - b.size / 2, b.cy - b.size / 2, b.size, b.size, radiusOf(b.size))
      f.fill({ color: p.cursor, alpha })
    }

    this.#drawFlash(songMs)

    // 커서. 위치 판정의 주체라 항상 보여야 한다.
    const c = this.#cursor
    c.clear()
    c.roundRect(cursor.x - 22, cursor.y - 22, 44, 44, radiusOf(44))
    c.fill({ color: p.cursor, alpha: 0.9 })
  }

  /** 판정 직후 과녁을 번쩍인다. 맞았는지 즉시 알아야 한다. */
  mark(songMs: number, note: NoteState['note'], grade: Grade): void {
    const b = targetOf(note)
    const color =
      grade === 'miss' ? this.#palette.click : grade === 'perfect' ? this.#palette.bone : colorOf(this.#palette, note.type)
    this.#glow.set(`${b.cx},${b.cy}`, { until: songMs + AFTERGLOW_MS, grade, color })
  }

  #drawFlash(songMs: number): void {
    const f = this.#flash
    for (const [key, v] of this.#glow) {
      const left = v.until - songMs
      if (left <= 0) {
        this.#glow.delete(key)
        continue
      }
      const [cx, cy] = key.split(',').map(Number) as [number, number]
      const u = left / AFTERGLOW_MS
      const size = (v.grade === 'miss' ? 88 : 100) * (1 + (1 - u) * 0.25)
      f.roundRect(cx - size / 2, cy - size / 2, size, size, radiusOf(size))
      f.fill({ color: v.color, alpha: 0.28 * u })
    }
  }
}
