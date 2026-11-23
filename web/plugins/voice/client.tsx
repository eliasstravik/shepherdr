// Voice: a hands-free, interruptible voice for Shepherdr as a whole, run over the app (no call screen). It operates
// the app through tools: it looks, opens things, sends and acts, with a yes before anything that deletes, merges or
// stops. The wave button starts it (furthest right in the header; at the right of a phone's bottom bar). In a call the
// button becomes two of the same size, Mute and End call, beside a live wave of whoever is talking (the agent in blue,
// you in the text colour, still dots while it connects). SHEP-326: a call shows no words anywhere: no state words, no
// captions, nothing in a chat; what it did shows as the usual cards. The mic inside the message box is dictation only.
import { useEffect, useState } from 'react'
import { DictateButton } from '@client/dictate.tsx'
import type { Sample } from '@client/meter.ts'
import { definePlugin, getState, go, launchHref, notice, openArtifact, openSettings, openTask, setUI, tryAct, useStore, useUI, type Thread } from '@client/kernel.ts'
import { closeTop as closeLayer } from '@client/overlay.tsx'
import { I, IB } from '@client/ui.tsx'
import { isEverything, placeOf, taskOf } from '@shared/view.ts'
import { callPhase, callSample, muteCall, sendWhere, startCall, stopCall, type Nav, type NavAck } from './call.ts'
import { wantsCall, withoutVoice } from './launch.ts'
import { CallButtonsView, CallMarkView } from './mark.tsx'
import { resetScreen, screenAction, type Head } from './screen.ts'

/** what this page shows, told to the call as it changes: its "here" and "this task" */
function whereNow() {
  const { ui } = getState()
  return { device: ui.phone ? 'phone' : 'desktop', place: ui.at, task: ui.task, tab: ui.pane, artifact: ui.art, settings: !!ui.settings, full: false }
}

function screenHead(): Head {
  const { ui, snap } = getState()
  const bits: string[] = []
  if (!snap) return { app: 'Shepherdr', shows: 'loading' }
  if (ui.settings) bits.push(`Settings${ui.settings.sec ? `, ${ui.settings.sec}` : ''}`)
  const a = ui.art && snap.artifacts.find((x) => x.id === ui.art)
  if (a) bits.push(`the artifact "${a.title}"`)
  const t = taskOf(snap, ui.task)
  if (t) bits.push(`the task "${t.name}"`)
  const p = placeOf(snap, ui.at)
  if (p && !(ui.phone && ui.pane)) bits.push(isEverything(snap, p.id) ? "Everything's chat" : `the ${p.name} space's chat`)
  if (ui.pane && !t && !a) bits.push(`the ${ui.pane === 'screen' ? 'Screen' : ui.pane === 'terminal' ? 'Terminal' : ui.pane === 'tasks' ? 'Tasks' : 'Artifacts'} ${ui.phone ? 'view' : 'pane'}`)
  return { app: `Shepherdr on a ${ui.phone ? 'phone' : 'computer'}`, shows: bits.join(', ') }
}

/** close what is on top: a menu or dialog, search, the settings, the list, then an open task or pane */
function closeTop(): string | null {
  if (closeLayer()) return 'Closed what was on top'
  const { ui } = getState()
  if (ui.search) return setUI({ search: false }), 'Closed search'
  if (ui.settings) return setUI({ settings: null }), 'Closed Settings'
  if (ui.drawer) return setUI({ drawer: false }), 'Closed the list'
  if (ui.art) return setUI({ art: null, artWide: false }), 'Closed the artifact'
  if (ui.task) return setUI({ task: null, wide: false }), 'Closed the task'
  if (ui.pane) return setUI({ pane: null }), 'Closed the pane'
  return null
}

const OFF = { settings: null, search: false, drawer: false } as const

/** What the voice asked to show (its open tool), here on this page: done, then checked on the page's own state, so the
 *  call says it's on screen only when it is. What voice did is marked in small print where it shows. */
