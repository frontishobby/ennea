/**
 * 분석 결과 → 난이도별 채보 (PLAN §6⑦⑧⑨, §7①⑥).
 *
 * M3 범위: 대역→타입 배정, 밀도 조절, 이동 예산 안에서 랜덤 커서 배치, 타입 간 제약.
 * 패턴 어휘·D4 변형·섹션 매핑·관성은 M4 다.
 */
import {
  CHART_VERSION,
  GENERATOR,
  type Chart,
  type ClickNote,
  type CursorNote,
  type Difficulty,
  type Note,
  type ScrollNote,
} from '../../src/lib/chart.ts'
import { seeded } from '../../src/lib/util/prng.ts'
import type { Analysis } from './analyze.ts'
import { SOLID_MARGIN, WEAK_MARGIN } from './grid.ts'
import type { Onset } from './onset.ts'

export interface DifficultyParams {
  /** 비트 분할. 2 = 8분음표, 4 = 16분음표 */
  gridDiv: number
  /** sf/thr 가 이 이상인 온셋만 쓴다. 높을수록 센 타격만 남는다. */
  minRatio: number
  /**
   * 같은 타입 노트 사이 최소 간격, 비트 단위. 118 BPM 과 174 BPM 에서 같은 "음악적"
   * 밀도가 되게 한다. 절대 난이도 차이는 songs.json 의 level 이 진다.
   */
  minGapBeats: { cursor: number; click: number; scroll: number }
  /**
   * 타입 무관, 한 비트 안에 최대 몇 개 (센 것부터). 역학이 없는 균일한 곡에서는
   * minRatio 가 아무것도 못 솎는다 — 이게 밀도를 잡는 마지막 고삐다.
   */
  maxPerBeat: number
  /** 커서 이동 예산, 체비셰프 칸/초 (PLAN §7①). 실측 대상 (§15). */
  vMax: number
  /** 커서 노트 이 거리(초) 안의 클릭은 버린다. 겹침은 최상위 난이도에서만 (PLAN §7⑥). 0 이면 허용. */
  clickCursorExclusion: number
}

/** 스크롤 노트 최소 간격 바닥. 트랙패드 관성 때문에 어떤 난이도에서도 이 밑으로 안 간다 (PLAN §4). */
export const SCROLL_FLOOR_SEC = 0.2
/** 커서 노트 판정 ±50ms 안에 스크롤 금지 — 휠을 굴리면 마우스가 흔들린다 (PLAN §7⑥). */
export const SCROLL_CURSOR_EXCLUSION_SEC = 0.05
/** 스크롤 직후 커서를 멀리 보내지 않는다. 이 시간 동안 이동 예산을 절반으로. */
export const AFTER_SCROLL_SEC = 0.3

export const PARAMS: Record<Difficulty, DifficultyParams> = {
  easy: {
    gridDiv: 2,
    minRatio: 1.6,
    minGapBeats: { cursor: 1, click: 1, scroll: 2 },
    maxPerBeat: 1,
    vMax: 2.5,
    clickCursorExclusion: 0.1,
  },
  normal: {
    gridDiv: 4,
    minRatio: 1.25,
    minGapBeats: { cursor: 0.5, click: 0.5, scroll: 1 },
    maxPerBeat: 2,
    vMax: 4.5,
    clickCursorExclusion: 0.06,
  },
  hard: {
    gridDiv: 4,
    minRatio: 1.0,
    minGapBeats: { cursor: 0.25, click: 0.25, scroll: 0.5 },
    maxPerBeat: 4,
    vMax: 7.5,
    clickCursorExclusion: 0,
  },
}

/** 한 섹션 = 8마디. 2분 곡이면 8~10 구간 — 테니스 스코어가 성립하는 개수 (PLAN §10). */
const SECTION_BARS = 8

const cheb = (ax: number, ay: number, bx: number, by: number) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by))

/**
 * 박자가 흐린 구간에서는 세기 문턱을 올린다. 그리드가 설명 못 하는 온셋에 노트를 찍으면
 * 리듬게임에서는 "따로 논다"로 들린다 — 브레이크다운은 원래 노트를 비우는 구간이다.
 * 신뢰도 여유가 SOLID 이상이면 1배, WEAK 이하면 WEAK_RATIO_BOOST 배, 사이는 선형.
 */
