import { SONG_INDEX_URL } from './paths'

/** Expert is deliberately absent for now; hard is the ceiling. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface ChartRef {
  difficulty: Difficulty
  /** Records, replays and 1v1 chart matching all hang off this (PLAN §8). */
  chartHash: string
  noteCount: number
  /** 1-10, shown on the difficulty squares. */
  level: number
}

export interface Song {
  slug: string
  title: string
  artist: string
  license: string
  sourceUrl: string
  durationMs: number
  bpm: number
  previewStartMs: number
  audioOffsetMs: number
  charts: ChartRef[]
}

export interface SongIndex {
  version: number
  /** Set while the library is stand-in data with no audio behind it. */
  placeholder?: boolean
  songs: Song[]
}

export async function loadSongIndex(): Promise<SongIndex> {
  const res = await fetch(SONG_INDEX_URL)
  if (!res.ok) throw new Error(`songs.json responded ${res.status}`)
  const index = (await res.json()) as SongIndex
  if (index.version !== 1) throw new Error(`songs.json is version ${index.version}, expected 1`)
  return {
    ...index,
    songs: index.songs.map((song) => ({
      ...song,
      charts: [...song.charts].sort(
        (a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty),
      ),
    })),
  }
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
