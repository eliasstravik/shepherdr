// A plugin of the human's own (~/.shepherdr/plugins) can't take the screen down: its setup runs in a try, and whatever
// it adds to the slots is wrapped, so an error in it stops only that plugin's parts. Settings → Plugins says why.
import { Component, createElement, useSyncExternalStore, type FC, type ReactNode } from 'react'

let errors: Record<string, string> = {}
const listeners = new Set<() => void>()

/** a plugin of the human's own failed on this screen: its first error is kept */
export function pluginFailed(name: string, e: unknown) {
  if (errors[name]) return
  console.error(`plugin ${name} failed, so its parts are stopped:`, e)
  errors = { ...errors, [name]: e instanceof Error ? e.message : String(e) }
  for (const l of listeners) l()
}

/** the human's own plugins that failed on this screen, by name */
export const usePluginErrors = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => errors,
  )

class Boundary extends Component<{ name: string; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    pluginFailed(this.props.name, e)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** a plugin's view that draws nothing once it throws */
export function guardView<P extends object>(name: string, View: FC<P>): FC<P> {
  const Guarded: FC<P> = (props) => createElement(Boundary, { name }, createElement(View, props))
  Guarded.displayName = `${name}(${View.displayName ?? View.name ?? 'view'})`
  return Guarded
}

/** a plugin's function (a key handler, a test, an action) that gives `fallback` once it throws */
export function guardFn<A extends unknown[], R>(name: string, f: (...a: A) => R, fallback: R): (...a: A) => R {
  return (...a) => {
    try {
      const r = f(...a)
      return r instanceof Promise ? (r.catch((e) => (pluginFailed(name, e), fallback)) as R) : r
    } catch (e) {
      pluginFailed(name, e)
      return fallback
    }
  }
}

/** the parts of a slot item that are views; the rest of its functions are plain ones */
const VIEWS = new Set(['View', 'Icon'])

/** Run a plugin of the human's own's setup: on an error the registry is as it was before, and each part it added is
 *  wrapped. */
export function setupGuarded<R extends object>(name: string, registry: R, setup: (r: R) => void) {
  const reg = registry as Record<string, unknown>
  const before: Record<string, unknown> = Object.fromEntries(
    Object.entries(reg).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { ...v } : v]),
  )
  try {
    setup(registry)
  } catch (e) {
    for (const [k, v] of Object.entries(before)) {
      if (Array.isArray(v)) (reg[k] as unknown[]).splice(0, Infinity, ...v)
      else if (v && typeof v === 'object') {
        const now = reg[k] as Record<string, unknown>
        for (const kk of Object.keys(now)) delete now[kk]
        Object.assign(now, v)
      } else reg[k] = v
    }
    return pluginFailed(name, e)
  }
  const fallback = (k: string) => (k === 'useOff' ? null : k === 'settingActions' ? 'That failed.' : false)
  const item = (x: unknown): unknown => {
    if (typeof x === 'function') return guardView(name, x as FC)
    if (!x || typeof x !== 'object') return x
    return Object.fromEntries(
      Object.entries(x).map(([k, v]) => [k, typeof v !== 'function' ? v : VIEWS.has(k) ? guardView(name, v as FC) : guardFn(name, v as () => unknown, fallback(k))]),
    )
  }
  for (const [k, v] of Object.entries(reg)) {
    const was = before[k]
    if (Array.isArray(v)) reg[k] = v.map((x) => ((was as unknown[]).includes(x) ? x : item(x)))
    else if (typeof v === 'function') {
      if (v !== was) reg[k] = guardView(name, v as FC)
    } else if (v && typeof v === 'object') {
      const old = was as Record<string, unknown>
      for (const [kk, vv] of Object.entries(v)) {
        if (vv === old[kk] || typeof vv !== 'function') continue
        ;(v as Record<string, unknown>)[kk] = k === 'settingActions' ? guardFn(name, vv as () => unknown, fallback(k)) : guardView(name, vv as FC)
      }
    }
  }
}
