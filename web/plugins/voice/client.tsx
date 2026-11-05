// Voice: a call is with a voice agent that passes what you say to this chat's agent as ordinary messages and reads
// the replies out. While it is on, that chat's box is the call. The call stays with the agent you called: elsewhere a
// green bar shows who, Go back returns.
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { act, agentChat, chatName, definePlugin, getState, goChat, goPlace, openArtifact, openItem, openTask, placeOf, setUI, shownItem, useSnap, useStore, useUI, visibleChats } from '@client/kernel.ts'
import { ic, IconButton, LiveWave, MicIcon, MicOffIcon, roundBtn, useElapsed, WaveIcon, Waves, XIcon } from '@client/ui.tsx'
import { cancelDictation } from '@plugins/chat/client.tsx'
import { sectionOf } from '@client/Settings.tsx'
import { openAccept } from '@client/screens/Accept.tsx'
import { callPhase, callSample, muteCall, sendWhere, startCall, stopCall, type Nav, type NavAck } from './call.ts'

/** the Tasks panel's filter for a task state the voice agent named */
const FILTER: Record<string, string> = { need: 'needs', work: 'working', ready: 'ready', merging: 'merging', queued: 'queued', todo: 'todo', done: 'done' }
/** a task's tab as the side panel names it */
const ITEM: Record<string, string> = { terminal: 'terminal', files: 'files', changes: 'diff', pr: 'pr', browser: 'browser' }

/** what this page shows now, as the call is told it */
function whereNow() {
  const { ui, snap } = getState()
  if (!snap) return {}
  return { device: ui.device, place: ui.place, task: ui.task, tab: ui.task ? shownItem(ui, snap) ?? 'chat' : null, artifact: ui.viewer?.artifact ?? null, settings: !!ui.settings }
}

/** What the voice agent asked to show (its open tool), here on this page: done, then checked on the page's own state,
 *  so the call says it's on screen only when it is. */
export function voiceNav(nav: Nav): NavAck {
  const { ui, snap } = getState()
  if (!snap) return { ok: false, why: 'the app is still loading' }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const no = (why: string): NavAck => ({ ok: false, why, where: whereNow() })
  const check = (ok: boolean, why: string): NavAck => (ok ? { ok: true, where: whereNow() } : no(why))
  if (nav.kind === 'space') {
    const id = str(nav.place)
    if (!snap.places.some((p) => p.id === id)) return no('this app doesn\'t list that space')
    setUI({ viewer: null, settings: null, search: false, menu: false, plus: null })
    goPlace(id)
    const now = getState().ui
    return check(now.place === placeOf(snap, id).id && !now.task, 'the space didn\'t open')
  }
  if (nav.kind === 'chat' && str(nav.chat)) {
    setUI({ viewer: null, settings: null, search: false, menu: false, plus: null })
    goChat(str(nav.chat))
    return check(visibleChats(getState().ui, snap).includes(str(nav.chat)), 'that chat didn\'t open')
  }
  if (nav.kind === 'artifact' && str(nav.artifact)) {
    const id = str(nav.artifact)
    if (!(snap.artifacts ?? []).some((a) => a.id === id)) return no('this app doesn\'t list that artifact')
    setUI({ settings: null, search: false, menu: false, plus: null })
    openArtifact(id)
    return check(getState().ui.viewer?.artifact === id, 'the artifact didn\'t open')
  }
  if (nav.kind === 'settings') {
    setUI({ viewer: null, search: false, menu: false, plus: null })
    const at = nav.section ? sectionOf(str(nav.section), snap.settings ?? [], ui) : -1
    setUI({ settings: { section: ui.device === 'phone' && at < 0 ? null : Math.max(0, at) }, drawer: false })
    return check(!!getState().ui.settings, 'Settings didn\'t open')
  }
  if (nav.kind === 'tasks' || nav.kind === 'needs') {
    setUI({ viewer: null, settings: null, search: false, menu: false, plus: null })
    const taskFilter = nav.kind === 'needs' ? 'needs' : FILTER[str(nav.filter)] ?? 'all'
    setUI(ui.device === 'phone' ? { task: null, tab: 'tasks', taskFilter, pick: null } : { side: 'tasks', sideShut: false, taskFilter })
    const now = getState().ui
    return check(now.taskFilter === taskFilter && (ui.device === 'phone' ? now.tab === 'tasks' : now.side === 'tasks'), 'the Tasks panel didn\'t open')
  }
  if (nav.kind === 'task') {
    const id = str(nav.task), tab = str(nav.tab)
    if (!snap.tasks.some((t) => t.id === id)) return no('this app doesn\'t list that task')
    setUI({ viewer: null, settings: null, search: false, menu: false, plus: null })
    if (tab === 'review') { openAccept(id); return { ok: true, where: whereNow() } }
    openTask(id)
    const item = ITEM[tab]
    if (item) {
      if (getState().ui.device === 'desktop') setUI((u) => ({ sidebars: { ...u.sidebars, panelOpen: true, item } }))
      else openItem(item)
    }
    return check(getState().ui.task === id, 'the task didn\'t open')
  }
  return no('this app can\'t show that')
}

