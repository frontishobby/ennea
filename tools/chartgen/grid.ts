/**
 * 지역 비트 그리드 — 드리프트 추적.
 *
 * 전역 (BPM, 위상) 하나로는 안 된다. 디퓨전 모델 출력은 메트로놈이 없어서 128초 동안
 * ±1~2% 흔들리고, 평균 BPM 이 맞아도 고정 그리드는 뒤로 갈수록 노트를 음악 밖으로
 * 밀어낸다. 실측: 전역 그리드 정렬 36% (확률 34%) → 지역 그리드 76~81%.
 *
 * 방법: 8초 창(4초 간격)마다 (16분음표 간격, 위상)을 맞춘다. 간격은 창 노벨티의
 * 자기상관, 위상은 원형평균이 아니라 **정렬률을 직접 최대화하는 브루트포스**다 —
 * 원형평균은 앞박·뒷박·16분을 한 각도로 뭉개서 약하다. 창 사이는 간격을 선형 보간하며
 * 그리드 점을 걸어 나가고, 앵커를 지날 때마다 그 창의 위상 쪽으로 절반만 당긴다.
 * 결과는 연속적인 16분음표 시각 목록 하나다.
 */
import { mulberry32 } from '../../src/lib/util/prng.ts'
import type { Onset } from './onset.ts'
import { estimateTempo } from './tempo.ts'

export const WINDOW_SEC = 8
export const WINDOW_HOP_SEC = 4
/** 창 안에 이 개수 미만이면 그 창은 위상을 맞추지 않고 이웃을 따른다. */
export const MIN_ONSETS_PER_WINDOW = 8
/** 창 템포 추정 신뢰도 하한. 아래면 이웃 간격을 쓴다. */
export const MIN_WINDOW_CONF = 1.5
/** 위상 맞출 때 쓰는 온셋 세기 하한과 허용 오차. */
export const FIT_MIN_RATIO = 1.3
export const FIT_TOL_SEC = 0.02
/** 앵커를 지날 때 위상을 얼마나 당길지, 그리고 한 번에 최대 얼마나. */
export const PULL = 0.5
export const PULL_MAX_FRAC = 0.25

export interface GridAnchor {
  /** 창 중앙(초) */
  t: number
  /** 16분음표 간격(초) */
  step: number
  /** 창 중앙 근처의 그리드 점(초). 위상의 절대 표현. */
  origin: number
  /** 이 창에서 실제로 위상을 맞췄는가 (온셋이 충분했는가) */
  fitted: boolean
  conf: number
  n: number
  /** 맞춘 그리드에 센 온셋이 붙은 비율. 못 맞춘 창은 1 — 반박할 증거가 없다. */
  hitRate: number
  /**
   * 귀무 기준선. 같은 개수의 온셋을 무작위 시각으로 바꿔 똑같이 위상을 최적화했을 때의
   * 정렬률(5회 평균). 위상을 훑어 최대를 고르는 통계라 단일 위상 확률(2·tol/step)보다
   * 훨씬 높다 — 그걸 기준으로 쓰면 박자 없는 창도 "괜찮음"으로 통과한다.
   */
  nullRate: number
  /** 단일 위상 확률 2·tol/step. 참고용. */
  chance: number
}

export interface LocalGrid {
  anchors: GridAnchor[]
  /** 16분음표 시각 목록(초), 오름차순, 0 ~ duration 을 덮는다 */
  sixteenths: number[]
  /** 비트 시각 목록(초). sixteenths 의 4개마다 하나 — 어느 것이 비트인지는 센 온셋이 정한다. */
  beats: number[]
  /** sixteenths 에서 비트가 되는 인덱스의 나머지 (0~3) */
  beatBase: number
  meanBpm: number
  bpmRange: [number, number]
  /** 임의 시각의 지역 16분음표 간격 */
  stepAt: (t: number) => number
  /** div: 4 = 16분, 2 = 8분, 1 = 비트. 가장 가까운 그리드 점(초). */
  nearest: (t: number, div: 1 | 2 | 4) => number
  /** 그 그리드 점의 비트 인덱스 (몇 번째 비트 구간인가). 비트당 캡에 쓴다. */
  beatIndexAt: (t: number) => number
  /** 온셋들이 그리드에 얼마나 붙는가. 확률 기준선은 2·tol/step. */
  alignment: (onsets: Onset[], div: 1 | 2 | 4, tolSec: number) => number
  /**
   * 시각 t 주변의 리듬 신뢰도 = (정렬률 − 귀무 기준선). 이웃 앵커 사이 선형 보간.
   * 0.3 이상이면 그리드를 믿고, 0.1 아래면 박자가 없는 구간이다 — 브레이크다운, 라이저, 앰비언트.
   */
  marginAt: (t: number) => number
  /** marginAt < WEAK_MARGIN 인 구간들(초). 보고용. */
  weakSpans: () => [number, number][]
}

