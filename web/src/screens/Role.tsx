// Settings › Agents, as 3.0's: each role's model button ("Opus 5.5 · 1M · High ⌄") opening the window's model menu
// (mods/chat-models, settings mode: Model, Reasoning, Fast, Permissions; every change saved at once at the page's
// level), and the instructions every agent of a role is told first, edited in a sheet.
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentPick, ModelMenus, SettingRow } from '@shared/types.ts'
import { act } from '../kernel.ts'
import { ModelList } from '../restart.tsx'
import { CheckIcon, DownIcon, ic, Menu, MenuItem, MenuLabel, MenuSeparator, MenuSwitch, ModeIcon, NextIcon, Primary, SpeedIcon, Tab, Tabs, TextBox } from '../ui.tsx'
import * as AG from '@core/agents.js'
import { permissionOptions } from '@core/agents.js'
import { PermissionInfo, PermissionIcon } from '../PermissionInfo.tsx'
import * as ST from '@core/settings.js'

const { levelName, NAMES, menuFor } = AG as unknown as { levelName: (e: string | null) => string | null; NAMES: Record<string, string>; menuFor: (agent: string, defaults: object) => ModelMenus['menus'][string] }
const reviewPerm = (agent: string) => agent === 'claude' ? 'plan' : 'read-only'
const { MODEL_MENU, chooseModel, modelLabel } = ST as unknown as {
  MODEL_MENU: { reasoning: string; fast: string; permissions: string }
  chooseModel: (menus: ModelMenus['menus'], permDefault: ModelMenus['permDefault'], sel: AgentPick, agent: string, id: string) => AgentPick
  modelLabel: (menus: ModelMenus['menus'] | undefined, sel: AgentPick | null | undefined) => string
}

type Open = { kind: 'file'; role: string; title: string; file: string } | null
let open: Open = null
const listeners = new Set<() => void>()
const tell = () => { for (const f of listeners) f() }
export const openRole = (o: NonNullable<Open>) => { open = o; tell() }
const close = () => { open = null; tell() }

export function RoleSheet() {
  const o = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  if (!o) return null
  return <FileSheet key={o.role} o={o} />
}

/** the agents on offer here (read once, as the window's settings read them when they open) */
let offered: Promise<(ModelMenus & { picks?: { pinned: string[]; recent: string[] } }) | null> | null = null
const menusNow = () => (offered ??= act({ type: 'role-info' } as never).then((r: any) => (r?.menus && Object.keys(r.menus).length ? { menus: r.menus, permDefault: r.permDefault ?? {}, picks: r.picks } : (offered = null)), () => (offered = null)))
/** a model typed by id joins its agent's list, so the menu's levels and label know it */
const withTyped = (menus: ModelMenus['menus'], x: { agent: string; id: string; typed?: boolean }) =>
  x.typed && !menus[x.agent]?.models.some((m) => m.id === x.id) ? { ...menus, [x.agent]: { ...menus[x.agent], models: [x as never, ...menus[x.agent].models] } } : menus

/** a role's model button, as the window's (lib/settings.js modelButton): its words and ⌄, quiet, opening the model menu
 *  over or under it */
