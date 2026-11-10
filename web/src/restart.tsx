// Restart picks for either chat role, used once or saved for its space. Opened from the + or ⋯ menu.
import clsx from 'clsx'
import { ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { StarIcon as StarSolid } from '@heroicons/react/16/solid'
import { StarIcon as StarOutline } from '@heroicons/react/24/outline'
import { createPortal } from 'react-dom'
import * as AGc from '@core/agents.js'
import { PermissionInfo, PermissionIcon } from './PermissionInfo.tsx'
import { taskChatId, type Chat, type Place, type RestartCli, type RestartInfo } from '@shared/types.ts'
import { act, setUI, taskOf, useSnap, useStore, useUI } from './kernel.ts'
import { Dialog } from './rowmenu.tsx'
import { restartPermission } from './permissions.ts'
import { Pick, shown, Switch, TextValue } from './Settings.tsx'
import { CheckIcon, DownIcon, EffortIcon, ic, Menu, MenuItem, ModelIcon, ModeIcon, NextIcon, Primary, RestartIcon, SearchIcon, SpeedIcon, Tab, Tabs } from './ui.tsx'

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
      title={task ? `Restart ${name} agent?` : 'Restart Assistant?'}
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
const saveWords = (i: RestartInfo) => `Use for future ${i.role === 'task' ? 'task agents' : 'Assistants'} ${i.space ? `in ${i.space === '~' ? 'the home space' : i.space}` : 'on this machine'}`

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

/* ---------- the window's model button and menu (mods/chat pickParts, mods/chat-models) ---------- */

export type MenuModel = { id: string; name: string; efforts: string[]; defaultEffort?: string | null; fast?: boolean }
export type AgentMenu = { name: string; models: MenuModel[]; perms?: { id: string; label: string }[] }
type MenuPick = { agent: string; model: string | null; effort: string | null; fast: boolean; perm: string | null }
type MenuData = { current: MenuPick; menus: Record<string, AgentMenu>; permDefault: Record<string, string>; picks?: Picks; offline?: string | null }
/** a stretch of the model list (core/agents.js modelSections): Pinned, Recent, All models, or an agent's matches */
type Picks = { pinned: string[]; recent: string[] }
type Section = { key: string; title: string | null; agent: string; rows: (MenuModel & { agent: string; pinned: boolean; typed?: boolean })[]; more: number }

/** the menu open: its chat, and the model a typed /model named */
let menuOpen: { chat: string; typed?: string; permissions?: boolean } | null = null
const menuListeners = new Set<() => void>()
const setMenuOpen = (v: typeof menuOpen) => { menuOpen = v; menuListeners.forEach((f) => f()) }
const useMenuOpen = () => useSyncExternalStore((f) => (menuListeners.add(f), () => void menuListeners.delete(f)), () => menuOpen)

/** open the model menu over a chat's model button; typed: the model a /model named ('' for none) */
export function openModelMenu(chat: string, typed?: string) {
  setMenuOpen({ chat, typed })
}

/** the row a typed name means (/model sonnet, /model gpt-5), as the window's chat finds it */
function findModel(menus: Record<string, AgentMenu>, name?: string) {
  if (!name) return null
  const n = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '')
  const q = n(name)
  const rows = Object.entries(menus).flatMap(([a, m]) => m.models.map((r) => ({ agent: a, model: r.id, keys: [n(r.id), n(r.name)] })))
  const hit = rows.find((r) => r.keys.includes(q)) ?? rows.find((r) => r.keys.some((k) => q && k.startsWith(q)))
  return hit ? { agent: hit.agent, model: hit.model } : null
}

const LEVEL: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra', none: 'None' }

/** The model list both model menus show (the chat's, below, and Settings' role menu, screens/Role.tsx), made for
 *  any number of agents with any number of models: a tab per agent (only when more than one), a search over every
 *  agent's models (a letter typed on a row goes to it; Enter takes the first match; one word no model has is offered
 *  as an id to start on), the agent's pinned and recent models on top (core/agents.js modelSections), a star to pin
 *  one (onPin), long lists capped */
