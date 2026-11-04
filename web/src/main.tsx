import './styles.css'
import './theme.ts'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import plugins, { enabled, user } from '../generated/client-plugins.ts'
import App from './App.tsx'
import { watchKeys } from './focus.ts'
import { pluginFailed, usePluginErrors } from './guard.tsx'
import { connect, getState, installPlugins, registry, setUI, useStore, useUI } from './kernel.ts'
import { watchScrolling } from './scrolling.ts'
import Settings, { sectionOf, withPluginErrors } from './Settings.tsx'
import { watchViewport } from './viewport.ts'

/** a bar across the top: the first one keeps clear of a phone's notch (the screen's own top under it then doesn't) */
const topBar = 'shrink-0 bg-bubble px-4 py-1.5 text-center text-[0.8125rem] text-fg2 phone:text-[0.9375rem] [[data-device=phone]>&:first-child]:pt-[calc(env(safe-area-inset-top)+6px)]'
const barButton = 'relative font-medium text-fg underline after:absolute after:-inset-x-1.5 after:-inset-y-2.5'

/** Lost the link to Shepherdr (no tailnet): say so at the top; the screen keeps what it last showed. */
function Offline() {
  const offline = useUI((u) => u.offline)
  const restarting = useStore((s) => s.update?.state === 'restarting')
  if (!offline) return null
  if (restarting)
    return (
      <div role="status" data-topbar className={topBar}>
        Shepherdr is updating. Back in a moment.
      </div>
    )
  const at = new Date(offline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div role="status" data-topbar className={topBar}>
      Can't reach Shepherdr since {at}. Showing what it showed last; trying again.
    </div>
  )
}

/** Shepherdr couldn't update itself to a new commit: it keeps running the last version and says why. */
function UpdateFailed() {
  const update = useStore((s) => s.update)
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState<string | null>(null)
  if (update?.state !== 'failed' || hidden === update.commit) return null
  const [why, ...log] = (update.error ?? '').split('\n')
  return (
    <div role="status" data-topbar className={topBar}>
      Couldn't update to “{update.subject || update.commit.slice(0, 7)}”: {why.replace(/:$/, '')}. Still on the last version.{' '}
      {log.length ? (
        <button type="button" className={barButton} onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'Why'}
        </button>
      ) : null}{' '}
      <button type="button" className={barButton} onClick={() => setHidden(update.commit)}>
        Hide
      </button>
      {open ? <pre className="mt-1 max-h-40 overflow-auto text-left font-mono text-[0.6875rem] whitespace-pre-wrap">{log.join('\n')}</pre> : null}
    </div>
  )
}

/** A plugin of the human's own didn't build, threw as it loaded or threw here: one line, Settings → Plugins says why. */
function PluginTrouble() {
  const settings = useStore((s) => s.snap?.settings)
  const errors = usePluginErrors()
  const [hidden, setHidden] = useState<string | null>(null)
  const page = withPluginErrors(settings ?? [], errors).find((x) => x.name === 'Plugins')
  const names = [...new Set([...(page?.rows ?? []).filter((r) => r.warn).map((r) => r.label), ...Object.keys(errors)])]
  const key = names.join(' ')
  if (!names.length || hidden === key) return null
  const open = () => setUI({ settings: { section: Math.max(0, sectionOf('Plugins', settings ?? [], getState().ui)) }, drawer: false })
  return (
    <div role="status" data-topbar className={topBar}>
      {names.length === 1 ? `Your plugin “${names[0]}” has a problem` : `Your plugins ${names.map((n) => `“${n}”`).join(', ')} have problems`}.{' '}
      <button type="button" className={barButton} onClick={open}>
        Why
      </button>{' '}
      <button type="button" className={barButton} onClick={() => setHidden(key)}>
        Hide
      </button>
    </div>
  )
}

registry.views.settings = Settings
registry.topBars.push(Offline, UpdateFailed, PluginTrouble)
// the human's own plugins load first, each on its own: one that throws as it loads is left out
const loaded = await Promise.all(
  plugins.map(async (p) => {
    if (!('load' in p)) return p
    try {
      return (await p.load()).default
    } catch (e) {
      pluginFailed(p.name, e)
      return null
    }
  }),
)
installPlugins(loaded.filter((p) => p !== null), enabled, user)
connect()
watchViewport((keyboard) => setUI({ keyboard }))
watchScrolling()
watchKeys()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
