/**
 * ENNEA 채보 생성기 CLI (오프라인, PLAN §6).
 *
 *   node tools/chartgen/main.ts <audio.wav> --slug <slug> [옵션]
 *
 *   --difficulty easy|normal|hard|all   기본 all
 *   --bpm <n>            BPM 힌트. 기본은 songs.json 의 bpm. 없으면 80~200 자유 탐색
 *   --out <dir>          채보 출력. 기본 static/charts
 *   --preview            work/<slug>-<difficulty>.wav 에 클릭 트랙을 쓴다 — 귀로 검증
 *   --dump               work/<slug>-onsets.csv 에 온셋 전체를 쓴다
 *   --no-register        songs.json 을 건드리지 않는다
 *
 * 채보 파일명은 chartHash 다. 내용이 바뀌면 이름이 바뀐다. 옛 파일은 지우지 않는다 —
 * 기록과 리플레이가 그 해시를 참조할 수 있다 (PLAN §8).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  canonicalize,
  chartHash,
  DIFFICULTIES,
  sha256Hex,
  type Difficulty,
} from '../../src/lib/chart.ts'
import { analyze } from './analyze.ts'
import { describe, generate, validate } from './build.ts'
import { renderPreview } from './preview.ts'
import { readWav, writeWavPcm16 } from './wav.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const WORK = join(import.meta.dirname, 'work')
const SONGS_JSON = join(ROOT, 'static', 'songs.json')

interface Args {
  audio: string
  slug?: string
  difficulty: Difficulty | 'all'
  bpm?: number
  out: string
  preview: boolean
  dump: boolean
  register: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    audio: '',
    difficulty: 'all',
    out: join(ROOT, 'static', 'charts'),
    preview: false,
    dump: false,
    register: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} 에 값이 필요하다`)
      return v
    }
    if (a === '--slug') args.slug = next()
    else if (a === '--difficulty') {
      const d = next()
      if (d !== 'all' && !(DIFFICULTIES as readonly string[]).includes(d)) fail(`난이도: ${DIFFICULTIES.join('|')}|all`)
      args.difficulty = d as Difficulty | 'all'
    } else if (a === '--bpm') args.bpm = Number(next())
    else if (a === '--out') args.out = resolve(next())
    else if (a === '--preview') args.preview = true
    else if (a === '--dump') args.dump = true
    else if (a === '--no-register') args.register = false
    else if (a.startsWith('-')) fail(`모르는 옵션 ${a}`)
    else args.audio = resolve(a)
  }
  if (!args.audio) fail('음원 파일 경로가 필요하다')
  return args
}

function fail(msg: string): never {
  console.error(`오류: ${msg}`)
  console.error('사용법: node tools/chartgen/main.ts <audio.wav> --slug <slug> [--difficulty all] [--bpm 150] [--preview]')
  process.exit(2)
}

interface SongEntry {
  slug: string
  bpm?: number
  durationMs?: number
  charts: { difficulty: Difficulty; chartHash: string; noteCount: number; level: number }[]
  [k: string]: unknown
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.audio)) fail(`파일이 없다: ${args.audio}`)

  const index = existsSync(SONGS_JSON)
    ? (JSON.parse(readFileSync(SONGS_JSON, 'utf8')) as { songs: SongEntry[]; [k: string]: unknown })
    : undefined
  const song = args.slug ? index?.songs.find((s) => s.slug === args.slug) : undefined
  if (args.slug && !song) console.warn(`  ! songs.json 에 '${args.slug}' 가 없다. 채보는 만들지만 등록은 못 한다.`)

  const bytes = readFileSync(args.audio)
  const songHash = await sha256Hex(bytes, 16)
  const wav = readWav(args.audio)
  const bpmHint = args.bpm ?? song?.bpm

  console.log(`\n${args.audio}`)
  console.log(`  ${wav.sampleRate}Hz ${wav.channels}ch ${wav.bitsPerSample}bit  ${wav.durationSec.toFixed(1)}s  songHash ${songHash}`)

  const t0 = performance.now()
  const a = analyze(wav.mono, wav.sampleRate, { bpmHint })
  console.log(
    `  분석 ${((performance.now() - t0) / 1000).toFixed(1)}s — BPM ${a.tempo.bpm.toFixed(2)}` +
      (bpmHint ? ` (힌트 ${bpmHint})` : ' (자유 탐색)') +
      `  신뢰도 ${a.tempo.confidence.toFixed(1)}  위상 ${(a.tempo.phaseSec * 1000).toFixed(0)}ms`,
  )
  console.log(`  온셋  low ${a.byBand.low.length}  mid ${a.byBand.mid.length}  high ${a.byBand.high.length}`)
  if (a.tempo.confidence < 2) console.warn('  ! 템포 신뢰도가 낮다. --bpm 으로 힌트를 주거나 곡을 의심한다.')

  if (args.dump) {
    mkdirSync(WORK, { recursive: true })
    const csv = ['t_ms,band,ratio', ...a.onsets.map((o) => `${Math.round(o.t * 1000)},${o.band},${o.ratio.toFixed(3)}`)]
    const p = join(WORK, `${args.slug ?? 'song'}-onsets.csv`)
    writeFileSync(p, csv.join('\n') + '\n')
    console.log(`  온셋 덤프 ${p}`)
  }

  const targets: Difficulty[] = args.difficulty === 'all' ? [...DIFFICULTIES] : [args.difficulty]
  mkdirSync(args.out, { recursive: true })
  const refs: SongEntry['charts'] = []

  console.log('')
  for (const difficulty of targets) {
    const chart = generate(a, difficulty, songHash)
    const bad = validate(chart)
    if (bad.length) {
      console.error(`  ${difficulty}: 생성기가 자기 규칙을 어겼다 — 파일을 쓰지 않는다`)
      for (const b of bad.slice(0, 10)) console.error(`    ${b}`)
      process.exitCode = 1
      continue
    }
    const canonical = canonicalize(chart)
    const hash = await chartHash(chart)
    writeFileSync(join(args.out, `${hash}.json`), canonical)
    const st = describe(chart)
    refs.push({ difficulty, chartHash: hash, noteCount: st.total, level: st.level })
    console.log(
      `  ${difficulty.padEnd(6)} ${hash}  커서 ${String(st.counts.cursor).padStart(4)}  클릭 ${String(st.counts.click).padStart(4)}  ` +
        `스크롤 ${String(st.counts.scroll).padStart(3)}  ${st.nps.toFixed(2)} nps  level ${st.level}  섹션 ${chart.sections.length}`,
    )
    if (args.preview) {
      mkdirSync(WORK, { recursive: true })
      const p = join(WORK, `${args.slug ?? 'song'}-${difficulty}.wav`)
      writeWavPcm16(p, renderPreview(wav.mono, wav.sampleRate, chart), wav.sampleRate)
      console.log(`         프리뷰 ${p}`)
    }
  }

  if (args.register && song && index && refs.length) {
    for (const ref of refs) {
      const i = song.charts.findIndex((c) => c.difficulty === ref.difficulty)
      if (i >= 0) song.charts[i] = { ...song.charts[i], ...ref }
      else song.charts.push(ref)
    }
    song.durationMs = Math.round(wav.durationSec * 1000)
    if (!song.bpm) song.bpm = Math.round(a.tempo.bpm)
    writeFileSync(SONGS_JSON, JSON.stringify(index, null, 2) + '\n')
    console.log(`\n  songs.json 갱신: ${song.slug} (${refs.map((r) => r.difficulty).join(', ')})`)
  }

  if (args.slug) {
    console.log(`\n배포용 음원 (PLAN §5):`)
    console.log(`  ffmpeg -i "${args.audio}" -c:a libopus -b:a 128k -vbr on -application audio -ac 2 static/songs/${args.slug}/audio.webm`)
  }
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
