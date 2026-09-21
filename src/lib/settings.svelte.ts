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
const DEFAULTS = { theme: 'paper' as Theme }

function load(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as { version: number; theme: Theme }
    if (parsed.version !== VERSION) return { ...DEFAULTS }
    return { theme: THEMES.includes(parsed.theme) ? parsed.theme : DEFAULTS.theme }
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
