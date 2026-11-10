// Voice (SHEP-105): a call with Shepherdr itself, not one chat. One voice takes what you say to any space's Assistant
// or task's agent, tells you when they reply or need you, and opens things here (voiceNav; its screen tool reads and
// acts on this very page, screen.ts, whichever device started the call). It starts from the voice button beside Search in
// the sidebar's brand row, which is the call's Mute and End while it is on (SHEP-135); on a phone from the voice button
// at the end of the bottom bar, then Full screen, Mute and End (a chat's box has no call button since SHEP-108: it is
// always Send). Where neither shows (a shut sidebar, a task open on a phone) a strip sits at the top. Whatever the voice opens gets an "Opened by voice" tag for a moment.
import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { act, definePlugin, getState, goChat, goPlace, listView, openArtifact, openItem, openTask, placeOf, placesDrawn, registry, setFilter, setUI, shownItem, taskInMiddle, useStore, useUI, visibleChats, type UI } from '@client/kernel.ts'
import { EndCallIcon, FitIcon, ic, IconButton, MicIcon, MicOffIcon, RoundButton, UnfitIcon, useElapsed, WaveIcon, Waves, XIcon } from '@client/ui.tsx'
import { useWindowWidth } from '@client/Frame.tsx'
import { cancelDictation } from '@plugins/chat/client.tsx'
import { pageNames, sectionLike, sectionOf } from '@client/Settings.tsx'
import { openAccept } from '@client/screens/Accept.tsx'
import { callDoing, callPhase, callSample, muteCall, sendWhere, startCall, stepsAside, stopCall, type Nav, type NavAck } from './call.ts'
import { key, press, resetScreen, screenAction, type Head } from './screen.ts'

/** a task's tab as the side panel names it */
const ITEM: Record<string, string> = { terminal: 'terminal', pr: 'pr', browser: 'browser' }
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
    setUI(ui.device === 'phone' ? { task: null, tab: 'tasks', pick: null } : { side: 'tasks', sideShut: false, ...(ui.task && taskInMiddle(ui, snap) ? { task: null } : {}) })
    // words to filter by (a task's name or id): typed in the panel's filter box, as the person would
    const view = listView(getState().ui, snap)
    if (nav.kind === 'tasks') setFilter(view.search, 'tasks', str(nav.search))
    const now = getState().ui
    return check((ui.device === 'phone' ? now.tab === 'tasks' : now.side === 'tasks'), 'the Tasks panel didn\'t open')
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
      if (panel === 'files' || panel === 'changes') return no(`a phone has no ${panel} panel: it shows on a tablet or computer`)
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
  lastFrom = from
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
  }, (why) => {
    if (!mine()) return
    endCall()
    // SHEP-173: it ended by itself (not the person's End or yes): why, in plain words, with Call again
    if (why) setUI({ callError: `${ENDED}${why}.` })
  }, {
    // the lock screen and Control Center show the call: hang up and mute from there (SHEP-102)
    title: 'Shepherdr',
    hangUp: () => { if (mine()) endCall() },
    mute: (on) => { if (!mine()) return; muteCall(on); setUI({ callMuted: on }) },
  }).catch(() => { endCall(); setUI({ callError: 'Audio could not start on this device.' }) })
}

/** the chat the last call started from (Call again starts there) */
let lastFrom: string | null = null
/** a note that starts so is a call that ended by itself, said as it is ("Call ended: the connection was lost.") */
const ENDED = 'Call ended: '

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

/** SHEP-108, SHEP-118, SHEP-135: the minimized call's controls, one look wherever they show (the sidebar's brand row, a
 *  phone's bottom bar, the strip at the top), held together in one outlined capsule so they read as the call's: Full
 *  screen (where there is room for it) opens the call over everything again; Mute a quiet round, solid while muted;
 *  End a red round with the hang-up phone that hangs up at once (SHEP-127: no question first). size: the bottom
 *  bar's, or the brand row's and strip's */
