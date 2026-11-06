// Voice: a call is with a voice agent that passes what you say to this chat's agent as ordinary messages and reads
// the replies out. While it is on, that chat's box is the call (Mute, End). The call stays with the agent you called:
// elsewhere its space's row in the sidebar has a green mark with the call's clock, which goes back to it (SHEP-51), and
// where no sidebar shows it (a phone, a tablet, a shut sidebar) a slim band at the top does the same (SHEP-66). The voice agent's open tool shows things here (voiceNav) and its screen tool reads and acts on
// this very page (screen.ts), whichever device started the call.
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { act, chatName, definePlugin, getState, goChat, goPlace, listView, openArtifact, openItem, openTask, placeOf, placesDrawn, registry, setFilter, setUI, shownItem, taskInMiddle, useSnap, useStore, useUI, visibleChats, type UI } from '@client/kernel.ts'
import { ic, IconButton, LiveWave, MicIcon, MicOffIcon, NextIcon, roundBtn, useElapsed, WaveIcon, Waves, XIcon } from '@client/ui.tsx'
import { useWindowWidth } from '@client/Frame.tsx'
import { cancelDictation } from '@plugins/chat/client.tsx'
import { pageNames, sectionLike, sectionOf } from '@client/Settings.tsx'
import { openAccept } from '@client/screens/Accept.tsx'
import { callPhase, callSample, muteCall, sendWhere, startCall, stopCall, type Nav, type NavAck } from './call.ts'
import { key, press, resetScreen, screenAction, type Head } from './screen.ts'

/** the Tasks panel's filter for a task state the voice agent named */
const FILTER: Record<string, string> = { need: 'needs', work: 'working', ready: 'ready', merging: 'merging', queued: 'queued', scheduled: 'scheduled', todo: 'todo', done: 'done', automations: 'automations' }
/** a task's tab as the side panel names it */
const ITEM: Record<string, string> = { terminal: 'terminal', files: 'files', changes: 'diff', pr: 'pr', browser: 'browser' }
const PANEL_WORDS: Record<string, string> = { tasks: 'Tasks', artifacts: 'Artifacts', files: 'Files', changes: 'Changes', needs: 'Needs you' }

/** what this page shows now, as the call is told it */
function whereNow() {
  const { ui, snap } = getState()
  if (!snap) return {}
  return { device: ui.device, place: ui.place, task: ui.task, tab: ui.task ? shownItem(ui, snap) ?? 'chat' : null, artifact: ui.viewer?.artifact ?? null, settings: !!ui.settings }
}

/** what this page shows, in a few words, for the head of the screen's list */
function screenHead(): Head {
  const { ui, snap } = getState()
  const app = `the web app on a ${ui.device}`
  if (!snap) return { app, shows: 'nothing yet (loading)' }
  const bits: string[] = []
  if (ui.settings) {
    const name = ui.settings.section === null ? null : pageNames(snap.settings ?? [], ui)[ui.settings.section]
    bits.push(`Settings${name ? ` › ${name}` : ''}`)
  }
  const art = ui.viewer ? (snap.artifacts ?? []).find((a) => a.id === ui.viewer!.artifact) : null
  if (art) bits.push(`the artifact "${art.title}"`)
  if (ui.task) bits.push(`task ${ui.task}${shownItem(ui, snap) ? `, its ${shownItem(ui, snap)}` : ''}`)
  const p = snap.places.find((x) => x.id === ui.place)
  if (p && !(ui.device === 'phone' && ui.task)) bits.push(`the ${p.name} space${ui.term === p.chat ? "'s terminal" : ''}`)
  if (ui.device === 'phone' ? ui.tab !== 'chat' && !ui.task : !ui.sideShut) bits.push(`the ${PANEL_WORDS[ui.device === 'phone' ? ui.tab : ui.side] ?? ui.side} ${ui.device === 'phone' ? 'tab' : 'panel'}`)
  return { app, shows: bits.join(', ') }
}

const LAYERS_OFF = { viewer: null, settings: null, search: false, menu: false, plus: null, photo: null, adding: false } as const

