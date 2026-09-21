/**
 * Wheel normalisation (PLAN §4).
 *
 * A notched wheel fires one event per notch with deltaY around +/-100.
 * A trackpad fires dozens of inertial events with deltaY of 1-5, and a
 * free-spin wheel fires hundreds. Reading deltaY straight would let a
 * trackpad sweep through ten notes — or ten songs — in one flick.
 *
 * So: normalise deltaMode to pixels, accumulate magnitude, emit one tick
 * per threshold, then go deaf for a cooldown to kill inertial repeats.
 * Reset the accumulator when direction flips.
 */
export interface WheelTick {
  dir: -1 | 1
  /** The event's own timeStamp, never a rAF clock (PLAN §4). */
  timeStamp: number
}

export interface WheelOptions {
  /** Accumulated pixels before a tick fires. */
  threshold?: number
  /** Deaf window after a tick, in ms. */
  cooldown?: number
}

export function createWheelTicker(
  emit: (tick: WheelTick) => void,
  { threshold = 50, cooldown = 70 }: WheelOptions = {},
) {
  let accum = 0
  let lastDir = 0
  let deafUntil = 0

  return (event: WheelEvent) => {
    const dy =
      event.deltaMode === 1
        ? event.deltaY * 16 // LINE
        : event.deltaMode === 2
          ? event.deltaY * 400 // PAGE
          : event.deltaY // PIXEL

    // Horizontal flicks on a trackpad should browse too.
    const dx = event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX
    const primary = Math.abs(dx) > Math.abs(dy) ? dx : dy
    if (primary === 0) return

    const dir = Math.sign(primary) as -1 | 1
    if (dir !== lastDir) {
      accum = 0
      lastDir = dir
    }
    accum += Math.abs(primary)

    if (accum >= threshold && event.timeStamp >= deafUntil) {
      emit({ dir, timeStamp: event.timeStamp })
      accum = 0
      deafUntil = event.timeStamp + cooldown
    }
  }
}
