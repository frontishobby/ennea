/**
 * WAV 읽기/쓰기. 의존성 없이 직접 파싱한다.
 * 읽기: PCM 16/24/32bit, float 32/64bit, 채널 수 무관 (평균으로 모노 다운믹스).
 * 쓰기: PCM 16bit 모노 — 프리뷰 클릭 트랙용.
 */
import { readFileSync, writeFileSync } from 'node:fs'

export interface WavData {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** 채널 평균 모노, [-1, 1] */
  mono: Float32Array
  durationSec: number
}

export function readWav(path: string): WavData {
  const buf = readFileSync(path)
  if (
    buf.length < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(`${path}: RIFF/WAVE 헤더가 아니다`)
  }

  let fmt: { code: number; channels: number; sampleRate: number; bits: number } | undefined
  let data: { start: number; length: number } | undefined
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      let code = buf.readUInt16LE(body)
      const channels = buf.readUInt16LE(body + 2)
      const sampleRate = buf.readUInt32LE(body + 4)
      const bits = buf.readUInt16LE(body + 14)
      // WAVE_FORMAT_EXTENSIBLE — 실제 포맷 코드는 SubFormat GUID 앞 2바이트
      if (code === 0xfffe && size >= 40) code = buf.readUInt16LE(body + 24)
      fmt = { code, channels, sampleRate, bits }
    } else if (id === 'data') {
      data = { start: body, length: Math.min(size, buf.length - body) }
    }
    off = body + size + (size & 1)
  }
  if (!fmt || !data) throw new Error(`${path}: fmt 또는 data 청크가 없다`)

  const { code, channels, sampleRate, bits } = fmt
  const bytes = bits / 8
  const frames = Math.floor(data.length / (bytes * channels))
  const mono = new Float32Array(frames)
  const inv = 1 / channels
  let p = data.start

  if (code === 1 && bits === 16) {
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) {
        s += buf.readInt16LE(p)
        p += 2
      }
      mono[i] = (s * inv) / 32768
    }
  } else if (code === 1 && bits === 24) {
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) {
        let v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
        if (v & 0x800000) v -= 0x1000000
        s += v
        p += 3
      }
      mono[i] = (s * inv) / 8388608
    }
  } else if (code === 1 && bits === 32) {
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) {
        s += buf.readInt32LE(p)
        p += 4
      }
      mono[i] = (s * inv) / 2147483648
    }
  } else if (code === 3 && bits === 32) {
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) {
        s += buf.readFloatLE(p)
        p += 4
      }
      mono[i] = s * inv
    }
  } else if (code === 3 && bits === 64) {
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) {
        s += buf.readDoubleLE(p)
        p += 8
      }
      mono[i] = s * inv
    }
  } else {
    throw new Error(`${path}: 지원하지 않는 WAV 포맷 (code ${code}, ${bits}bit)`)
  }

  return { sampleRate, channels, bitsPerSample: bits, mono, durationSec: frames / sampleRate }
}

export function writeWavPcm16(path: string, mono: Float32Array, sampleRate: number): void {
  const n = mono.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}
