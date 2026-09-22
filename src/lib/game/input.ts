/**
 * 입력 수집 (PLAN §4).
 *
 * 핵심 규칙 하나: **이벤트 핸들러에서 `event.timeStamp` 를 그대로 캡처해 큐에 넣고,
 * rAF 는 소비만 한다.** rAF 시각으로 판정하면 최대 16ms 오차가 붙는데 그건 판정 등급을
 * 바꾼다. 그래서 여기서 하는 일은 "언제"를 정확히 기록하는 것뿐이고, 판정은 하지 않는다.
 *
 * 커서는 Pointer Lock 이 아니라 포인터 좌표를 논리 좌표로 환산한다 — Lock 과 감도
 * 설정은 M2 다 (PLAN §13). 좌표도 이벤트 시각과 함께 남겨서 노트 시각의 위치를
 * 보간으로 되찾을 수 있게 한다.
 */
import { createWheelTicker } from '../input/wheel.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../shell/viewport.ts'

export type DiscreteKind = 'clickL' | 'clickR' | 'scrollUp' | 'scrollDown'

export interface DiscreteInput {
  kind: DiscreteKind
  /** 곡 시각(ms). 이벤트 timeStamp 를 클럭으로 환산한 값. */
  songMs: number
}

export interface CursorSample {
  songMs: number
  x: number
  y: number
}

/** 커서 표본 보관 개수. 60Hz 로 약 4초. */
const CURSOR_HISTORY = 256

export interface InputOptions {
  /** performance 기준 ms → 곡 ms. AudioClock.songTimeOf 를 넘긴다. */
  toSongMs: (perfMs: number) => number
}

export class InputCollector {
  #queue: DiscreteInput[] = []
  #samples: CursorSample[] = []
  #detach: (() => void)[] = []
  #toSongMs: (perfMs: number) => number

  /** 마지막으로 본 커서 위치. 렌더용. */
  cursor = { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 }

  constructor({ toSongMs }: InputOptions) {
    this.#toSongMs = toSongMs
  }

  attach(surface: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.#detach.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }

    const push = (kind: DiscreteKind, perfMs: number) => {
      this.#queue.push({ kind, songMs: this.#toSongMs(perfMs) })
    }

    on(surface, 'pointermove', (e: PointerEvent) => {
      const rect = surface.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = ((e.clientX - rect.left) / rect.width) * STAGE_WIDTH
      const y = ((e.clientY - rect.top) / rect.height) * STAGE_HEIGHT
      this.cursor.x = Math.max(0, Math.min(STAGE_WIDTH, x))
      this.cursor.y = Math.max(0, Math.min(STAGE_HEIGHT, y))
      this.#samples.push({ songMs: this.#toSongMs(e.timeStamp), x: this.cursor.x, y: this.cursor.y })
      if (this.#samples.length > CURSOR_HISTORY) this.#samples.shift()
    })

    // click 이 아니라 pointerdown 이다. click 은 down+up 후에 와서 지연이 얹힌다.
    on(surface, 'pointerdown', (e: PointerEvent) => {
      if (e.button === 0) push('clickL', e.timeStamp)
      else if (e.button === 2) push('clickR', e.timeStamp)
    })
    // macOS 는 Ctrl+클릭도 우클릭으로 들어온다. 메뉴가 뜨면 게임이 멈춘다.
    on(surface, 'contextmenu', (e: Event) => e.preventDefault())

    const ticker = createWheelTicker(({ dir, timeStamp }) =>
      push(dir < 0 ? 'scrollUp' : 'scrollDown', timeStamp),
    )
    // passive: false 가 아니면 페이지가 같이 스크롤된다.
    on(surface, 'wheel', (e: WheelEvent) => {
      e.preventDefault()
      ticker(e)
    }, { passive: false })

    // 키보드 폴백. 트랙패드에서 스크롤 노트는 관성 때문에 사실상 불가능하다 (PLAN §4).
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return
      const kind = KEY_MAP[e.key.toLowerCase()]
      if (!kind) return
      e.preventDefault()
      push(kind, e.timeStamp)
    })
  }

  detach(): void {
    for (const off of this.#detach) off()
    this.#detach = []
  }

  /** 큐를 비우고 돌려준다. rAF 에서 한 번씩 부른다. */
  drain(): DiscreteInput[] {
    const out = this.#queue
    this.#queue = []
    return out
  }

  /**
   * 그 곡 시각의 커서 위치. 표본 사이는 선형 보간한다 — 노트 시각이 두 pointermove
   * 사이에 떨어지는 게 보통이고, 가장 가까운 표본을 그냥 쓰면 빠른 이동에서 한 칸씩 틀린다.
   */
  cursorAt(songMs: number): { x: number; y: number } | null {
    const s = this.#samples
    if (!s.length) return null
    if (songMs <= s[0]!.songMs) return { x: s[0]!.x, y: s[0]!.y }
    const last = s[s.length - 1]!
    if (songMs >= last.songMs) return { x: last.x, y: last.y }
    let lo = 0
    let hi = s.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s[mid]!.songMs <= songMs) lo = mid
      else hi = mid
    }
    const a = s[lo]!
    const b = s[hi]!
    const span = b.songMs - a.songMs
    const u = span > 0 ? (songMs - a.songMs) / span : 0
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
  }

  /** 검증용. 실제 입력과 같은 경로로 들어간다. */
  inject(kind: DiscreteKind, songMs: number): void {
    this.#queue.push({ kind, songMs })
  }

  injectCursor(songMs: number, x: number, y: number): void {
    this.#samples.push({ songMs, x, y })
    if (this.#samples.length > CURSOR_HISTORY) this.#samples.shift()
    this.cursor.x = x
    this.cursor.y = y
  }
}

const KEY_MAP: Record<string, DiscreteKind | undefined> = {
  z: 'clickL',
  x: 'clickR',
  w: 'scrollUp',
  s: 'scrollDown',
}
