/**
 * 판정 검증. 브라우저 없이 Session 을 직접 돌린다.
 *
 *   node tools/gametest.ts [chartHash]
 *
 * 핵심 질문: **노트 시각에 정확히 맞춰 입력을 넣으면 전부 PERFECT 인가.**
 * 아니면 판정기나 좌표계가 틀린 것이다. 브라우저 쪽 시계(AudioClock)는 여기서 못 보고
 * autoplay 모드 + tools/probe.mjs 로 따로 확인한다.
 *
 * 판정 창은 **성긴 합성 채보**로 본다. 실제 채보는 클릭 간격이 270ms 밖에 안 돼서
 * 150ms 늦은 입력이 다음 노트의 창에 들어간다 — 그건 정상 동작이지 버그가 아니지만,
 * 창 경계를 재는 데는 방해가 된다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHART_VERSION, FIELD_H, FIELD_W, GENERATOR, type Chart, type Note } from '../src/lib/chart.ts'
import { Session } from '../src/lib/game/session.ts'
import { CURSOR_WINDOW, MISS_AFTER, WINDOW, type Grade } from '../src/lib/game/judge.ts'
import { fieldToStage, HIT_RADIUS } from '../src/lib/game/layout.ts'
import type { DiscreteInput, DiscreteKind } from '../src/lib/game/input.ts'

const ROOT = join(import.meta.dirname, '..')
const CHARTS = join(ROOT, 'static', 'charts')

const kindOf = (n: Note): DiscreteKind | null =>
  n.type === 'click' ? (n.btn === 'L' ? 'clickL' : 'clickR')
  : n.type === 'scroll' ? (n.dir === 'up' ? 'scrollUp' : 'scrollDown')
  : null

interface Play {
  /** 입력 시각 오차(ms). 양수면 늦게 친다. */
  offsetMs?: number
  /** 커서를 판정 지점에서 얼마나 벗어나게 둘지(화면 px) */
  cursorOff?: number
  /** 커서 표본을 노트 시각에서 얼마나 밀지(ms) */
  cursorLateMs?: number
  swapButtons?: boolean
  idle?: boolean
}

/** 60fps 로 곡 전체를 돌린다. 입력은 실제와 같은 경로(이벤트 시각)로 들어간다. */
function simulate(chart: Chart, play: Play = {}) {
  const session = new Session(chart)
  const { offsetMs = 0, cursorOff = 0, cursorLateMs = 0, swapButtons = false, idle = false } = play
  const samples: { songMs: number; x: number; y: number }[] = []
  // 실제 InputCollector 는 표본 사이를 보간한다. 여기서는 표본이 노트마다 하나뿐이라
  // 가장 가까운 것을 쓰되, 5ms 넘게 떨어지면 그 시각엔 표본이 없다고 본다.
  const cursorAt = (ms: number) => {
    let best: (typeof samples)[number] | null = null
    for (const s of samples)
      if (!best || Math.abs(s.songMs - ms) < Math.abs(best.songMs - ms)) best = s
    return best && Math.abs(best.songMs - ms) <= 5 ? { x: best.x, y: best.y } : null
  }

  const last = chart.notes[chart.notes.length - 1]?.t ?? 0
  const STEP = 1000 / 60
  let pending = 0
  for (let songMs = -1000; songMs <= last + MISS_AFTER + 200; songMs += STEP) {
    const inputs: DiscreteInput[] = []
    while (pending < chart.notes.length && chart.notes[pending]!.t <= songMs) {
      const note = chart.notes[pending]!
      pending++
      if (idle) continue
      if (note.type === 'cursor') {
        const b = fieldToStage(note.x, note.y)
        samples.push({ songMs: note.t + cursorLateMs, x: b.x + cursorOff, y: b.y })
        if (samples.length > 256) samples.shift()
      } else {
        let kind = kindOf(note)!
        if (swapButtons && note.type === 'click') kind = kind === 'clickL' ? 'clickR' : 'clickL'
        inputs.push({ kind, songMs: note.t + offsetMs })
      }
    }
    session.update(songMs, inputs, cursorAt)
  }
  return session
}

/** 노트 타입별 등급 집계. "커서는 전부 perfect 인가" 같은 질문에 답하려면 필요하다. */
function tallyBy(session: Session, want: 'cursor' | 'discrete'): Record<Grade, number> {
  const out = { perfect: 0, great: 0, good: 0, miss: 0 }
  for (const s of session.notes) {
    const isCursor = s.note.type === 'cursor'
    if ((want === 'cursor') !== isCursor) continue
    if (s.grade) out[s.grade]++
  }
  return out
}
const fmt = (g: Record<Grade, number>) => `P${g.perfect} G${g.great} g${g.good} M${g.miss}`

let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}

