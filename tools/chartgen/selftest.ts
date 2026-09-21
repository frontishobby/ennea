/**
 * 합성 신호로 파이프라인을 검증한다. 진짜 곡이 없어도 돌아가고, 정답을 알고 있으므로
 * 재현율·정밀도·검출 지연(bias)을 숫자로 뽑는다.
 *
 *   node tools/chartgen/selftest.ts          검증만
 *   node tools/chartgen/selftest.ts --wav    work/ 에 합성 신호와 클릭 트랙도 쓴다 (귀로 확인용)
 *
 * 패턴 (150 BPM, 위상 0.137s): 킥 1·3박, 스네어 2·4박, 하이햇 8분음표 전부.
 * 처음 8박은 하이햇만 작게 — 조용한 인트로에서도 적응형 임계값이 잡는지 본다.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalize, DIFFICULTIES } from '../../src/lib/chart.ts'
import { mulberry32 } from '../../src/lib/util/prng.ts'
import { analyze } from './analyze.ts'
import { describe, generate, validate } from './build.ts'
import { renderPreview } from './preview.ts'
import { writeWavPcm16 } from './wav.ts'

const SR = 48000
const BPM = 150
const DUR = 40
const PHASE = 0.137
const INTRO_BEATS = 8
const TOL = 0.03

let rand = mulberry32(42)
let sig = new Float32Array(SR * DUR)

/**
 * 끝 20ms 를 반코사인으로 접는다 — 뚝 끊기면 그 자체가 광대역 클릭이 돼서 가짜 온셋을 만든다.
 * 50Hz 킥은 주기가 20ms 라 그보다 짧은 페이드는 여전히 하드컷이다.
 */
function add(t0: number, lenSec: number, fn: (i: number) => number) {
  const s0 = Math.round(t0 * SR)
  const n = Math.round(lenSec * SR)
  const fade = Math.min(n, Math.round(0.02 * SR))
  for (let i = 0; i < n && s0 + i < sig.length; i++) {
    const tail = n - 1 - i
    const g = tail < fade ? 0.5 - 0.5 * Math.cos((Math.PI * tail) / fade) : 1
    sig[s0 + i] += fn(i) * g
  }
}
function kick(t: number) {
  let ph = 0
  add(t, 0.22, (i) => {
    const tt = i / SR
    ph += (2 * Math.PI * (50 + 90 * Math.exp(-tt / 0.02))) / SR
    const click = i < 48 ? (rand() * 2 - 1) * 0.4 : 0
    return 0.9 * Math.sin(ph) * Math.exp(-tt / 0.05) + click
  })
}
function snare(t: number) {
  add(t, 0.12, (i) => {
    const tt = i / SR
    return (
      (rand() * 2 - 1) * 0.55 * Math.exp(-tt / 0.04) +
      0.35 * Math.sin(2 * Math.PI * 330 * tt) * Math.exp(-tt / 0.03)
    )
  })
}
function hat(t: number, amp: number) {
  const n = Math.round(0.03 * SR)
  const w = new Float32Array(n + 2)
  for (let i = 0; i < n + 2; i++) w[i] = rand() * 2 - 1
  // 2차 차분 = 거친 하이패스. 진짜 하이햇처럼 저역이 비어 있어야 대역 배정을 시험할 수 있다.
  add(t, n / SR, (i) => amp * (w[i + 2] - 2 * w[i + 1] + w[i]) * Math.exp(-i / (SR * 0.012)))
}

interface Truth {
  kicks: number[]
  snares: number[]
  hatsOff: number[] // 뒷박 하이햇 — 킥/스네어와 안 겹치는 것만 정답으로 센다
  hatsOn: number[]
  beats: number[]
}

/**
 * 드럼 패턴을 만든다. bpmAt(t) 로 템포 곡선을 준다 — 상수면 정박, 램프면 드리프트.
 * 8분음표 시각은 순간 템포를 적분해서 얻는다.
 */
function synth(bpmAt: (t: number) => number): Truth {
  rand = mulberry32(42)
  sig = new Float32Array(SR * DUR)
  const truth: Truth = { kicks: [], snares: [], hatsOff: [], hatsOn: [], beats: [] }
  let t = PHASE
  for (let k = 0; ; k++) {
    if (t > DUR - 1) break
    const beatIdx = k >> 1
    const onBeat = (k & 1) === 0
    const intro = beatIdx < INTRO_BEATS
    hat(t, intro ? 0.06 : 0.12)
    if (onBeat) {
      truth.hatsOn.push(t)
      truth.beats.push(t)
      if (!intro) {
        if (beatIdx % 2 === 0) {
          kick(t)
          truth.kicks.push(t)
        } else {
          snare(t)
          truth.snares.push(t)
        }
      }
    } else truth.hatsOff.push(t)
    t += 60 / bpmAt(t) / 2
  }
  // 패드 + 노이즈 바닥. 지속음은 온셋이 아니어야 하고, LFO 가 만드는 작은 flux 도 무시돼야 한다.
  for (let i = 0; i < sig.length; i++) {
    const tt = i / SR
    const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.1 * tt)
    sig[i] +=
      (0.1 * lfo * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277 * tt) + Math.sin(2 * Math.PI * 330 * tt))) / 3 +
      0.0015 * (rand() * 2 - 1)
  }
  return truth
}

