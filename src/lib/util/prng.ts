/**
 * 결정적 난수. 채보 생성기(Node)와 클라이언트가 같은 코드를 쓴다.
 * Math.random 은 어디서도 쓰지 않는다 — 같은 입력이 항상 같은 채보를 내야 한다 (PLAN §7⑦).
 */

/** FNV-1a, 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — 작고 빠르고 플랫폼 간 결과가 같다 (정수 연산만 쓴다). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 문자열 조각들로 시드를 만든다. `seeded(songHash, difficulty, generator)`. */
export const seeded = (...parts: string[]) => mulberry32(hash32(parts.join('|')))
