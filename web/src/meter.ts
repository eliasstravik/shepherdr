// How loud a sound is right now, 0 to 1: the live waves of a call and of talk to type draw from it.
const bufs = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>()

export function meter(ctx: AudioContext): AnalyserNode {
  const an = ctx.createAnalyser()
  an.fftSize = 512
  return an
}

export function levelOf(an: AnalyserNode | null): number {
  if (!an) return 0
  let buf = bufs.get(an)
  if (!buf) bufs.set(an, (buf = new Float32Array(an.fftSize)))
  an.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  // a room's hum stays at nothing; speech fills about half the height, a loud voice all of it
  return Math.min(1, Math.max(0, (Math.sqrt(Math.sqrt(sum / buf.length)) - 0.08) * 2.5))
}

/** what a wave draws: how loud, and whose voice it is */
export interface Sample {
  level: number
  who: 'you' | 'agent' | null
}

/** the voice counts as talking above this level */
export const TALKING = 0.06
