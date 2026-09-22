<script lang="ts">
  import { onMount } from 'svelte'
  import { AudioClock } from '$lib/audio/clock'
  import { preview } from '$lib/audio/preview.svelte'
  import type { ChartRef, Song } from '$lib/songs'
  import { loadChart } from '$lib/songs'
  import { audioUrl } from '$lib/paths'
  import type { Chart } from '$lib/chart'
  import { go } from '$lib/router.svelte'
  import { settings } from '$lib/settings.svelte'
  import { stageScale } from '$lib/shell/viewport'
  import { InputCollector } from '$lib/game/input'
  import { Playfield } from '$lib/game/render'
  import { kindOf, Session } from '$lib/game/session'
  import { fieldToStage } from '$lib/game/layout'
  import type { Grade } from '$lib/game/judge'
  import Keycap from '$lib/ui/Keycap.svelte'

  /**
   * M1 타이밍 코어 (PLAN §5, §13).
   *
   * 판정은 AudioClock 기준, 렌더는 rAF — 둘을 섞지 않는다. 입력은 이벤트의
   * timeStamp 로 큐에 들어가고 rAF 는 소비만 한다. 여기서 확인할 것은 하나다:
   * **노트가 음악에 맞게 떨어지는가.** 이게 안 되면 나머지가 무의미하다.
   */
  let { song, chart: ref }: { song: Song; chart: ChartRef } = $props()

  /** 시작 전 여유(ms). 카운트다운이 돌고 첫 노트가 미리 떨어진다. */
  const LEAD_MS = 3000

  /**
   * ?autoplay=1 이면 노트 시각에 맞춰 입력을 자동으로 넣는다. 실제 입력과 **같은 경로**로
   * 들어가므로, 정확도가 100% 가 아니면 시계가 틀린 것이다 — 브라우저에서 AudioClock 을
   * 검증하는 유일한 방법이다. 나중에 레퍼런스 고스트에도 쓴다 (PLAN §9).
   */
  const autoplay =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('autoplay')

  type Phase = 'loading' | 'countdown' | 'playing' | 'done' | 'failed'
  let phase = $state<Phase>('loading')
  let error = $state('')
  let countdown = $state(3)
  let hud = $state({ score: 0, combo: 0, accuracy: 1, judged: 0, total: 0 })
  let lastGrade = $state<Grade | null>(null)
  let lastDelta = $state(0)

  let host: HTMLDivElement

  onMount(() => {
    let disposed = false
    let clock: AudioClock | undefined
    let field: Playfield | undefined
    let input: InputCollector | undefined
    let frame = 0

    const run = async () => {
      const chart: Chart = await loadChart(ref.chartHash)
      if (disposed) return

      clock = new AudioClock()
      clock.offsets = {
        audioOffsetMs: chart.audioOffsetMs,
        userOffsetMs: settings.audioOffsetMs ?? 0,
      }
      // 미리듣기가 이미 받아 둔 버퍼가 있으면 그대로 쓴다 — 곡을 두 번 받지 않는다.
      const cached = preview.cached(song.slug)
      const bytes = cached ?? (await (await fetch(audioUrl(song.slug))).arrayBuffer())
      if (disposed) return
      await clock.load(bytes)
      await clock.resume()
      if (disposed) return

      const session = new Session(chart)
      hud.total = chart.notes.length

      input = new InputCollector({ toSongMs: (perfMs) => clock!.songTimeOf(perfMs) })
      input.attach(host)
      field = await Playfield.create(host, stageScale())
      if (disposed) {
        field.destroy()
        return
      }

      preview.stop()
      clock.start(LEAD_MS)
      phase = 'countdown'

      const endsAt = chart.notes.length ? chart.notes[chart.notes.length - 1]!.t + 2000 : 0
      let autoAt = 0
      const tick = () => {
        if (disposed || !clock || !field || !input) return
        frame = requestAnimationFrame(tick)
        const songMs = clock.now()

        if (songMs < 0) {
          countdown = Math.max(1, Math.ceil(-songMs / 1000))
        } else if (phase === 'countdown') {
          phase = 'playing'
        }

        if (autoplay) {
          while (autoAt < chart.notes.length && chart.notes[autoAt]!.t <= songMs) {
            const note = chart.notes[autoAt]!
            autoAt++
            if (note.type === 'cursor') {
              const p = fieldToStage(note.x, note.y)
              input.injectCursor(note.t, p.x, p.y)
            } else {
              input.inject(kindOf(note)!, note.t)
            }
          }
        }

        session.update(songMs, input.drain(), (ms) => input!.cursorAt(ms))
        for (const j of session.fresh) {
          field.mark(songMs, j.note, j.grade)
          lastGrade = j.grade
          lastDelta = j.deltaMs
        }
        session.fresh.length = 0

        field.draw(songMs, session.notes, session.head, input.cursor)
        hud.score = session.tally.score
        hud.combo = session.tally.combo
        hud.accuracy = session.tally.accuracy
        hud.judged = session.tally.perfect + session.tally.great + session.tally.good + session.tally.miss

        if (phase === 'playing' && (session.done || songMs > endsAt)) {
          phase = 'done'
          clock.stop()
        }
      }
      frame = requestAnimationFrame(tick)
    }

    void run().catch((e) => {
      if (disposed) return
      phase = 'failed'
      error = e instanceof Error ? e.message : String(e)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      input?.detach()
      field?.destroy()
      void clock?.close()
    }
  })

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') go({ screen: 'select' })
  }

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
</script>