// ── 성긴 합성 채보: 타입 하나씩 돌아가며 600ms 간격 ──────────────
const SPACING = 600
const synthNotes: Note[] = []
for (let i = 0; i < 40; i++) {
  const t = 2000 + i * SPACING
  switch (i % 3) {
    case 0:
      synthNotes.push({
        t, type: 'cursor',
        x: Math.round(150 + ((i * 137) % 700)),
        y: Math.round(120 + ((i * 211) % 510)),
      })
      break
    case 1: synthNotes.push({ t, type: 'click', btn: 'L' }); break
    default: synthNotes.push({ t, type: 'click', btn: 'R' })
  }
}
const synth: Chart = {
  version: CHART_VERSION, generator: GENERATOR, difficulty: 'normal',
  bpm: 100, beatOffsetMs: 0, beats: [], audioOffsetMs: 0, sections: [0], notes: synthNotes,
}
const synthCursor = synthNotes.filter((n) => n.type === 'cursor').length
const synthDiscrete = synthNotes.length - synthCursor
const synthClicks = synthNotes.filter((n) => n.type === 'click').length
void FIELD_W
void FIELD_H

console.log(`합성 채보  노트 ${synthNotes.length}개 (커서 ${synthCursor} / 이산 ${synthDiscrete}), 간격 ${SPACING}ms\n`)

console.log('타이밍 창 — 이산 입력')
for (const [off, want] of [
  [WINDOW.perfect - 5, 'perfect'],
  [WINDOW.perfect + 5, 'great'],
  [WINDOW.great + 5, 'good'],
  [WINDOW.good + 20, 'miss'],
] as const) {
  const g = tallyBy(simulate(synth, { offsetMs: off }), 'discrete')
  check(g[want] === synthDiscrete, `${String(off).padStart(4)}ms 늦으면 ${want.padEnd(7)} ${fmt(g)}`)
  const early = tallyBy(simulate(synth, { offsetMs: -off }), 'discrete')
  check(early[want] === synthDiscrete, `${String(-off).padStart(4)}ms 빠르면 ${want.padEnd(7)} ${fmt(early)} (대칭)`)
}

console.log('\n커서는 위치 판정 — 타이밍과 무관하다')
for (const off of [0, 500, -500]) {
  const g = tallyBy(simulate(synth, { offsetMs: off }), 'cursor')
  check(g.perfect === synthCursor, `이산 입력이 ${String(off).padStart(5)}ms 어긋나도 커서 ${fmt(g)}`)
}
check(tallyBy(simulate(synth, { cursorOff: HIT_RADIUS - 6 }), 'cursor').perfect === synthCursor, `반경 안(${HIT_RADIUS - 6}px) PERFECT`)
check(tallyBy(simulate(synth, { cursorOff: HIT_RADIUS + 6 }), 'cursor').miss === synthCursor, `반경 밖(${HIT_RADIUS + 6}px) MISS`)
console.log('\n커서 판정 창')
for (const [late, want] of [[CURSOR_WINDOW - 8, 'perfect'], [CURSOR_WINDOW + 20, 'miss']] as const) {
  const g = tallyBy(simulate(synth, { cursorLateMs: late }), 'cursor')
  check(g[want] === synthCursor, `커서가 ${late}ms 늦게 지나가면 ${want.padEnd(7)} ${fmt(g)}`)
}

console.log('\n잘못된 입력')
const swapped = tallyBy(simulate(synth, { swapButtons: true }), 'discrete')
check(swapped.miss === synthClicks, `좌우를 바꿔 치면 클릭 ${synthClicks}개만 MISS — ${fmt(swapped)}`)
const idleS = simulate(synth, { idle: true })
check(idleS.tally.miss === synthNotes.length, `아무것도 안 하면 전부 MISS — ${idleS.tally.miss}`)
check(idleS.tally.accuracy === 0, '정확도 0%')

// ── 실제 채보 ───────────────────────────────────────────────────
const hash = process.argv[2] ?? readdirSync(CHARTS).map((f) => f.replace('.json', ''))[0]
if (hash) {
  const chart = JSON.parse(readFileSync(join(CHARTS, `${hash}.json`), 'utf8')) as Chart
  console.log(`\n실제 채보 ${hash}  ${chart.difficulty}  노트 ${chart.notes.length}개  ${chart.bpm} BPM`)
  const s = simulate(chart)
  check(s.tally.perfect === chart.notes.length, `완벽한 입력이면 전부 PERFECT — ${s.tally.perfect}/${chart.notes.length}`)
  check(s.tally.maxCombo === chart.notes.length, `콤보가 끊기지 않는다 (${s.tally.maxCombo})`)
  check(s.tally.accuracy === 1, '정확도 100%')
  check(s.done && s.notes.every((n) => n.judged), '모든 노트가 정확히 한 번씩 판정됐다')
  const idleR = simulate(chart, { idle: true })
  check(idleR.tally.miss === chart.notes.length, `아무것도 안 하면 전부 MISS — ${idleR.tally.miss}`)
  // 촘촘한 채보에서 크게 늦은 입력이 다음 노트에 붙는 건 정상이다. 콤보만 확인한다.
  const late = simulate(chart, { offsetMs: 300 })
  check(late.tally.combo < chart.notes.length, `300ms 늦으면 콤보가 끊긴다 (최대 ${late.tally.maxCombo})`)
}

console.log(failures ? `\n실패 ${failures}건` : '\n전부 통과')
process.exit(failures ? 1 : 0)