const { kicks, snares, hatsOff, hatsOn } = synth(() => BPM)

// ── 분석 ──────────────────────────────────────────────────────────
let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}

const a = analyze(sig, SR)
const aHint = analyze(sig, SR, { bpmHint: BPM })

console.log('\n템포')
check(Math.abs(a.tempo.bpm - BPM) < 0.5, `BPM 자유 탐색  ${a.tempo.bpm.toFixed(2)} (기대 ${BPM}, 신뢰도 ${a.tempo.confidence.toFixed(1)})`)
check(Math.abs(aHint.tempo.bpm - BPM) < 0.5, `BPM 힌트 탐색  ${aHint.tempo.bpm.toFixed(2)}`)
const phaseErr = Math.min(
  Math.abs(a.tempo.phaseSec - PHASE),
  Math.abs(a.tempo.phaseSec - PHASE - a.tempo.periodSec),
  Math.abs(a.tempo.phaseSec - PHASE + a.tempo.periodSec),
)
check(phaseErr < 0.015, `비트 위상      ${(a.tempo.phaseSec * 1000).toFixed(1)}ms (기대 ${PHASE * 1000}ms, 오차 ${(phaseErr * 1000).toFixed(1)}ms)`)

function score(name: string, truth: number[], band: 'low' | 'mid' | 'high', minRecall: number, minPrecision: number) {
  const det = a.byBand[band]
  const used = new Set<number>()
  const errs: number[] = []
  for (const t of truth) {
    let bi = -1
    let bd = TOL
    det.forEach((d, i) => {
      const dd = Math.abs(d.t - t)
      if (dd < bd && !used.has(i)) {
        bd = dd
        bi = i
      }
    })
    if (bi >= 0) {
      used.add(bi)
      errs.push(det[bi].t - t)
    }
  }
  const recall = errs.length / truth.length
  const precision = det.length ? used.size / det.length : 0
  const bias = errs.length ? errs.reduce((s, e) => s + e, 0) / errs.length : 0
  const sd = errs.length ? Math.sqrt(errs.reduce((s, e) => s + (e - bias) ** 2, 0) / errs.length) : 0
  check(
    recall >= minRecall && precision >= minPrecision,
    `${name.padEnd(14)} 재현율 ${(recall * 100).toFixed(0).padStart(3)}%  정밀도 ${(precision * 100).toFixed(0).padStart(3)}%  ` +
      `bias ${(bias * 1000).toFixed(1).padStart(5)}ms  σ ${(sd * 1000).toFixed(1)}ms  (정답 ${truth.length}, 검출 ${det.length})`,
  )
  return bias
}

console.log('\n온셋 (대역 배정 후, ±30ms)')
// 정밀도 바닥은 느슨하다. 스네어는 광대역이라 저역·고역에도 정직하게 잡히고,
// 그건 build 의 겹침 규칙이 거른다. 여기서 잡을 건 "타격 하나가 여럿으로 쪼개지는" 회귀다.
const b1 = score('킥 → low', kicks, 'low', 0.95, 0.4)
const b2 = score('스네어 → mid', snares, 'mid', 0.95, 0.7)
const b3 = score('뒷박 햇 → high', hatsOff, 'high', 0.9, 0.55)
console.log(`  (앞박 햇 ${hatsOn.length}개는 킥/스네어와 겹쳐 흡수되는 게 정상. 스네어는 광대역이라 세 대역에 다 보인다)`)
console.log(`  평균 bias ${(((b1 + b2 + b3) / 3) * 1000).toFixed(1)}ms → 0 근처가 아니면 analyze.ts 의 DETECTION_OFFSET_SEC 를 조정한다`)

// ── 채보 ──────────────────────────────────────────────────────────
console.log('\n채보')
const songHash = 'selftest'
const charts = DIFFICULTIES.map((d) => generate(a, d, songHash))
for (const chart of charts) {
  const bad = validate(chart)
  const st = describe(chart)
  check(
    bad.length === 0,
    `${chart.difficulty.padEnd(6)} 커서 ${st.counts.cursor} 클릭 ${st.counts.click} 스크롤 ${st.counts.scroll}  ` +
      `${st.nps.toFixed(2)} nps  level ${st.level}  섹션 ${chart.sections.length}` +
      (bad.length ? `\n         ${bad.slice(0, 5).join('\n         ')}` : ''),
  )
}
const totals = charts.map((c) => c.notes.length)
check(totals[0] < totals[1] && totals[1] < totals[2], `밀도 단조 증가  easy ${totals[0]} < normal ${totals[1]} < hard ${totals[2]}`)

