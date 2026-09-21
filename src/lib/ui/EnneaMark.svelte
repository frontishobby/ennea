<script lang="ts">
  /** The game is a 3x3 grid, so the mark is nine squares under the same law. */
  let { size = 26 }: { size?: number } = $props()
</script>

<div class="mark" style:--mark-size="{size}px" aria-hidden="true">
  {#each Array.from({ length: 9 }) as _, i (i)}
    <i class:center={i === 4}></i>
  {/each}
</div>

<style>
  .mark {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    gap: calc(var(--mark-size) * 0.11);
    width: var(--mark-size);
    height: var(--mark-size);
  }

  i {
    border-radius: var(--curve);
    background: var(--bone-faint);
  }

  .center {
    background: var(--cursor);
  }
</style>
