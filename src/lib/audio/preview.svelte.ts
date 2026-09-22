import { audioUrl } from '$lib/paths'
import type { Song } from '$lib/songs'

/**
 * 곡 선택 화면의 미리듣기.
 *
 * 음원을 fetch 로 받아 ArrayBuffer 로 캐시하고, 재생은 Blob URL + <audio> 로 한다.
 * 디코드된 AudioBuffer 를 캐시하지 않는 이유: 128초 스테레오 48kHz 가 ~49MB 다.
 * 원본 webm 은 2MB 라 몇 곡을 들고 있어도 싸고, **M1 의 AudioClock 이 같은 버퍼를
 * 그대로 decodeAudioData 에 넘길 수 있다** — 곡을 두 번 받지 않는다.
 *
 * 미리듣기는 판정과 무관하므로 <audio> 로 충분하다. 게임 플레이는 정확한 시킹이
 * 필요해서 AudioContext + AudioBufferSourceNode 를 쓴다 (PLAN §5).
 */

/** 들고 있을 곡 수. 곡당 ~2MB. */
const CACHE_LIMIT = 4
const FADE_MS = 450
const TARGET_LOOP_SEC = 20
const VOLUME = 0.55

class SongPreview {
  /** 지금 받고 있는 곡 slug. 화면은 이걸 보고 제목을 흐리게 한다. */
  loading = $state<string | null>(null)
  playing = $state<string | null>(null)
  /** 받기·재생에 실패한 곡. 조용히 넘어가되 한 번은 알린다. */
  failed = $state<string | null>(null)

  #armed = false
  #cache = new Map<string, ArrayBuffer>()
  #el: HTMLAudioElement | null = null
  #url: string | null = null
  #token = 0
  #timer: ReturnType<typeof setTimeout> | undefined
  #fade: ReturnType<typeof setInterval> | undefined

  /** 브라우저는 유저 제스처 전에 소리를 막는다. 첫 입력에서 푼다. */
  arm() {
    this.#armed = true
  }

  /** 이미 받아 둔 음원. M1 이 재사용한다 — decodeAudioData 는 버퍼를 떼어가므로 사본을 준다. */
  cached(slug: string): ArrayBuffer | undefined {
    return this.#cache.get(slug)?.slice(0)
  }

  /** 곡이 바뀔 때마다 호출. 캐러셀을 빠르게 넘기는 동안은 받지 않는다. */
  request(song: Song | undefined, delayMs = 350) {
    clearTimeout(this.#timer)
    const token = ++this.#token
    this.#silence()
    if (!song || song.placeholder || !this.#armed) return
    this.#timer = setTimeout(() => void this.#start(song, token), delayMs)
  }

  stop() {
    clearTimeout(this.#timer)
    this.#token++
    this.#silence()
  }

  async #start(song: Song, token: number) {
    try {
      let buf = this.#cache.get(song.slug)
      if (!buf) {
        this.loading = song.slug
        const res = await fetch(audioUrl(song.slug))
        if (!res.ok) throw new Error(`audio responded ${res.status}`)
        buf = await res.arrayBuffer()
        if (token !== this.#token) return
        this.#remember(song.slug, buf)
      }
      if (token !== this.#token) return
      this.loading = null
      this.#play(song, buf, token)
    } catch {
      if (token !== this.#token) return
      this.loading = null
      this.failed = song.slug
    }
  }

  #remember(slug: string, buf: ArrayBuffer) {
    this.#cache.set(slug, buf)
    while (this.#cache.size > CACHE_LIMIT) {
      const oldest = this.#cache.keys().next().value
      if (oldest === undefined) break
      this.#cache.delete(oldest)
    }
  }

  #play(song: Song, buf: ArrayBuffer, token: number) {
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/webm' }))
    const el = new Audio()
    el.preload = 'auto'
    el.volume = 0
    el.src = url
    this.#el = el
    this.#url = url

    const start = song.previewStartMs / 1000
    // 마디 단위로 끊어 되감는다 — 이음매가 음악적으로 자연스럽다.
    const barSec = (4 * 60) / song.bpm
    const loopSec = Math.max(barSec, Math.round(TARGET_LOOP_SEC / barSec) * barSec)

    el.addEventListener('loadedmetadata', () => {
      if (token !== this.#token) return
      el.currentTime = Math.min(start, Math.max(0, el.duration - loopSec))
      void el.play().then(
        () => {
          if (token !== this.#token) return
          this.playing = song.slug
          this.#rampTo(VOLUME)
        },
        () => {
          // 제스처 정책에 막혔다. 다음 입력 때 다시 시도된다.
          if (token === this.#token) this.#silence()
        },
      )
    })
    el.addEventListener('timeupdate', () => {
      if (token !== this.#token) return
      if (el.currentTime >= start + loopSec) el.currentTime = start
    })
    el.addEventListener('error', () => {
      if (token !== this.#token) return
      this.#silence()
      this.failed = song.slug
    })
  }

  #rampTo(target: number) {
    clearInterval(this.#fade)
    const el = this.#el
    if (!el) return
    const steps = Math.max(1, Math.round(FADE_MS / 40))
    const from = el.volume
    let i = 0
    this.#fade = setInterval(() => {
      i++
      try {
        el.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)))
      } catch {
        /* 요소가 이미 버려졌다 */
      }
      if (i >= steps) clearInterval(this.#fade)
    }, 40)
  }

  /** 즉시 조용히 하고 자원을 놓는다. 페이드아웃은 다음 곡 로딩과 겹쳐 지저분해진다. */
  #silence() {
    clearInterval(this.#fade)
    const el = this.#el
    const url = this.#url
    this.#el = null
    this.#url = null
    this.loading = null
    this.playing = null
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    if (url) URL.revokeObjectURL(url)
  }
}

export const preview = new SongPreview()
