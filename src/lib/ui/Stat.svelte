<script lang="ts">
  /**
   * One fact, one square. Values that fit live in a 76px square; longer ones
   * keep the same corner curvature via the matching px step (--r-76).
   */
  let {
    value,
    label,
    wide = false,
    muted = false,
  }: { value: string | number; label: string; wide?: boolean; muted?: boolean } = $props()
</script>

<div class="stat" class:wide class:muted>
  <span class="value tnum">{value}</span>
  <span class="label">{label}</span>
</div>

<style>
  .stat {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 3px;
    width: 76px;
    height: 76px;
    border: 1px solid var(--line);
    border-radius: var(--curve);
    background: var(--ink-800);
  }

  .wide {
    width: 164px;
    border-radius: var(--r-76);
  }

  .value {
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.015em;
  }

  .muted .value {
    color: var(--bone-faint);
  }

  .label {
    font-size: 11px;
    font-weight: 500;
    color: var(--bone-faint);
  }
</style>
