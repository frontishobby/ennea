/**
 * 채보 포맷 (PLAN §8). 생성기(tools/chartgen)와 클라이언트가 같은 정의를 쓴다.
 * 이 파일은 의존성이 없어야 한다 — Node 스크립트가 그대로 import 한다.
 *
 * 파일명이 chartHash 다. 내용이 바뀌면 이름이 바뀌므로 영구 캐시가 안전하고,
 * 1v1 매칭·리플레이·기록이 전부 이 해시에 매달린다.
 */

export const CHART_VERSION = 1 as const

/** 생성기 이름+버전. 알고리즘이 바뀌면 올린다 — 시드와 해시가 같이 바뀐다. */
export const GENERATOR = 'onset-v1'

/** Expert 는 일단 없다. hard 가 천장이다. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type NoteType = 'cursor' | 'click' | 'scroll'

/** 3x3 그리드. x, y ∈ {0, 1, 2}. 판정 시점에 커서가 그 칸 안에 있으면 성공. */
export interface CursorNote {
  t: number
  type: 'cursor'
  x: number
  y: number
}

export interface ClickNote {
  t: number
  type: 'click'
  btn: 'L' | 'R'
}

export interface ScrollNote {
  t: number
  type: 'scroll'
  dir: 'up' | 'down'
}

export type Note = CursorNote | ClickNote | ScrollNote

export interface Chart {
  version: typeof CHART_VERSION
  generator: string
  difficulty: Difficulty
  /** 추정 BPM. 비트 라인 렌더와 디버깅용. */
  bpm: number
  /** 첫 비트가 놓이는 시각(ms). 그리드 = beatOffsetMs + k · 60000/bpm. */
  beatOffsetMs: number
  /** 디코더 프라이밍 등으로 인한 음원 고정 오프셋(ms). 곡마다 실측 (PLAN §5). */
  audioOffsetMs: number
  /** 1v1 구간 승부 경계(ms). 항상 0으로 시작한다 (PLAN §10). */
  sections: number[]
  /** t 오름차순. t 는 정수 ms — 부동소수점이 들어가면 해시가 흔들린다. */
  notes: Note[]
}

/**
 * 정규 직렬화. 키 순서를 고정하고 압축 JSON 으로 만든다.
 * 디스크의 채보 파일은 정확히 이 문자열이므로 sha256(파일 바이트) == chartHash 다.
 */
export function canonicalize(chart: Chart): string {
  const notes = chart.notes.map((n) => {
    if (!Number.isInteger(n.t)) throw new Error(`note.t must be an integer ms, got ${n.t}`)
    switch (n.type) {
      case 'cursor':
        return { t: n.t, type: n.type, x: n.x, y: n.y }
      case 'click':
        return { t: n.t, type: n.type, btn: n.btn }
      case 'scroll':
        return { t: n.t, type: n.type, dir: n.dir }
    }
  })
  return JSON.stringify({
    version: chart.version,
    generator: chart.generator,
    difficulty: chart.difficulty,
    bpm: chart.bpm,
    beatOffsetMs: chart.beatOffsetMs,
    audioOffsetMs: chart.audioOffsetMs,
    sections: chart.sections,
    notes,
  })
}

/** sha256 앞 16 hex. 파일명이자 기록·리플레이·1v1 매칭의 키. */
export async function chartHash(chart: Chart): Promise<string> {
  return sha256Hex(canonicalize(chart), 16)
}

export async function sha256Hex(input: string | Uint8Array, length = 64): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}
