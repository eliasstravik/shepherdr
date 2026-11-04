// Restart picks for either chat role, used once or saved for its space. Opened from the + or ⋯ menu.
import clsx from 'clsx'
import { ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { taskChatId, type Chat, type Place, type RestartCli, type RestartInfo } from '@shared/types.ts'
import { act, setUI, taskOf, useSnap, useStore } from './kernel.ts'
import { Dialog } from './rowmenu.tsx'
import { Pick, shown, Switch, TextValue } from './Settings.tsx'
import { EffortIcon, ic, MenuItem, ModelIcon, ModeIcon, Primary, RestartIcon, SpeedIcon } from './ui.tsx'

/* ---------- the sheet ---------- */

type Opening = { chat: string; name: string; current?: boolean; typed?: string }
let opening: Opening | null = null
const listeners = new Set<() => void>()
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f))

/** open the restart sheet for a coordinator (chat: its place id) or a task's agent (ID/Agent); name: what it is called;
 *  typed: what a /model in its chat said, '' for nothing */
export function openRestart(chat: string, name: string, current = false, typed?: string) {
  opening = { chat, name, current, typed }
  listeners.forEach((f) => f())
}

const close = () => {
  opening = null
  listeners.forEach((f) => f())
}

/** the sheet, while one is open: each anew, its picks fresh */
export function RestartSheet() {
  const o = useSyncExternalStore(subscribe, () => opening)
  return o ? <Sheet key={o.chat} chat={o.chat} name={o.name} current={o.current} typed={o.typed} /> : null
}

/** "Restart agent" in a ⋯ menu */
export function RestartItem({ chat, name, onPick }: { chat: string; name: string; onPick?: () => void }) {
  return (
    <MenuItem
      icon={<RestartIcon className={ic} />}
      onClick={() => {
        onPick?.()
        openRestart(chat, name)
      }}
    >
      Restart agent…
    </MenuItem>
  )
}

const DEFAULT = 'default'

/** a CLI's model choices by name, and the levels the one picked takes */
const modelsOf = (c?: RestartCli) => c?.models ?? []
const levelsOf = (c: RestartCli | undefined, model?: string) => (model ? modelsOf(c).find((m) => m.id === model)?.efforts : undefined) ?? c?.efforts ?? []

/** the model a /model named: by its id, its label, or a word of its id ("sonnet") */
const typedModel = (c: RestartCli | undefined, words: string) => {
  const raw = words.toLowerCase()
  return raw ? modelsOf(c).find((m) => m.id.toLowerCase() === raw || m.label.toLowerCase() === raw || m.id.toLowerCase().includes(`-${raw}-`)) : undefined
}

