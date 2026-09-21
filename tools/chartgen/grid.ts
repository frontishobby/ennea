/**
 * 지역 비트 그리드 — 드리프트 추적 + 구간별 분할(16분 / 셋잇단).
 *
 * 전역 (BPM, 위상) 하나로는 안 된다. 디퓨전 모델 출력은 메트로놈이 없어서 128초 동안
 * ±1~2% 흔들리고, 평균 BPM 이 맞아도 고정 그리드는 뒤로 갈수록 노트를 음악 밖으로
 * 밀어낸다. 실측: 전역 그리드 정렬 36% (확률 34%) → 지역 그리드 76~81%.
 *
 * 그리고 한 곡 안에서도 분할이 바뀐다. future-core 의 브레이크다운은 16분 격자엔
 * 7~12% 밖에 안 붙는데 12분(셋잇단 8분) 격자엔 21~28% 붙었다 — 146 BPM 의 ¾ 인 109.5 BPM
 * 16분과 같은 격자다. 강도로는 절대 못 거르는 구조라 창마다 두 격자를 다 맞춰 본다.
 *
 * 방법: 8초 창(4초 간격)마다 비트 주기는 노벨티 자기상관, 격자 위상은 **정렬률을 직접
 * 최대화하는 브루트포스**(원형평균은 앞박·뒷박·16분을 한 각도로 뭉개서 약하다).
 * 정렬률의 기준선은 같은 개수의 무작위 온셋을 똑같이 최적화한 값이다 — 최대값 통계라
 * 단일 위상 확률보다 훨씬 높다. 비트 시각은 주기를 보간하며 걸어 나가고 앵커마다
 * 절반씩 당긴다. 결과는 연속적인 비트 목록 하나와 구간별 분할이다.
 */
import { mulberry32 } from '../../src/lib/util/prng.ts'
import type { Onset } from './onset.ts'
import { estimateTempo } from './tempo.ts'

export const WINDOW_SEC = 8
export const WINDOW_HOP_SEC = 4
/** 창 안에 이 개수 미만이면 그 창은 위상을 맞추지 않고 이웃을 따른다. */
export const MIN_ONSETS_PER_WINDOW = 8
/** 창 템포 추정 신뢰도 하한. 아래면 이웃 주기를 쓴다. */
export const MIN_WINDOW_CONF = 1.5
/** 위상 맞출 때 쓰는 온셋 세기 하한과 허용 오차. */
export const FIT_MIN_RATIO = 1.3
export const FIT_TOL_SEC = 0.02
/** 앵커를 지날 때 위상을 얼마나 당길지, 그리고 한 번에 최대 얼마나. */
export const PULL = 0.5
export const PULL_MAX_FRAC = 0.25
/** 귀무 기준선 반복 횟수 */
export const NULL_REPS = 5
/**
 * 리듬 신뢰도 여유 = 정렬률 − 귀무 기준선. 이 아래면 박자가 없는 구간, 이 위면 그리드를
 * 온전히 믿는다. 실측 (future-core, 귀로 검증): 맞는 창 32~53%, 틀린 창 5~22%.
 */
export const WEAK_MARGIN = 0.15
export const SOLID_MARGIN = 0.3
/** 셋잇단 격자가 16분 격자보다 이만큼 더 잘 설명해야 셋잇단 구간으로 본다. */
export const TRIPLET_EDGE = 0.05

/** 비트당 분할 수. 4 = 16분음표, 3 = 셋잇단 8분음표 */
export type Sub = 3 | 4
/** 호출자가 요청하는 격자 굵기. 1 = 비트, 2 = 8분, 4 = 16분 (셋잇단 구간에선 각각 1, 3, 3) */
export type Div = 1 | 2 | 4

export interface GridAnchor {
  /** 창 중앙(초) */
  t: number
  /** 비트 주기(초) */
  period: number
  sub: Sub
  /** 창 중앙 근처의 비트 시각(초). 위상의 절대 표현. */
  beatOrigin: number
  /** 이 창에서 실제로 위상을 맞췄는가 (온셋이 충분했는가) */
  fitted: boolean
  conf: number
  n: number
  /** 고른 격자에 센 온셋이 붙은 비율. 못 맞춘 창은 이웃 값을 물려받는다. */
  hitRate: number
  /** 귀무 기준선 — 같은 개수의 무작위 온셋을 똑같이 최적화했을 때의 정렬률 */
  nullRate: number
  /** 두 격자 각각의 여유. 진단용. */
  margin16: number
  margin12: number
}

