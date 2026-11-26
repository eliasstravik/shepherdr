// The page starts here: the styles, this device's look, the plugins that are on, the link to the server.
import './styles.css'
import './prefs.ts'
import './awake.ts'
import './warnings.tsx'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import plugins, { enabled, user } from '../generated/client-plugins.ts'
import { App } from './App.tsx'
import { pluginFailed } from './guard.tsx'
import { connect, installPlugins, registry, setUI, useStore, useUI, type ClientPlugin } from './kernel.ts'
import { applySizes } from './resize.ts'
import { UpdateChip } from './update-chip.tsx'
import { watchViewport } from './viewport.ts'

/** Your phone can't reach Shepherdr: a thin line. What you typed stays in the box and sends when it is back. */
function Offline() {
  const offline = useUI((u) => u.offline)
  const restarting = useStore((s) => s.update?.state === 'restarting')
  if (!offline) return null
  return (
    <div role="status" className="tline">
      {restarting ? 'Shepherdr is updating · back in a moment' : "Can't reach Shepherdr · retrying"}
    </div>
  )
}
registry.topBars.push(Offline, UpdateChip)

async function start() {
  const loaded: ClientPlugin[] = []
  for (const p of plugins) {
    if ('setup' in p) loaded.push(p)
    else
      try {
        loaded.push((await p.load()).default)
      } catch (e) {
        pluginFailed(p.name, e)
      }
  }
  // the plugins switched off in Settings › Plugins are left out: their buttons, menu items and settings are gone
  let off: string[] = []
  try {
    off = ((await (await fetch('api/me')).json()) as { off?: string[] }).off ?? []
  } catch {
    /* the link is down: every plugin, until the first snapshot says otherwise */
  }
  ;(window as { shepherdrOff?: string[] }).shepherdrOff = off
  installPlugins(loaded.filter((p) => !off.includes(p.name)), enabled.filter((n) => !off.includes(n)), user)
  applySizes()
  connect()
  watchViewport((up) => setUI({ keyboard: up }))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start()
