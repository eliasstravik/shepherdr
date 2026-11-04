// Voice: a call is with a voice agent that passes what you say to this chat's agent as ordinary messages and reads
// the replies out. While it is on, that chat's box is the call. The call stays with the agent you called: elsewhere a
// green bar shows who, Go back returns.
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { act, agentChat, chatName, definePlugin, getState, goChat, placeOf, setUI, useSnap, useStore, useUI, visibleChats } from '@client/kernel.ts'
import { EndCallIcon, ic, IconButton, LiveWave, MicIcon, MicOffIcon, roundBtn, useElapsed, WaveIcon, Waves, XIcon } from '@client/ui.tsx'
import { cancelDictation } from '@plugins/chat/client.tsx'
import { callPhase, callSample, muteCall, startCall, stopCall } from './call.ts'

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
    setUI({ callError: message })
  }).catch(() => { endCall(); setUI({ callError: 'Audio could not start on this device.' }) })
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
        <EndCallIcon className={ic} />
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
      <button type="button" className={clsx(callBtn, 'bg-need-fg text-white dark:text-black')} onClick={endCall}>
        End call
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
    reg.topBars.push(CallBar, CallError)
    reg.keys.push({
      order: 50,
      handle: ({ e, ui, snap }) => {
        // not while you type anywhere (search, the emoji search, an artifact's box) or something is open over the chat
        const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
        if (ui.device !== 'desktop' || ui.focus || typing || ui.search || ui.viewer || ui.settings || ui.adding || ui.pick || e.metaKey || e.ctrlKey || e.altKey) return false
        if (e.key === 'm' && ui.call) {
          e.preventDefault()
          toggleMute()
          return true
        }
        if (e.key !== 'v') return false
        e.preventDefault()
        toggleCall(agentChat(ui, snap)?.chat ?? placeOf(snap, ui.place).chat)
        setUI({ kb: true })
        return true
      },
    })
  },
})
