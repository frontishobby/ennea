<script lang="ts">
  import { onMount } from 'svelte'
  import { coverUrl } from '$lib/paths'
  import {
    DIFFICULTIES,
    formatDuration,
    loadSongIndex,
    type ChartRef,
    type Difficulty,
    type Song,
  } from '$lib/songs'
  import { hueOf } from '$lib/design/hue'
  import { bestFor } from '$lib/records'
  import { spring } from '$lib/motion.svelte'
  import { createWheelTicker } from '$lib/input/wheel'
  import { go } from '$lib/router.svelte'
  import EnneaMark from '$lib/ui/EnneaMark.svelte'
  import Keycap from '$lib/ui/Keycap.svelte'
  import Stat from '$lib/ui/Stat.svelte'

  let songs = $state<Song[]>([])
  let placeholderLibrary = $state(false)
  let failure = $state<string | null>(null)
  let loading = $state(true)

  let index = $state(0)
  let tier = $state<Difficulty>('normal')

  /** Continuous carousel position; index is the integer it settles on. */
  const pos = spring(0, { stiffness: 210, damping: 26 })

  onMount(async () => {
    try {
      const library = await loadSongIndex()
      songs = library.songs
      placeholderLibrary = library.placeholder ?? false
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  const song = $derived(songs[index])
  const chart = $derived(song ? nearestChart(song, tier) : null)
  const best = $derived(chart ? bestFor(chart.chartHash) : null)
  const hue = $derived(song ? hueOf(song.slug) : 262)

  /** Songs don't all carry every tier, so hold the player's preference and
      land on the closest chart that exists. */
  function nearestChart(s: Song, want: Difficulty): ChartRef | null {
    if (!s.charts.length) return null
    const target = DIFFICULTIES.indexOf(want)
    const distance = (c: ChartRef) => Math.abs(DIFFICULTIES.indexOf(c.difficulty) - target)
    return s.charts.reduce((closest, c) => (distance(c) < distance(closest) ? c : closest))
  }

  /** Under this many songs the carousel can't wrap without showing the same
      cover twice, so it clamps at the ends instead. */
  const WRAP_MIN = 7
  const wraps = $derived(songs.length >= WRAP_MIN)

  /** Signed distance to a song, the short way round when wrapping. */
  function shortest(delta: number): number {
    if (!wraps) return delta
    const n = songs.length
    return (((delta % n) + n + n / 2) % n) - n / 2
  }

  function move(delta: number) {
    if (!songs.length) return
    if (wraps) {
      index = (((index + delta) % songs.length) + songs.length) % songs.length
    } else {
      const next = Math.max(0, Math.min(songs.length - 1, index + delta))
      delta = next - index
      index = next
    }
    pos.set(pos.target + delta)
  }

  const jumpTo = (target: number) => move(shortest(target - index))

  /** How far the spring still has to travel, in slots. */
  const slide = $derived(pos.target - pos.current)

  function stepTier(delta: number) {
    if (!song || !chart) return
    const at = song.charts.indexOf(chart)
    const next = song.charts[Math.max(0, Math.min(song.charts.length - 1, at + delta))]
    if (next) tier = next.difficulty
  }

  function play() {
    if (song && chart) go({ screen: 'play', song, chart })
  }

  function onKey(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
        move(-1)
        break
      case 'ArrowRight':
      case 'd':
        move(1)
        break
      case 'ArrowUp':
      case 'w':
        stepTier(1)
        break
      case 'ArrowDown':
      case 's':
        stepTier(-1)
        break
      case 'Enter':
        play()
        break
      default:
        return
    }
    event.preventDefault()
  }

  const ticker = createWheelTicker(({ dir }) => move(dir))

  /** The page must not scroll under the game, so the listener can't be passive. */
  function browseOnWheel(node: HTMLElement) {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      ticker(event)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return { destroy: () => node.removeEventListener('wheel', onWheel) }
  }

  /** Where a cover sits, by its distance from the centre slot. */
  const STOPS = [
    { x: 0, scale: 1, opacity: 1 },
    { x: 352, scale: 0.6, opacity: 1 },
    { x: 578, scale: 0.4, opacity: 0.8 },
    { x: 726, scale: 0.3, opacity: 0 },
  ]

  function place(offset: number) {
    const dist = Math.min(Math.abs(offset), STOPS.length - 1)
    const step = Math.min(Math.floor(dist), STOPS.length - 2)
    const t = dist - step
    const a = STOPS[step]!
    const b = STOPS[step + 1]!
    const lerp = (u: number, v: number) => u + (v - u) * t
    return {
      x: Math.sign(offset) * lerp(a.x, b.x),
      scale: lerp(a.scale, b.scale),
      opacity: lerp(a.opacity, b.opacity),
      z: 40 - Math.round(dist * 10),
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="screen">
  <header>
    <EnneaMark size={24} />
    <span class="wordmark">ENNEA</span>
    {#if songs.length}
      <span class="count tnum">{index + 1} / {songs.length}</span>
    {/if}
    <button class="chip" onclick={() => go({ screen: 'settings' })}>Settings</button>
  </header>

  {#if loading}
    <p class="state">Loading the library…</p>
  {:else if failure}
    <p class="state">
      Couldn't load the song list — {failure}. Check that static/songs.json is in place, then
      reload.
    </p>
  {:else if !songs.length}
    <p class="state">
      No songs yet. Add a folder under static/songs/ and list it in songs.json.
    </p>
  {:else if song}
    <div class="carousel" style:--glow="hsl({hue} 92% 62%)" use:browseOnWheel>
      <div class="glow"></div>
      {#each songs as entry, i (entry.slug)}
        {@const p = place(shortest(i - index) + slide)}
        <button
          class="jacket"
          class:active={i === index}
          style:transform="translate(-50%, -50%) translateX({p.x}px) scale({p.scale})"
          style:opacity={p.opacity}
          style:z-index={p.z}
          style:pointer-events={p.opacity < 0.2 ? 'none' : 'auto'}
          tabindex={Math.abs(shortest(i - index)) > 2 ? -1 : 0}
          onclick={() => (i === index ? play() : jumpTo(i))}
        >
          <img src={coverUrl(entry.slug)} alt="" draggable="false" />
          <span class="sr">{i === index ? `Play ${entry.title}` : `Select ${entry.title}`}</span>
        </button>
      {/each}
    </div>

    <div class="titles" aria-live="polite">
      <h1>{song.title}</h1>
      <p class="artist">{song.artist}</p>
    </div>

    <div class="band">
      <div class="group">
        <Stat value={song.bpm} label="BPM" />
        <Stat value={formatDuration(song.durationMs)} label="length" />
      </div>

      <div class="column">
        <div class="tiers" role="group" aria-label="Difficulty">
          {#each DIFFICULTIES as difficulty (difficulty)}
            {@const available = song.charts.find((c) => c.difficulty === difficulty)}
            <button
              class="tier"
              class:on={available && available === chart}
              class:absent={!available}
              style:--tone="var(--tone-{difficulty})"
              style:--tone-ink="var(--tone-{difficulty}-ink)"
              disabled={!available}
              aria-pressed={available === chart}
              onclick={() => (tier = difficulty)}
            >
              <span class="level tnum">{available ? available.level : '—'}</span>
              <span class="name">{difficulty}</span>
            </button>
          {/each}
        </div>
        <p class="notes tnum">
          {chart ? `${chart.noteCount.toLocaleString('en-US')} notes` : 'No chart for this song yet'}
        </p>
      </div>

      <div class="group">
        <Stat
          wide
          muted={!best}
          value={best ? best.score.toLocaleString('en-US') : '—'}
          label={best ? 'best score' : 'no record yet'}
        />
      </div>
    </div>

    <footer>
      <span class="hint"><Keycap label="A" /><Keycap label="D" /> browse</span>
      <span class="hint"><Keycap label="W" /><Keycap label="S" /> difficulty</span>
      <span class="hint"><Keycap label="Enter" /> play</span>
      {#if placeholderLibrary}
        <span class="notice">Placeholder library — no audio is wired up yet</span>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .screen {
    position: absolute;
    inset: 0;
  }

  header {
    position: absolute;
    top: 0;
    left: 40px;
    right: 40px;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .wordmark {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.22em;
  }

  .count {
    margin-left: auto;
    margin-right: 14px;
    font-size: 13px;
    font-weight: 500;
    color: var(--bone-faint);
  }

  .chip {
    height: 28px;
    padding: 0 13px;
    border: 1px solid var(--line);
    border-radius: var(--r-28);
    background: var(--ink-800);
    font-size: 12px;
    font-weight: 500;
    color: var(--bone-dim);
    transition:
      border-color 160ms ease,
      color 160ms ease;
  }

  .chip:hover {
    border-color: var(--bone-faint);
    color: var(--bone);
  }

  .state {
    position: absolute;
    top: 300px;
    left: 50%;
    width: 520px;
    margin: 0;
    transform: translateX(-50%);
    text-align: center;
    font-size: 16px;
    color: var(--bone-dim);
  }

  /* ── Carousel ─────────────────────────────────────────────── */

  .carousel {
    position: absolute;
    top: 76px;
    left: 0;
    right: 0;
    height: 348px;
  }

  .glow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 520px;
    height: 520px;
    transform: translate(-50%, -50%);
    border-radius: var(--curve);
    background-color: var(--glow);
    filter: blur(90px);
    opacity: var(--glow-alpha);
    transition: background-color 520ms ease;
    pointer-events: none;
  }

  .jacket {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 340px;
    height: 340px;
    border-radius: var(--curve);
    background: var(--ink-800);
    transform-origin: center;
    will-change: transform;
  }

  .jacket img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: var(--curve);
    object-fit: cover;
    filter: var(--cover-idle);
    transition: filter 300ms ease;
  }

  .jacket.active img {
    filter: none;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ── Title ────────────────────────────────────────────────── */

  .titles {
    position: absolute;
    top: 440px;
    left: 0;
    right: 0;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: 46px;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.028em;
  }

  .artist {
    margin: 7px 0 0;
    font-size: 17px;
    font-weight: 400;
    color: var(--bone-dim);
  }

  /* ── Band: two facts, four difficulties, one record ───────── */

  .band {
    position: absolute;
    top: 552px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 34px;
  }

  .group,
  .tiers {
    display: flex;
    gap: 12px;
  }

  .column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px;
  }

  .tier {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 3px;
    width: 76px;
    height: 76px;
    border: 1px solid var(--line);
    border-radius: var(--curve);
    background: var(--ink-800);
    transition:
      background-color 160ms ease,
      border-color 160ms ease;
  }

  .tier .level {
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    color: var(--tone-ink);
  }

  .tier .name {
    font-size: 10px;
    font-weight: 600;
    color: var(--bone-faint);
  }

  .tier:not(.absent):hover {
    border-color: var(--tone);
  }

  .tier.on {
    background: var(--tone);
    border-color: var(--tone);
  }

  .tier.on .level {
    color: var(--on-tone);
  }

  .tier.on .name {
    color: color-mix(in srgb, var(--on-tone) 65%, transparent);
  }

  .tier.absent {
    background: none;
    border-style: dashed;
    border-color: color-mix(in srgb, var(--line) 55%, transparent);
    cursor: default;
  }

  .tier.absent .level {
    color: var(--bone-faint);
  }

  .notes {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--bone-faint);
  }

  /* ── Footer ───────────────────────────────────────────────── */

  footer {
    position: absolute;
    bottom: 22px;
    left: 40px;
    right: 40px;
    display: flex;
    align-items: center;
    gap: 22px;
    font-size: 12px;
    color: var(--bone-faint);
  }

  .hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .notice {
    margin-left: auto;
    color: var(--bone-faint);
  }
</style>
