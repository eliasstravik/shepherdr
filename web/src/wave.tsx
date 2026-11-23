// The live wave of a sound's level (meter.ts): dictation's recording row and a voice call's mark draw it.
import { useEffect, useRef } from 'react'
import type { Sample } from './meter.ts'
import { still } from './motion.ts'

/** bars kept for the wave: one per BAR+GAP pixels, the newest on the right */
const BAR = 3
const GAP = 2
/** a new bar about every 60 ms: speech's syllables show as peaks */
const EVERY = 60

/** The wave: drawn from a real level (the microphone's in dictation, whoever talks in a call), scrolling left as it
 *  sounds; still dots before a sound, frozen while off. tint: a colour token for a sample (the call's agent in blue).
 *  With reduced motion: a calm level meter that fills and empties, no scroll. */
export function Wave({ on, sample, className = 'dwave', tint }: { on: boolean; sample: () => Sample; className?: string; tint?: (s: Sample) => string | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const bars = useRef<number[]>([])
  const calm = useRef(still())
  useEffect(() => {
    const c = ref.current
    if (!c) return
    let raf = 0
    let last = 0
    let smooth = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (!w || !h) return
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const css = getComputedStyle(c)
      const s = on ? sample() : null
      const v = s && tint?.(s)
      g.fillStyle = (v && css.getPropertyValue(v).trim()) || css.color
      const level = s ? s.level : 0
      if (calm.current) {
        // reduced motion: one bar that fills with how loud you are, eased so it doesn't flicker
        smooth += (level - smooth) * 0.2
        g.globalAlpha = 0.18
        round(g, 0, h / 2 - 2, w, 4)
        g.globalAlpha = 1
        if (smooth > 0.01) round(g, 0, h / 2 - 2, Math.max(4, w * Math.min(1, smooth * 1.4)), 4)
        return
      }
      const n = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)))
      if (on && now - last >= EVERY) {
        last = now
        bars.current.push(level)
        if (bars.current.length > n) bars.current.splice(0, bars.current.length - n)
      }
      const b = bars.current
      for (let i = 0; i < n; i++) {
        const v = b[b.length - n + i]
        const x = w - (n - i) * (BAR + GAP) + GAP
        // before any sound: a row of still dots; a sound: a bar as tall as it was loud
        const bh = v === undefined ? 2 : Math.max(2, Math.min(h, h * Math.min(1, v * 1.5)))
        // the oldest bars fade at the left edge
        g.globalAlpha = (v === undefined ? 0.25 : 1) * Math.min(1, (i + 1) / (n * 0.25))
        round(g, x, (h - bh) / 2, BAR, bh)
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [on, sample, tint])
  // the canvas fills its box and never sizes it: its pixel count (width x devicePixelRatio) once fed back into the
  // row's layout (a canvas's size attributes are its intrinsic size), so the wave ran out of the message box (3.2.3)
  return (
    <span className={`wv ${className}${on ? '' : ' off'}`} aria-hidden>
      <canvas ref={ref} />
    </span>
  )
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) / 2
  g.beginPath()
  if (g.roundRect) g.roundRect(x, y, w, h, r)
  else g.rect(x, y, w, h)
  g.fill()
}