<svelte:window onkeydown={onKey} />

<div class="play">
  <div class="canvas" bind:this={host}></div>

  <div class="now">
    <span class="title">{song.title}</span>
    <span class="chart">{ref.difficulty} {ref.level}</span>
  </div>

  {#if phase === 'playing' || phase === 'done'}
    <div class="hud">
      <span class="score tnum">{hud.score.toLocaleString('en-US')}</span>
      <span class="acc tnum">{pct(hud.accuracy)}</span>
      <span class="progress tnum">{hud.judged} / {hud.total}</span>
    </div>
    <div class="feed">
      {#if hud.combo > 2}
        <span class="combo tnum">{hud.combo}</span>
      {/if}
      {#if lastGrade}
        <span class="grade {lastGrade}">
          {lastGrade}
          {#if lastGrade !== 'miss' && lastDelta}
            <span class="delta tnum">{lastDelta > 0 ? '+' : ''}{lastDelta.toFixed(0)}ms</span>
          {/if}
        </span>
      {/if}
    </div>
  {/if}

  {#if phase === 'loading'}
    <p class="centre">Loading the chart…</p>
  {:else if phase === 'countdown'}
    <p class="centre count tnum">{countdown}</p>
  {:else if phase === 'failed'}
    <p class="centre fail">Couldn't start — {error}</p>
  {:else if phase === 'done'}
    <div class="centre summary">
      <p class="headline tnum">{pct(hud.accuracy)}</p>
      <p class="detail tnum">{hud.score.toLocaleString('en-US')} points</p>
      <p class="detail">Esc to pick another song</p>
    </div>
  {/if}

  <footer>
    <Keycap label="Z" /><Keycap label="X" /> click · move the cursor onto the marks ·
    <Keycap label="Esc" /> back
  </footer>
</div>

<style>
  .play {
    position: absolute;
    inset: 0;
  }

  .canvas {
    position: absolute;
    inset: 0;
  }

  .now {
    position: absolute;
    top: 26px;
    left: 40px;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .title {
    font-size: 19px;
    font-weight: 700;
  }

  .chart {
    font-size: 13px;
    font-weight: 500;
    color: var(--bone-faint);
  }

  .hud {
    position: absolute;
    top: 22px;
    right: 40px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .score {
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .acc {
    font-size: 14px;
    font-weight: 600;
    color: var(--bone-dim);
  }

  .progress {
    font-size: 11px;
    color: var(--bone-faint);
  }

  /* 플레이 영역 밖. 그리드 위에 글자를 올리면 노트를 가린다. */
  .feed {
    position: absolute;
    top: 62px;
    left: 40px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
  }

  .combo {
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    color: var(--bone);
    opacity: 0.35;
  }

  .grade {
    font-size: 14px;
    font-weight: 700;
  }

  .grade .delta {
    margin-left: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--bone-faint);
  }

  .grade.perfect { color: var(--cursor); }
  .grade.great { color: var(--scroll); }
  .grade.good { color: var(--bone-dim); }
  .grade.miss { color: var(--click); }

  .centre {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 4px;
    margin: 0;
    text-align: center;
    font-size: 15px;
    color: var(--bone-dim);
    pointer-events: none;
  }

  .count {
    font-size: 96px;
    font-weight: 800;
    color: var(--bone);
    opacity: 0.5;
  }

  .fail {
    color: var(--click);
  }

  .summary .headline {
    margin: 0;
    font-size: 64px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--bone);
  }

  .summary .detail {
    margin: 0;
    font-size: 14px;
    color: var(--bone-dim);
  }

  footer {
    position: absolute;
    bottom: 22px;
    left: 40px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--bone-faint);
  }
</style>