export function ModelList({ menus, agent, picks, chosen, disabled, phone, onPick, onPin, autoFocus }: {
  menus: Record<string, AgentMenu>; agent: string; picks?: Picks; chosen: { agent: string; model: string | null }; disabled?: boolean; phone?: boolean
  onPick: (row: MenuModel & { agent: string; typed?: boolean }) => void; onPin?: (agent: string, id: string) => void; autoFocus?: boolean
}) {
  const [tab, setTab] = useState(agent)
  const [q, setQ] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // on a desktop the search takes the keys at once; a phone's keyboard comes up only when the box is tapped
  useEffect(() => {
    if (autoFocus) search.current?.focus({ preventScroll: true })
  }, [])
  const agents = Object.keys(menus)
  const sections = AGc.modelSections(menus, tab, picks, q) as Section[]
  const pick = (row: Section['rows'][number]) => {
    onPick(row)
    setTab(row.agent)
    setQ('')
    if (!phone) search.current?.focus({ preventScroll: true })
  }
  const keys = (e: ReactKeyboardEvent) => {
    if (e.target === search.current || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || !search.current) return
    search.current.focus({ preventScroll: true })
  }
  const row = 'flex min-h-[31px] w-full items-center gap-2.5 rounded-[7px] px-[9px] text-left enabled:hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:text-fg3 coarse:min-h-11 phone:min-h-11'
  const head = (t: string) => <div className="px-[9px] pt-2 pb-1 text-[0.6875rem] text-fg3 coarse:text-[0.8125rem] phone:text-[0.8125rem]">{t}</div>
  return (
    <div onKeyDown={keys} className="flex flex-col">
      {agents.length > 1 ? (
        <div className="px-1 pt-1 pb-1.5">
          <Tabs label="Agent" className="flex w-full">
            {agents.map((a) => (
              <Tab key={a} fill on={tab === a} onClick={() => { setTab(a); setQ('') }} className="text-[0.75rem]! coarse:text-[0.875rem]! phone:text-[0.875rem]!">
                <span className="inline-flex items-center gap-1.5 align-middle">
                  {a === "cursor" ? <span aria-hidden className="size-3.5 shrink-0">◈</span> : <img src={`agents/${a}.svg`} alt="" aria-hidden className="size-3.5 shrink-0" />}
                  {menus[a].name}
                </span>
              </Tab>
            ))}
          </Tabs>
        </div>
      ) : null}
      <div className="px-1 pb-1">
        <div className="flex h-8 items-center gap-2 rounded-[7px] bg-sel pl-2.5 text-fg3 focus-within:shadow-[inset_0_0_0_1.5px_var(--focus)] coarse:h-11 phone:h-11">
          <SearchIcon aria-hidden className="size-3.5 shrink-0" />
          <input ref={search} name="model-search" type="search" autoComplete="off" spellCheck={false} enterKeyHint="go" disabled={disabled}
            aria-label="Search models" placeholder={agents.length > 1 ? 'Search every agent’s models' : 'Search models'} value={q}
            onChange={(e) => { setQ(e.target.value); list.current?.scrollTo({ top: 0 }) }}
            onKeyDown={(e) => {
              // Enter takes the first match
              if (e.key === 'Enter') { const first = sections[0]?.rows[0]; if (q && first) { e.preventDefault(); pick(first) } }
            }}
            className="h-full min-w-0 flex-1 bg-transparent pr-2 text-fg outline-none placeholder:text-fg3 max-sm:text-base [&::-webkit-search-cancel-button]:appearance-none" />
        </div>
      </div>
      <div ref={list} className={clsx('overflow-y-auto overscroll-contain', phone ? 'max-h-[40dvh]' : 'max-h-[min(300px,36dvh)]')}>
        {sections.length === 0 ? <p className="px-[9px] py-2 text-fg3">No models.</p> : null}
        {sections.map((s) => (
          <div key={s.key} role="group" aria-label={s.title ?? undefined}>
            {s.title ? head(s.title) : null}
            {s.rows.map((x) => {
              const on = x.agent === chosen.agent && x.id === chosen.model
              return (
                <div key={`${x.agent}-${x.id}`} className="group relative flex items-center">
                  <button type="button" role="menuitemradio" aria-checked={on} disabled={disabled} className={clsx(row, onPin && 'pr-9')} onClick={() => pick(x)}>
                    {/* the agent's own mark, Herdr's icon (web/public/agents, from the window's icons) */}
                    {x.agent === "cursor" ? <span aria-hidden className="size-3.5 shrink-0">◈</span> : <img src={`agents/${x.agent}.svg`} alt="" aria-hidden className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{x.typed ? <>Use <span className="font-medium">{x.id}</span></> : x.name}</span>
                    {x.typed ? <span className="shrink-0 text-[0.6875rem] text-fg3">{menus[x.agent]?.name} id</span> : null}
                    <span className="grid size-3.5 shrink-0 place-items-center">{on ? <CheckIcon className="size-3.5" /> : null}</span>
                  </button>
                  {x.typed || disabled || !onPin ? null : (
                    <button type="button" tabIndex={-1} aria-label={x.pinned ? `Unpin ${x.name}` : `Pin ${x.name}`} aria-pressed={x.pinned} onClick={() => onPin(x.agent, x.id)}
                      className={clsx('absolute right-0.5 grid size-7 place-items-center rounded-[6px] text-fg3 hover:text-fg coarse:size-10 phone:size-10', !x.pinned && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 coarse:opacity-60 phone:opacity-60')}>
                      {x.pinned ? <StarSolid className="size-3.5 text-fg2" /> : <StarOutline className="size-3.5" />}
                    </button>
                  )}
                </div>
              )
            })}
            {s.more ? <p className="px-[9px] py-1 text-[0.6875rem] text-fg3 coarse:text-[0.8125rem] phone:text-[0.8125rem]">{s.more} more. Type to narrow.</p> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The model menu, for any number of agents with any number of models each: a tab per installed agent (only when more
 *  than one), a search over every agent's models (type anywhere in the menu), the agent's pinned and recent models
 *  on top (core/agents.js modelSections), a star to pin one; then Reasoning (that model's levels), Fast (where the
 *  model has it), Permissions (a small sub-menu), and, only when a choice differs from what runs now, one button:
 *  Switch (the model, level or Fast change in place, SHEP-181), or Restart for another agent (said to start a new
 *  conversation) or permission mode. Popover on a desktop, a sheet on a phone. */
function ModelMenu({ chat, typed, permissions = false }: { chat: string; typed?: string; permissions?: boolean }) {
  const [data, setData] = useState<MenuData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<MenuPick | null>(null)
  const [perms, setPerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const phone = useUI((u) => u.device === 'phone')
  const close = () => setMenuOpen(null)
  const models = (d: MenuData) => Object.entries(d.menus).flatMap(([agent, m]) => m.models.map((x) => ({ ...x, agent })))
  const choose = (d: MenuData, was: MenuPick, m: MenuModel & { agent: string }): MenuPick => {
    const next = { ...was, agent: m.agent, model: m.id }
    if (next.effort && !m.efforts.includes(next.effort)) next.effort = null
    if (!m.fast) next.fast = false
    if (m.agent !== was.agent) {
      // another agent: its own permission modes; full access stays full access
      next.perm = AGc.mapPermission(was.agent, was.perm, m.agent, d.permDefault[m.agent])
      next.fast = false
    }
    return next
  }
  useEffect(() => {
    act({ type: 'model-menu', chat } as never)
      .then((r: { menu?: MenuData; error?: string }) => {
        if (!r.menu) return setError(r.error || "Couldn't read what it runs on.")
        setData(r.menu)
        const pre = findModel(r.menu.menus, typed)
        const m = pre && models(r.menu).find((x) => x.agent === pre.agent && x.id === pre.model)
        const s = m ? choose(r.menu, r.menu.current, m) : r.menu.current
        setSel(s)
      })
      .catch((e: Error) => setError(e.message))
  }, [chat, typed])
  const model = (s: MenuPick) => data?.menus[s.agent]?.models.find((m) => m.id === s.model) ?? null
  const level = (s: MenuPick) => permissions ? s.effort : s.effort ?? model(s)?.defaultEffort ?? null
  const changes = () => {
    if (!data || !sel) return []
    const w = data.current, out: string[] = []
    if (sel.agent !== w.agent) out.push(data.menus[sel.agent]?.name ?? sel.agent)
    if (sel.agent !== w.agent || sel.model !== w.model) out.push(model(sel)?.name ?? sel.model ?? '')
    if (level(sel) && level(sel) !== level(w)) out.push(LEVEL[level(sel)!] ?? level(sel)!)
    if (sel.fast !== w.fast) out.push(sel.fast ? 'Fast' : 'Standard')
    if (sel.perm && sel.perm !== w.perm) out.push(data.menus[sel.agent]?.perms?.find((x) => x.id === sel.perm)?.label ?? sel.perm)
    return out
  }
  const restart = async () => {
    if (!sel) return
    setBusy(true)
    setError(null)
    const r = await (permissions ? restartPermission(act, chat, sel.agent, sel.perm) : act({ type: 'restart', live: true, chat, kind: sel.agent, model: sel.model ?? '', effort: level(sel) ?? '', speed: sel.fast ? 'fast' : 'normal', perm: sel.perm ?? '' } as never)).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if ((r as { ok?: boolean }).ok === false) return setError((r as { error?: string }).error || (restarts ? "The agent didn't restart." : "It didn't switch."))
    close()
  }
  const pick = (row: MenuModel & { agent: string; typed?: boolean }) => {
    if (!data || !sel) return
    // a model typed by id joins its agent's list, so its levels and the Restart button know it
    if (row.typed && !data.menus[row.agent]?.models.some((m) => m.id === row.id)) {
      const menus = { ...data.menus, [row.agent]: { ...data.menus[row.agent], models: [row, ...data.menus[row.agent].models] } }
      setData({ ...data, menus })
    }
    setSel(choose(data, sel, row))
  }
  const pin = async (agent: string, id: string) => {
    const r = await act({ type: 'model-pin', agent, model: id } as never).catch(() => null)
    if (r?.picks && data) setData({ ...data, picks: r.picks })
  }
  const offline = data?.offline ?? null
  const menu = sel ? data?.menus[sel.agent] : undefined
  const permissionChoices = AGc.permissionOptions(menu?.perms, sel?.perm)
  const m = sel ? model(sel) : null
  const on = sel ? level(sel) : null
  const perm = sel ? menu?.perms?.find((x) => x.id === sel.perm) : undefined
  const ch = changes()
  // only another agent or permission mode needs a restart: the rest changes in place, the conversation going on
  const restarts = !!data && !!sel && (sel.agent !== data.current.agent || (!!sel.perm && sel.perm !== data.current.perm))
  const row = 'flex min-h-[31px] w-full items-center gap-2.5 rounded-[7px] px-[9px] text-left enabled:hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:text-fg3 coarse:min-h-11 phone:min-h-11'
  const head = (t: string) => <div className="px-[9px] pt-2 pb-1 text-[0.6875rem] text-fg3 coarse:text-[0.8125rem] phone:text-[0.8125rem]">{t}</div>
  const sheet = (
    <>
      {phone ? <div aria-hidden className="fixed inset-0 z-40 bg-black/30" /> : null}
      <Menu label={permissions ? "Permissions" : "Model"} onClose={close} tabs
        // a phone's sheet is outside the app's [data-device] (a portal): its own classes, not phone: ones
        className={phone ? 'fixed inset-x-0 bottom-0 z-40 rounded-b-none pb-[max(env(safe-area-inset-bottom),--spacing(2))]' : clsx('absolute bottom-full z-30 mb-2 max-w-[calc(100vw-2rem)]', permissions ? 'left-0 w-[260px] origin-bottom-left' : 'right-0 w-[340px] origin-bottom-right')}>
        <div data-model-menu={!permissions || undefined} data-permission-menu={permissions || undefined} className="relative flex flex-col text-[0.8rem] coarse:text-[0.9375rem] phone:text-[0.9375rem]">
          {!data || !sel ? (
            <p className={clsx('px-[9px] py-2 text-fg3', error && 'text-need-fg')}>{error ?? 'Reading what it runs on…'}</p>
          ) : (
            <>
              {permissions ? (
                <>
                  <div className="flex items-center justify-between">{head('Permissions')}<PermissionInfo agent={sel.agent} perm={sel.perm} /></div>
                  {permissionChoices.map((x) => (
                    <button key={x.id} type="button" role="menuitemradio" aria-checked={sel.perm === x.id} disabled={busy} className={row} onClick={() => setSel({ ...sel, perm: x.id })}>
                      <PermissionIcon kind={x.icon} /><span className="flex-1">{x.label}</span>
                      <span className="grid size-3.5 shrink-0 place-items-center">{sel.perm === x.id ? <CheckIcon className="size-3.5" /> : null}</span>
                    </button>
                  ))}
                  <p className="px-[9px] py-1 text-[0.71875rem] text-fg3">Restart to apply to this agent.</p>
                </>
              ) : (
                <>
                  <ModelList menus={data.menus} agent={sel.agent} picks={data.picks} chosen={sel} phone={phone} onPick={pick}
                    onPin={(agent, id) => void pin(agent, id)} autoFocus={!phone} />
                  <div className="px-1 py-1"><div className="h-px bg-line" /></div>
                </>
              )}
              {!permissions && m?.efforts?.length ? (
                <>
                  {head('Reasoning')}
                  <div className="px-1 py-[3px]">
                    {/* each level as wide as its word, the room left shared out: Extra high reads whole even at a phone's 288px */}
                    <div role="radiogroup" aria-label="Reasoning" className={clsx('flex h-7 gap-0.5 rounded-[7px] bg-sel p-0.5 coarse:h-10 phone:h-10')}>
                      {m.efforts.map((e) => (
                        <button key={e} type="button" role="radio" aria-checked={on === e} onClick={() => setSel({ ...sel, effort: e })}
                          className={clsx('min-w-0 flex-auto truncate rounded-[5px] px-1 text-[0.71875rem]', on === e ? 'bg-bg font-medium text-fg shadow-soft' : 'text-fg2 enabled:hover:text-fg')}>
                          {LEVEL[e] ?? e}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              {!permissions && m?.fast ? (
                <button type="button" role="menuitemcheckbox" aria-checked={sel.fast} className={row} onClick={() => setSel({ ...sel, fast: !sel.fast })}>
                  <SpeedIcon className="size-3.5 shrink-0 text-fg3" />
                  <span className="flex-1">Fast</span>
                  {/* a switch as wide as two thumbs, a touch bigger for a finger */}
                  <span aria-hidden className={clsx('inline-flex h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors coarse:h-5 coarse:w-9 phone:h-5 phone:w-9', sel.fast ? 'bg-accent' : 'bg-line2')}>
                    <span className={clsx('aspect-square h-full rounded-full bg-bg shadow-soft transition-transform', sel.fast && 'translate-x-full')} />
                  </span>
                </button>
              ) : null}
              {!permissions && menu?.perms?.length ? (
                <button type="button" aria-haspopup="menu" aria-expanded={perms} className={clsx(row, perms && 'bg-hover')} onClick={() => setPerms(!perms)}>
                  <ModeIcon className="size-3.5 shrink-0 text-fg3" />
                  <span className="flex-1">Permissions</span>
                  <span className="shrink-0 text-[0.75rem] text-fg3">{perm?.label ?? ''}</span>
                  <NextIcon className="size-3 shrink-0 text-fg3" />
                </button>
              ) : null}
              {!permissions && perms && menu?.perms ? (
                <div role="menu" aria-label="Permissions" className="absolute right-1 bottom-9 z-10 w-[240px] rounded-[8px] bg-bg p-[5px] shadow-menu">
                  {permissionChoices.map((x) => (
                    <button key={x.id} type="button" role="menuitemradio" aria-checked={sel.perm === x.id} className={row} onClick={() => { setSel({ ...sel, perm: x.id }); setPerms(false) }}>
                      <PermissionIcon kind={x.icon} /><span className="flex-1">{x.label}</span>
                      <span className="grid size-3.5 shrink-0 place-items-center">{sel.perm === x.id ? <CheckIcon className="size-3.5" /> : null}</span>
                    </button>
                  ))}
                  <PermissionInfo agent={sel.agent} perm={sel.perm} />
                </div>
              ) : null}
              {error ? <p className="px-[9px] pt-1 text-[0.75rem] text-need-fg">{error}</p> : null}
              {ch.length ? (
                <div className="flex flex-col gap-1 pt-[5px]">
                  {/* another agent can't carry this conversation on: said before the press, not after */}
                  {sel.agent !== data.current.agent ? (
                    <p className="px-[9px] text-pretty text-[0.71875rem] text-fg3 coarse:text-[0.8125rem] phone:text-[0.8125rem]">
                      {data.menus[sel.agent]?.name} starts a new conversation. This one stays in {data.menus[data.current.agent]?.name ?? 'its old agent'}’s history.
                    </p>
                  ) : null}
                  {/* a permission mode is set when the agent starts: said before the press too */}
                  {restarts && sel.agent === data.current.agent ? (
                    <p className="px-[9px] text-pretty text-[0.71875rem] text-fg3 coarse:text-[0.8125rem] phone:text-[0.8125rem]">
                      A new permission mode restarts the agent. The conversation carries on.
                    </p>
                  ) : null}
                  {/* another machine out of reach: said when a change is chosen, the button still tries */}
                  {offline && !error ? (
                    <p className="px-[9px] text-pretty text-[0.71875rem] text-need-fg coarse:text-[0.8125rem] phone:text-[0.8125rem]">
                      {offline} is offline. Try again once it’s back.
                    </p>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => void restart()} className="press-dim min-h-7 w-full rounded-[7px] bg-fg px-2.5 py-1 text-balance text-[0.78125rem] font-medium text-bg disabled:opacity-60 coarse:min-h-11 phone:min-h-11 coarse:text-[0.9375rem] phone:text-[0.9375rem]">
                    {busy ? (restarts ? 'Restarting…' : 'Switching…') : `${restarts ? 'Restart with' : 'Switch to'} ${ch.join(' · ')}`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Menu>
    </>
  )
  // a phone's sheet covers the whole screen's bottom (the tab bar too), above the chat's own layer
  return phone ? createPortal(<div data-device="phone" className="isolate z-40 font-sans antialiased">{sheet}</div>, document.body) : sheet
}

/** In the message box, as the window's model button: what its agent runs on ("Opus 5.5 · High"), a chevron; it opens
 *  the model menu */
export function AgentLine({ chatKey, cli }: { chatKey: string; cli: string }) {
  const words = useStore((s) => s.chats[chatKey]?.agent?.words)
  const open = useMenuOpen()
  const phone = useUI((u) => u.device === 'phone')
  if (!words) return <OldAgentLine chatKey={chatKey} cli={cli} />
  // a narrow chat drops "· 1M" first, as the window's
  const shown = phone ? words.replace(/\s*·\s*1M\b/, '') : words
  // in the box's row, before the mic (as the window's): the menu opens over the box, at its right (the box holds it)
  return (
    <>
      <button type="button" data-agent-line aria-haspopup="menu" aria-expanded={open?.chat === chatKey && !open.permissions}
        onClick={() => setMenuOpen(open?.chat === chatKey && !open.permissions ? null : { chat: chatKey })}
        className={agentPick}>
        <span className="min-w-0 truncate">{shown}</span>
        <DownIcon className="size-3 shrink-0" />
      </button>
      {open?.chat === chatKey && !open.permissions ? <ModelMenu key={`${chatKey}|${open.typed ?? ''}`} chat={chatKey} typed={open.typed} /> : null}
    </>
  )
}

export function PermissionLine({ chatKey }: { chatKey: string }) {
  const chat = useStore((s) => s.chats[chatKey])
  const agent = chat?.agent
  const available = !!agent && !agent.planned && !chat.finished && !chat.notice
  const open = useMenuOpen()
  const active = open?.chat === chatKey && !!open.permissions
  const menu = agent && ['claude', 'codex', 'cursor'].includes(agent.kind) ? AGc.menuFor(agent.kind, {}) : null
  const label = !available ? (chat?.finished ? 'Agent ended' : 'Not started') : menu?.perms?.find((p: { id: string }) => p.id === agent?.perm)?.label ?? 'Permissions'
  return (
    <>
      <button type="button" data-permission-line aria-label={`Permissions: ${label}`} aria-haspopup="menu" aria-expanded={active} disabled={!available}
        onClick={() => setMenuOpen(active ? null : { chat: chatKey, permissions: true })} className={clsx(agentPick, 'disabled:text-fg3 disabled:hover:bg-transparent')}>
        <PermissionIcon kind={menu?.perms?.find((p: { id: string }) => p.id === agent?.perm)?.icon} />
        <span className="min-w-0 truncate">{label}</span>
        <DownIcon className="size-3 shrink-0" />
      </button>
      {active ? <ModelMenu key={chatKey} chat={chatKey} permissions /> : null}
    </>
  )
}

/** the box's model button: as tall as its round buttons, its words cut only when the row has no room left */
const agentPick = 'flex h-[34px] min-w-0 items-center gap-1 rounded-full pr-2 pl-2.5 text-[0.75rem] font-medium whitespace-nowrap text-fg2 hover:bg-hover hover:text-fg phone:h-11 phone:pr-2.5 phone:pl-3 phone:text-[0.8125rem]'

/** what it runs on, before the chat has heard it from the agent's log */
function OldAgentLine({ chatKey, cli }: { chatKey: string; cli: string }) {
  const agent = useStore((s) => s.chats[chatKey]?.agent)
  const { model, effort, speed } = runsOn(agent)
  const plan = agent?.planned
  const planned = plan && `${plan.model ? model!.text : `${cli} default`}${plan.effort ? ` · ${effort!.text}` : ''}, from Settings`
  // Normal that runs is left out: only a speed out of the ordinary earns its place on the line
  // Shepherdr 3: labels start with a capital ("Opus 5.5 · 1M · High")
  const bits = [model, effort, speed?.text === 'Normal' && !speed.requested ? undefined : speed].filter((w): w is Worn => !!w)
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
      onClick={() => openRestart(chatKey, taskChatId(chatKey) ?? 'this space', true)}
      className={agentPick}
    >
      {planned ? <span className="min-w-0 truncate italic">{planned}</span> : bits.length ? [...seen, ...requested].map(part) : <span className="min-w-0 truncate">{`${cli} · Not known yet`}</span>}
      <DownIcon className="size-3 shrink-0" />
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
      <MenuItem key={label} icon={<Icon className={ic} />} aria-label={`${label}: ${value}. Select and restart`} onClick={open}>
        <span className="flex min-w-0 items-center justify-between gap-4">
          <span>{label}</span>
          <span className="flex min-w-0 items-center gap-1 text-fg2"><span className="truncate">{value}</span><ChevronUpDownIcon className={`${ic} shrink-0`} /></span>
        </span>
      </MenuItem>)}
  </div>
}