function CallControls({ size, fit }: { size: 'bar' | 'head'; fit?: boolean }) {
  const muted = useUI((u) => u.callMuted)
  // the same pitch inside as beside it: the brand row's buttons are its icon buttons' size, as far apart as Search and
  // the toggle, the capsule's ring drawn in the margin so it takes no room; the bar's as far apart as the bar's pieces
  const btn = size === 'bar' ? 'size-12 max-[359px]:size-10' : 'size-7 phone:size-11'
  const glyph = size === 'bar' ? 'size-5' : ic
  const quiet = 'text-fg2 enabled:hover:bg-hover'
  return (
    <div role="group" aria-label="Call controls" data-call-controls
      className={clsx('flex shrink-0 items-center rounded-full shadow-[inset_0_0_0_1px_var(--line2)]', size === 'bar' ? 'gap-2 p-1 max-[359px]:gap-1' : '-m-0.5 gap-1 p-0.5')}>
      {fit ? (
        <button type="button" aria-label="Open the call full screen" data-call-maximize onClick={() => setUI({ callFull: true })}
          className={clsx('press-dim grid shrink-0 place-items-center rounded-full', quiet, btn)}>
          <FitIcon className={glyph} />
        </button>
      ) : null}
      <button type="button" aria-label={muted ? 'Unmute yourself' : 'Mute yourself'} aria-pressed={muted} onClick={toggleMute}
        className={clsx('press-dim grid shrink-0 place-items-center rounded-full', muted ? 'bg-fg text-bg' : quiet, btn)}>
        {muted ? <MicOffIcon className={glyph} /> : <MicIcon className={glyph} />}
      </button>
      <button type="button" aria-label="End call" onClick={endCall}
        className={clsx('press-dim grid shrink-0 place-items-center rounded-full bg-need text-white', btn)}>
        <EndCallIcon className={glyph} />
      </button>
    </div>
  )
}

/** the soft green of a call (the old call mark's), its words in the ready colour */
const callTint = 'bg-[color-mix(in_srgb,var(--ready)_11%,var(--bg))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ready)_22%,transparent)]'

/** SHEP-105, SHEP-135: the top of the spaces list: nothing, but the key's card when a call couldn't start for want of
 *  one. A call shows in the brand row (VoiceButton: Mute and End), never a card here as well */
function ShepherdrRow() {
  const [helped] = useHelp()
  if (!helped) return null
  return (
    <div className="flex flex-col gap-2 px-2 pt-1.5 pb-1 phone:px-3 phone:pt-2">
      <CallHelp />
    </div>
  )
}

/** SHEP-135: the voice call's button in the sidebar's brand row, beside Search and as quiet as it. On a call it turns
 *  into the call's Mute and End in their capsule, as a phone's bar does: the call's one place, never a card as well */
function VoiceButton() {
  const on = useUI((u) => u.call)
  if (on) return <CallControls size="head" />
  return (
    <IconButton label="Voice call" data-voice-button onClick={() => toggleCall(null)}>
      <WaveIcon className={ic} />
    </IconButton>
  )
}

/** SHEP-105, SHEP-108, SHEP-135: the end of a phone's bottom bar. Off a call: Voice call, a quiet grey round. On one:
 *  Full screen, Mute and the red hang-up in their capsule, nothing above the bar */
function PhoneCallButton() {
  const on = useUI((u) => u.call)
  return on ? <CallControls size="bar" fit /> : (
    <RoundButton label="Voice call" onClick={() => toggleCall(null)} className="size-14 max-[359px]:size-12">
      <WaveIcon className="size-5" />
    </RoundButton>
  )
}

/** the strip at the top where neither the sidebar's brand row nor a phone's bottom bar shows: Shepherdr, what it is doing
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
      <CallControls size="head" fit />
    </div>
  )
}

/** the strip at the top where no brand row or bottom bar shows the call: a shut sidebar, a tablet, a phone with a task or
 *  Settings over its home (SHEP-66's band, now with Mute and End) */
function CallBanner() {
  const on = useUI((u) => u.call)
  return useTop() && on ? <CallStrip /> : null
}

/** where the call shows at the top: neither the sidebar's brand row nor a phone's bottom bar is on screen */
function useTop() {
  const width = useWindowWidth()
  return useStore((s) => {
    const { ui, snap } = s
    if (!snap) return false
    if (ui.device === 'phone') return !!(ui.task || ui.settings || ui.keyboard)
    return !placesDrawn(ui, snap, width)
  })
}

