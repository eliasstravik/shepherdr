// An artifact as the person sees it in the web app's viewer, on the machine that keeps it (SHEP-149): herdr-artifact
// preview serves this page on 127.0.0.1 only, with the artifact's recipe and pictures. It draws with the web app's own
// recipe view (screens/Recipe.tsx) and styles, at the web app's device widths (phone under 640 px), so an agent's
// screenshot of it is what the person gets. Choices and forms say Sent but reach no one: it is a preview.
import '../src/styles.css'
import clsx from 'clsx'
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Recipe, UNREADABLE } from '../src/screens/Recipe.tsx'
import * as R from '@core/recipe.js'
import { deviceFor as deviceOf } from '../src/kernel.ts'

const { withIds } = R as any

type Meta = { id: string; title: string; version: number; versions: { v: number; at: number; note?: string }[] }

const q = new URLSearchParams((window as any).viewerLink ?? location.search)
const id = q.get('artifact') ?? ''
const api = `api/artifacts/${encodeURIComponent(id)}`

/** how long ago, as the web app's viewer says it (plugins/artifacts ago): "just now", "5m ago", "2h ago", "3d ago" */
function ago(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}

function useDevice() {
  const [d, setD] = useState(() => deviceOf(innerWidth))
  useEffect(() => {
    const on = () => setD(deviceOf(innerWidth))
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])
  return d
}

/** a fetch that gives up after `ms` (the preview server could be stuck or gone: say so, never Loading forever, #971) */
async function get(url: string, ms = 15000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    const body = await r.json().catch(() => null)
    if (!r.ok) throw new Error(body?.error || (r.status === 404 ? 'This artifact is gone.' : UNREADABLE))
    return body
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`The preview server didn't answer in ${ms / 1000} s. Run herdr-artifact preview ${id} again for a fresh link.`)
    if (e instanceof TypeError) throw new Error(`The preview server can't be reached (it may have stopped). Run herdr-artifact preview ${id} again for a fresh link.`)
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** how often an open preview looks for a newer version (#1043): a publish shows here without a reload */
const FOLLOW_MS = 3000

function Viewer() {
  const device = useDevice()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [recipe, setRecipe] = useState<{ blocks: unknown[]; v: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pinned = Number(q.get('v')) || null
  useEffect(() => {
    let live = true, shown = 0, timer: ReturnType<typeof setTimeout> | undefined
    // the artifact's record, then the recipe of the version to show: the pinned one, else the newest, again whenever a
    // newer one is published (its pictures' addresses carry the version, so none comes from the cache of the last)
    const look = async () => {
      try {
        const m: Meta = await get(api)
        if (!live) return
        setMeta(m)
        document.title = m.title
        const v = pinned || m.version
        if (v !== shown) {
          const r = await get(`${api}/recipe?v=${v}`)
          if (!live) return
          shown = v
          setRecipe({ ...withIds(r), v })
        }
        setError(null)
      } catch (e) {
        // a hiccup while following keeps what shows; with nothing shown yet, say why
        if (live && !shown) setError((e as Error).message || UNREADABLE)
      }
      if (live && !pinned) timer = setTimeout(look, FOLLOW_MS)
    }
    look()
    return () => { live = false; clearTimeout(timer) }
  }, [])
  const v = recipe?.v ?? pinned ?? meta?.version
  const when = meta?.versions.find((x) => x.v === v)?.at
  return (
    // the web app's viewer: a slim bar (its title, which version) over the artifact, the whole screen its
    <div data-device={device} className="isolate flex h-dvh flex-col overflow-hidden bg-bg font-sans text-sm/5 text-fg antialiased phone:text-base/6">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line py-2 pr-3 pl-4 phone:gap-2 phone:px-3">
        <div className="min-w-0 flex-1 truncate font-medium">{meta?.title || 'Artifact'}</div>
        {v ? <div className="shrink-0 text-xs text-fg2 tabular-nums phone:text-[0.8125rem]">v{v}{when ? ` · ${ago(when)}` : ''}</div> : null}
        <div className="shrink-0 rounded-full bg-sel px-2 py-px text-[0.6875rem]/4 font-medium text-fg2" title="Shown on this machine only; answers aren't sent">Preview</div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          {error ? <p role="alert" className="p-4 text-fg3">{error}</p> : !recipe ? <p className="p-4 text-fg3">Loading…</p> : (
            <div className={clsx('h-full overflow-y-auto p-4 phone:p-5')}>
              <Shown key={recipe.v}>
                <Recipe recipe={recipe} asset={(src) => `${api}/file/${src.split('/').map(encodeURIComponent).join('/')}?v=${recipe.v}`} reply={async () => undefined} />
              </Shown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A recipe that fails to draw says so, with what went wrong, instead of leaving the page blank (#1025). */
class Shown extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null }
  static getDerivedStateFromError(e: Error) { return { failed: e?.message || String(e) } }
  render() {
    return this.state.failed
      ? <p role="alert" className="text-fg3">This version couldn't be drawn here ({this.state.failed}). <button type="button" className="underline" onClick={() => location.reload()}>Reload</button></p>
      : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Viewer /></StrictMode>)