/** Close what is on top: an open menu, a dialog (by its Close or Cancel), then the app's layers, then a phone's task. */
function closeTop(): string | null {
  const { ui, snap } = getState()
  if (ui.menu || ui.plus || ui.pick || ui.taskMenu) { setUI({ menu: false, plus: null, pick: null, taskMenu: false }); return 'Closed the menu' }
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]')].filter((m) => m.offsetParent !== null).at(-1)
  if (menu) { key('Escape', menu); return 'Closed the menu' }
  const layer: [keyof UI, unknown, string][] = [
    ['photo', null, 'Closed the picture'], ['viewer', null, 'Closed the artifact'], ['search', false, 'Closed search'], ['adding', false, 'Closed Add a project'],
    ['find', null, 'Closed find'], ['archived', null, 'Closed the archived tasks'], ['sheet', null, 'Closed the task\'s panel'], ['settings', null, 'Closed Settings'],
    ['arts', null, 'Back to the chat from its artifacts'], ['term', null, 'Back to the chat from the terminal'], ['drawer', false, 'Closed the spaces list'],
  ]
  // a dialog that isn't one of the app's layers (the Accept card, a confirm, an agent's role): its own Close or Cancel
  const dialog = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="alertdialog"], dialog[open]')].filter((d) => d.offsetParent !== null || d.getClientRects().length).at(-1)
  const ownLayer = layer.some(([k]) => !!ui[k]) && dialog && (ui.viewer || ui.photo || ui.settings || ui.search || ui.adding) && !dialog.matches('[role="alertdialog"]')
  if (dialog && !ownLayer) {
    const close = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')].find((b) => /^(close|cancel|not now|dismiss)\b/i.test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()))
    const name = dialog.getAttribute('aria-label') || 'the dialog'
    if (close) { press(close); return `Closed ${name}` }
    key('Escape', dialog)
    return `Pressed Escape on ${name}`
  }
  for (const [k, off, did] of layer) if (ui[k]) { setUI({ [k]: off } as Partial<UI>); return did }
  // a page shown inside a panel (an artifact in the Artifacts list, a task's file): the screen's own ‹ Back
  const own = [...document.querySelectorAll<SVGElement>('[data-back]')].map((i) => i.closest<HTMLElement>('button, [role="button"], a')).filter((b): b is HTMLElement => !!b && b.getClientRects().length > 0)
  const side = own.filter((b) => b.closest('[data-side], aside, [role="complementary"]')).at(-1) ?? own.at(-1)
  if (side) { press(side); return `Pressed ‹ ${(side.getAttribute('aria-label') || side.textContent || 'Back').trim().slice(0, 40)}` }
  if (ui.task && (ui.device === 'phone' || (snap && taskInMiddle(ui, snap)))) { setUI({ task: null, sheet: null }); return 'Closed the task' }
  return null
}

/** The app's Back (nav.ts: each screen is a step in the history): one step back, only within the app. */
function goBack(): string | null {
  const st = history.state as { shep?: number; prev?: string | null } | null
  if (st?.shep && st.prev) { history.back(); return 'Went back one step' }
  return closeTop()
}

/** What the voice agent asked to show (its open tool), here on this page: done, then checked on the page's own state,
 *  so the call says it's on screen only when it is. Its screen tool's actions are done here too (screen.ts). */