export async function voiceNav(nav: Nav): Promise<NavAck> {
  const { snap } = getState()
  if (!snap) return { ok: false, why: 'the app is still loading' }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const no = (why: string): NavAck => ({ ok: false, why, where: whereNow() })
  const check = (ok: boolean, why: string): NavAck => (ok ? { ok: true, where: whereNow() } : no(why))
  if (nav.kind === 'screen') return { ...(await screenAction(nav, screenHead, { back: () => (history.length > 1 ? (history.back(), 'Went back one step') : closeTop()), closeTop })), where: whereNow() }
  if (nav.kind === 'call') return { ok: true, where: whereNow() }
  if (nav.kind === 'space' || (nav.kind === 'chat' && str(nav.chat).startsWith('p:'))) {
    const id = str(nav.place) || snap.places.find((p) => p.chat === str(nav.chat))?.id || ''
    if (!placeOf(snap, id)) return no("this app doesn't list that space")
    setUI(OFF)
    go(id)
    return check(getState().ui.at === id, "the space didn't open")
  }
  if (nav.kind === 'chat' || nav.kind === 'task') {
    const t = snap.tasks.find((x) => x.id === str(nav.task) || x.agent?.chat === str(nav.chat))
    if (!t) return no("this app doesn't list that task")
    setUI(OFF)
    openTask(t.id)
    if (str(nav.tab) === 'screen' || str(nav.tab) === 'browser') setUI({ pane: 'screen', scr: { key: `task:${t.id}`, src: 'b', drive: false } })
    return check(getState().ui.task === t.id, "the task didn't open")
  }
  if (nav.kind === 'artifact') {
    const id = str(nav.artifact)
    if (!snap.artifacts.some((a) => a.id === id)) return no("this app doesn't list that artifact")
    setUI(OFF)
    openArtifact(id)
    return check(getState().ui.art === id, "the artifact didn't open")
  }
  if (nav.kind === 'settings') {
    const names = ['General', 'Agents', 'Tasks', 'Secrets', 'Machines', 'Usage', 'Plugins']
    const want = str(nav.section).toLowerCase()
    const sec = want ? names.find((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase())) : null
    if (want && !sec) return no(`Settings has no page like "${str(nav.section)}": its pages are ${names.join(', ')}`)
    openSettings('all', sec ?? null)
    return check(!!getState().ui.settings, "Settings didn't open")
  }
  if (nav.kind === 'tasks' || nav.kind === 'needs') {
    setUI({ ...OFF, pane: 'tasks', task: null, art: null, wide: false, tab: 'Now' })
    return check(getState().ui.pane === 'tasks', "Tasks didn't open")
  }
  if (nav.kind === 'panel') {
    const panel = str(nav.panel)
    const { ui } = getState()
    const p = placeOf(snap, ui.at)
    if (!p) return no('no space is shown')
    if (panel === 'chat') return setUI({ ...OFF, pane: ui.phone ? null : ui.pane, aterm: { ...ui.aterm, [p.chat]: false } }), { ok: true, where: whereNow() }
    if (panel === 'terminal') return setUI({ ...OFF, aterm: { ...ui.aterm, [p.chat]: true } }), { ok: true, where: whereNow() }
    if (panel === 'screen' || panel === 'browser' || panel === 'desktop') return setUI({ ...OFF, pane: 'screen', scr: { key: ui.task ? `task:${ui.task}` : `chat:${ui.at}`, src: panel === 'desktop' ? 'd' : 'b', drive: false } }), { ok: true, where: whereNow() }
    if (panel === 'tasks' || panel === 'artifacts') return setUI({ ...OFF, pane: panel, task: null, art: null }), check(getState().ui.pane === panel, `${panel} didn't open`)
    return no(`this app has no ${panel} view`)
  }
  return no("this app can't show that")
}

function CallWhere() {
  const where = useStore((s) => (s.ui.call && s.snap ? JSON.stringify(whereNow()) : ''))
  useEffect(() => {
    if (where) sendWhere(JSON.parse(where) as Record<string, unknown>)
  }, [where])
  return null
}

let demoTimers: ReturnType<typeof setTimeout>[] = []
export function endCall() {
  demoTimers.forEach(clearTimeout)
  demoTimers = []
  stopCall()
  setUI({ call: false, callMuted: false })
}

