/**
 * 판정 시계 (PLAN §5). 이 파일이 M1 의 심장이다.
 *
 * 브라우저에는 서로 다른 시계가 셋 있다.
 *   AudioContext.currentTime  실제로 들리는 소리의 위치. 128샘플 블록 단위로 움직인다
 *   performance.now()          입력 이벤트의 timeStamp 와 같은 기준
 *   requestAnimationFrame      화면. 16.7ms 간격이라 판정에 쓰면 등급이 바뀐다
 *
 * 판정은 오디오 시계 기준이어야 하는데 입력은 performance 기준으로 들어온다.
 * 둘을 묶는 게 이 클래스의 일이다. `getOutputTimestamp()` 가 같은 순간의
 * (contextTime, performanceTime) 쌍을 주므로 그걸로 주기적으로 다시 맞춘다 —
 * 탭이 백그라운드에 갔다 오거나 오디오 장치가 바뀌면 두 시계가 어긋난다.
 */

export interface ClockOffsets {
  /** 코덱 프라이밍 등 곡 고유 지연(ms). 채보에서 온다. */
  audioOffsetMs: number
  /** 플레이어 캘리브레이션(ms). 양수면 "소리가 늦게 들린다"는 뜻. */
  userOffsetMs: number
}

/** 재동기화 주기. 너무 잦으면 지터가, 너무 드물면 드리프트가 남는다. */
const RESYNC_MS = 1000
/** 한 번에 보정할 최대 폭(초). 이보다 크게 튀면 그대로 받아들인다 (탭 복귀 등). */
const SLEW_MAX_SEC = 0.02

export class AudioClock {
  readonly ctx: AudioContext
  #buffer: AudioBuffer | null = null
  #source: AudioBufferSourceNode | null = null
  #gain: GainNode

  /** 곡 0초가 놓인 performance.now() 시각(ms). 모든 판정이 이 값에서 나온다. */
  #originMs = 0
  #startedAt = 0
  #running = false
  #resync = 0
  offsets: ClockOffsets = { audioOffsetMs: 0, userOffsetMs: 0 }

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.#gain = this.ctx.createGain()
    this.#gain.connect(this.ctx.destination)
  }

  get duration(): number {
    return this.#buffer?.duration ?? 0
  }

  get running(): boolean {
    return this.#running
  }

  set volume(v: number) {
    this.#gain.gain.value = v
  }

  /** decodeAudioData 는 버퍼를 떼어가므로 호출자가 사본을 주어야 한다. */
  async load(audio: ArrayBuffer): Promise<void> {
    this.#buffer = await this.ctx.decodeAudioData(audio)
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  /**
   * `whenMs` 뒤에 곡을 시작한다. 카운트다운 동안 노트가 미리 떨어져야 하므로
   * 시작 시각을 먼저 정해두고 그 전부터 songTime 이 음수로 흐르게 한다.
   */
  start(leadMs = 0): void {
    if (!this.#buffer) throw new Error('clock: load() 를 먼저 불러야 한다')
    const startAt = this.ctx.currentTime + leadMs / 1000
    const src = this.ctx.createBufferSource()
    src.buffer = this.#buffer
    src.connect(this.#gain)
    src.start(startAt)
    this.#source = src
    this.#startedAt = startAt
    this.#originMs = this.#contextToPerf(startAt)
    this.#running = true
    this.#resync = window.setInterval(() => this.#sync(), RESYNC_MS)
  }

  stop(): void {
    this.#running = false
    clearInterval(this.#resync)
    if (this.#source) {
      try {
        this.#source.stop()
      } catch {
        /* 아직 시작 전이면 던진다 */
      }
      this.#source.disconnect()
      this.#source = null
    }
  }

  async close(): Promise<void> {
    this.stop()
    await this.ctx.close()
  }

  /**
   * 입력 이벤트의 timeStamp(performance 기준, ms) → 곡 시각(ms).
   * **이벤트 핸들러에서 받은 timeStamp 를 그대로 넣어야 한다.** rAF 시각을 넣으면
   * 최대 16ms 오차가 붙고, 리듬게임에서 16ms 면 판정 등급이 바뀐다 (PLAN §4).
   */
  songTimeOf(perfMs: number): number {
    const { audioOffsetMs, userOffsetMs } = this.offsets
    return perfMs - this.#originMs - audioOffsetMs - userOffsetMs
  }

  /** 지금 곡 시각(ms). 렌더용 — 판정에는 이벤트 timeStamp 를 쓴다. */
  now(): number {
    return this.songTimeOf(performance.now())
  }

  /** 오디오 시계로 직접 읽은 곡 시각(ms). 진단·검증용. */
  nowFromAudio(): number {
    const { audioOffsetMs, userOffsetMs } = this.offsets
    return (this.ctx.currentTime - this.#startedAt) * 1000 - audioOffsetMs - userOffsetMs
  }

  #contextToPerf(contextTime: number): number {
    const ts = this.ctx.getOutputTimestamp?.()
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (contextTime - ts.contextTime) * 1000
    }
    // getOutputTimestamp 가 없으면 지금 이 순간을 기준으로 환산한다.
    return performance.now() + (contextTime - this.ctx.currentTime) * 1000
  }

  /**
   * 두 시계의 어긋남을 조금씩 당긴다. 한 번에 확 옮기면 노트가 순간이동한다 —
   * 큰 점프(탭 복귀)만 그대로 받는다.
   */
  #sync(): void {
    if (!this.#running) return
    const want = this.#contextToPerf(this.#startedAt)
    const drift = want - this.#originMs
    if (!Number.isFinite(drift)) return
    const lim = SLEW_MAX_SEC * 1000
    this.#originMs += Math.abs(drift) > lim * 5 ? drift : Math.max(-lim, Math.min(lim, drift)) * 0.25
  }
}
