/**
 * 한 판의 상태. 노트를 들고 있다가 입력·시간에 따라 판정한다.
 *
 * 렌더와 완전히 분리돼 있다 — 여기에는 Pixi 도 DOM 도 없고, 시간은 인자로만 들어온다.
 * 그래서 브라우저 없이 테스트할 수 있고, "완벽한 입력을 넣으면 전부 PERFECT 인가"를
 * 숫자로 확인할 수 있다. 그게 시계가 맞는지 보는 가장 확실한 방법이다.
 */
import type { Chart, Note } from '../chart.ts'
import type { DiscreteInput, DiscreteKind } from './input.ts'
import { withinHit } from './layout.ts'
import {
  applyJudgement,
  CURSOR_WINDOW,
  emptyTally,
  gradeTiming,
  MISS_AFTER,
  type Grade,
  type Judgement,
  type Tally,
} from './judge.ts'

/** 판정 창이 닫힌 뒤 이만큼 더 기다렸다가 판정한다. 표본이 도착할 여유. */
const CURSOR_SETTLE_MS = 30
/** 창 안을 훑는 간격(ms). pointermove 가 60~125Hz 라 이보다 촘촘히 볼 이유가 없다. */
const CURSOR_PROBE_MS = 8

export interface NoteState {
  note: Note
  judged: boolean
  grade?: Grade
  deltaMs?: number
}

/** 이 노트를 치는 이산 입력. 커서 노트는 위치 판정이라 없다. */
export const kindOf = (note: Note): DiscreteKind | null => {
  if (note.type === 'click') return note.btn === 'L' ? 'clickL' : 'clickR'
  if (note.type === 'scroll') return note.dir === 'up' ? 'scrollUp' : 'scrollDown'
  return null
}

export class Session {
  readonly notes: NoteState[]
  readonly tally: Tally = emptyTally()
  /** 방금 난 판정들. 렌더가 읽어 팝업을 띄우고 비운다. */
  readonly fresh: Judgement[] = []
  /** 아직 판정 안 난 가장 이른 노트. 렌더가 여기서부터 훑는다. */
  #head = 0

  constructor(chart: Chart) {
    this.notes = chart.notes.map((note) => ({ note, judged: false }))
  }

  get done(): boolean {
    return this.#head >= this.notes.length
  }

  get head(): number {
    return this.#head
  }

  /**
   * @param songMs 지금 곡 시각
   * @param inputs 이번 프레임에 들어온 이산 입력 (이벤트 시각 기준)
   * @param cursorAt 그 곡 시각의 커서 위치
   */
  update(
    songMs: number,
    inputs: DiscreteInput[],
    cursorAt: (ms: number) => { x: number; y: number } | null,
  ): void {
    // 1. 이산 입력을 노트에 붙인다. 이벤트 시각에 가장 가까운 미판정 노트를 찾는다.
    for (const input of inputs) {
      const hit = this.#nearest(input)
      if (!hit) continue // 창 밖의 헛손질. 콤보를 끊지는 않는다
      const delta = input.songMs - hit.note.t
      this.#settle(hit, gradeTiming(delta), delta)
    }

    // 2. 시간이 지난 노트를 처리한다.
    for (let i = this.#head; i < this.notes.length; i++) {
      const s = this.notes[i]!
      if (s.judged) continue
      const { note } = s
      if (note.type === 'cursor') {
        if (songMs < note.t + CURSOR_WINDOW + CURSOR_SETTLE_MS) break
        // 위치 판정: 창 안 어느 순간이라도 반경에 들어왔는가. 타이밍 등급은 없다.
        let hit = false
        for (let d = -CURSOR_WINDOW; d <= CURSOR_WINDOW && !hit; d += CURSOR_PROBE_MS) {
          const at = cursorAt(note.t + d)
          if (at && withinHit(at, note)) hit = true
        }
        this.#settle(s, hit ? 'perfect' : 'miss', 0)
      } else {
        if (songMs <= note.t + MISS_AFTER) break
        this.#settle(s, 'miss', 0)
      }
    }
    while (this.#head < this.notes.length && this.notes[this.#head]!.judged) this.#head++
  }

  /** 이 이산 입력이 붙을 노트. 같은 종류 중 시각이 가장 가까운 미판정 노트. */
  #nearest(input: DiscreteInput): NoteState | null {
    let best: NoteState | null = null
    let bestD = MISS_AFTER
    for (let i = this.#head; i < this.notes.length; i++) {
      const s = this.notes[i]!
      const d = s.note.t - input.songMs
      if (d > MISS_AFTER) break // 정렬돼 있으므로 뒤는 볼 필요 없다
      if (s.judged || kindOf(s.note) !== input.kind) continue
      const abs = Math.abs(d)
      if (abs < bestD) {
        bestD = abs
        best = s
      }
    }
    return best
  }

  #settle(s: NoteState, grade: Grade, deltaMs: number): void {
    s.judged = true
    s.grade = grade
    s.deltaMs = deltaMs
    applyJudgement(this.tally, grade)
    this.fresh.push({ note: s.note, grade, deltaMs })
  }
}
