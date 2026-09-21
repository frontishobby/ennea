/** FNV-1a, 32-bit. Deterministic and tiny. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A song's signature hue, derived from its slug. scripts/gen-covers.ts
 * paints the placeholder jacket with it and the select screen lights the
 * backdrop with it, so the two always agree. When real cover art lands,
 * this gets replaced by a colour sampled from the image.
 */
export const hueOf = (slug: string) => hash32(slug) % 360