/** While a call is on: what this page shows, told to the call as it changes (its "here" and "this task"). */
function CallWhere() {
  const where = useStore((s) => {
    if (!s.ui.call || !s.snap) return ''
    return JSON.stringify({ device: s.ui.device, place: s.ui.place, task: s.ui.task, tab: s.ui.task ? shownItem(s.ui, s.snap) ?? 'chat' : null,
      artifact: s.ui.viewer?.artifact ?? null, settings: !!s.ui.settings })
  })
  useEffect(() => { if (where) sendWhere(JSON.parse(where)) }, [where])
  return null
}

export function toggleCall(chatKey: string) {
  const ui = getState().ui
  if (ui.call === chatKey) return endCall()
  if (ui.call) endCall()
  if (ui.dict) cancelDictation()
  // the box turns into the call: nothing to type, so the keyboard goes down
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  setUI({ call: chatKey, callStarted: Date.now(), callMuted: false, callError: null, focus: null, plus: null })
  act({ type: 'call', chat: chatKey, on: true })
  void startCall(chatKey, (message) => {
    endCall()
    // no key yet: the window's card over the box says where it goes (callBar), not an error
    if (/ElevenLabs key/i.test(message)) return void (help = chatKey, helpers.forEach((f) => f()))
    setUI({ callError: message })
  }, voiceNav, () => {
    // the call's socket is open: where this page is, from the start
    if (getState().snap) sendWhere(whereNow())
  }).catch(() => { endCall(); setUI({ callError: 'Audio could not start on this device.' }) })
}

/** the chat whose call couldn't start for want of a key: the card over its box */
let help: string | null = null
const helpers = new Set<() => void>()

/** as the window's (mods/chat callBar): why a call can't start, where the key goes, Open Secrets */
function CallHelp({ chatKey }: { chatKey: string }) {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick((x) => x + 1); helpers.add(f); return () => void helpers.delete(f) }, [])
  const settings = useStore((s) => s.snap?.settings)
  if (help !== chatKey) return null
  const close = () => { help = null; helpers.forEach((f) => f()) }
  return (
    <div role="status" className="flex flex-col gap-2 rounded-[8px] bg-bubble px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line2)]">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium text-fg">Voice calls need an ElevenLabs key</span>
        <IconButton label="Close" className="rounded-full!" onClick={close}><XIcon className={ic} /></IconButton>
      </div>
      <p className="text-[0.8125rem] text-fg2">Add your key in Settings › Secrets as ELEVENLABS_API_KEY, then press the call button again.</p>
      <div>
        <button type="button" onClick={() => { close(); setUI({ settings: { section: Math.max(0, sectionOf('Secrets', settings ?? [], getState().ui)) }, drawer: false }) }}
          className="press-dim h-7 rounded-[7px] bg-bg px-2.5 text-[0.78125rem] font-medium text-fg shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover phone:h-10">
          Open Secrets
        </button>
      </div>
    </div>
  )
}

export function endCall() {
  const key = getState().ui.call
  if (!key) return
  stopCall()
  setUI({ call: null, callMuted: false })
  act({ type: 'call', chat: key, on: false })
}

function CallButton({ chatKey }: { chatKey: string }) {
  const on = useUI((u) => u.call === chatKey)
  return (
    <button
      type="button"
      aria-label="Voice call"
      aria-pressed={on}
      onClick={() => toggleCall(chatKey)}
      className="press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-fg text-bg after:absolute after:-inset-1.5 aria-pressed:bg-ready phone:size-11"
    >
      <WaveIcon />
    </button>
  )
}

export function toggleMute() {
  const on = !getState().ui.callMuted
  muteCall(on)
  setUI({ callMuted: on })
}

const WORD = { connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }

function usePhase() {
  const [phase, set] = useState(callPhase)
  useEffect(() => {
    const t = setInterval(() => set(callPhase()), 150)
    return () => clearInterval(t)
  }, [])
  return phase
}