/** the key's card where the sidebar doesn't show: above a phone's bar, else at the top */
function PhoneHelp() {
  return useTop() ? null : <CallHelp className="mx-4 mb-2" />
}

function TopHelp() {
  return useTop() ? <CallHelp className="mx-3 mt-2" /> : null
}

/* ---------- SHEP-118: the full-screen call ---------- */

/** the logo's staff, exactly (public/icon.svg): its path, round cap and 12° tilt about (16 16); its hook's centre */
const STAFF = 'M21 60V12a7 7 0 0 0-14 0v2.5'
const HOOK = [14, 12] as const
const ease = (x: number) => x * x * (3 - 2 * x)
const fract = (x: number) => x - Math.floor(x)
const clamp = (x: number) => Math.min(1, Math.max(0, x))

/** The full-screen call's mark (SHEP-137, option 1 of SHEP-134): the hooked staff from Shepherdr's logo as one white
 *  line on the call's near-black, green only for the voice. Shepherdr's voice ripples out from the hook, yours ripples
 *  in; it draws itself while connecting, a green glint runs along it while it thinks or works, and it goes grey and
 *  still while you are muted. Everything it draws stays inside its own box (no blur, blend or clip: SHEP-120's grey
 *  square came from those on WebKit), so the box is the room the rings need and nothing else overlaps it. Each frame
 *  sets a few attributes from the call's sound; React only renders it once per phase */
function Crook({ phase, className }: { phase: string; className?: string }) {
  const id = useId()
  const svg = useRef<SVGSVGElement>(null)
  const now = useRef(phase)
  now.current = phase
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const g = el.querySelector<SVGGElement>('[data-crook-tilt]')!
    const line = el.querySelector<SVGPathElement>('[data-crook-line]')!
    const glint = el.querySelector<SVGPathElement>('[data-crook-glint]')!
    const rings = [...el.querySelectorAll<SVGCircleElement>('[data-crook-ring]')]
    const calm = matchMedia('(prefers-reduced-motion: reduce)')
    // eased values, so a change of phase glides instead of jumping
    let raf = 0, last = performance.now(), lvl = 0, glow = 0, ring = 0
    const step = (ms: number) => {
      const dt = Math.min(0.1, (ms - last) / 1000), still = calm.matches, t = still ? 0 : ms / 1000, p = now.current
      last = ms
      const glide = (v: number, to: number, k: number) => v + (to - v) * (1 - Math.pow(1 - k, dt * 60))
      // the swell, from whoever speaks (nothing of yours while muted): up fast, down slow
      const s = callSample()
      const target = getState().ui.callMuted && s.who !== 'agent' ? 0 : s.level
      lvl = glide(lvl, target, target > lvl ? 0.35 : 0.12)
      const l = still ? lvl * 0.6 : lvl
      const sway = still ? 0 : Math.sin((t * Math.PI * 2) / 7) * 1.4
      g.setAttribute('transform', `rotate(${sway.toFixed(2)} 16 41) rotate(12 16 16) translate(${HOOK[0]} ${HOOK[1]}) scale(${(1 + l * 0.03).toFixed(4)}) translate(${-HOOK[0]} ${-HOOK[1]})`)
      // connecting: it draws itself up from the staff to the hook, holds, and draws again
      const draw = (p === 'connecting' || p === 'reconnecting') && !still ? Math.max(0, 1 - ease(Math.min(1, fract(t / 2.6) / 0.6))) : 0
      line.setAttribute('stroke-dashoffset', (draw * 100).toFixed(2))
      line.setAttribute('stroke-opacity', clamp((1 - draw) * 5).toFixed(3))
      // thinking or working: a green glint runs along it, from the staff over the hook (still: it rests on the hook)
      glow = glide(glow, p === 'thinking' || p === 'working' ? 1 : 0, 0.1)
      glint.setAttribute('stroke-opacity', glow.toFixed(3))
      glint.setAttribute('stroke-dashoffset', still ? '-70' : (-(fract(t / (p === 'working' ? 1.1 : 1.8)) * 134 - 14)).toFixed(2))
      // the rings: out from the hook while Shepherdr speaks, in to it while it listens, as bright as the voice
      const inward = p === 'listening'
      ring = glide(ring, inward || p === 'speaking' ? 1 : 0, 0.08)
      rings.forEach((r, i) => {
        let f = fract(t * 0.45 + i / 4)
        if (inward) f = 1 - f
        const a = still ? (i === 1 ? 0.15 + l : 0) : (1 - f) * Math.min(1, 0.05 + l * 1.4) * (inward ? Math.min(1, f * 3 + 0.2) : 1)
        r.setAttribute('r', (still ? 11.5 + i * 5.7 : 9.5 + f * 18.5).toFixed(2))
        r.setAttribute('stroke-opacity', (clamp(ring * a) * 0.9).toFixed(3))
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  const fade = `${id}-fade`, mask = `${id}-mask`
  return (
    <svg ref={svg} viewBox="-15 -19 60 75" data-crook data-phase={phase} aria-hidden className={clsx('group overflow-visible', className)}>
      <defs>
        {/* the staff fades out below, as the app icon's edge cuts it */}
        <linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="0" y1="34" x2="0" y2="54">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-40" y="-40" width="120" height="120">
          <rect x="-40" y="-40" width="120" height="120" fill={`url(#${fade})`} />
        </mask>
      </defs>
      <g data-crook-tilt>
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} data-crook-ring cx={HOOK[0]} cy={HOOK[1]} r="9.5" strokeWidth="0.9" strokeOpacity="0"
            className="fill-none stroke-ready transition-[stroke] duration-700 group-data-[phase=connecting]:stroke-fg3 group-data-[phase=muted]:stroke-fg3 group-data-[phase=reconnecting]:stroke-fg3" />
        ))}
        <path data-crook-line d={STAFF} pathLength={100} strokeDasharray="100 100" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" mask={`url(#${mask})`}
          className="fill-none stroke-fg transition-[stroke,opacity] duration-700 group-data-[phase=connecting]:stroke-fg2 group-data-[phase=muted]:stroke-fg3 group-data-[phase=muted]:opacity-80 group-data-[phase=reconnecting]:stroke-fg2" />
        <path data-crook-glint d={STAFF} pathLength={100} strokeDasharray="14 120" strokeOpacity="0" strokeWidth="4.5" strokeLinecap="round" mask={`url(#${mask})`}
          className="fill-none stroke-ready" />
      </g>
    </svg>
  )
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
 *  the top, the Crook (SHEP-137) in the middle with what the call does under it, and only the call's own buttons: Minimize, Mute,
 *  End. Held sideways (short and wide), the Crook and its word sit left and the rest right (SHEP-126). Minimize (or Escape) puts it back in the brand row, bar or strip; the bar's and strip's Full screen button brings it back. */
