/**
 * Placeholder jacket art, 1024x1024, built out of the same rounded squares
 * as the rest of the game. Deterministic from the slug, so a cover never
 * changes under a cached client. Run: npm run gen:covers
 *
 * Real cover art replaces these at M8; only the file extension in
 * src/lib/paths.ts changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hash32, hueOf } from '../src/lib/design/hue.ts'
import { CURVE } from '../src/lib/design/curve.ts'

const SIZE = 1024
const PAD = 92

/** mulberry32 — small, fast, and identical across runs. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cover(slug: string): string {
  const seed = hash32(slug)
  const rand = rng(seed)
  const hue = hueOf(slug)

  const deep = `hsl(${hue} 64% 8%)`
  const lift = `hsl(${(hue + 32) % 360} 56% 22%)`
  const accent = `hsl(${hue} 92% 63%)`
  const counter = `hsl(${(hue + 148) % 360} 86% 66%)`
  const outline = `hsl(${hue} 76% 54%)`

  // Lattice density carries most of the variety between covers: a 2x2 reads
  // as bold blocks, a 5x5 as fine texture.
  const n = 2 + (seed % 4)
  const gap = n <= 3 ? 34 : 22
  const cell = (SIZE - PAD * 2 - gap * (n - 1)) / n
  const r = (cell * CURVE).toFixed(1)
  const at = (i: number) => PAD + i * (cell + gap)

  const squares: string[] = []
  const taken = new Set<string>()

  // One oversized square anchors the composition so covers don't read as a
  // uniform mesh. Not on a 2x2 — there it would swallow the whole cover.
  if (n >= 3) {
    const row = Math.floor(rand() * (n - 1))
    const col = Math.floor(rand() * (n - 1))
    const span = cell * 2 + gap
    for (const dr of [0, 1]) for (const dc of [0, 1]) taken.add(`${row + dr},${col + dc}`)
    squares.push(
      `  <rect x="${at(col)}" y="${at(row)}" width="${span}" height="${span}" rx="${(span * CURVE).toFixed(1)}" ry="${(span * CURVE).toFixed(1)}" fill="${counter}" opacity="0.94" />`,
    )
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (taken.has(`${row},${col}`)) continue
      const roll = rand()
      const shared = `x="${at(col)}" y="${at(row)}" width="${cell}" height="${cell}" rx="${r}" ry="${r}"`
      if (roll < 0.3) squares.push(`  <rect ${shared} fill="${accent}" opacity="0.92" />`)
      else if (roll < 0.4) squares.push(`  <rect ${shared} fill="${counter}" opacity="0.7" />`)
      else if (roll < 0.52) squares.push(`  <rect ${shared} fill="${accent}" opacity="0.2" />`)
      else
        squares.push(
          `  <rect ${shared} fill="none" stroke="${outline}" stroke-width="${n <= 3 ? 8 : 5}" opacity="0.45" />`,
        )
    }
  }

  const flip = seed & 1
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${slug} placeholder cover">
  <defs>
    <linearGradient id="bg" x1="${flip ? 1 : 0}" y1="0" x2="${flip ? 0 : 1}" y2="1">
      <stop offset="0" stop-color="${deep}" />
      <stop offset="1" stop-color="${lift}" />
    </linearGradient>
    <radialGradient id="glow" cx="${flip ? 0.7 : 0.32}" cy="0.38" r="0.68">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.24" />
      <stop offset="1" stop-color="${accent}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)" />
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)" />
${squares.join('\n')}
</svg>
`
}

const index = JSON.parse(readFileSync('static/songs.json', 'utf8')) as { songs: { slug: string }[] }
for (const { slug } of index.songs) {
  mkdirSync(`static/songs/${slug}`, { recursive: true })
  writeFileSync(`static/songs/${slug}/cover.svg`, cover(slug))
}
console.log(`wrote ${index.songs.length} placeholder covers`)