export const WEAK_RATIO_BOOST = 3
function ratioBoost(margin: number): number {
  if (margin >= SOLID_MARGIN) return 1
  if (margin <= WEAK_MARGIN) return WEAK_RATIO_BOOST
  const u = (margin - WEAK_MARGIN) / (SOLID_MARGIN - WEAK_MARGIN)
  return WEAK_RATIO_BOOST + (1 - WEAK_RATIO_BOOST) * u
}

/** 비최대 억제: 센 것부터 받고, 이미 받은 것과 minGap 안이면 버린다. 문턱은 온셋마다 다를 수 있다. */
function thin(onsets: Onset[], minGap: number, minRatio: number | ((o: Onset) => number)): Onset[] {
  const need = typeof minRatio === 'number' ? () => minRatio : minRatio
  const sorted = onsets.filter((o) => o.ratio >= need(o)).sort((a, b) => b.ratio - a.ratio)
  const kept: Onset[] = []
  for (const o of sorted) {
    if (kept.every((k) => Math.abs(k.t - o.t) >= minGap)) kept.push(o)
  }
  return kept.sort((a, b) => a.t - b.t)
}

export function generate(a: Analysis, difficulty: Difficulty, songHash: string): Chart {
  const p = PARAMS[difficulty]
  const rng = seeded(songHash, difficulty, GENERATOR)
  const { grid } = a
  const periodSec = 60 / grid.meanBpm
  const div = p.gridDiv as 2 | 4

  // 지역 그리드 스냅. 허용치 밖이면 그대로 둔다 — 셋잇단·스윙 보존.
  // 박자가 흐린 구간에서는 스냅하지 않는다. 못 믿는 그리드로 노트를 옮기면 더 틀린다.
  const snap = (t: number) => {
    if (grid.marginAt(t) < WEAK_MARGIN) return t
    const g = grid.nearest(t, div)
    const tol = Math.min(0.035, 0.4 * (grid.stepAt(t) * (4 / div)))
    return Math.abs(g - t) <= tol ? g : t
  }
  const need = (o: Onset) => p.minRatio * ratioBoost(grid.marginAt(o.t))

  // 대역 → 타입. 적합도 게이트를 못 넘은 대역은 비운다 — 그리드에 안 붙는 온셋을
  // 스냅하면 노트가 음악 밖으로 밀려나고, 그건 소리로 바로 들린다.
  const src = (band: 'low' | 'mid' | 'high') => (a.fitness[band].ok ? a.byBand[band] : [])
  // 스냅은 솎아내기 전에 — 같은 그리드 점으로 몰린 것들이 minGap 에서 정리된다.
  const snapAll = (list: Onset[]) => list.map((o) => ({ ...o, t: snap(o.t) }))
  const gap = (beats: number) => beats * periodSec
  const cursorSrc0 = thin(snapAll(src('mid')), gap(p.minGapBeats.cursor), need)
  const cursorTimes = cursorSrc0.map((o) => o.t)
  const nearCursor = (t: number, within: number) =>
    within > 0 && cursorTimes.some((c) => Math.abs(c - t) < within)

  // 클릭: 스네어·클랩은 광대역이라 고역에도 잡힌다. 커서와 동시에 치는 건 hard 만.
  const clickSrc0 = thin(
    snapAll(src('high')).filter((o) => !nearCursor(o.t, p.clickCursorExclusion)),
    gap(p.minGapBeats.click),
    need,
  )

  // 스크롤: 커서 노트 ±50ms 안은 어떤 난이도에서도 안 된다. 바닥 200ms 도 절대.
  const scrollSrc0 = thin(
    snapAll(src('low')).filter((o) => !nearCursor(o.t, SCROLL_CURSOR_EXCLUSION_SEC)),
    Math.max(gap(p.minGapBeats.scroll), SCROLL_FLOOR_SEC),
    need,
  )

  // 비트당 캡: 세 타입을 합쳐 비트 단위로 묶고 센 것부터 maxPerBeat 개만 남긴다.
  const tagged = [
    ...cursorSrc0.map((o) => ({ o, kind: 'cursor' as const })),
    ...clickSrc0.map((o) => ({ o, kind: 'click' as const })),
    ...scrollSrc0.map((o) => ({ o, kind: 'scroll' as const })),
  ]
  const byBeat = new Map<number, typeof tagged>()
  for (const x of tagged) {
    const b = grid.beatIndexAt(x.o.t)
    const list = byBeat.get(b)
    if (list) list.push(x)
    else byBeat.set(b, [x])
  }
  const kept = { cursor: [] as Onset[], click: [] as Onset[], scroll: [] as Onset[] }
  for (const list of byBeat.values()) {
    list.sort((x, y) => y.o.ratio - x.o.ratio || x.o.t - y.o.t)
    for (const x of list.slice(0, p.maxPerBeat)) kept[x.kind].push(x.o)
  }
  const byT = (x: Onset, y: Onset) => x.t - y.t
  const cursorSrc = kept.cursor.sort(byT)
  const clickSrc = kept.click.sort(byT)
  const scrollSrc = kept.scroll.sort(byT)

  const ms = (t: number) => Math.round(t * 1000)

  // 클릭: 연타면 좌우 번갈아, 떨어져 있으면 무작위
  const clicks: ClickNote[] = []
  let lastBtn: 'L' | 'R' = rng() < 0.5 ? 'L' : 'R'
  let lastClickT = -Infinity
  for (const o of clickSrc) {
    const btn: 'L' | 'R' =
      o.t - lastClickT < 0.3 ? (lastBtn === 'L' ? 'R' : 'L') : rng() < 0.5 ? 'L' : 'R'
    clicks.push({ t: ms(o.t), type: 'click', btn })
    lastBtn = btn
    lastClickT = o.t
  }

  // 스크롤: 같은 방향으로 이어지는 게 자연스럽다. 65% 유지.
  const scrolls: ScrollNote[] = []
  let dir: 'up' | 'down' = rng() < 0.5 ? 'up' : 'down'
  for (const o of scrollSrc) {
    if (scrolls.length && rng() >= 0.65) dir = dir === 'up' ? 'down' : 'up'
    scrolls.push({ t: ms(o.t), type: 'scroll', dir })
  }

  // 커서: 이동 예산 안에서 무작위 (M3). 스크롤 직후엔 예산 절반.
  const scrollTimes = scrollSrc.map((o) => o.t)
  let scrollPtr = 0
  const recentScroll = (t: number) => {
    while (scrollPtr < scrollTimes.length && scrollTimes[scrollPtr] < t - AFTER_SCROLL_SEC) scrollPtr++
    const s = scrollTimes[scrollPtr]
    return s !== undefined && s <= t && t - s < AFTER_SCROLL_SEC
  }
  const cursors: CursorNote[] = []
  let cx = 1
  let cy = 1
  let prevMs: number | undefined
  for (const o of cursorSrc) {
    // 예산은 채보에 기록되는 정수 ms 로 계산한다. validate() 와 같은 숫자를 봐야
    // 반올림 1ms 차이로 경계에서 7.5 > 7.5 가 나지 않는다.
    const tMs = ms(o.t)
    const dt = prevMs === undefined ? Infinity : (tMs - prevMs) / 1000
    let budget = p.vMax * dt
    if (recentScroll(o.t)) budget *= 0.5
    const maxD = Math.min(2, Math.floor(budget + 1e-9))
    if (maxD > 0) {
      const cands: { x: number; y: number; w: number }[] = [{ x: cx, y: cy, w: 0.25 }]
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          const d = cheb(cx, cy, x, y)
          if (d >= 1 && d <= maxD) cands.push({ x, y, w: 1 })
        }
      let r = rng() * cands.reduce((s, c) => s + c.w, 0)
      for (const c of cands) {
        r -= c.w
        if (r <= 0) {
          cx = c.x
          cy = c.y
          break
        }
      }
    }
    cursors.push({ t: tMs, type: 'cursor', x: cx, y: cy })
    prevMs = tMs
  }

  const order: Record<Note['type'], number> = { cursor: 0, click: 1, scroll: 2 }
  const notes: Note[] = [...cursors, ...clicks, ...scrolls].sort(
    (x, y) => x.t - y.t || order[x.type] - order[y.type],
  )

  // 섹션: 비트 목록에서 8마디(32비트)마다. 마지막 구간이 4마디 미만이면 앞 구간에 합친다.
  const beats = grid.beats.map(ms)
  const perSection = SECTION_BARS * 4
  const sections = [0]
  for (let i = perSection; i + perSection / 2 < beats.length; i += perSection) sections.push(beats[i])

  return {
    version: CHART_VERSION,
    generator: GENERATOR,
    difficulty,
    bpm: Math.round(grid.meanBpm * 1000) / 1000,
    beatOffsetMs: beats[0] ?? 0,
    beats,
    audioOffsetMs: 0,
    sections,
    notes,
  }
}

