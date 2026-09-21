<script lang="ts">
  import { go } from '$lib/router.svelte'
  import { settings, setTheme, THEME_LABELS, THEMES } from '$lib/settings.svelte'
  import EnneaMark from '$lib/ui/EnneaMark.svelte'
  import Keycap from '$lib/ui/Keycap.svelte'

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') go({ screen: 'select' })
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="screen">
  <header>
    <EnneaMark size={24} />
    <span class="wordmark">ENNEA</span>
  </header>

  <h1>Settings</h1>

  <section>
    <h2>Colour theme</h2>
    <div class="themes" role="radiogroup" aria-label="Colour theme">
      {#each THEMES as theme (theme)}
        <button
          class="swatch"
          class:on={settings.theme === theme}
          data-theme={theme}
          role="radio"
          aria-checked={settings.theme === theme}
          onclick={() => setTheme(theme)}
        >
          <span class="preview">
            {#each Array.from({ length: 9 }) as _, i (i)}
              <i
                style:background={i === 4
                  ? 'var(--cursor)'
                  : i === 1
                    ? 'var(--click)'
                    : i === 7
                      ? 'var(--scroll)'
                      : 'var(--line)'}
              ></i>
            {/each}
          </span>
          <span class="name">{THEME_LABELS[theme]}</span>
        </button>
      {/each}
    </div>
  </section>

  <p class="later">Mouse sensitivity and audio offset move in here once the timing core lands.</p>

  <footer><Keycap label="Esc" /> back to song select</footer>
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

  h1 {
    position: absolute;
    top: 104px;
    left: 40px;
    margin: 0;
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -0.028em;
  }

  section {
    position: absolute;
    top: 208px;
    left: 40px;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 15px;
    font-weight: 600;
    color: var(--bone-dim);
  }

  .themes {
    display: flex;
    gap: 16px;
  }

  .swatch {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 14px;
    width: 156px;
    height: 156px;
    border: 1px solid var(--line);
    border-radius: var(--curve);
    background: var(--ink-900);
    color: var(--bone);
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .swatch:hover {
    border-color: var(--bone-faint);
  }

  .swatch.on {
    border-color: var(--cursor);
    box-shadow: inset 0 0 0 1px var(--cursor);
  }

  .preview {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    gap: 7px;
    width: 72px;
    height: 72px;
  }

  .preview i {
    border-radius: var(--curve);
  }

  .name {
    font-size: 13px;
    font-weight: 600;
  }

  .later {
    position: absolute;
    top: 420px;
    left: 40px;
    margin: 0;
    font-size: 13px;
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
