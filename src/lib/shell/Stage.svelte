<script lang="ts">
  import type { Snippet } from 'svelte'
  import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from './viewport'

  /**
   * The whole game lives in a 1280x720 logical field (PLAN §3). Everything
   * inside works in those units; this is the only place a real pixel appears.
   * Scaling here rather than in the game means mouse sensitivity is identical
   * at every window size, because Pointer Lock deltas go straight into
   * logical coordinates.
   */
  let { children }: { children: Snippet } = $props()

  let scale = $state(stageScale())
</script>

<svelte:window onresize={() => (scale = stageScale())} />

<div class="viewport">
  <div
    class="stage"
    style:width="{STAGE_WIDTH}px"
    style:height="{STAGE_HEIGHT}px"
    style:transform="scale({scale})"
  >
    {@render children()}
  </div>
</div>

<style>
  .viewport {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--void);
    overflow: hidden;
  }

  .stage {
    position: relative;
    flex: none;
    transform-origin: center center;
    background: var(--ink-900);
    overflow: hidden;
  }
</style>