export interface ChartStats {
  counts: Record<Note['type'], number>
  total: number
  /** 첫 노트~마지막 노트 구간의 초당 노트 수 */
  nps: number
  /** 커서 이동 평균 속도 (칸/초) */
  cursorSpeed: number
  /** 1~10. 절대 난이도 추정치 — songs.json 의 level. 손으로 고쳐도 된다. */
  level: number
}

export function describe(chart: Chart): ChartStats {
  const counts = { cursor: 0, click: 0, scroll: 0 }
  for (const n of chart.notes) counts[n.type]++
  const total = chart.notes.length
  const first = chart.notes[0]?.t ?? 0
  const last = chart.notes[total - 1]?.t ?? 0
  const active = Math.max(1, (last - first) / 1000)
  const nps = total / active

  let moves = 0
  let speedSum = 0
  let prev: CursorNote | undefined
  for (const n of chart.notes) {
    if (n.type !== 'cursor') continue
    if (prev) {
      const dt = (n.t - prev.t) / 1000
      if (dt > 0 && dt < 2) {
        speedSum += cheb(prev.x, prev.y, n.x, n.y) / dt
        moves++
      }
    }
    prev = n
  }
  const cursorSpeed = moves ? speedSum / moves : 0
  const level = Math.max(1, Math.min(10, Math.round(0.5 + nps * 1.3 + cursorSpeed * 0.8)))
  return { counts, total, nps, cursorSpeed, level }
}