const weakSteady = a.grid.weakSpans().reduce((s, [x, y]) => s + (y - x), 0)
check(weakSteady < 1, `박자 흐린 구간 ${weakSteady.toFixed(1)}s (정박 합성 — 0 이어야 한다)`)
const tripSteady = a.grid.tripletSpans().reduce((s, [x, y]) => s + (y - x), 0)
check(tripSteady < 1, `셋잇단 구간 ${tripSteady.toFixed(1)}s (정박 8분 햇 — 0 이어야 한다)`)

const again = generate(a, 'hard', songHash)
check(canonicalize(again) === canonicalize(charts[2]), '결정성 — 같은 입력이면 같은 채보')
const other = generate(a, 'hard', 'another-song')
check(canonicalize(other) !== canonicalize(charts[2]), '시드 — 다른 곡 해시면 다른 배치')

// ── 드리프트: 150 → 154 BPM 으로 40초 동안 선형 가속 (+2.7%). 실측 ACE-Step 은 ±1.4% ──
console.log('\n드리프트 (150→154 BPM 램프)')
const drifted = synth((t) => BPM + 4 * (t / DUR))
const d = analyze(sig, SR)
const [dlo, dhi] = d.grid.bpmRange
check(dlo < 151.5 && dhi > 152.5, `지역 BPM 범위 ${dlo.toFixed(1)}~${dhi.toFixed(1)} 이 램프를 따라간다 (평균 ${d.grid.meanBpm.toFixed(1)})`)
// 채보의 beats 가 진짜 비트를 얼마나 가까이 따라가나
const dChart = generate(d, 'hard', songHash)
const beatErr = drifted.beats.map((b) => Math.min(...dChart.beats.map((x) => Math.abs(x / 1000 - b))))
beatErr.sort((x, y) => x - y)
const p90 = beatErr[Math.floor(beatErr.length * 0.9)]
check(p90 < 0.02, `beats 추적 오차 p50 ${(beatErr[beatErr.length >> 1] * 1000).toFixed(1)}ms  p90 ${(p90 * 1000).toFixed(1)}ms  (정답 비트 ${drifted.beats.length}, 채보 비트 ${dChart.beats.length})`)
for (const b of ['low', 'mid', 'high'] as const) {
  const f = d.fitness[b]
  check(f.ok, `${b.padEnd(4)} 적합도 정렬 ${(f.align * 100).toFixed(0)}% / 확률 ${(f.chance * 100).toFixed(0)}% → ${f.ok ? '통과' : '탈락'}`)
}
const weakDrift = d.grid.weakSpans().reduce((s, [x, y]) => s + (y - x), 0)
check(weakDrift < 1, `박자 흐린 구간 ${weakDrift.toFixed(1)}s (드리프트 합성 — 0 이어야 한다)`)
const tripDrift = d.grid.tripletSpans().reduce((s, [x, y]) => s + (y - x), 0)
check(tripDrift < 1, `셋잇단 구간 ${tripDrift.toFixed(1)}s (드리프트 합성 — 0 이어야 한다)`)
const dBad = validate(dChart)
const dSt = describe(dChart)
check(dBad.length === 0, `hard   커서 ${dSt.counts.cursor} 클릭 ${dSt.counts.click} 스크롤 ${dSt.counts.scroll}  ${dSt.nps.toFixed(2)} nps  섹션 ${dChart.sections.length}` + (dBad.length ? `\n         ${dBad.slice(0, 5).join('\n         ')}` : ''))
// 스냅이 노트를 음악 밖으로 밀지 않았나: 킥 노트(scroll)와 진짜 킥의 거리
const scrollT = dChart.notes.filter((n) => n.type === 'scroll').map((n) => n.t / 1000)
const kickErr = drifted.kicks.map((k) => Math.min(...scrollT.map((x) => Math.abs(x - k)))).filter((e) => e < 0.1)
kickErr.sort((x, y) => x - y)
check(kickErr[Math.floor(kickErr.length * 0.9)] < 0.025, `스냅 후 스크롤 노트 ↔ 진짜 킥 p90 ${(kickErr[Math.floor(kickErr.length * 0.9)] * 1000).toFixed(1)}ms (매칭 ${kickErr.length}/${drifted.kicks.length})`)

// 정박 시나리오도 새 그리드로 다시 확인 — 드리프트 기계가 정박을 해치면 안 된다
synth(() => BPM)

if (process.argv.includes('--wav')) {
  const dir = join(import.meta.dirname, 'work')
  mkdirSync(dir, { recursive: true })
  writeWavPcm16(join(dir, 'selftest.wav'), sig, SR)
  writeWavPcm16(join(dir, 'selftest-hard.wav'), renderPreview(sig, SR, charts[2]), SR)
  console.log(`\n${dir}/selftest.wav, selftest-hard.wav 저장`)
}

console.log(failures ? `\n실패 ${failures}건` : '\n전부 통과')
process.exit(failures ? 1 : 0)