export interface LocalGrid {
  anchors: GridAnchor[]
  /** 비트 시각 목록(초), 오름차순, 0 ~ duration 을 덮는다 */
  beats: number[]
  meanBpm: number
  bpmRange: [number, number]
  periodAt: (t: number) => number
  subAt: (t: number) => Sub
  /** div 요청을 그 구간의 분할로 환산한 실제 격자 간격(초) */
  stepAt: (t: number, div: Div) => number
  /** t 에 가장 가까운 격자 점(초) */
  nearest: (t: number, div: Div) => number
  /** t 가 속한 비트 구간 번호. 비트당 캡에 쓴다. */
  beatIndexAt: (t: number) => number
  alignment: (onsets: Onset[], div: Div, tolSec: number) => number
  /** 시각 t 주변의 리듬 신뢰도 여유. 이웃 앵커 사이 선형 보간. */
  marginAt: (t: number) => number
  weakSpans: () => [number, number][]
  tripletSpans: () => [number, number][]
}

export interface FitInput {
  novelty: Float64Array
  hopSec: number
  durationSec: number
  /** 위상 맞추기에 쓸 온셋 (보통 mid + high). 저역은 킥이 아니라 베이스 벽일 수 있어 뺀다. */
  onsets: Onset[]
  /** 센 온셋 전체 — 첫 창에서 어느 격자 점이 비트인지 고를 때 쓴다 */
  allOnsets: Onset[]
  globalBpm: number
}

/** 위상 브루트포스: [0, step) 를 1ms 로 훑어 정렬 개수가 최대인 위상. */
function fitLattice(ts: number[], step: number, tol: number): { phase: number; hits: number } {
  let best = { phase: 0, hits: -1 }
  for (let ph = 0; ph < step; ph += 0.001) {
    let hits = 0
    for (const t of ts) {
      const d = t - ph
      if (Math.abs(d - Math.round(d / step) * step) <= tol) hits++
    }
    if (hits > best.hits) best = { phase: ph, hits }
  }
  return best
}

/** 귀무 기준선: n 개를 창 안에 균일하게 뿌리고 똑같이 최적화. 시드 고정. */
function nullRateOf(n: number, t0: number, t1: number, step: number, tol: number, seed: number): number {
  const rng = mulberry32(seed)
  let sum = 0
  for (let r = 0; r < NULL_REPS; r++) {
    const fake = Array.from({ length: n }, () => t0 + rng() * (t1 - t0))
    sum += fitLattice(fake, step, tol).hits / n
  }
  return sum / NULL_REPS
}

const wrap = (d: number, p: number) => ((((d + p / 2) % p) + p) % p) - p / 2

