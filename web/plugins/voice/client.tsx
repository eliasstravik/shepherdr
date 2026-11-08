// Voice (SHEP-105): a call with Shepherdr itself, not one chat. One voice takes what you say to any space's Assistant
// or task's agent, tells you when they reply or need you, and opens things here (voiceNav; its screen tool reads and
// acts on this very page, screen.ts, whichever device started the call). It starts from the "Talk to Shepherdr" row at
// the top of the sidebar, which becomes the call card while it is on (what it last said, Mute, End); on a phone from
// the voice button at the end of the bottom bar, with a green strip of Mute and End above the bar (a chat's box has no
// call button since SHEP-108: it is always Send). Where neither shows (a shut sidebar, a task open on a phone)
// the strip sits at the top. Whatever the voice opens gets an "Opened by voice" tag for a moment.
import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { act, definePlugin, getState, goChat, goPlace, listView, openArtifact, openItem, openTask, placeOf, placesDrawn, registry, setFilter, setUI, shownItem, taskInMiddle, useStore, useUI, visibleChats, type UI } from '@client/kernel.ts'
import { EndCallIcon, FitIcon, ic, IconButton, MicIcon, MicOffIcon, RoundButton, UnfitIcon, useElapsed, WaveIcon, Waves, XIcon } from '@client/ui.tsx'
import { useWindowWidth } from '@client/Frame.tsx'
import { cancelDictation } from '@plugins/chat/client.tsx'
import { pageNames, sectionLike, sectionOf } from '@client/Settings.tsx'
import { openAccept } from '@client/screens/Accept.tsx'
import { callDoing, callPhase, callSample, muteCall, sendWhere, startCall, stepsAside, stopCall, type Nav, type NavAck } from './call.ts'
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
  return { device: ui.device, place: ui.place, task: ui.task, tab: ui.task ? shownItem(ui, snap) ?? 'chat' : null, artifact: ui.viewer?.artifact ?? null, settings: !!ui.settings, full: ui.callFull }
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
  // SHEP-124: the call's own view (call_view): full screen or minimized, set here, never by clicks
  if (nav.kind === 'call') return callView(nav.full === true)
  const was = getState().ui.callFull
  const ack = await doNav(nav)
  // what the voice opened is tagged for a moment, so a screen that changed by itself says why
  if (ack.ok && nav.kind !== 'screen') openedByVoice()
  // SHEP-118: whatever the voice opens or does on the page is meant to be seen: the full-screen call steps aside.
  // SHEP-124: but not when that very action opened it (a screen click on the call's Full screen button)
  if (stepsAside(nav, ack.ok, was, getState().ui.callFull)) {
    setUI({ callFull: false })
    // what the call is told it shows: minimized now
    if (ack.where) return { ...ack, where: { ...ack.where, full: false } }
  }
  return ack
}

/** SHEP-124: the voice agent's call_view: the call full screen (full) or minimized, checked on the page's state */
function callView(full: boolean): NavAck {
  if (!getState().ui.call) return { ok: false, why: 'no call is on in this app', where: whereNow() }
  setUI(full ? { callFull: true, menu: false, plus: null } : { callFull: false })
  const ok = getState().ui.callFull === full
  return ok ? { ok: true, where: whereNow() } : { ok: false, why: full ? 'the call didn\'t go full screen' : 'the call didn\'t minimize', where: whereNow() }
}

async function doNav(nav: Nav): Promise<NavAck> {
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
      artifact: s.ui.viewer?.artifact ?? null, settings: !!s.ui.settings, full: s.ui.callFull })
  })
  useEffect(() => { if (where) sendWhere(JSON.parse(where)) }, [where])
  return null
}

/** Start a call with Shepherdr (from: the chat whose call button started it, its "here" while the screen shows no
 *  chat), or end the one on. */
