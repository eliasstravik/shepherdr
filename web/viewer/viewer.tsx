// An artifact as the person sees it in the web app's viewer, on the machine that keeps it (SHEP-149): herdr-artifact
// preview serves this page on 127.0.0.1 only, with the artifact's recipe and pictures. It draws with the web app's own
// recipe view (screens/Recipe.tsx) and styles, at the web app's device widths (phone under 640 px), so an agent's
// screenshot of it is what the person gets. Choices and forms say Sent but reach no one: it is a preview.
import '../src/styles.css'
import clsx from 'clsx'
import { StrictMode, useEffect, useState } from 'react'
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

function Viewer() {
  const device = useDevice()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [recipe, setRecipe] = useState<{ blocks: unknown[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch(api)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error || 'gone')))))
      .then((m: Meta) => {
        setMeta(m)
        document.title = m.title
        const v = Number(q.get('v')) || m.version
        return fetch(`${api}/recipe?v=${v}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(UNREADABLE))))
      })
      .then((r) => setRecipe(withIds(r)), (e: Error) => setError(e.message || UNREADABLE))
  }, [])
  const v = Number(q.get('v')) || meta?.version
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
          {error ? <p className="p-4 text-fg3">{error}</p> : !recipe ? <p className="p-4 text-fg3">Loading…</p> : (
            <div className={clsx('h-full overflow-y-auto p-4 phone:p-5')}>
              <Recipe recipe={recipe} asset={(src) => `${api}/file/${src.split('/').map(encodeURIComponent).join('/')}?v=${v}`} reply={async () => undefined} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Viewer /></StrictMode>)