export function toggleCall(resume: string | null = null) {
  const { ui } = getState()
  if (ui.call) return endCall()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  setUI({ call: true, callMuted: false })
  if (getState().snap?.demo) {
    // the demo's call: no audio, only what it does (the payment question opened, then answered)
    const later = (ms: number, f: () => void) => demoTimers.push(setTimeout(f, ms))
    later(3200, () => openTask('SHOP-14'))
    later(7800, () => void tryAct({ type: 'answer', chat: 'SHOP-14/worker', question: 'q-pay', choice: 0, byVoice: true }))
    return
  }
  resetScreen()
  const fail = (m: string) => {
    endCall()
    notice(/ElevenLabs key/i.test(m) ? 'Voice needs an ElevenLabs key: ask Shepherdr to add the secret ELEVENLABS_API_KEY.' : m)
  }
  void startCall(null, fail, voiceNav, () => getState().snap && sendWhere(whereNow()), (why) => { endCall(); if (why) notice(`Call ended: ${why}.`) }, { title: 'Shepherdr', hangUp: endCall, mute: (on) => { muteCall(on); setUI({ callMuted: on }) } }, () => endCall(), resume).catch(() => fail('Audio could not start on this device.'))
}

function toggleMute() {
  const on = !getState().ui.callMuted
  muteCall(on)
  setUI({ callMuted: on })
}

/** the call's phase, looked at twice a second while a call is on (it changes without the store knowing) */
function usePhase() {
  const on = useUI((u) => u.call)
  const [phase, setPhase] = useState(callPhase)
  useEffect(() => {
    if (!on) return
    setPhase(callPhase())
    const t = setInterval(() => setPhase(callPhase()), 500)
    return () => clearInterval(t)
  }, [on])
  return phase
}

/** the call's mark, from its live phase */
function CallMark({ phone }: { phone: boolean }) {
  const phase = usePhase()
  const demo = useStore((s) => !!s.snap?.demo)
  return <CallMarkView phone={phone} phase={demo ? 'listening' : phase} muted={useUI((u) => u.callMuted)} sample={demo ? demoSample : callSample} />
}

/** the demo's call has no audio: a made-up voice, you then the agent in turns, so its wave moves as a real one does */
function demoSample(): Sample {
  const t = performance.now() / 1000
  const who = Math.floor(t / 3) % 2 ? 'agent' : 'you'
  const words = Math.max(0, Math.sin(t * 9) * Math.sin(t * 2.3)) * (t % 3 < 2.4 ? 1 : 0)
  return { level: words * (who === 'agent' || !getState().ui.callMuted ? 0.6 : 0), who: words > 0.05 ? who : null }
}

function CallButtons({ phone }: { phone: boolean }) {
  return <CallButtonsView phone={phone} muted={useUI((u) => u.callMuted)} onMute={toggleMute} onEnd={endCall} />
}

function HeaderVoice(_: { thread: Thread }) {
  const call = useUI((u) => u.call)
  if (!call) return <IB icon="wave" label="Talk to Shepherdr" onClick={() => toggleCall()} />
  return (
    <>
      <CallMark phone={false} />
      <CallButtons phone={false} />
    </>
  )
}

function BarVoice() {
  const call = useUI((u) => u.call)
  return call ? <CallButtons phone /> : <button type="button" className="vbtn" aria-label="Talk to Shepherdr" onClick={() => toggleCall()}><I n="wave" c="s22" /></button>
}

function BarMark() {
  const call = useUI((u) => u.call)
  return call ? <div className="vcap"><CallMark phone /></div> : null
}

export default definePlugin({
  name: 'voice',
  setup(reg) {
    reg.header.push({ order: 50, View: HeaderVoice })
    reg.barEnd.push(BarVoice)
    reg.barAbove.push(BarMark)
    reg.overlays.push(CallWhere)
    reg.boxButtons.push({ order: 10, View: ({ thread, write }) => <DictateButton write={write} scope={thread.chat} /> })
    reg.voiceWake = () => !getState().ui.call && toggleCall()
    // opened from the home screen's "Talk" shortcut (?voice=1): straight into a call
    if (wantsCall(launchHref)) {
      history.replaceState(history.state, '', withoutVoice(location.href))
      setTimeout(() => !getState().ui.call && toggleCall(), 400)
    }
  },
})
