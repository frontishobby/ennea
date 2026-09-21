/**
 * 음원 → 온셋 + 템포. 한 곡에 한 번만 돌린다. 난이도는 build.ts 가 이 결과를
 * 걸러서 만든다 — 대역별 검출을 세 번 반복할 이유가 없다.
 */
import { bandFlux, BANDS, type BandName } from './dsp.ts'
import { fitLocalGrid, type LocalGrid } from './grid.ts'
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

/**
 * 대역이 채보에 쓸 만한가. 지역 그리드에 대한 16분음표 정렬률이 확률 기준선을
 * CHARTABLE_MARGIN 이상 넘어야 한다. 실측: 킥 없는 베이스 벽은 42% vs 확률 34% (+8),
 * 리듬 있는 mid 는 76% (+37). 못 넘는 대역의 노트 타입은 만들지 않는다 —
 * 그리드에 안 붙는 온셋을 스냅하면 노트가 음악 밖으로 밀려나 소리로 바로 들린다.
 */
export const CHARTABLE_MARGIN = 0.2
export const ALIGN_TOL_SEC = 0.02

export interface BandFitness {
  /** 지역 16분 그리드 정렬률 */
  align: number
  /** 무작위 온셋이 우연히 붙을 확률 */
  chance: number
  ok: boolean
  count: number
}

export interface Analysis {
  sampleRate: number
  durationSec: number
  hopSec: number
  tempo: TempoEstimate & {
    phaseSec: number
    /** 호출자가 준 힌트. 경계에 붙어서 버렸으면 hintRejected. */
    hintBpm?: number
    hintRejected: boolean
  }
  /** 전 대역, t 오름차순 */
  onsets: Onset[]
  byBand: Record<BandName, Onset[]>
  novelty: Float64Array
  timeOf: (n: number) => number
  grid: LocalGrid
  fitness: Record<BandName, BandFitness>
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

  const free: BpmRange = opts.bpmRange ?? { min: 80, max: 200 }
  let tempo: TempoEstimate
  let hintRejected = false
  if (opts.bpmHint) {
    // 프롬프트에 적은 BPM 을 모델이 지킨다는 보장이 없다. 힌트 범위 안 추정이 경계에
    // 붙으면 진짜 값이 밖에 있다는 신호다 — 자유 탐색으로 물러난다.
    const hinted = estimateTempo(novelty, fx.hopSec, { min: opts.bpmHint * 0.92, max: opts.bpmHint * 1.08 })
    const atEdge = hinted.bpm <= opts.bpmHint * 0.92 * 1.005 || hinted.bpm >= opts.bpmHint * 1.08 * 0.995
    if (atEdge) {
      const unhinted = estimateTempo(novelty, fx.hopSec, free)
      if (unhinted.confidence >= hinted.confidence) {
        tempo = unhinted
        hintRejected = true
      } else tempo = hinted
    } else tempo = hinted
  } else tempo = estimateTempo(novelty, fx.hopSec, free)
  const phaseSec = estimatePhase(onsets, tempo.periodSec)

  // 지역 그리드는 mid + high 로 맞춘다. 저역은 킥이 아니라 베이스 벽일 수 있다.
  const grid = fitLocalGrid({
    novelty,
    hopSec: fx.hopSec,
    durationSec,
    onsets: [...byBand.mid, ...byBand.high].sort((a, b) => a.t - b.t),
    allOnsets: onsets,
    globalBpm: tempo.bpm,
  })

  const fitness = {} as Record<BandName, BandFitness>
  for (const name of ['low', 'mid', 'high'] as const) {
    const list = byBand[name]
    const align = grid.alignment(list, 4, ALIGN_TOL_SEC)
    const chance = Math.min(1, (2 * ALIGN_TOL_SEC) / (60 / grid.meanBpm / 4))
    fitness[name] = { align, chance, ok: list.length >= 8 && align - chance >= CHARTABLE_MARGIN, count: list.length }
  }

  return {
    sampleRate,
    durationSec,
    hopSec: fx.hopSec,
    tempo: { ...tempo, phaseSec, hintBpm: opts.bpmHint, hintRejected },
    onsets,
    byBand,
    novelty,
    timeOf: fx.timeOf,
    grid,
    fitness,
  }
}
