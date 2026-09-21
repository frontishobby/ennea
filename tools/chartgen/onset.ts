/**
 * 적응형 임계값 + 피크 피킹 (PLAN §6 ④⑤).
 *
 *   thr[n] = δ + α · median(SF[n-w : n+w])      w ≈ ±0.3초
 *
 * 고정 임계값은 절대 금지 — 조용한 벌스와 터지는 후렴이 한 곡에 있다.
 */
import type { BandName } from './dsp.ts'

export interface Onset {
  /** 초. 검출 지연 보정 후. */
  t: number
  band: BandName
  sf: number
  thr: number
  /** sf / thr. 항상 ≥ 1. 난이도별 밀도 조절의 기준. */
  ratio: number
}

export interface ThresholdParams {
  delta: number
  alpha: number
  windowSec: number
}

export function medianThreshold(
  sf: Float64Array,
  hopSec: number,
  { delta, alpha, windowSec }: ThresholdParams,
): Float64Array {
  const n = sf.length
  const w = Math.max(1, Math.round(windowSec / hopSec))
  const thr = new Float64Array(n)
  const buf = new Float64Array(2 * w + 1)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w)
    const hi = Math.min(n - 1, i + w)
    const len = hi - lo + 1
    const view = buf.subarray(0, len)
    view.set(sf.subarray(lo, hi + 1))
    view.sort()
    const median = len & 1 ? view[len >> 1] : 0.5 * (view[(len >> 1) - 1] + view[len >> 1])
    thr[i] = delta + alpha * median
  }
  return thr
}

/**
 * 봉우리 직후의 감쇠 마스크. 킥의 피치 스윕 꼬리, 스네어 노이즈의 미세 봉우리는
 * 임계값은 넘지만 직전 타격의 몇 분의 일이다 — 그건 새 타격이 아니라 잔향이다.
 * 직전 봉우리 세기의 MASK_REL 배에서 시작해 τ 로 지수 감쇠하는 문턱을 추가로 건다.
 *   32ms 뒤: 0.40배 필요 → 킥 꼬리(1/13)는 죽고
 *   86ms 뒤: 0.20배 필요 → 174 BPM 16분 햇(같은 세기)은 산다
 */
export const MASK_REL = 0.6
export const MASK_TAU_SEC = 0.08

/**
 * 임계값 초과 + 국소 최대 + 최소 간격 + 감쇠 마스크.
 * 오른쪽은 strict 비교 — 평평한 봉우리가 두 번 잡히지 않게.
 */
export function pickPeaks(
  sf: Float64Array,
  thr: Float64Array,
  band: BandName,
  timeOf: (n: number) => number,
  minGapSec: number,
  latencySec = 0,
): Onset[] {
  const out: Onset[] = []
  const n = sf.length
  for (let i = 1; i < n - 1; i++) {
    const v = sf[i]
    if (v <= thr[i] || v < sf[i - 1] || v <= sf[i + 1]) continue
    const onset: Onset = { t: timeOf(i) - latencySec, band, sf: v, thr: thr[i], ratio: v / thr[i] }
    const last = out[out.length - 1]
    if (last) {
      const dt = onset.t - last.t
      if (dt < minGapSec) {
        if (onset.ratio > last.ratio) out[out.length - 1] = onset
        continue
      }
      if (v < last.sf * MASK_REL * Math.exp(-dt / MASK_TAU_SEC)) continue
    }
    out.push(onset)
  }
  return out
}