function Sheet({ chat, name, current, typed }: Opening) {
  const [info, setInfo] = useState<RestartInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [speed, setSpeed] = useState('')
  const [save, setSave] = useState(false)
  const agent = useStore((s) => s.chats[chat]?.agent)
  useEffect(() => {
    act({ type: 'restart-info', chat })
      .then((r: { ok?: boolean; error?: string; info?: RestartInfo; waiting?: boolean }) => {
        if (!r.info) return setError(r.waiting ? 'Its machine is out of reach: restart it once it is back.' : r.error || 'It could not be restarted.')
        setInfo(r.info)
        // not started yet: nothing runs to start from, so what Settings will use
        const pick = current && r.info.onKnown !== false ? r.info.on : r.info.want
        setKind(pick.kind)
        const cli = r.info.clis.find((c) => c.kind === pick.kind), named = typedModel(cli, typed ?? '')
        setModel(typed?.toLowerCase() === DEFAULT ? '' : (named?.id ?? pick.model ?? ''))
        setEffort(named && pick.effort && !levelsOf(cli, named.id).includes(pick.effort) ? '' : (pick.effort ?? ''))
        // Settings hold no speed: what it was started on stays unless changed
        setSpeed(r.info.on.speed ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [chat, current, typed])
  const cli = info?.clis.find((c) => c.kind === kind)
  const levels = levelsOf(cli, model)
  // Default names no level: where its records say what that came to, on the model that stays, the sheet says so too
  const ran = agent?.runtime?.effort && !agent.effort && info?.on.kind === kind && (info.on.model ?? '') === model ? shown(agent.runtime.effort).toLowerCase() : ''
  const unavailable = !!(model && cli?.models?.length && !cli.models.some((m) => m.id === model))
  const pickKind = (k: string) => {
    const c = info?.clis.find((x) => x.kind === k)
    setKind(k)
    // a model of the CLI it was on means nothing to another; a level stays where the new one takes it
    setModel(k === info?.want.kind ? (info.want.model ?? '') : '')
    if (!levelsOf(c, k === info?.want.kind ? info.want.model : undefined).includes(effort)) setEffort('')
  }
  const pickModel = (id: string) => {
    setModel(id)
    if (!levelsOf(cli, id).includes(effort)) setEffort('')
  }
  const go = async () => {
    setBusy(true)
    setError(null)
    const r = await act({ type: 'restart', chat, kind, model, effort, speed, save }).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be restarted.')
    close()
  }
  const task = chat.includes('/')
  const other = !!info && kind !== info.on.kind
  const changed = !!info && (kind !== info.want.kind || model !== (info.want.model ?? '') || effort !== (info.want.effort ?? ''))
  const label = (id: string) => (id ? (modelsOf(cli).find((m) => m.id === id)?.label ?? id) : DEFAULT)
  return (
    <Dialog
      title={task ? `Restart ${name} agent?` : 'Restart coordinator?'}
      onCancel={close}
      buttons={
        <Primary autoFocus disabled={!info || busy || unavailable} onClick={go}>
          {busy ? 'Restarting…' : 'Restart'}
        </Primary>
      }
    >
      {info ? (
        <div data-restart className="flex flex-col gap-4">
          {typed !== undefined ? <p className="text-sm text-fg3">Changes this agent only, not the device's default for later agents.{typed && typed.toLowerCase() !== DEFAULT && !typedModel(info.clis.find((c) => c.kind === info.on.kind), typed) ? ` ${typed} isn't one of its models.` : ''}</p> : null}
          <div className="flex flex-col gap-2.5 text-fg phone:gap-1">
            <Line label="Agent">
              <Pick label="Agent" value={cli?.name ?? kind} options={info.clis.map((c) => c.name)} onPick={(n) => pickKind(info.clis.find((c) => c.name === n)!.kind)} />
            </Line>
            <Line label="Model">
              {cli?.models ? (
                cli.models.length ? (
                  <Pick label="Model" value={label(model)} options={[DEFAULT, ...cli.models.map((m) => m.label)]} onPick={(l) => pickModel(cli.models!.find((m) => m.label === l)?.id ?? '')} />
                ) : (
                  <TextValue label="Model" value={model || DEFAULT} onEdit={() => undefined} onSave={(v) => pickModel(v.trim() === DEFAULT ? '' : v.trim())} />
                )
              ) : <span className="text-fg3">Default</span>}
            </Line>
            {cli?.models && levels.length ? (
              <Line label="Effort">
                <Pick label="Effort" value={effort || DEFAULT} options={[DEFAULT, ...levels]} ordered onPick={(v) => setEffort(v === DEFAULT ? '' : v)} />
              </Line>
            ) : <Line label="Effort"><span className="text-fg3">Default</span></Line>}
            {ran && !effort ? <p data-effort-ran className="text-sm text-fg3">Default lets {cli?.name ?? 'the agent'} choose. It runs {ran} now.</p> : null}
            {cli?.speeds ? (
              <Line label="Speed">
                <Pick label="Speed" value={speed || DEFAULT} options={[DEFAULT, ...cli.speeds]} ordered onPick={(v) => setSpeed(v === DEFAULT ? '' : v)} />
              </Line>
            ) : null}
            {unavailable ? <p className="text-need-fg">{model} is unavailable. Choose Default or an available model before restarting.</p> : null}
            {changed || save ? (
              <Line label={saveWords(info)}>
                <Switch label={saveWords(info)} on={save} onChange={setSave} />
              </Line>
            ) : null}
          </div>
          {speed === 'fast' && kind === 'claude' ? <p className="text-sm text-fg3">Fast needs a model and an account that allow it. The line under the message box shows what really runs.</p> : null}
          {other ? <p className="text-sm text-fg3">{cli?.name ?? shown(kind)} starts a new session with this chat{task ? ', its instructions and branch' : ''}.</p> : null}
          {error ? <p className="text-need-fg">{error}</p> : null}
        </div>
      ) : (
        <p className={clsx(error && 'text-need-fg')}>{error ?? 'Reading what it runs on…'}</p>
      )}
    </Dialog>
  )
}

/** "Save as nas's setting", for its role's agents there from now on */
const saveWords = (i: RestartInfo) => `Use for future ${i.role === 'task' ? 'task agents' : 'coordinators'} ${i.space ? `in ${i.space === '~' ? 'the home space' : i.space}` : 'on this machine'}`

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="min-w-0">{label}</span>
      {children}
    </div>
  )
}

/** Kept for plugin imports. The + menu replaces the old Settings mismatch banner. */
export function RestartHint(_props: { chatKey: string; cli: string }) {
  return null
}

/* ---------- in the ⋯ menus ---------- */

/** a coordinator chat's top-right menu (placeMenu) */
export function PlaceRestartItem({ place }: { place: Place }) {
  return <RestartItem chat={place.chat} name={place.name} onPick={() => setUI({ menu: false })} />
}

/** one thing it runs on: what its records say, or else what was asked for or what Settings will use, marked so; none: nothing either way */
interface Worn { text: string; requested?: boolean; planned?: boolean }

function runsOn(agent: Chat['agent']): { model?: Worn; effort?: Worn; speed?: Worn } {
  const r = agent?.runtime, plan = agent?.planned
  // not started: Speed is no Setting, so it stays the CLI's own
  if (plan) return { model: { text: plan.modelLabel ?? plan.model ?? shown(DEFAULT), planned: true }, effort: { text: shown(plan.effort ?? DEFAULT), planned: true }, speed: { text: shown(DEFAULT) } }
  const seen = (text?: string) => (text ? { text } : undefined)
  const asked = (text?: string) => (text ? { text, requested: true } : undefined)
  const model = r?.modelLabel ?? r?.model
  return {
    model: seen(model) ?? asked(agent?.modelLabel ?? agent?.model),
    effort: r?.effortUnsupported ? seen('Not supported') : seen(r?.effort && shown(r.effort)) ?? (r?.effortDefault ? seen('Default') : asked(agent?.effort && shown(agent.effort))),
    speed: seen(r?.speed && shown(r.speed)) ?? asked(agent?.speed && shown(agent.speed)),
  }
}

const inMenu = (w?: Worn) => (!w ? 'Not known yet' : w.requested ? `Asked for: ${w.text}` : w.planned ? `${w.text}, from Settings` : w.text)

/** a fast speed wears the zap */
function SpeedWords({ speed }: { speed: Worn }) {
  if (!/fast/i.test(speed.text)) return <>{speed.text}</>
  return <><SpeedIcon aria-hidden="true" className="mr-0.5 inline size-3 align-[-1.5px]" />{speed.text}</>
}

/** Always on show under the message box: what its agent really runs on, a tap from the menu that changes it */
export function AgentLine({ chatKey, cli }: { chatKey: string; cli: string }) {
  const agent = useStore((s) => s.chats[chatKey]?.agent)
  const { model, effort, speed } = runsOn(agent)
  const plan = agent?.planned
  const planned = plan && `${plan.model ? model!.text : `${cli} default`}${plan.effort ? ` · ${effort!.text.toLowerCase()}` : ''}, from Settings`
  // Normal that runs is left out: only a speed out of the ordinary earns its place on the line
  const bits = [model, effort && { ...effort, text: effort.text.toLowerCase() }, speed?.text === 'Normal' && !speed.requested ? undefined : speed].filter((w): w is Worn => !!w)
  const seen = bits.filter((w) => !w.requested), requested = bits.filter((w) => w.requested)
  const words = planned ?? ([...seen.map((w) => w.text), requested.length ? `Asked for: ${requested.map((w) => w.text).join(' · ')}` : ''].filter(Boolean).join(' · ') || `${cli} · Not known yet`)
  // a long model id is what gives way: effort and speed stay in view
  const part = (w: Worn, i: number) => (
    <span key={w.text} className={clsx(w === model ? 'min-w-0 truncate' : 'shrink-0', w.requested && 'italic')}>
      {i ? '\u00a0·\u00a0' : ''}
      {w === requested[0] ? 'Asked for: ' : ''}
      {w === speed ? <SpeedWords speed={w} /> : w.text}
    </span>
  )
  return (
    <button
      type="button"
      data-agent-line
      aria-label={`Runs on: ${words}. Change it`}
      onClick={() => setUI({ plus: chatKey })}
      className="press-dim relative mt-1 flex h-4 w-full justify-start pl-3 text-left text-xs/4 text-fg3 after:absolute after:-inset-y-1.5 after:inset-x-0"
    >
      {planned ? <span className="min-w-0 truncate italic">{planned}</span> : bits.length ? [...seen, ...requested].map(part) : `${cli} · Not known yet`}
    </button>
  )
}

/** Compact launch controls inside the composer + menu, shared by both chat roles. */
export function AgentControls({ chatKey, cli }: { chatKey: string; cli: string }) {
  const agent = useStore((s) => s.chats[chatKey]?.agent)
  const { model, effort, speed } = runsOn(agent)
  const open = () => {
    setUI({ plus: null })
    openRestart(chatKey, taskChatId(chatKey) ?? 'this space', true)
  }
  return <div data-agent-controls>
    {([['Agent', agent ? cli : `${cli} · unknown`, ModeIcon], ['Model', inMenu(model), ModelIcon], ['Effort', inMenu(effort), EffortIcon], ['Speed', inMenu(speed), SpeedIcon]] as const).map(([label, value, Icon]) =>
      <MenuItem key={label} icon={<Icon className={ic} />} aria-label={`${label}: ${value}. Select and restart`} title={`${label}: ${value}. Select and restart`} onClick={open}>
        <span className="flex min-w-0 items-center justify-between gap-4">
          <span>{label}</span>
          <span className="flex min-w-0 items-center gap-1 text-fg2"><span className="truncate">{value}</span><ChevronUpDownIcon className={`${ic} shrink-0`} /></span>
        </span>
      </MenuItem>)}
  </div>
}
