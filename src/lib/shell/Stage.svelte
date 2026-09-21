<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * The whole game lives in a 1280x720 logical field (PLAN §3). Everything
   * inside works in those units; this is the only place a real pixel appears.
   * Scaling here rather than in the game means mouse sensitivity is identical
   * at every window size, because Pointer Lock deltas go straight into
   * logical coordinates.
   */
  let { children }: { children: Snippet } = $props()

  const fit = () => Math.min(window.innerWidth / 1280, window.innerHeight / 720)
  let scale = $state(fit())
</script>

<svelte:window onresize={() => (scale = fit())} />

<div class="viewport">
  <div class="stage" style:transform="scale({scale})">
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
    width: 1280px;
    height: 720px;
    flex: none;
    transform-origin: center center;
    background: var(--ink-900);
    overflow: hidden;
  }
</style>
