/**
 * Reads a colour token off the document so PixiJS draws in whatever theme
 * the player picked. Custom properties come back as authored, so both hex
 * and rgb() forms have to be handled.
 */
export function tokenColor(name: string, fallback = 0xffffff): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback

  const rgb = raw.match(/^rgba?\(([^)]+)\)/)
  if (rgb?.[1]) {
    const [r = 0, g = 0, b = 0] = rgb[1].split(/[,/\s]+/).map(Number)
    return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
  }

  const hex = raw.replace('#', '')
  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => parseInt(c + c, 16))
    return ((r! & 255) << 16) | ((g! & 255) << 8) | (b! & 255)
  }
  if (hex.length === 6) return parseInt(hex, 16)
  return fallback
}