export function toggleCall(from: string | null = null) {
  const ui = getState().ui
  if (ui.call) return endCall()
  if (ui.dict) cancelDictation()
  // the keyboard goes down: the call is listening
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  setUI({ call: true, callFull: true, callFrom: from, callStarted: Date.now(), callMuted: false, callError: null, focus: null, plus: null })
  act({ type: 'call', chat: from ?? '', on: true })
  resetScreen()
  const started = getState().ui.callStarted
  const mine = () => getState().ui.call && getState().ui.callStarted === started
  void startCall(from, (message) => {
    endCall()
    // no key yet: a card says where it goes, not an error
    if (/ElevenLabs key/i.test(message)) return void (help = true, helpers.forEach((f) => f()))
    setUI({ callError: message })
  }, voiceNav, () => {
    // the call's socket is open: where this page is, from the start
    if (getState().snap) sendWhere(whereNow())
  }, () => { if (mine()) endCall() }, {
    // the lock screen and Control Center show the call: hang up and mute from there (SHEP-102)
    title: 'Shepherdr',
    hangUp: () => { if (mine()) endCall() },
    mute: (on) => { if (!mine()) return; muteCall(on); setUI({ callMuted: on }) },
  }).catch(() => { endCall(); setUI({ callError: 'Audio could not start on this device.' }) })
}

/** a call couldn't start for want of a key: a card says where it goes */
let help = false
const helpers = new Set<() => void>()
function useHelp() {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick((x) => x + 1); helpers.add(f); return () => void helpers.delete(f) }, [])
  return [help, () => { help = false; helpers.forEach((f) => f()) }] as const
}

