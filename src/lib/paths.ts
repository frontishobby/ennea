/**
 * Every asset URL in the game is built from these two constants.
 * Moving audio/charts to R2 or Supabase Storage later is a two-line change
 * (PLAN §14.2).
 */
export const AUDIO_BASE_URL = import.meta.env.BASE_URL + 'songs/'
export const CHART_BASE_URL = import.meta.env.BASE_URL + 'charts/'

export const SONG_INDEX_URL = import.meta.env.BASE_URL + 'songs.json'

/** Placeholder jackets are SVG; real cover art will be cover.webp. */
const COVER_FILE = 'cover.svg'

export const coverUrl = (slug: string) => `${AUDIO_BASE_URL}${slug}/${COVER_FILE}`
export const audioUrl = (slug: string) => `${AUDIO_BASE_URL}${slug}/audio.webm`
export const chartUrl = (chartHash: string) => `${CHART_BASE_URL}${chartHash}.json`
