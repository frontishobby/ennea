/**
 * Player settings. localStorage carries a version field so a later server
 * migration has something to read (PLAN §14.5). Mouse sensitivity and the
 * audio offset join this once M1/M2 land.
 */
export const THEMES = ['paper', 'graphite', 'ultraviolet'] as const
export type Theme = (typeof THEMES)[number]

export const THEME_LABELS: { [K in Theme]: string } = {
  paper: 'Paper',
  graphite: 'Graphite',
  ultraviolet: 'Ultraviolet',
}

const KEY = 'ennea.settings'
const VERSION = 1
const DEFAULTS = {
  theme: 'paper' as Theme,
  /**
   * 플레이어 캘리브레이션(ms). 양수면 "소리가 늦게 들린다" — 블루투스 이어폰은
   * 100~300ms 밀린다. 측정 화면은 아직 없고 값 자리만 둔다 (PLAN §5).
   */
  audioOffsetMs: 0,
}

function load(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as { version: number; theme: Theme; audioOffsetMs: number }
    if (parsed.version !== VERSION) return { ...DEFAULTS }
    return {
      theme: THEMES.includes(parsed.theme) ? parsed.theme : DEFAULTS.theme,
      audioOffsetMs: Number.isFinite(parsed.audioOffsetMs) ? parsed.audioOffsetMs : 0,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = $state(load())

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...settings }))
  } catch {
    /* blocked storage — the setting still applies for this session */
  }
}

export function setTheme(theme: Theme) {
  settings.theme = theme
  save()
}

/** Called before mount so the first paint is already in the right theme. */
export function applyThemeAttribute() {
  document.documentElement.dataset.theme = settings.theme
}
