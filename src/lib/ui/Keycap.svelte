<script lang="ts">
  let { label }: { label: string } = $props()
</script>

<kbd>{label}</kbd>

<style>
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 26px;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--line);
    border-radius: var(--r-28);
    background: var(--ink-800);
    color: var(--bone-dim);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }
</style>
