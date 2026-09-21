<script lang="ts">
  import { onMount } from 'svelte'
  import { Application, Graphics } from 'pixi.js'
  import { radiusFor } from '$lib/design/curve'
  import { tokenColor } from '$lib/design/theme'
  import { go } from '$lib/router.svelte'
  import { stageScale } from '$lib/shell/viewport'
  import Keycap from '$lib/ui/Keycap.svelte'
  import type { ChartRef, Song } from '$lib/songs'

  /**
   * The empty playfield from M0: the 3x3 cursor grid, the click lanes either
   * side and the scroll lanes above and below (PLAN §3). Same curvature law as
   * the menu, drawn with roundRect so Pixi and CSS agree on the corner.
   * No audio, no notes, no judgement — that is M1.
   */
  let { song, chart }: { song: Song; chart: ChartRef } = $props()

  const CELL = 132
  const GAP = 12
  const GRID = CELL * 3 + GAP * 2
  const LEFT = (1280 - GRID) / 2
  const TOP = (720 - GRID) / 2
  const LANE_GAP = 24
  const LANE_THICKNESS = 76

  let host: HTMLDivElement

  function field(): Graphics {
    const g = new Graphics()
    const CURSOR = tokenColor('--cursor', 0xffc24a)
    const CLICK = tokenColor('--click', 0xff5f8d)
    const SCROLL = tokenColor('--scroll', 0x4ce0c4)

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        g.roundRect(
          LEFT + col * (CELL + GAP),
          TOP + row * (CELL + GAP),
          CELL,
          CELL,
          radiusFor(CELL),
        )
      }
    }
    g.stroke({ width: 2, color: CURSOR, alpha: 0.26 })

    g.roundRect(LEFT, TOP - LANE_GAP - LANE_THICKNESS, GRID, LANE_THICKNESS, radiusFor(LANE_THICKNESS))
    g.roundRect(LEFT, TOP + GRID + LANE_GAP, GRID, LANE_THICKNESS, radiusFor(LANE_THICKNESS))
    g.stroke({ width: 2, color: SCROLL, alpha: 0.34 })

    g.roundRect(LEFT - LANE_GAP - LANE_THICKNESS, TOP, LANE_THICKNESS, GRID, radiusFor(LANE_THICKNESS))
    g.roundRect(LEFT + GRID + LANE_GAP, TOP, LANE_THICKNESS, GRID, radiusFor(LANE_THICKNESS))
    g.stroke({ width: 2, color: CLICK, alpha: 0.34 })

    return g
  }

  onMount(() => {
    let app: Application | undefined
    let disposed = false

    const start = async () => {
      const created = new Application()
      await created.init({
        width: 1280,
        height: 720,
        backgroundAlpha: 0,
        antialias: true,
        // The stage is CSS-scaled, so render at the size it actually occupies.
        resolution: Math.min((window.devicePixelRatio || 1) * stageScale(), 3),
        autoDensity: true,
      })
      if (disposed) {
        created.destroy(true)
        return
      }
      app = created
      host.appendChild(created.canvas)
      created.stage.addChild(field())

      const cursor = new Graphics()
        .roundRect(-22, -22, 44, 44, radiusFor(44))
        .fill({ color: tokenColor('--cursor', 0xffc24a), alpha: 0.9 })
      cursor.position.set(640, 360)
      created.stage.addChild(cursor)

      // Pointer Lock and logical-coordinate accumulation arrive at M2; until
      // then the cursor just tracks the pointer through the stage scale.
      const track = (event: PointerEvent) => {
        const rect = created.canvas.getBoundingClientRect()
        cursor.position.set(
          ((event.clientX - rect.left) / rect.width) * 1280,
          ((event.clientY - rect.top) / rect.height) * 720,
        )
      }
      host.addEventListener('pointermove', track)
      created.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    }

    void start()

    return () => {
      disposed = true
      app?.destroy(true, { children: true })
    }
  })

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') go({ screen: 'select' })
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="play">
  <div class="canvas" bind:this={host}></div>

  <div class="now">
    <span class="title">{song.title}</span>
    <span class="chart">{chart.difficulty} {chart.level}</span>
  </div>

  <p class="status">
    The playfield is drawn, nothing is running yet. Audio, the judgement clock and note
    rendering land at M1.
  </p>

  <footer><Keycap label="Esc" /> back to song select</footer>
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

  .status {
    position: absolute;
    top: 26px;
    right: 40px;
    margin: 0;
    max-width: 320px;
    text-align: right;
    font-size: 12px;
    line-height: 1.5;
    color: var(--bone-faint);
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
