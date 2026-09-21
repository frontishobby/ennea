/**
 * Personal bests, kept per chartHash rather than per song: improving the
 * chart generator produces a new hash and therefore a fresh record slot,
 * leaving old records valid instead of silently corrupting them (PLAN §8).
 * The version field is what a future server migration reads (PLAN §14.5).
 */
const KEY = 'ennea.records'
const VERSION = 1

export interface Record {
  score: number
  accuracy: number
  combo: number
  playedAt: number
}

interface Store {
  version: number
  entries: { [chartHash: string]: Record }
}

const empty = (): Store => ({ version: VERSION, entries: {} })

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Store
    // No migrations exist yet; an unknown version starts clean rather than crashing.
    if (parsed.version !== VERSION) return empty()
    return parsed
  } catch {
    // Private browsing, disabled storage, corrupt JSON — the game still runs.
    return empty()
  }
}

export function bestFor(chartHash: string): Record | null {
  return read().entries[chartHash] ?? null
}

export function submit(chartHash: string, result: Record): void {
  const store = read()
  const previous = store.entries[chartHash]
  if (previous && previous.score >= result.score) return
  store.entries[chartHash] = result
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* over quota or blocked — the run still counted, it just won't persist */
  }
}