export async function voiceNav(nav: Nav): Promise<NavAck> {
  const { ui, snap } = getState()
  if (!snap) return { ok: false, why: 'the app is still loading' }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const no = (why: string): NavAck => ({ ok: false, why, where: whereNow() })
  const check = (ok: boolean, why: string): NavAck => (ok ? { ok: true, where: whereNow() } : no(why))
  if (nav.kind === 'screen') {
    const a = await screenAction(nav, screenHead, { back: goBack, closeTop })
    return { ...a, where: whereNow() }
  }
  if (nav.kind === 'space') {
    const id = str(nav.place)
    if (!snap.places.some((p) => p.id === id)) return no('this app doesn\'t list that space')
    setUI(LAYERS_OFF)
    goPlace(id)
    const now = getState().ui
    return check(now.place === placeOf(snap, id).id && !now.task, 'the space didn\'t open')
  }
  if (nav.kind === 'chat' && str(nav.chat)) {
    setUI(LAYERS_OFF)
    goChat(str(nav.chat))
    setUI({ term: null, arts: null })
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
    const at = nav.section ? sectionLike(str(nav.section), snap.settings ?? [], ui) : -1
    if (nav.section && at < 0) return no(`Settings has no page like "${str(nav.section)}": its pages are ${pageNames(snap.settings ?? [], ui).join(', ')}`)
    setUI({ settings: { section: ui.device === 'phone' && at < 0 ? null : Math.max(0, at) }, drawer: false })
    return check(!!getState().ui.settings, 'Settings didn\'t open')
  }
  if (nav.kind === 'tasks' || nav.kind === 'needs') {
    setUI(LAYERS_OFF)
    const taskFilter = nav.kind === 'needs' ? 'needs' : FILTER[str(nav.filter)] ?? 'all'
    setUI(ui.device === 'phone' ? { task: null, tab: 'tasks', taskFilter, pick: null } : { side: 'tasks', sideShut: false, taskFilter, ...(ui.task && taskInMiddle(ui, snap) ? { task: null } : {}) })
    // words to filter by (a task's name or id): typed in the panel's filter box, as the person would
    const view = listView(getState().ui, snap)
    if (nav.kind === 'tasks') setFilter(view.search, 'tasks', str(nav.search))
    const now = getState().ui
    return check(now.taskFilter === taskFilter && (ui.device === 'phone' ? now.tab === 'tasks' : now.side === 'tasks'), 'the Tasks panel didn\'t open')
  }
  if (nav.kind === 'panel') {
    const panel = str(nav.panel)
    setUI(LAYERS_OFF)
    const p = placeOf(snap, ui.place)
    if (panel === 'terminal' || panel === 'chat') {
      // the space's Assistant: Chat | Terminal
      setUI({ task: null, tab: 'chat', term: panel === 'terminal' ? p.chat : null, arts: null })
      return check(getState().ui.term === (panel === 'terminal' ? p.chat : null), `the ${panel} didn't open`)
    }
    if (panel === 'artifacts' && !registry.views.artifacts) return no('Artifacts is turned off in this app')
    if ((panel === 'files' || panel === 'changes') && !(snap.panels ?? ['files', 'changes']).includes(panel)) return no(`this space has no ${panel} panel`)
    if (ui.device === 'phone') {
      if (panel === 'files' || panel === 'changes') return no(`a phone shows ${panel} only on a task: open the task's ${panel} tab`)
      setUI({ task: null, tab: panel as UI['tab'], pick: null })
      return check(getState().ui.tab === panel, `the ${panel} tab didn't open`)
    }
    setUI({ side: panel as UI['side'], sideShut: false, ...(ui.task && taskInMiddle(ui, snap) ? { task: null } : {}) })
    const now = getState().ui
    return check(now.side === panel && !now.sideShut, `the ${panel} panel didn't open`)
  }
  if (nav.kind === 'task') {
    const id = str(nav.task), tab = str(nav.tab)
    if (!snap.tasks.some((t) => t.id === id)) return no('this app doesn\'t list that task')
    setUI(LAYERS_OFF)
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
  resetScreen()
  void startCall(chatKey, (message) => {
    endCall()
    // no key yet: the window's card over the box says where it goes (callBar), not an error
    if (/ElevenLabs key/i.test(message)) return void (help = chatKey, helpers.forEach((f) => f()))
    setUI({ callError: message })
  }, voiceNav, () => {
    // the call's socket is open: where this page is, from the start
    if (getState().snap) sendWhere(whereNow())
  }, () => { if (getState().ui.call === chatKey) endCall() }).catch(() => { endCall(); setUI({ callError: 'Audio could not start on this device.' }) })
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

/** SHEP-66: a call whose chat isn't on screen, where the sidebar's call mark can't be seen (a phone, a tablet, a shut
 *  sidebar): a slim band across the very top in the mark's soft green, with the call's name and clock. A tap goes back
 *  to its chat. It pushes the app down rather than covering it, and on a phone it holds the notch's room itself. Not
 *  the loud green bar SHEP-51 took away: no buttons, the mark's colours, a line of small words. Mute and End stay in
 *  the call's box. */
function CallBanner() {
  const width = useWindowWidth()
  const call = useStore((s) => {
    const { ui, snap } = s
    if (!ui.call || !snap) return null
    // its chat on screen: not under Settings, an artifact, or flipped to its terminal or artifacts
    const shown = !ui.settings && !ui.viewer && ui.term !== ui.call && ui.arts !== ui.call && visibleChats(ui, snap).includes(ui.call)
    // a desktop's open sidebar has its mark already
    return shown || placesDrawn(ui, snap, width) ? null : ui.call
  })
  return call ? <CallBand call={call} /> : null
}

function CallBand({ call }: { call: string }) {
  const snap = useSnap()!
  const t = useElapsed(useUI((u) => u.callStarted))
  const name = chatName(snap, call)
  return (
    <button
      type="button"
      data-topbar
      data-call-banner
      aria-label={`Back to the voice call with ${name}, ${t}`}
      // its chat, not the terminal or artifacts it was flipped to, and nothing over it
      onClick={() => { setUI({ settings: null, viewer: null, search: false, menu: false, plus: null }); goChat(call); setUI({ term: null, arts: null }) }}
      className={clsx(
        'press-dim flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 bg-[color-mix(in_srgb,var(--ready)_11%,var(--bg))] px-4 text-[0.75rem] font-medium text-ready-fg tabular-nums shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--ready)_22%,transparent)]',
        // a phone: a finger's height, the words a step up, and the notch's room above them
        'phone:h-auto phone:min-h-8 phone:py-1.5 phone:text-[0.8125rem] [[data-device=phone]>&:first-child]:pt-[calc(env(safe-area-inset-top)+6px)]',
      )}
    >
      <Waves className="h-3 shrink-0 scale-75" />
      <span className="min-w-0 truncate">{name}</span>
      <span aria-hidden className="opacity-50">·</span>
      <span className="shrink-0">{t}</span>
      <NextIcon aria-hidden className="-mr-1 size-3.5 shrink-0 opacity-60 phone:size-4" />
    </button>
  )
}

/** a note at the top about the call (why it stopped), in the call's pill shape and its words' size */
const callPill = 'mx-3 mt-2 flex shrink-0 [[data-device=phone]>&:first-child]:mt-[calc(env(safe-area-inset-top)+8px)] items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-4 text-[0.8125rem] font-medium phone:text-[0.9375rem]'

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
    reg.topBars.push(CallBanner, CallError, CallWhere)
    reg.composerAbove.push({ order: 7, View: CallHelp })
    // 3.0 calls with Ctrl+Shift+Space (the keyboard plugin): no V or M keys of its own
  },
})
