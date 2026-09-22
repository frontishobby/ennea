/**
 * 채보 포맷 (PLAN §8). 생성기(tools/chartgen)와 클라이언트가 같은 정의를 쓴다.
 * 이 파일은 의존성이 없어야 한다 — Node 스크립트가 그대로 import 한다.
 *
 * 파일명이 chartHash 다. 내용이 바뀌면 이름이 바뀌므로 영구 캐시가 안전하고,
 * 1v1 매칭·리플레이·기록이 전부 이 해시에 매달린다.
 */

export const CHART_VERSION = 2 as const

/** 생성기 이름+버전. 알고리즘이 바뀌면 올린다 — 시드와 해시가 같이 바뀐다. */
export const GENERATOR = 'onset-v3'

/**
 * 커서 좌표계. 채보는 **정규화 필드 단위**로 좌표를 적고, 게임이 화면에 맞춘다.
 * 그래야 플레이 영역 크기를 바꿔도 채보가 안 깨진다.
 *
 * 가로세로 비가 4:3 인 이유는 osu!standard 플레이필드(512×384)가 4:3 이고, 거기서
 * 채보를 들여올 것이기 때문이다. 비를 바꾸면 수입해온 에임 패턴이 가로로 눌린다.
 */
export const FIELD_W = 1000
export const FIELD_H = 750

/** Expert 는 일단 없다. hard 가 천장이다. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type NoteType = 'cursor' | 'click' | 'scroll'

/**
 * 커서 노트. x ∈ [0, FIELD_W], y ∈ [0, FIELD_H] 의 **정수**다.
 * 노트 시각 근처에 커서가 그 점 반경 안에 있으면 성공 — 타이밍이 아니라 위치 판정이다.
 * 정수여야 하는 이유는 t 와 같다: 부동소수점이 들어가면 직렬화에 따라 해시가 흔들린다.
 */
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
  /** 평균 BPM. 표시용 — 실제 그리드는 beats 다. */
  bpm: number
  /** 첫 비트 시각(ms) = beats[0]. 하위 호환·가독성용. */
  beatOffsetMs: number
  /**
   * 비트 시각 목록(ms). 템포가 곡 안에서 흔들리므로 고정 격자가 아니라 목록이다.
   * 비트 라인 렌더와 구간 경계가 여기서 나온다.
   */
  beats: number[]
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
  for (const b of chart.beats) if (!Number.isInteger(b)) throw new Error(`beats must be integer ms, got ${b}`)
  const notes = chart.notes.map((n) => {
    if (!Number.isInteger(n.t)) throw new Error(`note.t must be an integer ms, got ${n.t}`)
    switch (n.type) {
      case 'cursor':
        if (!Number.isInteger(n.x) || !Number.isInteger(n.y))
          throw new Error(`cursor note position must be integers, got (${n.x}, ${n.y})`)
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
    beats: chart.beats,
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
