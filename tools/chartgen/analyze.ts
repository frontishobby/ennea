/**
 * 음원 → 온셋 + 템포. 한 곡에 한 번만 돌린다. 난이도는 build.ts 가 이 결과를
 * 걸러서 만든다 — 대역별 검출을 세 번 반복할 이유가 없다.
 */
import { bandFlux, BANDS, type BandName } from './dsp.ts'
import { medianThreshold, pickPeaks, type Onset, type ThresholdParams } from './onset.ts'
import { estimatePhase, estimateTempo, type BpmRange, type TempoEstimate } from './tempo.ts'

/**
 * 검출 시각 보정(초). 검출값에 더한다. selftest 가 합성 신호로 실측한 값 —
 * 창 중앙을 대표 시각으로 쓰면 flux 봉우리가 실제 어택보다 5ms 쯤 앞선다.
 * 그리드 스냅이 대부분 흡수하지만, 스냅 안 되는 노트(셋잇단·스윙)에는 그대로 남는다.
 */
export const DETECTION_OFFSET_SEC = 0.005

/**
 * 같은 타격을 한 타격으로 보는 창. 킥의 클릭 트랜지언트는 고역까지 번지고
 * 스네어 노이즈는 저역까지 내려온다 — 대역마다 따로 잡히면 노트가 세 배가 된다.
 */
export const CLUSTER_SEC = 0.025
/** 지배 대역이 아닌 대역이 같이 살아남으려면(동시 타격) 자기 비율이 이만큼은 돼야 한다. */
export const SECONDARY_MIN_RATIO = 2.0
export const SECONDARY_REL = 0.6
/** 파일 양끝에서 이만큼은 버린다. */
export const EDGE_SEC = 0.06

/**
 * 대역별 기본 임계값. α 는 낮게 잡아 많이 잡고, 난이도별 ratio 컷으로 솎아낸다.
 * δ 는 무음·지속음에서 아무것도 안 나오게 하는 바닥이다.
 */
export const BASE_THRESHOLD: Record<BandName, ThresholdParams> = {
  low: { delta: 0.05, alpha: 1.2, windowSec: 0.3 },
  mid: { delta: 0.04, alpha: 1.2, windowSec: 0.3 },
  high: { delta: 0.04, alpha: 1.2, windowSec: 0.3 },
}

/** 피크 최소 간격. 이보다 촘촘한 건 같은 타격의 잔향이다. */
export const PEAK_MIN_GAP_SEC = 0.03

export interface AnalyzeOptions {
  /** 곡의 의도 BPM 을 알면 ±8% 안에서만 찾는다. 8분/2분 착오가 사라진다. */
  bpmHint?: number
  bpmRange?: BpmRange
}

export interface Analysis {
  sampleRate: number
  durationSec: number
  hopSec: number
  tempo: TempoEstimate & { phaseSec: number }
  /** 전 대역, t 오름차순 */
  onsets: Onset[]
  byBand: Record<BandName, Onset[]>
  novelty: Float64Array
  timeOf: (n: number) => number
}

/**
 * 대역 배정 (PLAN §6⑦의 실제 구현). ±CLUSTER_SEC 안의 검출을 한 타격으로 묶고,
 * sf/thr 비율이 가장 큰 대역이 그 타격을 가져간다. 다른 대역은 자기 비율이 충분히
 * 클 때만 — 진짜 동시 타격(킥+햇)일 때만 — 같이 남는다.
 */
export function resolveBands(all: Onset[]): Onset[] {
  const out: Onset[] = []
  let i = 0
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1].t - all[i].t < CLUSTER_SEC) j++
    let top = all[i]
    for (let k = i + 1; k <= j; k++) if (all[k].ratio > top.ratio) top = all[k]
    for (let k = i; k <= j; k++) {
      const o = all[k]
      if (o === top || o.ratio >= Math.max(SECONDARY_MIN_RATIO, SECONDARY_REL * top.ratio)) out.push(o)
    }
    i = j + 1
  }
  return out
}

export function analyze(mono: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): Analysis {
  const fx = bandFlux(mono, sampleRate)

  const byBand = { low: [] as Onset[], mid: [] as Onset[], high: [] as Onset[] }
  const novelty = new Float64Array(fx.frames)

  for (const band of BANDS) {
    const sf = fx.flux[band.name]
    const thr = medianThreshold(sf, fx.hopSec, BASE_THRESHOLD[band.name])
    byBand[band.name] = pickPeaks(sf, thr, band.name, fx.timeOf, PEAK_MIN_GAP_SEC, -DETECTION_OFFSET_SEC)
    for (let n = 0; n < fx.frames; n++) {
      const e = sf[n] - thr[n]
      if (e > 0) novelty[n] += e
    }
  }

  // 파일 끝의 하드컷은 스펙트럼 전체로 튀어 가짜 온셋이 된다. 어차피 칠 수 없는 구간이다.
  const durationSec = mono.length / sampleRate
  const inRange = (o: Onset) => o.t >= 0 && o.t <= durationSec - EDGE_SEC
  const onsets = resolveBands(
    [...byBand.low, ...byBand.mid, ...byBand.high].filter(inRange).sort((a, b) => a.t - b.t),
  )
  for (const name of ['low', 'mid', 'high'] as const) byBand[name] = onsets.filter((o) => o.band === name)

  const range: BpmRange = opts.bpmHint
    ? { min: opts.bpmHint * 0.92, max: opts.bpmHint * 1.08 }
    : (opts.bpmRange ?? { min: 80, max: 200 })
  const tempo = estimateTempo(novelty, fx.hopSec, range)
  const phaseSec = estimatePhase(onsets, tempo.periodSec)

  return {
    sampleRate,
    durationSec,
    hopSec: fx.hopSec,
    tempo: { ...tempo, phaseSec },
    onsets,
    byBand,
    novelty,
    timeOf: fx.timeOf,
  }
}