/** as the window's (mods/chat callBar): why a call can't start, where the key goes, Open Secrets */
function CallHelp({ className }: { className?: string }) {
  const [shown, close] = useHelp()
  const settings = useStore((s) => s.snap?.settings)
  if (!shown) return null
  return (
    <div role="status" className={clsx('flex flex-col gap-2 rounded-[8px] bg-bubble px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line2)]', className)}>
      <div className="flex items-center gap-2">
        <p className="flex-1 font-medium text-fg">Voice calls need an ElevenLabs key</p>
        <IconButton label="Close" className="rounded-full!" onClick={close}><XIcon className={ic} /></IconButton>
      </div>
      <p className="text-[0.8125rem] text-fg2">Add your key in Settings › Secrets as ELEVENLABS_API_KEY, then start the call again.</p>
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
  const ui = getState().ui
  if (!ui.call) return
  stopCall()
  setUI({ call: false, callFull: false, callFrom: null, callMuted: false })
  act({ type: 'call', chat: ui.callFrom ?? '', on: false })
}

export function toggleMute() {
  const on = !getState().ui.callMuted
  muteCall(on)
  setUI({ callMuted: on })
}

const WORD = { connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', working: 'Working', speaking: 'Speaking', reconnecting: 'Reconnecting' }
type Phase = keyof typeof WORD

/** What the call is doing, in a word, from the conversation's own events (SHEP-113): Listening, Thinking, Working with
 *  what it does ("Working: checking tasks"), Speaking. Muted whenever the voice isn't speaking and the mic is off, but
 *  never over Thinking or Working: the person still sees it heard them. */
function usePhase() {
  const [now, set] = useState(() => ({ phase: callPhase() as Phase, doing: callDoing() }))
  useEffect(() => {
    const t = setInterval(() => {
      const phase = callPhase() as Phase, doing = callDoing()
      set((was) => (was.phase === phase && was.doing === doing ? was : { phase, doing }))
    }, 150)
    return () => clearInterval(t)
  }, [])
  const muted = useUI((u) => u.callMuted)
  const { phase, doing } = now
  // working: what it does says it ("Checking tasks…"), the dots beside say it's at work
  const word = muted && (phase === 'listening' || phase === 'connecting') ? 'Muted' : phase === 'working' && doing ? `${doing[0].toUpperCase()}${doing.slice(1)}…` : WORD[phase]
  return { word, phase }
}

/** SHEP-113: the call's mark beside its words, one per state: the wave moves while the voice speaks, stands still
 *  while it listens, and gives way to the typing dots while it thinks or works */
function CallMark({ phase, className }: { phase: Phase; className?: string }) {
  if (phase === 'thinking' || phase === 'working')
    return <span aria-hidden data-call-mark={phase} className={clsx('typing inline-flex shrink-0 items-center gap-[3px] [&>i]:size-[4px]!', className)}><i /><i /><i /></span>
  return <span data-call-mark={phase} className="contents"><Waves className={clsx('shrink-0', phase !== 'speaking' && 'wv-still', className)} /></span>
}

/** SHEP-108, SHEP-118: the minimized call's two buttons, one look wherever they show (a phone's bottom bar, the
 *  sidebar's card, the strip at the top): Full screen a quiet grey round that opens the call over everything again
 *  (Mute lives there only), End a red round with the hang-up phone that hangs up at once (SHEP-127: no question first).
 *  size: the bottom bar's, or the card's */
function CallControls({ size }: { size: 'bar' | 'card' }) {
  const btn = size === 'bar' ? 'size-14 max-[359px]:size-12' : 'size-8 phone:size-11'
  const glyph = size === 'bar' ? 'size-5' : ic
  return (
    <>
      <button type="button" aria-label="Open the call full screen" data-call-maximize onClick={() => setUI({ callFull: true })}
        className={clsx('press-dim relative grid shrink-0 place-items-center rounded-full bg-bubble text-fg2 after:absolute after:-inset-1', btn)}>
        <FitIcon className={glyph} />
      </button>
      <button type="button" aria-label="End call" onClick={endCall}
        className={clsx('press-dim relative grid shrink-0 place-items-center rounded-full bg-need text-white after:absolute after:-inset-1', btn)}>
        <EndCallIcon className={glyph} />
      </button>
    </>
  )
}

/** the soft green of a call (the old call mark's), its words in the ready colour */
const callTint = 'bg-[color-mix(in_srgb,var(--ready)_11%,var(--bg))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ready)_22%,transparent)]'

/** SHEP-105: the top of the spaces list: "Talk to Shepherdr", above everything it can reach. On a call it is the call
 *  card: Shepherdr, what it is doing and its clock, the last thing it said, Mute and End. */
function ShepherdrRow() {
  const on = useUI((u) => u.call)
  return (
    <div className="flex flex-col gap-2 px-2 pt-1.5 pb-1 phone:px-3 phone:pt-2">
      {on ? <CallCard /> : (
        <button type="button" onClick={() => toggleCall(null)} aria-label="Talk to Shepherdr: a voice call"
          className="press group flex min-h-9 items-center gap-2.5 rounded-row py-1 pr-1 pl-2 text-left text-[0.9375rem]/5 text-fg hover:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none coarse:min-h-11 phone:min-h-12 phone:pl-3 phone:text-base/6">
          <WaveIcon className="size-4 text-fg2 phone:size-[18px]" />
          <span className="min-w-0 flex-1 truncate font-medium">Talk to Shepherdr</span>
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-bg phone:size-9"><WaveIcon className="size-3.5 phone:size-4" /></span>
        </button>
      )}
      <CallHelp />
    </div>
  )
}

/** SHEP-108: the call's one place for its details: who, what it is doing and how long, then Mute and End. Never what
 *  was said: that is the chat's */
function CallCard() {
  const t = useElapsed(useUI((u) => u.callStarted))
  const { word, phase } = usePhase()
  return (
    <section aria-label="Voice call with Shepherdr" data-call-card data-phase={phase} className={clsx('flex items-center gap-2.5 rounded-[12px] py-1.5 pr-1.5 pl-3 phone:gap-3 phone:py-2 phone:pr-2 phone:pl-3.5', callTint)}>
      <span className="grid w-4 shrink-0 place-items-center text-ready-fg phone:w-5"><CallMark phase={phase} className="h-3.5 phone:h-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[0.9375rem]/5 font-semibold text-fg phone:text-base/6">Shepherdr</h2>
        <p className="flex min-w-0 gap-1 text-[0.75rem]/4 font-medium text-ready-fg tabular-nums phone:text-[0.8125rem]/5">
          <span role="status" className="min-w-0 truncate">{word}</span><span className="shrink-0">· {t}</span>
        </p>
      </div>
      <CallControls size="card" />
    </section>
  )
}

/** SHEP-105, SHEP-108: the end of a phone's bottom bar. Off a call: Talk to Shepherdr, a quiet grey round. On one:
 *  Mute and the red hang-up, nothing above the bar (the call's details are the sidebar's card) */
function PhoneCallButton() {
  const on = useUI((u) => u.call)
  return on ? <CallControls size="bar" /> : (
    <RoundButton label="Talk to Shepherdr" onClick={() => toggleCall(null)} className="size-14 max-[359px]:size-12">
      <WaveIcon className="size-5" />
    </RoundButton>
  )
}

/** the strip at the top where neither the sidebar's card nor a phone's bottom bar shows: Shepherdr, what it is doing
 *  and its clock, Mute and End */
function CallStrip() {
  const t = useElapsed(useUI((u) => u.callStarted))
  const { word, phase } = usePhase()
  return (
    <div data-call-strip data-topbar data-phase={phase} role="group" aria-label="Voice call with Shepherdr"
      className={clsx('mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-full py-1 pr-1 pl-3.5 text-[0.8125rem] font-medium text-ready-fg tabular-nums [[data-device=phone]>&:first-child]:mt-[calc(env(safe-area-inset-top)+8px)] phone:text-[0.9375rem]', callTint)}>
      <span className="grid w-4 shrink-0 place-items-center"><CallMark phase={phase} className="h-3" /></span>
      <p className="min-w-0 flex-1 truncate">
        <span className="text-fg">Shepherdr</span> · <span role="status">{word}</span> · {t}
      </p>
      <CallControls size="card" />
    </div>
  )
}

/** the strip at the top where no card or bottom bar shows the call: a shut sidebar, a tablet, a phone with a task or
 *  Settings over its home (SHEP-66's band, now with Mute and End) */
function CallBanner() {
  const on = useUI((u) => u.call)
  return useTop() && on ? <CallStrip /> : null
}

/** where the call shows at the top: neither the sidebar's card nor a phone's bottom bar is on screen */
function useTop() {
  const width = useWindowWidth()
  return useStore((s) => {
    const { ui, snap } = s
    if (!snap) return false
    if (ui.device === 'phone') return !!(ui.task || ui.settings || ui.keyboard)
    return !placesDrawn(ui, snap, width)
  })
}

/** the key's card where the sidebar's row doesn't show: above a phone's bar, else at the top */
function PhoneHelp() {
  return useTop() ? null : <CallHelp className="mx-4 mb-2" />
}

function TopHelp() {
  return useTop() ? <CallHelp className="mx-3 mt-2" /> : null
}

/* ---------- SHEP-118: the full-screen call ---------- */

/** the orb's swell, each frame from the call's sound: whoever speaks (nothing of yours while muted), smoothed */
function useOrbLevel(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let raf = 0, v = 0
    const step = () => {
      const s = callSample()
      const target = getState().ui.callMuted && s.who !== 'agent' ? 0 : s.level
      v += (target - v) * (target > v ? 0.35 : 0.12)
      ref.current?.style.setProperty('--lvl', v.toFixed(3))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ref])
}

/** one of the full-screen call's three round buttons, its word under it */
function BigCallButton({ label, word, onClick, pressed, className, children }: { label: string; word: string; onClick: () => void; pressed?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className="flex w-20 flex-col items-center gap-2">
      <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}
        className={clsx('press-dim relative grid size-16 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg', className)}>
        {children}
      </button>
      <p aria-hidden className="text-[0.8125rem]/5 text-fg2">{word}</p>
    </div>
  )
}

