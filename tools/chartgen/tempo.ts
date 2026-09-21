/**
 * BPM 추정 + 비트 위상 + 그리드 스냅 (PLAN §6⑥). 품질을 제일 크게 올리는 단계.
 *
 * 검출이 ±20ms 흔들려도 16분음표 그리드에 붙이면 리듬이 깔끔해진다.
 * 스냅 거리가 허용치보다 멀면 붙이지 않고 그대로 둔다 — 셋잇단·스윙 보존.
 */
import type { Onset } from './onset.ts'

export interface TempoEstimate {
  bpm: number
  periodSec: number
  /** 자기상관 봉우리가 RMS 대비 얼마나 두드러졌나. 3 이상이면 믿을 만하고 1.5 아래면 의심한다. */
  confidence: number
}

export interface BpmRange {
  min: number
  max: number
}

/**
 * 노벨티 곡선의 자기상관. 하모닉 콤(ACF(L) + ½ACF(2L)) 으로 8분/2분 착오를 줄이고
 * 봉우리 주변 포물선 보간으로 프레임 이하 정밀도를 얻는다.
 */
export function estimateTempo(
  novelty: Float64Array,
  hopSec: number,
  range: BpmRange = { min: 80, max: 200 },
): TempoEstimate {
  const n = novelty.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += novelty[i]
  mean /= n
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = novelty[i] - mean

  const lagMin = Math.max(2, Math.floor(60 / (range.max * hopSec)))
  const lagMax = Math.ceil(60 / (range.min * hopSec))
  const acfMax = Math.min(n - 2, lagMax * 2 + 2)
  const acf = new Float64Array(acfMax + 1)
  for (let L = lagMin; L <= acfMax; L++) {
    let s = 0
    for (let i = 0; i + L < n; i++) s += x[i] * x[i + L]
    acf[L] = s / (n - L)
  }

  const score = new Float64Array(lagMax + 2)
  let best = lagMin
  let sq = 0
  for (let L = lagMin; L <= lagMax; L++) {
    score[L] = acf[L] + 0.5 * (2 * L <= acfMax ? acf[2 * L] : 0)
    sq += score[L] * score[L]
    if (score[L] > score[best]) best = L
  }

  // 포물선 보간
  let lag = best
  if (best > lagMin && best < lagMax) {
    const a = score[best - 1]
    const b = score[best]
    const c = score[best + 1]
    const denom = a - 2 * b + c
    if (Math.abs(denom) > 1e-12) lag = best + (0.5 * (a - c)) / denom
  }

  const periodSec = lag * hopSec
  // 평균을 뺀 ACF 는 음수가 흔하므로 RMS 대비 봉우리 높이로 본다. 1 근처면 봉우리가 없다.
  const rms = Math.sqrt(sq / (lagMax - lagMin + 1))
  return {
    bpm: 60 / periodSec,
    periodSec,
    confidence: rms > 0 ? score[best] / rms : 0,
  }
}

/**
 * 비트 위상. 온셋들을 단위원에 올려 원형 평균을 낸다 — 이상치에 강하고 정렬이 필요 없다.
 * 킥이 비트에 놓이므로 저역 온셋을 쓰고, 너무 적으면 전 대역으로 물러난다.
 */
export function estimatePhase(onsets: Onset[], periodSec: number): number {
  let pool = onsets.filter((o) => o.band === 'low')
  if (pool.length < 8) pool = onsets
  let sx = 0
  let sy = 0
  for (const o of pool) {
    const w = o.ratio - 1
    const th = (2 * Math.PI * o.t) / periodSec
    sx += w * Math.cos(th)
    sy += w * Math.sin(th)
  }
  let phase = (Math.atan2(sy, sx) / (2 * Math.PI)) * periodSec
  if (phase < 0) phase += periodSec
  return phase
}

export interface Snapped {
  t: number
  snapped: boolean
}

export function snapToGrid(t: number, phaseSec: number, stepSec: number, tolSec: number): Snapped {
  const k = Math.round((t - phaseSec) / stepSec)
  const g = phaseSec + k * stepSec
  return Math.abs(t - g) <= tolSec ? { t: g, snapped: true } : { t, snapped: false }
}