/** 생성기가 자기 규칙을 어겼는지. 위반이 있으면 파일을 쓰지 않는다. */
export function validate(chart: Chart): string[] {
  const p = PARAMS[chart.difficulty]
  const bad: string[] = []
  let prevT = -1
  for (const n of chart.notes) {
    if (!Number.isInteger(n.t)) bad.push(`t 가 정수가 아니다: ${n.t}`)
    if (n.t < prevT) bad.push(`정렬이 깨졌다: ${prevT} -> ${n.t}`)
    prevT = n.t
    if (n.type === 'cursor' && (n.x < 0 || n.x > 2 || n.y < 0 || n.y > 2))
      bad.push(`커서 칸 범위 밖: (${n.x}, ${n.y})`)
  }
  const cursors = chart.notes.filter((n): n is CursorNote => n.type === 'cursor')
  const scrolls = chart.notes.filter((n) => n.type === 'scroll')
  for (let i = 1; i < scrolls.length; i++) {
    const gap = scrolls[i].t - scrolls[i - 1].t
    if (gap < SCROLL_FLOOR_SEC * 1000 - 1) bad.push(`스크롤 간격 ${gap}ms < 200ms @${scrolls[i].t}`)
  }
  for (const s of scrolls) {
    if (cursors.some((c) => Math.abs(c.t - s.t) < SCROLL_CURSOR_EXCLUSION_SEC * 1000))
      bad.push(`스크롤이 커서 ±50ms 안: @${s.t}`)
  }
  for (let i = 1; i < cursors.length; i++) {
    const a = cursors[i - 1]
    const b = cursors[i]
    const dt = (b.t - a.t) / 1000
    const d = cheb(a.x, a.y, b.x, b.y)
    if (d > 0 && d / dt > p.vMax + 1e-6) bad.push(`커서 속도 초과 ${(d / dt).toFixed(1)} > ${p.vMax} @${b.t}`)
  }
  if (chart.sections[0] !== 0) bad.push('sections 는 0 으로 시작해야 한다')
  for (let i = 1; i < chart.beats.length; i++) {
    const d = chart.beats[i] - chart.beats[i - 1]
    if (d <= 0) bad.push(`beats 가 단조 증가가 아니다 @${chart.beats[i]}`)
  }
  return bad
}