function minimize() { setUI({ callFull: false }) }

/** The call over everything, phone first (SHEP-118): calm and dark whatever the app's look, Shepherdr and the clock at
 *  the top, the orb in the middle with what the call does under it, and only the call's own buttons: Minimize, Mute,
 *  End. Held sideways (short and wide), the orb and its word sit left and the rest right (SHEP-126). Minimize (or Escape) puts it back in the bar, card or strip, whose Full screen button brings it back. */
function CallScreen() {
  const on = useUI((u) => u.call && u.callFull)
  return on ? <FullCall /> : null
}
function FullCall() {
  const t = useElapsed(useUI((u) => u.callStarted))
  const muted = useUI((u) => u.callMuted)
  const { word, phase } = usePhase()
  const orb = useRef<HTMLDivElement>(null)
  useOrbLevel(orb)
  const screen = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // the keyboard stays on the call: focus starts on it, Tab goes round its own buttons, Escape minimizes
    if (!screen.current?.contains(document.activeElement)) screen.current?.focus()
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); minimize() }
      else if (e.key === 'Tab' && screen.current) {
        const bs = [...screen.current.querySelectorAll<HTMLElement>('button')]
        const at = bs.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        bs[at < 0 ? (e.shiftKey ? bs.length - 1 : 0) : (at + (e.shiftKey ? bs.length - 1 : 1)) % bs.length]?.focus()
      }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  const look = muted && (phase === 'listening' || phase === 'connecting') ? 'muted' : phase
  return (
    <div ref={screen} tabIndex={-1} data-call-screen data-theme="dark" data-phase={look} role="dialog" aria-label="Voice call with Shepherdr"
      className="call-screen-in outline-none fixed inset-0 z-70 flex flex-col bg-[#08090a] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[max(env(safe-area-inset-bottom),--spacing(8))] pl-[env(safe-area-inset-left)] text-fg antialiased scheme-only-dark short:grid short:grid-cols-2 short:grid-rows-[1fr_auto_auto_1fr] short:pt-[max(env(safe-area-inset-top),--spacing(6))] short:pb-[max(env(safe-area-inset-bottom),--spacing(6))]">
      <header className="flex flex-col items-center gap-0.5 pt-8 short:col-start-2 short:row-start-2 short:pt-0">
        <h2 className="text-base/6 font-semibold">Shepherdr</h2>
        <p className="text-sm/5 text-fg2 tabular-nums">{t}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-12 px-6 short:col-start-1 short:row-span-full short:gap-(--orb-short-gap)">
        <div ref={orb} data-phase={look} aria-hidden className="call-orb w-[min(64vw,38dvh,300px)] short:w-(--orb-short)">
          <span className="call-orb-body"><span className="call-orb-swirl" /><span className="call-orb-sheen" /></span>
        </div>
        <p className="flex h-7 max-w-full min-w-0 items-center gap-2 text-lg/7 font-medium text-fg2">
          <span role="status" className="min-w-0 truncate">{word}</span>
          {phase === 'thinking' || phase === 'working' ? <span aria-hidden className="typing inline-flex shrink-0 items-center gap-[3px] [&>i]:size-[5px]!"><i /><i /><i /></span> : null}
        </p>
      </div>
      <div role="group" aria-label="Call controls" className="flex items-start justify-center gap-6 px-6 short:col-start-2 short:row-start-3 short:mt-10">
        <BigCallButton label="Minimize the call" word="Minimize" onClick={minimize} className="bg-white/10 text-fg">
          <UnfitIcon className="size-6" />
        </BigCallButton>
        <BigCallButton label={muted ? 'Unmute yourself' : 'Mute yourself'} word={muted ? 'Unmute' : 'Mute'} pressed={muted} onClick={toggleMute}
          className="bg-white/10 text-fg aria-pressed:bg-fg aria-pressed:text-[#08090a]">
          {muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
        </BigCallButton>
        <BigCallButton label="End call" word="End" onClick={endCall} className="bg-need text-white">
          <EndCallIcon className="size-6" />
        </BigCallButton>
      </div>
    </div>
  )
}