export function ModelButton({ row, level }: { row: SettingRow; level: string }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const readOnly = row.key === 'holycow.hc-review'
  const raw = row.agent?.sel ?? null
  const sel = readOnly && raw ? { ...raw, perm: reviewPerm(raw.agent) } : raw
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    const below = r ? innerHeight - r.bottom : 999
    setUp(!!r && below < 440 && r.top > below)
    setOpen(!open)
  }
  return (
    <span ref={ref} className="relative max-w-full">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${row.label}: ${row.value}`}
        disabled={!sel}
        onClick={toggle}
        className="press-dim relative inline-flex h-7 max-w-full items-center gap-1 rounded-row pr-1.5 pl-2 text-[0.8125rem] font-medium whitespace-nowrap text-fg2 after:absolute after:-inset-y-1.5 after:inset-x-0 enabled:hover:bg-hover enabled:hover:text-fg disabled:opacity-60 aria-expanded:bg-hover coarse:h-9 phone:h-9 phone:text-[0.875rem]"
      >
        <span className="truncate">{row.value}</span>
        <DownIcon className={clsx(ic, 'size-3.5')} />
      </button>
      {open && sel ? <ModelMenu start={sel} up={up} readOnly={readOnly} onClose={() => setOpen(false)} save={(next) => act({ type: 'setting', key: row.key, value: JSON.stringify(next), place: level } as never)} /> : null}
    </span>
  )
}

export function PermissionButton({ row, level }: { row: SettingRow; level: string }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const [error, setError] = useState('')
  const sel = row.agent?.sel
  if (!sel) return null
  const locked = row.key === 'holycow.hc-review'
  const current = locked ? reviewPerm(sel.agent) : sel.perm
  const perms = permissionOptions(menuFor(sel.agent, {}).perms, current)
  const label = perms.find((p) => p.id === current)?.label ?? 'CLI default'
  const choose = (perm: string) => {
    if (locked) return
    if (perm === current) { setOpen(false); return }
    setError('')
    void act({ type: 'setting', key: row.key, value: JSON.stringify({ ...sel, perm }), place: level } as never)
      .then((r: any) => r?.ok === false ? setError(r.error ?? 'It did not save.') : setOpen(false), (e: Error) => setError(e.message))
  }
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    const below = r ? innerHeight - r.bottom : 999
    setUp(!!r && below < 40 + 40 * perms.length && r.top > below)
    setOpen(!open)
  }
  return <span ref={ref} className="relative inline-flex max-w-full items-center">
    <button type="button" disabled={locked} aria-label={`${row.label} permissions: ${label}`} aria-haspopup="menu" aria-expanded={open}
      onClick={toggle} className="press-dim inline-flex h-7 items-center gap-1.5 rounded-row px-2 text-[0.8125rem] whitespace-nowrap text-fg2 enabled:hover:bg-hover coarse:h-9 phone:h-9">
      <PermissionIcon kind={perms.find((p) => p.id === current)?.icon} /><span>{label}</span>{!locked ? <DownIcon className={clsx(ic, 'size-3.5')} /> : null}
    </button>
    <PermissionInfo agent={sel.agent} perm={current} />
    {open ? <Menu label={MODEL_MENU.permissions} onClose={() => setOpen(false)} className={clsx('absolute right-0 z-20 w-[250px] max-w-[calc(100vw-2rem)]', up ? 'bottom-full mb-1' : 'top-full mt-1')}>
      <MenuLabel>{MODEL_MENU.permissions}</MenuLabel>
      {perms.map((p) => <MenuItem key={p.id} role="menuitemradio" aria-checked={p.id === current} icon={<PermissionIcon kind={p.icon} />} hint={p.id === current ? <CheckIcon className={ic} /> : null} onClick={() => choose(p.id)}>{p.label}</MenuItem>)}
      {error ? <p role="alert" className="px-3 py-2 text-[0.75rem] text-need-fg">{error}</p> : null}
    </Menu> : null}
  </span>
}

/** the window's model menu in settings mode: the model list as the chat's (restart.tsx ModelList: agent tabs,
 *  search, pinned and recent; picking another CLI's switches agent), Reasoning (that model's levels), Fast (where the model has it), Permissions (a small list); no Restart, each change
 *  saved as it is made */
function ModelMenu({ start, up, readOnly = false, onClose, save }: { start: AgentPick; up: boolean; readOnly?: boolean; onClose: () => void; save: (sel: AgentPick) => Promise<any> }) {
  const [data, setData] = useState<ModelMenus | null>(null)
  const [sel, setSel] = useState<AgentPick>(start)
  const [perms, setPerms] = useState(false)
  const [error, setError] = useState('')
  const [picks, setPicks] = useState<{ pinned: string[]; recent: string[] } | undefined>()
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  useEffect(() => { void menusNow().then((m) => (m ? (setData(m), setPicks(m.picks)) : setError('Could not read the agents.'))) }, [])
  const change = (next: AgentPick) => {
    if (readOnly) next = { ...next, perm: reviewPerm(next.agent) }
    setSel(next)
    setError('')
    void save(next).then((r: any) => r?.ok === false && setError(r.error ?? 'It did not save.'), (e: Error) => setError(e.message))
  }
  const offeredMenu = data?.menus[sel.agent]
  const menu = readOnly && offeredMenu ? { ...offeredMenu, perms: offeredMenu.perms.filter((p) => p.id === reviewPerm(sel.agent)) } : offeredMenu
  const permissions = permissionOptions(menu?.perms, sel.perm)
  const model = menu?.models.find((m) => m.id === sel.model)
  const level = sel.effort ?? model?.defaultEffort ?? null
  const fast = !!model?.fast
  const perm = menu?.perms.find((p) => p.id === sel.perm)
  return (
    <Menu label={modelLabel(data?.menus, sel)} tabs onClose={onClose}
      className={clsx('absolute right-0 z-20 w-[340px] max-w-[calc(100vw-2rem)]', up ? 'bottom-full mb-1 origin-bottom-right' : 'top-full mt-1 origin-top-right')}>
      {!data ? <p className={clsx('px-3 py-2 text-fg3', error && 'text-need-fg')}>{error || ST.LOADING_AGENTS}</p> : (
        <>
          <ModelList menus={data.menus as never} agent={sel.agent} picks={picks} chosen={{ agent: sel.agent, model: sel.model ?? null }} autoFocus={!coarse}
            onPick={(x) => { if (x.agent === sel.agent && x.id === sel.model) return; const menus = withTyped(data.menus, x); if (menus !== data.menus) setData({ ...data, menus }); change(chooseModel(menus, data.permDefault, sel, x.agent, x.id)) }}
            onPin={(agent, id) => void act({ type: 'model-pin', agent, model: id } as never).then((r: any) => r?.picks && setPicks(r.picks), () => undefined)} />
          <MenuSeparator />
          <MenuLabel>{MODEL_MENU.reasoning}</MenuLabel>
          <div className="px-2 pb-1 phone:px-3">
            <Tabs label={MODEL_MENU.reasoning} className="flex! w-full">
              {(model?.efforts ?? []).map((e) => (
                <Tab key={e} fill on={level === e} onClick={() => level !== e && change({ ...sel, effort: e })}>{levelName(e)}</Tab>
              ))}
            </Tabs>
          </div>
          {fast ? <MenuSwitch name={MODEL_MENU.fast} icon={<SpeedIcon className={ic} />} on={!!sel.fast} onClick={() => change({ ...sel, fast: !sel.fast })} /> : null}
          {menu?.perms.length ? (
            <>
              <MenuItem icon={<ModeIcon className={ic} />} aria-expanded={perms} onClick={() => setPerms(!perms)}
                hint={<span className="inline-flex items-center gap-1">{perm?.label ?? ''}<NextIcon className={clsx('size-3 transition-transform', perms && 'rotate-90')} /></span>}>
                {MODEL_MENU.permissions}
              </MenuItem>
              {perms ? permissions.map((p) => (
                <MenuItem key={p.id} role="menuitemradio" aria-checked={p.id === sel.perm} className="pl-8 phone:pl-10" icon={<PermissionIcon kind={p.icon} />} hint={p.id === sel.perm ? <CheckIcon className={ic} /> : null}
                  onClick={() => { setPerms(false); if (p.id !== sel.perm) change({ ...sel, perm: p.id }) }}>
                  {p.label}
                </MenuItem>
              )) : null}
              {perms ? <PermissionInfo agent={sel.agent} perm={sel.perm} /> : null}
            </>
          ) : null}
          {error ? <p role="alert" className="px-3 pt-1 pb-2 text-[0.75rem] text-need-fg">{error}</p> : null}
        </>
      )}
    </Menu>
  )
}

/** the instructions editor over Settings, as the window's (mods/coordinator's instructions view): its title and Done,
 *  the text saved shortly after typing stops (and on Done), and the role's note under it with "Saved." */
function FileSheet({ o }: { o: Extract<Open, { kind: 'file' }> }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const later = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shade = useRef<HTMLDivElement>(null)
  const W = ST.INSTRUCTIONS as { title: string; done: string; saved: string; notSaved: (why: string) => string; notes: Record<string, string> }
  useEffect(() => {
    act({ type: 'template', role: o.role } as never).then((r: any) => (r.ok === false ? setError(r.error) : (setSaved(r.text ?? ''), setText(r.text ?? ''))), (e: Error) => setError(e.message))
  }, [o.role])
  const save = async (t: string) => {
    clearTimeout(later.current)
    if (saved === null || t === saved) return
    const r: any = await act({ type: 'template', role: o.role, text: t } as never).catch((e: Error) => ({ ok: false, error: e.message }))
    if (r?.ok === false) return setError(W.notSaved(r.error ?? 'it did not save'))
    setSaved(t)
    setError(null)
    setStatus(W.saved)
  }
  const done = () => { void save(text).finally(close) }
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done() } }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  })
  return (
    <div ref={shade} className="absolute inset-0 z-30 flex items-start justify-center bg-black/35 px-6 py-12 phone:items-end phone:p-3 phone:pb-[max(env(safe-area-inset-bottom),--spacing(3))]" onClick={(e) => e.target === e.currentTarget && done()}>
      <div role="dialog" aria-modal="true" aria-label={o.title} className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-box bg-bg shadow-dialog">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line pr-2 pl-4 phone:h-12">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{o.title || W.title}</h2>
          <Primary className="h-7! px-3! text-[0.8125rem] phone:h-9!" onClick={done}>{W.done}</Primary>
        </div>
        {saved === null ? <p className={clsx('px-4 py-3', error ? 'text-need-fg' : 'text-fg3')}>{error ?? 'Reading…'}</p> : (
          <div className="h-[60dvh] min-h-0 overflow-y-auto overscroll-contain">
            <TextBox label={o.title} value={text} spellCheck={false} autoFocus
              onChange={(t) => { setText(t); setStatus(''); clearTimeout(later.current); later.current = setTimeout(() => void save(t), 600) }}
              className="block min-h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-[0.8125rem]/5 outline-none phone:text-[0.875rem]/[1.375rem]" />
          </div>
        )}
        <div className="flex shrink-0 items-start gap-3 border-t border-line px-3 py-2 text-[0.75rem] phone:text-[0.8125rem]">
          <p className="min-w-0 flex-1 text-pretty text-fg3">{W.notes[o.role] ?? W.notes.coordinator}</p>
          {error || status ? <p role="status" className={clsx('shrink-0', error ? 'text-need-fg' : 'text-fg3')}>{error ?? status}</p> : null}
        </div>
      </div>
    </div>
  )
}
