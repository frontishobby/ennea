<script lang="ts">
  import Stage from '$lib/shell/Stage.svelte'
  import SongSelect from '$lib/screens/SongSelect.svelte'
  import Settings from '$lib/screens/Settings.svelte'
  import Play from '$lib/screens/Play.svelte'
  import { nav } from '$lib/router.svelte'
  import { settings } from '$lib/settings.svelte'

  $effect(() => {
    document.documentElement.dataset.theme = settings.theme
  })
</script>

<Stage>
  {#if nav.route.screen === 'play'}
    <Play song={nav.route.song} chart={nav.route.chart} />
  {:else if nav.route.screen === 'settings'}
    <Settings />
  {:else}
    <SongSelect />
  {/if}
</Stage>