/* ---------- "Opened by voice" ---------- */

let opened = 0
const openers = new Set<() => void>()
function openedByVoice() {
  opened = Date.now()
  openers.forEach((f) => f())
}

/** a small green tag at the top for a few seconds after the voice opened something, so the screen changing says why */
function OpenedTag() {
  const [at, set] = useState(0)
  useEffect(() => { const f = () => set(opened); openers.add(f); return () => void openers.delete(f) }, [])
  useEffect(() => {
    if (!at) return
    const t = setTimeout(() => set(0), 3500)
    return () => clearTimeout(t)
  }, [at])
  if (!at) return null
  return (
    <div role="status" data-opened-by-voice
      className={clsx('pointer-events-none fixed top-[calc(env(safe-area-inset-top)+10px)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full py-1 pr-3 pl-2.5 text-[0.75rem] font-medium text-ready-fg phone:text-[0.8125rem]', callTint)}>
      <Waves className="h-3 shrink-0 scale-75" />
      Opened by voice
    </div>
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
    reg.sideTop.push(ShepherdrRow)
    reg.phoneBar.push(PhoneCallButton)
    // SHEP-122: no Listening pill above a phone's bar: the minimized call is its bar's buttons alone
    reg.phoneAbove.push(PhoneHelp)
    reg.topBars.push(CallBanner, TopHelp, CallError, CallWhere)
    reg.overlays.push(OpenedTag, CallScreen)
    // 3.0 calls with Ctrl+Shift+Space (the keyboard plugin): no V or M keys of its own
  },
})