/** On a call the chat box is the call: no typing, a live wave of who is talking, what the call is doing, Mute and End */
function CallBox({ chatKey }: { chatKey: string }) {
  const ui = useUI()
  const snap = useSnap()!
  const phase = usePhase()
  const t = useElapsed(ui.callStarted)
  // muted shows whenever the agent isn't speaking, so a silent call never looks like it's listening
  const word = ui.callMuted && phase !== 'speaking' ? 'Muted' : WORD[phase]
  return (
    <>
      {/* a call control, not the talk to type mic: filled, and struck through and dark while muted */}
      <IconButton
        label={ui.callMuted ? 'Unmute' : 'Mute'}
        pressed={ui.callMuted}
        className={clsx(roundBtn, 'bg-bubble! text-fg! aria-pressed:bg-fg! aria-pressed:text-bg!')}
        onClick={toggleMute}
      >
        {ui.callMuted ? <MicOffIcon className={ic} /> : <MicIcon className={ic} />}
      </IconButton>
      <LiveWave sample={callSample} label={`Voice call with ${chatName(snap, chatKey)}`} className="ml-1.5 flex-1" />
      <p className="flex shrink-0 items-baseline gap-1.5 px-2 text-[0.8125rem] phone:text-[0.9375rem]">
        <span role="status" className="font-medium text-fg">
          {word}
        </span>
        <span className="text-fg3 tabular-nums">{t}</span>
      </p>
      <button
        type="button"
        aria-label="End call"
        onClick={endCall}
        className="press-dim relative grid size-[34px] shrink-0 place-items-center rounded-full bg-need text-white after:absolute after:-inset-1.5 phone:size-11"
      >
        {/* the window's red round X */}
        <XIcon className={ic} />
      </button>
    </>
  )
}

const callBtn = 'press-dim relative h-8 shrink-0 rounded-full px-3.5 text-[0.8125rem] font-medium after:absolute after:-inset-y-1.5 after:-inset-x-0.5 coarse:h-11 phone:h-11 phone:text-[0.9375rem]'
/** a bar at the top about the call: the call's own pill shape, in its words' size */
const callPill = 'mx-3 mt-2 flex shrink-0 [[data-device=phone]>&:first-child]:mt-[calc(env(safe-area-inset-top)+8px)] items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-4 text-[0.8125rem] font-medium phone:text-[0.9375rem]'

function CallBar() {
  // a call in a chat not on screen; its clock ticks only while it shows
  const call = useStore((s) => (s.snap && s.ui.call && !visibleChats(s.ui, s.snap).includes(s.ui.call) ? s.ui.call : null))
  return call ? <CallLine call={call} /> : null
}

function CallLine({ call }: { call: string }) {
  const snap = useSnap()!
  const t = useElapsed(useUI((u) => u.callStarted))
  return (
    // a deeper green in light mode and dark words in dark mode, so the words read on it in both
    <div data-topbar className={clsx(callPill, 'bg-[color-mix(in_srgb,var(--ready)_80%,black)] text-white dark:bg-ready dark:text-black')}>
      <Waves />
      <span className="min-w-0 flex-1 truncate tabular-nums">
        Voice call with {chatName(snap, call)} · {t}
      </span>
      <button type="button" className={clsx(callBtn, 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_40%,transparent)]')} onClick={() => goChat(call)}>
        Go back
      </button>
      {/* the window's hang-up: a red round X ("End call") */}
      <button type="button" aria-label="End call" className="press-dim relative grid size-8 shrink-0 place-items-center rounded-full bg-need text-white after:absolute after:-inset-1.5 phone:size-11" onClick={endCall}>
        <XIcon className={ic} />
      </button>
    </div>
  )
}

/** A call that stopped on an error says why at the top, in the call bar's shape, until closed. */
function CallError() {
  const error = useUI((u) => u.callError)
  if (!error) return null
  return (
    <div data-topbar role="status" className={clsx(callPill, 'bg-bubble font-normal text-fg2')}>
      <span className="min-w-0 flex-1 text-pretty">Voice call: {error}</span>
      <IconButton label="Close" className="rounded-full!" onClick={() => setUI({ callError: null })}>
        <XIcon className={ic} />
      </IconButton>
    </div>
  )
}

export default definePlugin({
  name: 'voice',
  setup(reg) {
    reg.composerIdle = CallButton
    reg.composerLive.push({ when: (ui, chatKey) => ui.call === chatKey, View: CallBox })
    reg.topBars.push(CallBar, CallError, CallWhere)
    reg.composerAbove.push({ order: 7, View: CallHelp })
    // 3.0 calls with Ctrl+Shift+Space (the keyboard plugin): no V or M keys of its own
  },
})
