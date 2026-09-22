import { SONG_INDEX_URL } from './paths'
import { DIFFICULTIES, type Difficulty } from './chart'

export { DIFFICULTIES, type Difficulty }

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
  /** 음원·채보가 아직 없는 자리표시자. 미리듣기를 시도하지 않는다. */
  placeholder?: boolean
  /** 자켓 파일명. 기본은 cover.webp (PLAN §8). */
  cover?: string
}

export interface SongIndex {
  version: number
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