/**
 * 이 아래면 그 구간에는 박자가 없다고 본다. 이 위면 그리드를 온전히 믿는다. 사이는 선형.
 * 실측 (future-core, 귀로 검증): 귀로 맞는 창은 여유 32~53%, 귀로 틀린 브레이크다운 창은
 * 5~22% 였고 대부분 12% 아래였다. 두 무리 사이 빈틈에 WEAK 를 둔다.
 */
export const WEAK_MARGIN = 0.15
export const SOLID_MARGIN = 0.3

export interface FitInput {
  novelty: Float64Array
  hopSec: number
  durationSec: number
  /** 위상 맞추기에 쓸 온셋 (보통 mid + high). 저역은 베이스 벽일 수 있어 뺀다. */
  onsets: Onset[]
  /** 센 온셋 전체 — 어느 16분음표가 비트인지 고를 때 쓴다 */
  allOnsets: Onset[]
  globalBpm: number
}

/** 귀무 기준선 반복 횟수 */
export const NULL_REPS = 5

/** 위상 브루트포스: [0, step) 를 1ms 로 훑어 정렬 개수가 최대인 위상. */
function fitPhase(ts: number[], step: number, tol: number): { phase: number; hits: number } {
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

export function fitLocalGrid(input: FitInput): LocalGrid {
  const { novelty, hopSec, durationSec, globalBpm } = input
  const strong = input.onsets.filter((o) => o.ratio >= FIT_MIN_RATIO)
  const globalStep = 60 / globalBpm / 4

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

    let step = prev ? prev.step : globalStep
    let conf = 0
    if (n1 - n0 > 20) {
      const est = estimateTempo(novelty.subarray(n0, n1), hopSec, {
        min: globalBpm * 0.95,
        max: globalBpm * 1.05,
      })
      conf = est.confidence
      if (est.confidence >= MIN_WINDOW_CONF && inWin.length >= MIN_ONSETS_PER_WINDOW) step = est.periodSec / 4
    }

    let origin: number
    let fitted = false
    let hitRate = 1
    let nullRate = 0
    const tol = Math.min(FIT_TOL_SEC, 0.2 * step)
    if (inWin.length >= MIN_ONSETS_PER_WINDOW) {
      const fit = fitPhase(inWin.map((o) => o.t), step, tol)
      origin = fit.phase + Math.round((c - fit.phase) / step) * step
      fitted = true
      hitRate = fit.hits / inWin.length
      // 귀무: 같은 n 개를 창 안에 균일하게 뿌리고 똑같이 최적화. 창 번호로 시드를 고정한다.
      const rng = mulberry32(0x9e3779b1 ^ (anchors.length * 2654435761))
      let sum = 0
      for (let r = 0; r < NULL_REPS; r++) {
        const fake = inWin.map(() => t0 + rng() * (t1 - t0))
        sum += fitPhase(fake, step, tol).hits / inWin.length
      }
      nullRate = sum / NULL_REPS
    } else if (prev) {
      origin = prev.origin + Math.round((c - prev.origin) / prev.step) * prev.step
    } else {
      origin = c
    }
    anchors.push({ t: c, step, origin, fitted, conf, n: inWin.length, hitRate, nullRate, chance: Math.min(1, (2 * tol) / step) })
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
    }

  // ── 2. 간격 보간 ────────────────────────────────────────────
  const stepAt = (t: number): number => {
    if (t <= anchors[0].t) return anchors[0].step
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]
      const b = anchors[i]
      if (t <= b.t) {
        const u = (t - a.t) / (b.t - a.t)
        return a.step + (b.step - a.step) * u
      }
    }
    return anchors[anchors.length - 1].step
  }

  // ── 3. 그리드 걷기: 첫 앵커 원점에서 앞뒤로 ─────────────────
  const first = anchors.find((a) => a.fitted) ?? anchors[0]
  const forward: number[] = []
  let g = first.origin
  let nextAnchor = anchors.findIndex((a) => a.t > first.t)
  while (g <= durationSec + 1e-9) {
    forward.push(g)
    const next = g + stepAt(g)
    // 앵커를 지나면 그 창의 위상 쪽으로 절반만 당긴다. 위상을 못 맞춘 창은 건너뛴다.
    if (nextAnchor >= 0 && nextAnchor < anchors.length && next >= anchors[nextAnchor].t) {
      const an = anchors[nextAnchor]
      if (an.fitted) {
        const target = an.origin + Math.round((next - an.origin) / an.step) * an.step
        const err = target - next
        const lim = PULL_MAX_FRAC * an.step
        g = next + Math.max(-lim, Math.min(lim, err * PULL))
      } else g = next
      nextAnchor++
    } else g = next
  }
  const backward: number[] = []
  g = first.origin
  while (true) {
    const prevT = g - stepAt(g)
    if (prevT < -1e-9) break
    backward.push(prevT)
    g = prevT
  }
  const sixteenths = [...backward.reverse(), ...forward]

  // ── 4. 어느 16분음표가 비트인가: 센 온셋(ratio≥2)이 가장 많이 얹히는 나머지 ──
  const heavy = input.allOnsets.filter((o) => o.ratio >= 2)
  const idxOf = (t: number) => {
    let lo = 0
    let hi = sixteenths.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sixteenths[mid] < t) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && Math.abs(sixteenths[lo - 1] - t) < Math.abs(sixteenths[lo] - t)) return lo - 1
    return lo
  }
  const votes = [0, 0, 0, 0]
  for (const o of heavy) {
    const i = idxOf(o.t)
    if (Math.abs(sixteenths[i] - o.t) <= FIT_TOL_SEC) votes[i & 3] += o.ratio
  }
  let beatBase = 0
  for (let r = 1; r < 4; r++) if (votes[r] > votes[beatBase]) beatBase = r
  const beats = sixteenths.filter((_, i) => (i & 3) === beatBase)

  const nearest = (t: number, div: 1 | 2 | 4): number => {
    const i = idxOf(t)
    const mod = 4 / div
    // 허용되는 인덱스: (i - beatBase) % mod === 0. 좌우로 가장 가까운 허용 인덱스를 찾는다.
    const ok = (k: number) => k >= 0 && k < sixteenths.length && (((k - beatBase) % mod) + mod) % mod === 0
    let best = -1
    for (let d = 0; d < mod && best < 0; d++) {
      const cands = [i - d, i + d].filter(ok)
      if (cands.length) best = cands.reduce((p, q) => (Math.abs(sixteenths[q] - t) < Math.abs(sixteenths[p] - t) ? q : p))
    }
    return sixteenths[best < 0 ? i : best]
  }

  const beatIndexAt = (t: number): number => {
    const i = idxOf(t)
    return Math.floor((i - beatBase) / 4)
  }

  const alignment = (onsets: Onset[], div: 1 | 2 | 4, tolSec: number): number => {
    if (!onsets.length) return 0
    let hit = 0
    for (const o of onsets) if (Math.abs(nearest(o.t, div) - o.t) <= tolSec) hit++
    return hit / onsets.length
  }

  const marginOf = (a: GridAnchor) => a.hitRate - a.nullRate
  const marginAt = (t: number): number => {
    if (t <= anchors[0].t) return marginOf(anchors[0])
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]
      const b = anchors[i]
      if (t <= b.t) {
        const u = (t - a.t) / (b.t - a.t)
        return marginOf(a) + (marginOf(b) - marginOf(a)) * u
      }
    }
    return marginOf(anchors[anchors.length - 1])
  }
  const weakSpans = (): [number, number][] => {
    const spans: [number, number][] = []
    let open: number | null = null
    for (let t = 0; t <= durationSec; t += 0.5) {
      const weak = marginAt(t) < WEAK_MARGIN
      if (weak && open === null) open = t
      if (!weak && open !== null) {
        spans.push([open, t])
        open = null
      }
    }
    if (open !== null) spans.push([open, durationSec])
    return spans
  }

  const steps = anchors.map((a) => a.step)
  const meanStep = steps.reduce((s, v) => s + v, 0) / steps.length
  const bpms = steps.map((s) => 60 / (4 * s))
  return {
    anchors,
    sixteenths,
    beats,
    beatBase,
    meanBpm: 60 / (4 * meanStep),
    bpmRange: [Math.min(...bpms), Math.max(...bpms)],
    stepAt,
    nearest,
    beatIndexAt,
    alignment,
    marginAt,
    weakSpans,
  }
}