export function fitLocalGrid(input: FitInput): LocalGrid {
  const { novelty, hopSec, durationSec, globalBpm } = input
  const strong = input.onsets.filter((o) => o.ratio >= FIT_MIN_RATIO)
  const heavy = input.allOnsets.filter((o) => o.ratio >= 2)

  // ── 1. 창별 앵커 ────────────────────────────────────────────
  const anchors: GridAnchor[] = []
  const win = Math.min(WINDOW_SEC, durationSec)
  for (let t0 = 0; ; t0 += WINDOW_HOP_SEC) {
    if (t0 > 0 && t0 + win > durationSec + 1e-9) break
    const t1 = Math.min(durationSec, t0 + win)
    const c = (t0 + t1) / 2
    const n0 = Math.floor(t0 / hopSec)
    const n1 = Math.min(novelty.length, Math.floor(t1 / hopSec))
    const inWin = strong.filter((o) => o.t >= t0 && o.t < t1)
    const prev = anchors[anchors.length - 1]
    const idx = anchors.length

    let period = prev ? prev.period : 60 / globalBpm
    let conf = 0
    if (n1 - n0 > 20) {
      const est = estimateTempo(novelty.subarray(n0, n1), hopSec, { min: globalBpm * 0.95, max: globalBpm * 1.05 })
      conf = est.confidence
      if (est.confidence >= MIN_WINDOW_CONF && inWin.length >= MIN_ONSETS_PER_WINDOW) period = est.periodSec
    }

    let sub: Sub = prev ? prev.sub : 4
    let beatOrigin: number
    let fitted = false
    let hitRate = 1
    let nullRate = 0
    let margin16 = NaN
    let margin12 = NaN

    if (inWin.length >= MIN_ONSETS_PER_WINDOW) {
      const ts = inWin.map((o) => o.t)
      const n = ts.length
      const s16 = period / 4
      const s12 = period / 3
      const tol16 = Math.min(FIT_TOL_SEC, 0.2 * s16)
      const tol12 = Math.min(FIT_TOL_SEC, 0.2 * s12)
      const f16 = fitLattice(ts, s16, tol16)
      const f12 = fitLattice(ts, s12, tol12)
      const null16 = nullRateOf(n, t0, t1, s16, tol16, 0x9e3779b1 ^ (idx * 2654435761))
      const null12 = nullRateOf(n, t0, t1, s12, tol12, 0x7f4a7c15 ^ (idx * 2654435761))
      margin16 = f16.hits / n - null16
      margin12 = f12.hits / n - null12
      sub = margin12 > margin16 + TRIPLET_EDGE ? 3 : 4
      const f = sub === 3 ? f12 : f16
      const step = sub === 3 ? s12 : s16
      hitRate = f.hits / n
      nullRate = sub === 3 ? null12 : null16
      fitted = true

      // 어느 격자 점이 비트인가. 이전 앵커가 있으면 연속성 — 예측한 비트에 가장 가까운 후보.
      // 첫 앵커면 센 온셋이 가장 많이 얹히는 후보.
      const cands = Array.from({ length: sub }, (_, j) => f.phase + j * step)
      let pick = cands[0]
      if (prev) {
        const predicted = prev.beatOrigin + Math.round((c - prev.beatOrigin) / prev.period) * prev.period
        let bestD = Infinity
        for (const cand of cands) {
          const d = Math.abs(wrap(cand - predicted, period))
          if (d < bestD) {
            bestD = d
            pick = cand
          }
        }
      } else {
        let bestV = -1
        for (const cand of cands) {
          let v = 0
          for (const o of heavy) {
            if (o.t < t0 || o.t >= t1) continue
            const d = o.t - cand
            if (Math.abs(d - Math.round(d / period) * period) <= tol16) v += o.ratio
          }
          if (v > bestV) {
            bestV = v
            pick = cand
          }
        }
      }
      beatOrigin = pick + Math.round((c - pick) / period) * period
    } else if (prev) {
      beatOrigin = prev.beatOrigin + Math.round((c - prev.beatOrigin) / prev.period) * prev.period
    } else {
      beatOrigin = c
    }

    anchors.push({ t: c, period, sub, beatOrigin, fitted, conf, n: inWin.length, hitRate, nullRate, margin16, margin12 })
    if (t1 >= durationSec) break
  }

  // 위상을 못 맞춘 창(온셋 부족)은 가장 가까운 맞춘 창의 신뢰도를 물려받는다.
  // "증거 없음"을 "완전 신뢰"로 두면 희소한 창 하나가 이웃 브레이크다운을 가려 버린다.
  const fittedOnes = anchors.filter((a) => a.fitted)
  if (fittedOnes.length)
    for (const a of anchors) {
      if (a.fitted) continue
      const near = fittedOnes.reduce((p, q) => (Math.abs(q.t - a.t) < Math.abs(p.t - a.t) ? q : p))
      a.hitRate = near.hitRate
      a.nullRate = near.nullRate
      a.sub = near.sub
    }

  // ── 2. 보간 ─────────────────────────────────────────────────
  const interp = (t: number, f: (a: GridAnchor) => number): number => {
    if (t <= anchors[0].t) return f(anchors[0])
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]
      const b = anchors[i]
      if (t <= b.t) return f(a) + (f(b) - f(a)) * ((t - a.t) / (b.t - a.t))
    }
    return f(anchors[anchors.length - 1])
  }
  const nearestAnchor = (t: number) => anchors.reduce((p, q) => (Math.abs(q.t - t) < Math.abs(p.t - t) ? q : p))
  const periodAt = (t: number) => interp(t, (a) => a.period)
  const subAt = (t: number): Sub => nearestAnchor(t).sub
  const marginAt = (t: number) => interp(t, (a) => a.hitRate - a.nullRate)

  // ── 3. 비트 걷기: 첫 맞춘 앵커에서 앞뒤로 ──────────────────────
  const first = fittedOnes[0] ?? anchors[0]
  const forward: number[] = []
  let g = first.beatOrigin
  let nextAnchor = anchors.findIndex((a) => a.t > first.t)
  while (g <= durationSec + 1e-9) {
    forward.push(g)
    const next = g + periodAt(g)
    if (nextAnchor >= 0 && nextAnchor < anchors.length && next >= anchors[nextAnchor].t) {
      const an = anchors[nextAnchor]
      if (an.fitted) {
        const target = an.beatOrigin + Math.round((next - an.beatOrigin) / an.period) * an.period
        const lim = PULL_MAX_FRAC * an.period
        g = next + Math.max(-lim, Math.min(lim, (target - next) * PULL))
      } else g = next
      nextAnchor++
    } else g = next
  }
  const backward: number[] = []
  g = first.beatOrigin
  while (true) {
    const prevT = g - periodAt(g)
    if (prevT < -1e-9) break
    backward.push(prevT)
    g = prevT
  }
  const beats = [...backward.reverse(), ...forward]

  // ── 4. 조회 ─────────────────────────────────────────────────
  /** beats[k] ≤ t 인 최대 k. t 가 첫 비트 앞이면 -1. */
  const intervalOf = (t: number): number => {
    let lo = 0
    let hi = beats.length - 1
    if (t < beats[0]) return -1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (beats[mid] <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const bounds = (k: number): [number, number] => {
    if (k < 0) return [beats[0] - periodAt(beats[0]), beats[0]]
    if (k >= beats.length - 1) return [beats[beats.length - 1], beats[beats.length - 1] + periodAt(beats[beats.length - 1])]
    return [beats[k], beats[k + 1]]
  }
  const pointsPerBeat = (t: number, div: Div): number => {
    if (div === 1) return 1
    const s = subAt(t)
    if (div === 2) return s === 3 ? 3 : 2
    return s
  }
  const stepAt = (t: number, div: Div) => periodAt(t) / pointsPerBeat(t, div)
  const nearest = (t: number, div: Div): number => {
    const [b0, b1] = bounds(intervalOf(t))
    const n = pointsPerBeat(t, div)
    let best = b0
    for (let j = 0; j <= n; j++) {
      const x = b0 + ((b1 - b0) * j) / n
      if (Math.abs(x - t) < Math.abs(best - t)) best = x
    }
    return best
  }
  const beatIndexAt = (t: number) => intervalOf(t)
  const alignment = (onsets: Onset[], div: Div, tolSec: number): number => {
    if (!onsets.length) return 0
    let hit = 0
    for (const o of onsets) if (Math.abs(nearest(o.t, div) - o.t) <= tolSec) hit++
    return hit / onsets.length
  }
  const spans = (pred: (t: number) => boolean): [number, number][] => {
    const out: [number, number][] = []
    let open: number | null = null
    for (let t = 0; t <= durationSec; t += 0.5) {
      const on = pred(t)
      if (on && open === null) open = t
      if (!on && open !== null) {
        out.push([open, t])
        open = null
      }
    }
    if (open !== null) out.push([open, durationSec])
    return out
  }

  const periods = anchors.map((a) => a.period)
  const meanPeriod = periods.reduce((s, v) => s + v, 0) / periods.length
  const bpms = periods.map((p) => 60 / p)
  return {
    anchors,
    beats,
    meanBpm: 60 / meanPeriod,
    bpmRange: [Math.min(...bpms), Math.max(...bpms)],
    periodAt,
    subAt,
    stepAt,
    nearest,
    beatIndexAt,
    alignment,
    marginAt,
    weakSpans: () => spans((t) => marginAt(t) < WEAK_MARGIN),
    tripletSpans: () => spans((t) => subAt(t) === 3),
  }
}
