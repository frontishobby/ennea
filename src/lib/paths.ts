/**
 * Every asset URL in the game is built from these two constants.
 * Moving audio/charts to R2 or Supabase Storage later is a two-line change
 * (PLAN §14.2).
 */
export const AUDIO_BASE_URL = import.meta.env.BASE_URL + 'songs/'
export const CHART_BASE_URL = import.meta.env.BASE_URL + 'charts/'

export const SONG_INDEX_URL = import.meta.env.BASE_URL + 'songs.json'

/** PLAN §8. 자리표시자만 songs.json 에서 cover.svg 로 덮어쓴다. */
export const DEFAULT_COVER = 'cover.webp'

export const coverUrl = (slug: string, cover = DEFAULT_COVER) => `${AUDIO_BASE_URL}${slug}/${cover}`
export const audioUrl = (slug: string) => `${AUDIO_BASE_URL}${slug}/audio.webm`
export const chartUrl = (chartHash: string) => `${CHART_BASE_URL}${chartHash}.json`
