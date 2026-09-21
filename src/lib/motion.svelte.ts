/**
 * A critically-ish damped spring driven by rAF. Used for menu motion only —
 * gameplay judgement runs on AudioContext.currentTime and never touches this.
 * The loop stops as soon as the value settles, so an idle menu costs nothing.
 */
export interface SpringOptions {
  stiffness?: number
  damping?: number
}

export function spring(initial: number, { stiffness = 180, damping = 24 }: SpringOptions = {}) {
  let current = $state(initial)
  let target = initial
  let velocity = 0
  let frame = 0
  let last = 0

  const reduced = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    const accel = stiffness * (target - current) - damping * velocity
    velocity += accel * dt
    current += velocity * dt

    if (Math.abs(target - current) < 0.0004 && Math.abs(velocity) < 0.004) {
      current = target
      velocity = 0
      frame = 0
      return
    }
    frame = requestAnimationFrame(step)
  }

  return {
    get current() {
      return current
    },
    get target() {
      return target
    },
    set(value: number, { hard = false } = {}) {
      target = value
      if (hard || reduced()) {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        velocity = 0
        current = value
        return
      }
      if (!frame) {
        last = performance.now()
        frame = requestAnimationFrame(step)
      }
    },
    stop() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