function CallScreen() {
  const on = useUI((u) => u.call && u.callFull)
  return on ? <FullCall /> : null
}
function FullCall() {
  const t = useElapsed(useUI((u) => u.callStarted))
  const muted = useUI((u) => u.callMuted)
  const { word, phase } = usePhase()
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-12 px-6 short:col-start-1 short:row-span-full short:gap-2">
        <Crook phase={look} className="h-[min(46dvh,100vw,400px)] short:h-(--crook-short)" />
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
      <span className="min-w-0 flex-1 text-pretty">{error.startsWith(ENDED) ? error : `Voice call: ${error}`}</span>
      <button type="button" data-call-again onClick={() => { setUI({ callError: null }); toggleCall(lastFrom) }}
        className={clsx('press-dim h-7 shrink-0 rounded-full px-3 text-[0.78125rem] font-medium text-ready-fg phone:h-9 phone:text-[0.875rem]', callTint)}>
        Call again
      </button>
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
    reg.sideHead.push(VoiceButton)
    reg.phoneBar.push(PhoneCallButton)
    // SHEP-122: no Listening pill above a phone's bar: the minimized call is its bar's buttons alone
    reg.phoneAbove.push(PhoneHelp)
    reg.topBars.push(CallBanner, TopHelp, CallError, CallWhere)
    reg.overlays.push(OpenedTag, CallScreen)
    // 3.0 calls with Ctrl+Shift+Space (the keyboard plugin): no V or M keys of its own
  },
})
