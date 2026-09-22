/**
 * 판정 (PLAN §4). 타입마다 판정 방식이 다르다.
 *
 * click·scroll 은 **타이밍 판정** — 입력 시각과 노트 시각의 차이.
 * cursor 는 **위치 판정** — 노트 시각에 커서가 그 칸 안에 있었는가. 타이밍이 아니다.
 * 이 둘은 완전히 다른 코드 경로이고, 섞으면 둘 다 틀린다.
 */
import type { Note } from '../chart.ts'

export const GRADES = ['perfect', 'great', 'good', 'miss'] as const
export type Grade = (typeof GRADES)[number]

/** 타이밍 판정 창(ms). 실측으로 다시 볼 값이다 (PLAN §15). */
export const WINDOW: Record<Exclude<Grade, 'miss'>, number> = {
  perfect: 40,
  great: 80,
  good: 130,
}
/** 이 밖이면 입력이 그 노트에 닿지 않는다. */
export const MISS_AFTER = WINDOW.good

export const SCORE: Record<Grade, number> = { perfect: 300, great: 200, good: 100, miss: 0 }
/** 정확도 계산용 가중치. */
export const ACCURACY: Record<Grade, number> = { perfect: 1, great: 0.7, good: 0.35, miss: 0 }

export function gradeTiming(deltaMs: number): Grade {
  const d = Math.abs(deltaMs)
  if (d <= WINDOW.perfect) return 'perfect'
  if (d <= WINDOW.great) return 'great'
  if (d <= WINDOW.good) return 'good'
  return 'miss'
}

export interface Judgement {
  note: Note
  grade: Grade
  /** 타이밍 판정만. 양수면 늦게 쳤다. 커서 노트는 0. */
  deltaMs: number
}

export interface Tally {
  perfect: number
  great: number
  good: number
  miss: number
  score: number
  combo: number
  maxCombo: number
  /** 0~1 */
  accuracy: number
}

export const emptyTally = (): Tally => ({
  perfect: 0,
  great: 0,
  good: 0,
  miss: 0,
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 1,
})

export function applyJudgement(t: Tally, grade: Grade): void {
  t[grade]++
  t.score += SCORE[grade]
  t.combo = grade === 'miss' ? 0 : t.combo + 1
  t.maxCombo = Math.max(t.maxCombo, t.combo)
  const judged = t.perfect + t.great + t.good + t.miss
  t.accuracy =
    (t.perfect * ACCURACY.perfect + t.great * ACCURACY.great + t.good * ACCURACY.good) / judged
}
