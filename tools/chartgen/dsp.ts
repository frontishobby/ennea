/**
 * STFT 와 대역별 spectral flux (PLAN §6 ①②③).
 *
 * 프레임 2048 / hop 512 / Hann. 로그 압축 log(1 + 1000·|X|) 을 빼먹으면
 * 조용한 인트로에서 노트가 안 나온다. flux 는 대역별로 "증가분만" 합산한다 —
 * 감쇠는 온셋이 아니다.
 */

export type BandName = 'low' | 'mid' | 'high'

export interface Band {
  name: BandName
  lo: number
  hi: number
}

/** 대역 → 악기 → 노트 타입 (PLAN §6⑦). 2k~4k 는 일부러 비운다 — 경계가 애매하다. */
export const BANDS: readonly Band[] = [
  { name: 'low', lo: 20, hi: 250 }, // 킥·베이스 → scroll
  { name: 'mid', lo: 250, hi: 2000 }, // 스네어·보컬 → cursor
  { name: 'high', lo: 4000, hi: 16000 }, // 하이햇·심벌 → click
]

/** 반복 radix-2 복소 FFT. 크기는 2의 거듭제곱. */
export class FFT {
  readonly n: number
  readonly rev: Uint32Array
  readonly cosT: Float64Array
  readonly sinT: Float64Array

  constructor(n: number) {
    if (n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`)
    this.n = n
    const bits = Math.log2(n)
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cosT = new Float64Array(n / 2)
    this.sinT = new Float64Array(n / 2)
    for (let k = 0; k < n / 2; k++) {
      this.cosT[k] = Math.cos((2 * Math.PI * k) / n)
      this.sinT[k] = Math.sin((2 * Math.PI * k) / n)
    }
  }

  /** in-place. 정방향(e^{-2πi kn/N}). */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cosT, sinT } = this
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (i < j) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step
          const wr = cosT[k]
          const wi = -sinT[k]
          const a = start + j
          const b = a + half
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
  return w
}

export interface FluxOptions {
  frameSize?: number
  hop?: number
  /** 대역 경계 실험용. 기본은 BANDS. */
  bands?: readonly Band[]
  /**
   * 직전 몇 프레임의 평균과 비교할지. 1 이면 고전적 spectral flux.
   * 슈퍼소처럼 디튠된 오실레이터가 많은 믹스는 프레임마다 빈 크기가 맥놀이로 출렁여서
   * 1프레임 차분이 상시 잡음 마루를 만든다. 3프레임 평균 대비면 그게 가라앉고(ACF 1.9→2.6)
   * 깨끗한 타격은 재현율·bias 가 그대로다.
   */
  lag?: number
}

export interface Flux {
  sampleRate: number
  frameSize: number
  hop: number
  hopSec: number
  frames: number
  /** 대역별 flux, 빈 수로 정규화. 첫 프레임은 0. */
  flux: Record<BandName, Float64Array>
  /** 프레임 n 의 대표 시각(초). 윈도우 중앙 — 온셋이 창 가운데 올 때 flux 가 최대다. */
  timeOf: (n: number) => number
}

export function bandFlux(
  mono: Float32Array,
  sampleRate: number,
  { frameSize = 2048, hop = 512, bands = BANDS, lag = 3 }: FluxOptions = {},
): Flux {
  const fft = new FFT(frameSize)
  const window = hann(frameSize)
  const half = frameSize / 2
  const binHz = sampleRate / frameSize

  const ranges = bands.map((b) => {
    const lo = Math.max(1, Math.floor(b.lo / binHz))
    const hi = Math.min(half, Math.ceil(b.hi / binHz))
    return { name: b.name, lo, hi, count: Math.max(1, hi - lo) }
  })

  // 끝에 한 프레임만큼 0 을 붙여 마지막 온셋도 잡는다
  const frames = Math.floor(mono.length / hop) + 1
  const flux: Record<BandName, Float64Array> = {
    low: new Float64Array(frames),
    mid: new Float64Array(frames),
    high: new Float64Array(frames),
  }

  const re = new Float64Array(frameSize)
  const im = new Float64Array(frameSize)
  const curLog = new Float64Array(half + 1)
  const norm = 1 / half
  // 직전 lag 프레임의 로그 스펙트럼 링 버퍼와 그 합 — 평균은 합/lag
  const ring = Array.from({ length: lag }, () => new Float64Array(half + 1))
  const ringSum = new Float64Array(half + 1)
  let filled = 0

  for (let n = 0; n < frames; n++) {
    const start = n * hop
    for (let i = 0; i < frameSize; i++) {
      const s = start + i
      re[i] = s < mono.length ? mono[s] * window[i] : 0
      im[i] = 0
    }
    fft.transform(re, im)

    for (let k = 0; k <= half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm
      curLog[k] = Math.log1p(1000 * mag)
    }

    if (filled > 0) {
      const inv = 1 / filled
      for (const r of ranges) {
        let sum = 0
        for (let k = r.lo; k < r.hi; k++) {
          const d = curLog[k] - ringSum[k] * inv
          if (d > 0) sum += d
        }
        flux[r.name][n] = sum / r.count
      }
    }
    const slot = ring[n % lag]
    if (filled === lag) for (let k = 0; k <= half; k++) ringSum[k] -= slot[k]
    else filled++
    slot.set(curLog)
    for (let k = 0; k <= half; k++) ringSum[k] += slot[k]
  }

  const hopSec = hop / sampleRate
  return {
    sampleRate,
    frameSize,
    hop,
    hopSec,
    frames,
    flux,
    timeOf: (n) => (n * hop + half) / sampleRate,
  }
}
