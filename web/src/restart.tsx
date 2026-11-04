// Restart picks for either chat role, used once or saved for its space. Opened from the + or ⋯ menu.
import clsx from 'clsx'
import { ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { taskChatId, type Chat, type Place, type RestartCli, type RestartInfo } from '@shared/types.ts'
import { act, setUI, taskOf, useSnap, useStore, useUI } from './kernel.ts'
import { Dialog } from './rowmenu.tsx'
import { Pick, shown, Switch, TextValue } from './Settings.tsx'
import { CheckIcon, DownIcon, EffortIcon, ic, Menu, MenuItem, ModelIcon, ModeIcon, NextIcon, Primary, RestartIcon, SpeedIcon } from './ui.tsx'

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

type MenuModel = { id: string; name: string; efforts: string[]; defaultEffort?: string | null; fast?: boolean }
type AgentMenu = { name: string; models: MenuModel[]; perms?: { id: string; label: string }[]; fastLocked?: boolean }
type MenuPick = { agent: string; model: string | null; effort: string | null; fast: boolean; perm: string | null }
type MenuData = { current: MenuPick; menus: Record<string, AgentMenu>; permDefault: Record<string, string>; remote: string | null }

/** the menu open: its chat, and the model a typed /model named */
let menuOpen: { chat: string; typed?: string } | null = null
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

/** Model (every installed agent's; picking another agent's switches agent), Reasoning (that model's levels), Fast
 *  (where the model has it), Permissions (a small sub-menu), and, only when a choice differs from what runs now, one
 *  Restart button */
function ModelMenu({ chat, typed }: { chat: string; typed?: string }) {
  const [data, setData] = useState<MenuData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<MenuPick | null>(null)
  const [perms, setPerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = () => setMenuOpen(null)
  const models = (d: MenuData) => Object.entries(d.menus).flatMap(([agent, m]) => m.models.map((x) => ({ ...x, agent })))
  const choose = (d: MenuData, was: MenuPick, m: MenuModel & { agent: string }): MenuPick => {
    const next = { ...was, agent: m.agent, model: m.id }
    if (next.effort && !m.efforts.includes(next.effort)) next.effort = null
    if (!m.fast) next.fast = false
    if (m.agent !== was.agent) {
      // another agent: its own permission modes; full access stays full access
      // (core/settings.js chooseModel: a kind with no full-access mode or no Fast, pi say, gets its own default)
      const full = was.perm === 'bypassPermissions' || was.perm === 'full'
      const fullId = m.agent === 'claude' ? 'bypassPermissions' : 'full'
      next.perm = full && d.menus[m.agent]?.perms?.some((p) => p.id === fullId) ? fullId : d.permDefault[m.agent] ?? null
      next.fast = !!d.menus[m.agent]?.fastLocked && !!m.fast
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
        setSel(m ? choose(r.menu, r.menu.current, m) : r.menu.current)
      })
      .catch((e: Error) => setError(e.message))
  }, [chat, typed])
  const model = (s: MenuPick) => data?.menus[s.agent]?.models.find((m) => m.id === s.model) ?? null
  const level = (s: MenuPick) => s.effort ?? model(s)?.defaultEffort ?? null
  const changes = () => {
    if (!data || !sel || data.remote) return []
    const w = data.current, out: string[] = []
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
    const r = await act({ type: 'restart', chat, kind: sel.agent, model: sel.model ?? '', effort: level(sel) ?? '', speed: sel.fast ? 'fast' : 'normal', perm: sel.perm ?? '' } as never).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if ((r as { ok?: boolean }).ok === false) return setError((r as { error?: string }).error || "The agent didn't restart.")
    close()
  }
  const remote = data?.remote ?? null
  const menu = sel ? data?.menus[sel.agent] : undefined
  const m = sel ? model(sel) : null
  const on = sel ? level(sel) : null
  const perm = sel ? menu?.perms?.find((x) => x.id === sel.perm) : undefined
  const ch = changes()
  const row = 'flex min-h-[31px] w-full items-center gap-2.5 rounded-[7px] px-[9px] text-left enabled:hover:bg-hover disabled:text-fg3 coarse:min-h-11'
  const head = (t: string) => <div className="px-[9px] pt-2 pb-1 text-[0.6875rem] text-fg3">{t}</div>
  return (
    <Menu label="Model" onClose={close} className="absolute right-0 bottom-full z-30 mb-2 w-[300px] max-w-[calc(100vw-2rem)] origin-bottom-right">
      <div data-model-menu className="relative flex flex-col text-[0.8rem]">
        {!data || !sel ? (
          <p className={clsx('px-[9px] py-2 text-fg3', error && 'text-need-fg')}>{error ?? 'Reading what it runs on…'}</p>
        ) : (
          <>
            {head('Model')}
            {models(data).map((x) => (
              <button key={`${x.agent}-${x.id}`} type="button" role="menuitemradio" aria-checked={x.agent === sel.agent && x.id === sel.model} disabled={!!remote} className={row} onClick={() => setSel(choose(data, sel, x))}>
                {/* the agent's own mark, Herdr's icon (web/public/agents, from the window's icons) */}
                <img src={`agents/${x.agent}.svg`} alt="" aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                {remote ? <span className="shrink-0 text-[0.6875rem] text-fg3">{remote}</span> : null}
                <span className="grid size-3.5 shrink-0 place-items-center">{x.agent === sel.agent && x.id === sel.model ? <CheckIcon className="size-3.5" /> : null}</span>
              </button>
            ))}
            <div className="px-1 py-1"><div className="h-px bg-line" /></div>
            {head('Reasoning')}
            <div className="px-1 py-[3px]">
              <div role="radiogroup" aria-label="Reasoning" className={clsx('flex h-7 gap-0.5 rounded-[7px] bg-sel p-0.5 coarse:h-10', remote && 'opacity-50')}>
                {(m?.efforts ?? []).map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={on === e} disabled={!!remote} onClick={() => setSel({ ...sel, effort: e })}
                    className={clsx('min-w-0 flex-1 truncate rounded-[5px] text-[0.71875rem]', on === e ? 'bg-bg font-medium text-fg shadow-soft' : 'text-fg2 enabled:hover:text-fg')}>
                    {LEVEL[e] ?? e}
                  </button>
                ))}
              </div>
            </div>
            {m?.fast && !menu?.fastLocked ? (
              <button type="button" role="menuitemcheckbox" aria-checked={sel.fast} disabled={!!remote} className={row} onClick={() => setSel({ ...sel, fast: !sel.fast })}>
                <SpeedIcon className="size-3.5 shrink-0 text-fg3" />
                <span className="flex-1">Fast</span>
                <span aria-hidden className={clsx('relative h-4 w-7 shrink-0 rounded-full transition-colors', sel.fast ? 'bg-accent' : 'bg-line2')}>
                  <span className={clsx('absolute top-0.5 size-3 rounded-full bg-bg transition-[left]', sel.fast ? 'left-3.5' : 'left-0.5')} />
                </span>
              </button>
            ) : null}
            {menu?.perms?.length ? (
              <button type="button" aria-haspopup="menu" aria-expanded={perms} disabled={!!remote} className={clsx(row, perms && 'bg-hover')} onClick={() => setPerms(!perms)}>
                <ModeIcon className="size-3.5 shrink-0 text-fg3" />
                <span className="flex-1">Permissions</span>
                <span className="shrink-0 text-[0.75rem] text-fg3">{perm?.label ?? ''}</span>
                <NextIcon className="size-3 shrink-0 text-fg3" />
              </button>
            ) : null}
            {perms && menu?.perms ? (
              <div role="menu" aria-label="Permissions" className="absolute right-1 bottom-9 z-10 w-[180px] rounded-[8px] bg-bg p-[5px] shadow-menu">
                {menu.perms.map((x) => (
                  <button key={x.id} type="button" role="menuitemradio" aria-checked={sel.perm === x.id} className={row} onClick={() => { setSel({ ...sel, perm: x.id }); setPerms(false) }}>
                    <span className="flex-1">{x.label}</span>
                    <span className="grid size-3.5 shrink-0 place-items-center">{sel.perm === x.id ? <CheckIcon className="size-3.5" /> : null}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {error ? <p className="px-[9px] pt-1 text-[0.75rem] text-need-fg">{error}</p> : null}
            {ch.length ? (
              <div className="pt-[5px]">
                <button type="button" disabled={busy} onClick={() => void restart()} className="press-dim h-7 w-full truncate rounded-[7px] bg-fg px-2.5 text-[0.78125rem] font-medium text-bg disabled:opacity-60 coarse:h-11">
                  {busy ? 'Restarting…' : `Restart with ${ch.join(' · ')}`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Menu>
  )
}

/** Under the message box, as the window's model button: what its agent runs on ("Opus 5.5 · High"), a chevron; it opens
 *  the model menu */
export function AgentLine({ chatKey, cli }: { chatKey: string; cli: string }) {
  const words = useStore((s) => s.chats[chatKey]?.agent?.words)
  const open = useMenuOpen()
  const phone = useUI((u) => u.device === 'phone')
  if (!words) return <OldAgentLine chatKey={chatKey} cli={cli} />
  // a narrow chat drops "· 1M" first, as the window's
  const shown = phone ? words.replace(/\s*·\s*1M\b/, '') : words
  return (
    <div className="relative mt-1 flex justify-end pr-1">
      <button type="button" data-agent-line aria-haspopup="menu" aria-expanded={open?.chat === chatKey}
        onClick={() => setMenuOpen(open?.chat === chatKey ? null : { chat: chatKey })}
        className="flex h-6 items-center gap-1 rounded-[6px] pr-[5px] pl-2 text-[0.75rem] font-medium whitespace-nowrap text-fg2 hover:bg-hover hover:text-fg phone:h-9">
        {shown}
        <DownIcon className="size-3 shrink-0" />
      </button>
      {open?.chat === chatKey ? <ModelMenu key={`${chatKey}|${open.typed ?? ''}`} chat={chatKey} typed={open.typed} /> : null}
    </div>
  )
}

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
