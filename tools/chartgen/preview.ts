/**
 * 귀로 검증하기 위한 클릭 트랙. 원곡 위에 노트 타입별로 다른 소리를 얹는다.
 *   cursor → 1.2kHz 톡, click → 3kHz 틱, scroll → 250Hz 툭
 * M3 의 목적은 "노트가 음악에 맞게 떨어지는가"를 귀로 확인하는 것이다 (PLAN §13).
 */
import type { Chart } from '../../src/lib/chart.ts'

const VOICES = {
  cursor: { hz: 1200, lenSec: 0.03, amp: 0.55 },
  click: { hz: 3000, lenSec: 0.015, amp: 0.45 },
  scroll: { hz: 250, lenSec: 0.06, amp: 0.7 },
} as const

export function renderPreview(mono: Float32Array, sampleRate: number, chart: Chart): Float32Array {
  const out = new Float32Array(mono.length)
  for (let i = 0; i < mono.length; i++) out[i] = mono[i] * 0.45

  for (const note of chart.notes) {
    const v = VOICES[note.type]
    const start = Math.round((note.t / 1000) * sampleRate)
    const len = Math.round(v.lenSec * sampleRate)
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.exp((-4 * i) / len)
      out[start + i] += v.amp * env * Math.sin((2 * Math.PI * v.hz * i) / sampleRate)
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]))
  return out
}
