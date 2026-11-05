// Settings, as the window's (mods/shepherdr-settings): its pages in its order (Agents, Tasks, Autopilot, Notify, Secrets,
// Machines, Window, Web), Everywhere's, or a space's own ("Space settings"). A page a space can set its own of starts
// with the level switch (Applies to: Everywhere or a space, picked); the others say they are one for every space. Each
// row says, as the window's, "Inherited from Everywhere" or "Set for this space · Reset", and on Everywhere which spaces
// set their own. Every title, line and button word is core/settings.js's, the window's own.
// The web follows the device's light or dark (the window follows Herdr's theme): no page of its own here. A phone
// lists the pages in one rounded group, as iOS's Settings does, and a tap pushes one over the list; a wider screen
// keeps the list down its side.
import clsx from 'clsx'
import { ModelButton, openRole } from './screens/Role.tsx'
import { MachineDetails } from './MachineDetails.tsx'
import { askServeFrom } from './screens/ServeFrom.tsx'
// The window's words for every page: core/settings.js (mods/shepherdr-settings reads the same)
import * as STc from '@core/settings.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ST = STc as any
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FC, type ReactNode } from 'react'
import { machineName, type SettingRow, type SettingSection, type Snapshot } from '@shared/types.ts'
import { act, registry, setUI, useSnap, useUI, type UI } from './kernel.ts'
// Autopilot's schedule words (Custom…, its example), the window's: core/autopilot.js
import * as APc from '@core/autopilot.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AP = APc as any
import { usePluginErrors } from './guard.tsx'
import { PlacesToggle } from './Frame.tsx'
import { Stack } from './Stack.tsx'
import {
  AppearanceIcon,
  AutopilotIcon,
  ClockIcon,
  BackIcon,
  BellIcon,
  ChatIcon,
  CheckIcon,
  CogIcon,
  DownIcon,
  Ghost,
  GlobeIcon,
  HashIcon,
  SplitIcon,
  Head,
  ic,
  IconButton,
  KeyIcon,
  MachineIcon,
  Menu,
  MenuItem,
  MenuLabel,
  MinusIcon,
  ModelIcon,
  NextIcon,
  PhoneTop,
  PlaceIcon,
  PlanIcon,
  PluginIcon,
  PlusIcon,
  RoundButton,
  Small,
  field,
  Tab,
  Tabs,
  TasksIcon,
  TextBox,
  UpDownIcon,
  Who,
  XIcon,
} from './ui.tsx'

/** a setting's word as the screen says it: "Off", "On its own", "2 rounds"; a name like claude-haiku-5-5 as it is */
export const shown = (v: string) => (v === 'xhigh' ? 'Extra high' : /^[a-z][a-z ,]*$/.test(v) ? v.charAt(0).toUpperCase() + v.slice(1) : v)

/** a setting's value and the menu of its choices; plain, as a phone's grouped rows have it (the value and ⌃⌄, no box) */
export function Pick({
  value,
  options,
  onPick,
  label,
  plain,
  show = shown,
  depth,
  icon,
  ordered,
  left,
  className,
}: {
  value: string
  options: string[]
  onPick: (v: string) => void
  label: string
  plain?: boolean
  /** its words for a value */
  show?: (v: string) => string
  /** a mark before a value's words, in the picker and its menu (a place's icon) */
  icon?: (v: string) => ReactNode
  /** a tree: how deep each choice sits, and its own short name there (a project's, under its machine) */
  depth?: (v: string) => { depth: number; name: string }
  /** the choices in their own order (else the one picked first) */
  ordered?: boolean
  /** its menu opens from its left edge */
  left?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // a menu near the bottom of the screen opens upward, so every choice stays in view; a long one (pi's many models,
  // every place) shows ten rows and scrolls, fewer where the screen has less room (a phone on its side)
  const [up, setUp] = useState(false)
  const [tall, setTall] = useState(0)
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    const row = innerWidth < 640 || matchMedia('(pointer: coarse)').matches ? 44 : 32
    const need = (Math.min(options.length, 10) + 1) * row + 16
    const below = r ? innerHeight - r.bottom - 12 : need
    const above = r ? r.top - 12 : 0
    const upward = below < need && above > below
    setUp(upward)
    setTall(Math.max(3 * row, Math.min(need, upward ? above : below)))
    setOpen(!open)
  }
  const ref = useRef<HTMLDivElement>(null)
  return (
    // plain, its ⌃⌄ sits a hair past the row's edge, lined up with the other rows' ends
    <div ref={ref} className={clsx('relative max-w-full', plain && 'left-1', className)}>
      {plain ? (
        <button
          type="button"
          aria-label={`${label}: ${show(value)}`}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={toggle}
          className="press-dim relative -my-2.5 inline-flex min-h-11 max-w-full items-center gap-1 pl-2 whitespace-nowrap text-fg2"
        >
          {icon?.(value)}
          <span className="truncate">{show(value)}</span>
          <UpDownIcon className={ic} />
        </button>
      ) : (
        <Ghost className="max-w-full pr-1.5 pl-2.5 tabular-nums" aria-label={`${label}: ${show(value)}`} aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
          {icon?.(value)}
          <span className="truncate">{show(value)}</span>
          <DownIcon className={ic} />
        </Ghost>
      )}
      {open ? (
        <Choices
          value={value}
          options={options}
          show={show}
          depth={depth}
          icon={icon}
          ordered={ordered}
          left={left}
          up={up}
          tall={tall}
          onClose={() => setOpen(false)}
          onPick={(o) => {
            setOpen(false)
            if (o !== value) onPick(o)
          }}
        />
      ) : null}
    </div>
  )
}

/** a setting's choices: the shared menu, springing out of it (up, near the bottom of the screen); one too long to show
 *  whole scrolls, the one picked in view */
function Choices({
  value,
  options,
  up,
  tall,
  onPick,
  onClose,
  show,
  depth,
  icon,
  ordered,
  left,
}: {
  value: string
  options: string[]
  up: boolean
  tall: number
  onPick: (v: string) => void
  onClose: () => void
  show: (v: string) => string
  depth?: (v: string) => { depth: number; name: string }
  icon?: (v: string) => ReactNode
  ordered?: boolean
  left?: boolean
}) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight > el.clientHeight) el.querySelector('[aria-checked=true]')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <Menu
      label="Choices"
      onClose={onClose}
      className={clsx(
        'absolute z-10 min-w-full max-w-[calc(100vw-2rem)]',
        left ? 'left-0' : 'right-0',
        up ? 'bottom-full mb-1' : 'top-full mt-1',
        up ? (left ? 'origin-bottom-left' : 'origin-bottom-right') : left ? 'origin-top-left' : 'origin-top-right',
      )}
    >
      {depth && options.length > 10 ? <input aria-label="Find scope or value" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} className="mx-2 mb-1 w-[calc(100%-1rem)] min-w-0 rounded-row bg-well px-2 py-2 outline-none" /> : null}
      <div ref={ref} style={{ maxHeight: tall - (depth && options.length > 10 ? 56 : 12) }} className="overflow-y-auto overscroll-contain">
        {(ordered ? options : [value, ...options.filter((o) => o !== value)]).filter((o) => show(o).toLowerCase().includes(query.toLowerCase())).map((o) => {
          const at = depth?.(o)
          return (
            <MenuItem
              key={o}
              role="menuitemradio"
              aria-checked={o === value}
              aria-label={at && at.name !== show(o) ? show(o) : undefined}
              icon={o === value ? <CheckIcon className={ic} /> : null}
              onClick={() => onPick(o)}
            >
              {/* a tree's rows step in under the one they belong to, as the sidebar's */}
              <span style={at ? { paddingLeft: `${at.depth}rem` } : undefined} className={clsx(icon && 'flex min-w-0 items-center gap-2')}>
                {icon?.(o)}
                <span className="truncate">{at ? at.name : show(o)}</span>
              </span>
            </MenuItem>
          )
        })}
      </div>
    </Menu>
  )
}

/** a number as the screen says it: "7 days", "1.5× cores", "Off" */
const numShown = (v: string, num: NonNullable<SettingRow['num']>) => (v === 'off' ? 'Off' : v.replace(/^(\d+(?:\.\d+)?)(\s*).*$/, (_, n, sp) => `${n}${num.unit ? `${sp}${Number(n) === 1 && num.one ? num.one : num.unit}` : ''}`))

/** a value you type: a box as wide as its words, saved when you leave it (Enter too) */
export function TextValue({ value, onSave, onEdit, label, placeholder }: { value: string; onSave: (v: string) => void; onEdit: () => void; label: string; placeholder?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    // as tall and round as the pickers beside it, its edge a shade darker while you type (a text box's look)
    <span className="relative inline-flex h-7 max-w-full items-center rounded-full shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus coarse:h-9 phone:h-9">
      <span aria-hidden="true" className="invisible block truncate px-2.5 whitespace-pre">
        {v || placeholder || ' '}
      </span>
      <input
        name={label}
        aria-label={label}
        placeholder={placeholder}
        value={v}
        onFocus={onEdit}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="absolute inset-0 w-full min-w-0 bg-transparent px-2.5 outline-none phone:text-[1rem]"
      />
    </span>
  )
}

/** on or off: the track grey off, green on, its knob sliding across (iOS's) */
export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group relative inline-flex w-9 shrink-0 rounded-full bg-line2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-200 ease-in-out after:absolute after:-inset-2 disabled:cursor-default disabled:opacity-40 aria-checked:bg-ready aria-checked:shadow-none coarse:w-12 phone:w-12"
    >
      <span className="aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-black/5 transition-transform duration-200 ease-in-out group-aria-checked:translate-x-full" />
    </button>
  )
}

/** a few short choices side by side, the one picked raised */
function Segments({ value, options, label, onPick, fill }: { value: string; options: string[]; label: string; onPick: (v: string) => void; fill?: boolean }) {
  return (
    <Tabs label={label} className={fill ? 'flex! w-full' : undefined}>
      {options.map((o) => (
        <Tab key={o} fill={fill} on={o === value} onClick={() => o !== value && onPick(o)}>
          {shown(o)}
        </Tab>
      ))}
    </Tabs>
  )
}

/** a stepper's − or + */
function Step({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="press-dim relative grid size-7 shrink-0 place-items-center rounded-full bg-hover text-fg2 after:absolute after:-inset-1 enabled:hover:bg-sel enabled:hover:text-fg disabled:cursor-default disabled:opacity-40 coarse:size-9 phone:size-9"
    >
      {children}
    </button>
  )
}

/** a count or a threshold: − and + step it (↑ and ↓ too), or type any number in its range, its unit after it; one
 *  that may be off is off below its least, or left empty. Typed, it is saved when you leave it; stepped, a moment
 *  after the last step */
function NumberValue({ value, num, onSave, onEdit, label }: { value: string; num: NonNullable<SettingRow['num']>; onSave: (v: string) => void; onEdit: () => void; label: string }) {
  const now = value === 'off' ? '' : String(Number.parseFloat(value))
  const [v, setV] = useState(now)
  useEffect(() => setV(now), [now])
  const offable = !!(num.off || num.zero)
  const later = useRef<ReturnType<typeof setTimeout>>(undefined)
  // a step still waiting is saved as the row goes (another page, Settings closed)
  const pending = useRef<() => void>(undefined)
  useEffect(() => () => pending.current?.(), [])
  const save = (t = v.trim()) => {
    clearTimeout(later.current)
    pending.current = undefined
    if (t === now) return
    if (!t && !offable) return setV(now)
    onSave(t || 'off')
  }
  const step = (by: number) => {
    onEdit()
    const s = num.step ?? 1
    const x = Number.parseFloat(v)
    let next: string
    if (!Number.isFinite(x)) next = by > 0 ? String(num.min) : v
    else {
      const to = Math.round((x + by * s) / s) * s
      next = to < num.min - 1e-9 ? (offable ? '' : String(num.min)) : String(+Math.min(num.max, to).toFixed(4))
    }
    setV(next)
    clearTimeout(later.current)
    pending.current = () => save(next)
    later.current = setTimeout(() => save(next), 700)
  }
  const x = Number.parseFloat(v)
  const unit = v && num.unit ? (x === 1 && num.one ? num.one : num.unit) : ''
  return (
    <span className="inline-flex items-center gap-1.5">
      <Step label={`Less: ${label}`} onClick={() => step(-1)} disabled={!v || (!offable && x <= num.min)}>
        <MinusIcon className={ic} />
      </Step>
      <span className="relative inline-flex h-7 min-w-14 items-center justify-center rounded-full tabular-nums shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus coarse:h-9 phone:h-9">
        {/* the box is as wide as its number */}
        <span className="inline-grid">
          <span aria-hidden="true" className={clsx('invisible col-start-1 row-start-1 pl-2.5 whitespace-pre', !unit && 'pr-2.5')}>
            {v || (offable ? 'Off' : ' ')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            name={label}
            aria-label={num.unit ? `${label} (${num.unit})` : label}
            value={v}
            placeholder={offable ? 'Off' : undefined}
            onFocus={onEdit}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                step(e.key === 'ArrowUp' ? 1 : -1)
              }
            }}
            className={clsx('col-start-1 row-start-1 w-0 min-w-full bg-transparent pl-2.5 outline-none placeholder:text-fg2 phone:text-[1rem]', !unit && 'pr-2.5')}
          />
        </span>
        {unit ? <span className={clsx('pr-2.5 whitespace-nowrap text-fg2', !/^[×%]/.test(unit) && 'pl-1')}>{unit}</span> : null}
      </span>
      <Step label={`More: ${label}`} onClick={() => step(1)} disabled={!!v && x >= num.max}>
        <PlusIcon className={ic} />
      </Step>
    </span>
  )
}

/** a trigger (Autopilot's heartbeat, the news that wakes it): never its rule as written, but in plain words, its next
 *  runs, and a few ready-made picks side by side (none raised for one the coordinator wrote); anything else is asked of
 *  the coordinator */
function TriggerValue({ row, phone, onPick }: { row: SettingRow & { trigger: NonNullable<SettingRow['trigger']> }; phone: boolean; onPick: (v: string) => void }) {
  const t = row.trigger
  // a row that takes its own words (Autopilot's schedule) has Custom… too: a box for any rule, saved as you leave it
  const [custom, setCustom] = useState(false)
  const preset = t.presets.find((p) => p.value === row.value)
  const picked = custom || (row.text && !preset) ? AP.CUSTOM : (preset?.label ?? '')
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-pretty text-fg">{t.words}</p>
        {t.next.length ? <Small className="tabular-nums">Next: {t.next.join(' · ')}</Small> : null}
      </div>
      {(() => {
        const options = [...t.presets.map((p) => p.label), ...(row.text ? [AP.CUSTOM] : [])]
        const pick = (l: string) => { if (l === AP.CUSTOM) return setCustom(true); setCustom(false); onPick(t.presets.find((p) => p.label === l)!.value) }
        // more picks than a phone's line holds: a pick list
        return phone && options.length > 4 ? <Pick label={row.label} plain value={picked} options={options} onPick={pick} /> : <Segments label={row.label} value={picked} options={options} fill={phone} onPick={pick} />
      })()}
      {row.text && picked === AP.CUSTOM ? (
        <div className="flex flex-col gap-1 [&>span:first-child]:w-full">
          <TextValue label={`${row.label} rule`} placeholder={AP.CUSTOM_PLACEHOLDER} value={preset ? '' : row.value} onEdit={() => {}} onSave={(v) => { setCustom(false); onPick(v) }} />
          <Small className="text-pretty">{AP.CUSTOM_HINT}</Small>
        </div>
      ) : null}
      {row.text ? null : <Small className="text-pretty">{row.key === 'heartbeat.on' ? 'Other news waits for the next heartbeat. ' : ''}Ask the Assistant for anything else.</Small>}
    </div>
  )
}

/** a whole file's words (a coordinator's HEARTBEAT.md): an editor as wide as the page that grows with them, its
 *  name on top; Save (⌘S, Ctrl+S) and Undo show once it changed, Undo putting back what is saved */
function DocValue({ value, onSave, label, file, phone, privateRules = false, empty }: { value: string; onSave: (v: string) => void; label: string; file: string; phone: boolean; privateRules?: boolean; empty?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const changed = v !== value
  return (
    <div className={clsx('flex w-full flex-col', privateRules && clsx('overflow-hidden rounded-row shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus', phone ? 'bg-well' : 'bg-bg'))}>
      <div className={clsx('flex min-h-9 items-center gap-3 text-[0.8125rem] phone:min-h-11', privateRules && 'border-b border-line py-1 pr-1.5 pl-3')}>
        <span className={clsx('min-w-0 flex-1 text-fg2', privateRules && 'truncate font-mono text-[0.75rem]')}>{file}</span>
        {changed ? (
          <>
            <span className="text-fg3 phone:hidden">Not saved</span>
            <Ghost onClick={() => setV(value)}>Undo</Ghost>
            <Ghost onClick={() => onSave(v)} className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg">
              Save
            </Ghost>
          </>
        ) : null}
      </div>
      <TextBox
        label={label}
        value={v}
        onChange={setV}
        spellCheck={false}
        placeholder={empty ?? (privateRules ? 'Empty: no private rules for this role' : 'Empty: nothing to go through')}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault()
            if (changed) onSave(v)
          }
        }}
        className={clsx('w-full bg-transparent outline-none', privateRules ? 'min-h-24 px-3 py-2.5 font-mono text-[0.8125rem]/5 phone:text-[0.875rem]/[1.375rem]' : 'min-h-40 whitespace-pre-wrap wrap-anywhere text-base/6 focus-visible:rounded-row focus-visible:outline-2 focus-visible:outline-box-focus')}
      />
    </div>
  )
}

/** a page of settings: one of the server's sections, or a plugin's drawn by its View */
interface Page extends SettingSection {
  targets?: Record<string, string>
  device?: boolean
  Icon?: ComponentType<{ className?: string }>
  View?: FC<{ phone: boolean }>
}

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'How tasks work': PlanIcon,
  'Private instructions': PlanIcon,
  Agents: ModelIcon,
  Tasks: TasksIcon,
  'Task IDs': TasksIcon,
  Autopilot: AutopilotIcon,
  'Time zone': ClockIcon,
  Machine: MachineIcon,
  Browser: GlobeIcon,
  Notify: BellIcon,
  Notifications: BellIcon,
  Voice: ChatIcon,
  'Alerts and voice': BellIcon,
  Appearance: AppearanceIcon,
  Plugins: PluginIcon,
  Machines: MachineIcon,
  // 3.0's icons for these: the window's layout, and a globe
  Window: SplitIcon,
  Web: GlobeIcon,
  Secrets: KeyIcon,
}

/** every level defaults are set at: Everywhere, then each machine and its spaces */
export const levelsOf = (sections: SettingSection[]) => [...new Set(sections.flatMap((x) => (x.level && !x.global ? [x.level] : [])))]

/** the level Settings edits: the one picked, else Everywhere: a default set without thinking must not stay with one space */
export function levelOf(sections: SettingSection[], ui: UI) {
  const want = ui.settings?.level
  return want && levelsOf(sections).includes(want) ? want : 'all'
}

/** a level's name: Everywhere, a machine's, or a space's (with its machine's, where there are more machines) */
export function levelName(level: string, sections: SettingSection[], snap: Pick<Snapshot, 'places' | 'machines'> = { places: [], machines: [] }) {
  if (level === 'all') return 'Everywhere'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  if (kind === 'm') return machine
  const machines = new Set(levelsOf(sections).filter((l) => l.startsWith('m:')))
  // 3.0's spaces: a level is the space's own id
  const place = snap.places.find((p) => p.id === level)
  if (place && kind !== 'p') return machines.size > 1 && place.machine ? `${place.name} · ${machineName(snap.machines, place.machine)}` : place.name
  const name = place?.name ?? (space === '~' ? 'home' : space)
  return machines.size > 1 ? `${name} · ${machine}` : name
}

/** what a level's defaults are, and what it follows where it sets none */
function levelHint(level: string, snap: Pick<Snapshot, 'places' | 'machines'>) {
  if (level === 'all') return 'For every machine and space, unless one sets its own.'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  // 3.0's levels: Everywhere, then a space; a machine's page holds only what is that machine's
  if (kind === 'm') return `For ${machine} only. The rest follows All machines.`
  const place = snap.places.find((p) => p.id === level)
  if (place) return `For ${place.name}. The rest follows Everywhere.`
  return `For ${space}. The rest follows ${machine}, then Everywhere.`
}

/** Settings → Plugins with what failed on this screen too: a plugin of the human's own that threw here */
export function withPluginErrors(sections: SettingSection[], errors: Record<string, string>): SettingSection[] {
  if (!Object.keys(errors).length) return sections
  return sections.map((x) =>
    x.name !== 'Plugins'
      ? x
      : { ...x, rows: x.rows.map((r) => (errors[r.label] && !r.warn ? { ...r, warn: `Stopped on this screen: it threw:\n${errors[r.label]}` } : r)) },
  )
}

/** the window's Settings sections, in its order; a space's own settings show only the ones a space can set its own of */
const ORDER: string[] = ST.SECTIONS.map((s: { title: string }) => s.title)
const SPACE_PAGES = new Set<string>(ST.SECTIONS.filter((s: { space?: unknown }) => s.space).map((s: { title: string }) => s.title))

/** the window's pages, one list under its title ("Settings", or a space's own "Space settings"): no other group, as
 *  the window has none (Herdr's own look and keys are the window's elsewhere; the web follows the device's light or
 *  dark). A plugin's own page, if one adds any, comes after them. */
function groupsOf(sections: SettingSection[], ui: UI): { name: string; pages: Page[] }[] {
  const level = levelOf(sections, ui)
  const space = level !== 'all'
  const pages = [...sections.filter((x) => x.level === level && !x.global), ...(space ? [] : sections.filter((x) => x.global))]
    .filter((x) => ORDER.includes(x.name) && (!space || SPACE_PAGES.has(x.name)))
    .sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
  const own = registry.settingsPages.filter((x) => x.when(ui)).map(({ name, about, Icon, View }): Page => ({ name, about, Icon, View, device: true, rows: [] }))
  return [{ name: space ? ST.SPACE_TITLE : ST.TITLE, pages: [...pages, ...own] }].filter((g) => g.pages.length)
}

/** where a page sits in the list of them (for ui.settings.section), or -1 where it doesn't show */
export const sectionOf = (name: string, sections: SettingSection[], ui: UI) =>
  groupsOf(sections, ui)
    .flatMap((g) => g.pages)
    .findIndex((p) => p.name === ({ 'Alerts and voice': 'Voice' }[name] ?? name))

/** a machine's own Machine page (to open Settings on it): its section and level */
export function settingsPageOf(sections: SettingSection[], machine: string, ui: UI) {
  const level = `m:${machine}`
  if (!levelsOf(sections).includes(level)) return undefined
  const i = sectionOf('Machine', sections, { ...ui, settings: { section: 0, level } })
  return i < 0 ? undefined : { section: i, level }
}

/** a page's own icon: a plugin's, or its section's */
const iconOf = (p: Page) => p.Icon ?? ICONS[p.name] ?? CogIcon

/** a phone's rounded group of rows, a shade lighter than the page under it in dark mode, as iOS's */
const card = 'rounded-box bg-bg dark:bg-bubble'
/** a row's look: in a phone's group its line starts where its words do, as iOS's; on a wider screen a line between rows */
export const rowLook = (phone: boolean) =>
  phone
    ? 'relative flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:inset-x-0 not-first:before:top-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line'
    : 'flex min-h-12 items-center justify-between gap-3 py-2 not-first:border-t not-first:border-line'
const heading = (phone: boolean) => (phone ? 'px-4 pb-1.5 text-[0.8125rem] text-fg2' : 'pb-1 text-[0.75rem] font-medium text-fg3')

/** the window's stepper: − its value + (a count, a percent, a size), stepping through the row's choices; a value off
 *  the list (Off) steps from where the row says */
function Stepper({ row, set }: { row: SettingRow; set: (value: string) => void }) {
  const steps = row.steps ?? []
  const at = steps.indexOf(row.value)
  const from = at >= 0 ? at : Math.max(0, steps.indexOf(row.stepFrom ?? ''))
  const go = (by: number) => {
    const next = steps[Math.max(0, Math.min(steps.length - 1, (at >= 0 ? at : from) + by))]
    if (next !== undefined && next !== row.value) set(next)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Step label={`Less: ${row.label}`} onClick={() => go(-1)} disabled={at === 0}>
        <MinusIcon className={ic} />
      </Step>
      <span className="inline-flex h-7 min-w-14 items-center justify-center rounded-full px-2.5 whitespace-nowrap tabular-nums shadow-[inset_0_0_0_1px_var(--line2)] coarse:h-9 phone:h-9">{row.value}</span>
      <Step label={`More: ${row.label}`} onClick={() => go(1)} disabled={at === steps.length - 1}>
        <PlusIcon className={ic} />
      </Step>
    </span>
  )
}

/** a row's control, by what its value is: on or off a switch, a few short words segments, a count or a limit the
 *  window's stepper, free words a box, a list a menu; one with no other choice, or only shown, its words */
function Control({ row, phone, set, edit, level }: { row: SettingRow; phone: boolean; set: (value: string) => void; edit: () => void; level?: string }) {
  const options = row.options ?? []
  const action = row.key in registry.settingActions
  // a role's agent: the window's model button, and on Everywhere "Use other CLI" (a set Reviewer) and Edit
  // instructions (the file every agent of the role is told first)
  if (row.agent) {
    const role = row.key.split('.')[1]
    const told = ST.ROLES.find((r: { id: string }) => r.id === role)?.told ?? row.label
    return (
      <span className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
        <ModelButton row={row} level={level ?? 'all'} />
        {row.agent.other ? <Ghost onClick={() => set(null as unknown as string)}>{ST.USE_OTHER_CLI}</Ghost> : null}
        {row.file ? <Ghost onClick={() => openRole({ kind: 'file', role, title: told, file: row.file! })}>{ST.EDIT_INSTRUCTIONS}</Ghost> : null}
      </span>
    )
  }
  // Web's link: Copy beside it
  if (row.copy) return <CopyButton text={row.copy} />
  if (row.steps) return <Stepper row={row} set={set} />
  const onOff = options.length === 2 && options.every((o) => /^(on|off)$/i.test(o))
  const only = !row.num && !row.text && !row.multi && !action && !onOff && options.length <= 1 && (options[0] ?? row.value) === row.value
  if (row.fixed || !row.key || only) return <span className="text-right text-pretty text-fg2 [overflow-wrap:anywhere]">{shown(row.value)}</span>
  if (row.num) return <NumberValue label={row.label} value={row.value} num={row.num} onEdit={edit} onSave={set} />
  if (row.text) return <TextValue label={row.label} value={row.value} placeholder={row.placeholder} onEdit={edit} onSave={set} />
  if (row.multi) {
    // chips that each turn on or off (3.0's Autopilot events)
    const on = new Set(row.value.split(',').filter(Boolean))
    return (
      <div role="group" aria-label={row.label} className={clsx('flex flex-wrap gap-1.5', phone ? 'justify-start' : 'justify-end')}>
        {row.multi.map((o) => (
          <Tab key={o.value} on={on.has(o.value)} className="shadow-[0_0_0_1px_var(--line2)]" onClick={() => set(row.multi!.map((x) => x.value).filter((v) => (v === o.value ? !on.has(v) : on.has(v))).join(','))}>
            {o.label}
          </Tab>
        ))}
      </div>
    )
  }
  // an action (alerts: turn them on for this device) is a button, its row's value the words under its label
  if (action) return <Ghost onClick={() => set(options[0])}>{options[0]}</Ghost>
  // on or off: the window's switch (its words On/Off or on/off), greyed where it can't flip now (an add-on another needs)
  if (onOff) {
    const [yes, no] = /^on$/i.test(options[0]) ? options : [options[1], options[0]]
    const sw = <Switch label={row.label} on={row.value === yes} disabled={row.disabled} onChange={(on) => set(on ? yes : no)} />
    // Home Assistant's Make home space, beside its switch
    return row.extra ? <span className="flex items-center gap-2.5"><Ghost onClick={() => setExtra(row.extra!.key)}>{row.extra.label}</Ghost>{sw}</span> : sw
  }
  if (SEGMENTS.has(row.key)) return <Segments label={row.label} value={row.value} options={options} onPick={set} fill={phone} />
  return <Pick label={row.label} plain={phone} value={row.value} options={options} onPick={set} />
}

/** a row's extra button (Make home space): its own key, set at once */
const setExtra = (key: string) => void act({ type: 'setting', key, value: 'on' } as never)

/** Copy, as the window's Web › Link */
function CopyButton({ text }: { text: string }) {
  return <Ghost onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>{ST.WEB.copy}</Ghost>
}

/** a value set here that is what the row would follow anyway unsets it: it follows again */
const follows = (row: SettingRow, value: string) => (row.inherits && value === row.inherits.value ? null : value)

/** the rows whose few short choices sit side by side, as the window's segmented controls */
const SEGMENTS = new Set(['notify', 'tasks.merge', 'tasks.review_rounds', 'tasks.must_fix', 'tasks.archive_after', 'autopilot.events'])

/** a page's settings: its rows under their group's heading (Tasks, Coordinators, Reviewer), and what it notes under them */
function PageBody({ page, phone, set, refused, clear, hint }: { page: Page; phone: boolean; set: (key: string, value: string | null) => void; refused: (key: string) => string | undefined; clear: (key: string) => void; hint?: string }) {
  // a machine's block's details: this computer ("local") or another by its key
  const machines = useSnap()?.machines ?? []
  const snapMachine = (key: string) => machines.find((m) => (key === ST.LOCAL ? m.here : !m.here && (m.machine === key || m.name === key)))
  // a machine's own limits, opened by its Set its own (3.0's: shown once it has any, or once asked for)
  const [revealed, setRevealed] = useState<string[]>([])
  // the "N spaces use their own" lists open now
  const [listed, setListed] = useState<string[]>([])
  const groups: { name?: string; rows: Page['rows'] }[] = []
  for (const row of page.rows.filter((r) => !r.hidden || revealed.includes(r.hidden)).filter((r) => !r.reveals || !revealed.includes(r.reveals))) {
    if (groups.length && groups.at(-1)!.name === row.group) groups.at(-1)!.rows.push(row)
    else groups.push({ name: row.group, rows: [row] })
  }
  // what is said under a row's label: where its value comes from, or a reset for one set here; then what went wrong
  const under = (row: SettingRow) => (
    <>
      {row.key in registry.settingActions ? <Small className="text-pretty">{row.value}</Small> : null}
      {/* its line; a second (Backup's "Can't on vm: Codex is signed out.") under it, as the window's */}
      {row.hint ? <Small className="text-pretty whitespace-pre-line">{row.hint}</Small> : null}
      {/* the exact words it adds to every new task's brief, as it is set now */}
      {row.line ? <details className="text-[0.8125rem] text-fg2"><summary className="cursor-pointer">Words this adds to each new task</summary><p className="text-pretty">“{row.line}”</p></details> : null}
      {/* as the window's: "Inherited from Everywhere" / "Set for this space · Reset"; on Everywhere the spaces that set
          their own (a machine's own rows: "Set for this machine") */}
      {row.from && !row.inherits ? <Small className="text-pretty">{ST.inheritedFrom(row.from)}</Small> : null}
      {row.inherits ? (
        <Small className="flex flex-wrap items-center gap-1 text-pretty">
          <span className="text-fg2">{row.key.startsWith('machine.') ? ST.SET_FOR_MACHINE : ST.CHANGED_HERE}</span>
          <span aria-hidden>·</span>
          <button type="button" aria-label={`${ST.RESET}: ${ST.RESET_TIP(row.inherits.from)}`} onClick={() => set(row.key, null)}
            className="press-dim relative font-medium text-accent after:absolute after:-inset-x-1 after:-inset-y-1.5 coarse:after:-inset-y-3">
            {ST.RESET}
          </button>
        </Small>
      ) : null}
      {row.machinesOwn ? <Small className="text-pretty">{ST.machinesOwn(row.machinesOwn)}</Small> : null}
      {row.others?.length ? (
        <Small className="flex flex-col gap-1 text-pretty">
          <button type="button" aria-expanded={listed.includes(row.key)} onClick={() => setListed((l) => (l.includes(row.key) ? l.filter((k) => k !== row.key) : [...l, row.key]))}
            className="press-dim relative self-start text-left text-accent after:absolute after:-inset-x-1 after:-inset-y-1.5 coarse:after:-inset-y-3">
            {ST.spacesOwn(row.others.length)}
          </button>
          {listed.includes(row.key) ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {row.others.map((o) => (
                <button key={o.id} type="button" onClick={() => setUI((u) => ({ settings: { ...(u.settings ?? { section: 0 }), level: o.id } }))} className="press-dim text-left text-fg2 underline decoration-fg3 underline-offset-2">
                  {o.name}
                </button>
              ))}
            </span>
          ) : null}
        </Small>
      ) : null}
      {row.warn ? <Small className="text-pretty whitespace-pre-line text-need-fg!">{row.warn}</Small> : null}
      {refused(row.key) ? (
        <Small role="status" className={clsx('text-pretty', !registry.settingActions[row.key] && 'text-need-fg!')}>
          {refused(row.key)}
        </Small>
      ) : null}
    </>
  )
  return (
    <div className={clsx('flex w-full flex-col', phone ? 'gap-6 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))]' : 'max-w-[720px] gap-6 px-6 pt-5 pb-8')}>
      <div className={clsx('flex flex-col gap-1', phone && 'px-4')}>
        {phone ? null : <h2 className="text-[0.9375rem] font-semibold">{page.name}</h2>}
        {page.about ? <p className={clsx('text-pretty text-fg2', phone ? 'text-[0.9375rem]' : 'text-[0.8125rem]')}>{page.about}</p> : null}
        {hint ? <p className={clsx('text-pretty text-fg3', phone ? 'text-[0.9375rem]' : 'text-[0.8125rem]')}>{hint}</p> : null}
      </div>
      {page.vault && page.level ? <SecretsPage level={page.level} page={page} phone={phone} /> : null}
      {page.View ? <page.View phone={phone} /> : null}
      {groups.map(({ name, rows }, g) => {
        const Group = name === 'Access and limits' ? 'details' : 'div'
        // a machine's block (Settings › Machines): its name, then its health and plans, then its rows
        const machine = rows[0]?.details
        return <Group key={name ?? g} className="w-full">
          {name === 'Access and limits' ? <summary className={clsx(heading(phone), 'cursor-pointer')}>Access and limits</summary> : null}
          {name && name !== 'Access and limits' ? <h3 className={machine ? clsx('pb-2.5 font-semibold', phone && 'px-4') : heading(phone)}>{name}</h3> : null}
          {machine ? <div className={clsx('pb-3', phone ? clsx(card, 'mb-2 px-4 py-3') : 'border-b border-line')}><MachineDetails m={snapMachine(machine)} /></div> : null}
          <dl className={phone ? card : undefined}>
            {rows.map((row) =>
              (row.multiline && row.key.startsWith('tasks.')) || row.doc ? (
                // Tasks' notes and Autopilot's heartbeat, as the window's: the title and its line, then a box as wide as
                // the page (the heartbeat's monospace, its file small on top), saved as you type
                <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2.5 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                  <NoteBox row={row} under={under(row)} mono={!!row.doc} save={(x) => set(row.key, follows(row, x))} />
                </div>
              ) : row.multiline ? (
                <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2.5 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                  <dt className="flex min-w-0 flex-col">
                    {row.label}
                    {under(row)}
                  </dt>
                  <dd>
                    <DocValue label={row.label} file={row.key.endsWith('_notes') ? 'Every task here' : 'Private · this role only'} privateRules={row.multiline} empty={row.key.endsWith('_notes') ? 'Empty: nothing extra' : undefined} phone={phone} value={row.value} onSave={(x) => set(row.key, follows(row, x))} />
                    {row.instructions ? <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed [overflow-wrap:anywhere]">{row.instructions}</p> : null}
                  </dd>
                </div>
              ) : row.trigger ? (
                // a trigger: its words, next runs and picks under its label, as wide as the page
                <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                  <dt className="flex min-w-0 flex-col">
                    {row.label}
                    {under(row)}
                  </dt>
                  <dd>
                    <TriggerValue row={{ ...row, trigger: row.trigger }} phone={phone} onPick={(x) => set(row.key, follows(row, x))} />
                  </dd>
                </div>
              ) : (
                // on a phone, a row's segments fill a line of their own under its label
                <div key={row.key || row.reveals || row.label} className={clsx(rowLook(phone), row.inherits && 'border-l-2 border-accent pl-3', phone && SEGMENTS.has(row.key) && 'flex-col items-stretch! gap-2.5 pb-3!')}>
                  <dt className="flex min-w-0 flex-1 flex-col">
                    {row.label}
                    {under(row)}
                  </dt>
                  <dd className={clsx('flex min-w-0 shrink-0 flex-col', phone && SEGMENTS.has(row.key) ? 'items-stretch' : 'max-w-[65%] items-end')}>
                    {row.reveals ? <Ghost onClick={() => setRevealed((r) => [...r, row.reveals!])}>{ST.MACHINES.own.button}</Ghost> : row.button ? <Ghost disabled={row.disabled} onClick={() => set(row.key, null)}>{row.button}</Ghost> : <Control row={row} phone={phone} level={page.level} set={(x) => set(row.key, follows(row, x))} edit={() => clear(row.key)} />}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </Group>
      })}
      {page.qr ? (
        // Web: the link's QR code, to open it on a phone (the window's)
        <figure className="flex w-full flex-col gap-2">
          <figcaption className={clsx('text-fg2', phone ? 'px-4 text-[0.9375rem]' : 'text-[0.8125rem]')}>{page.qrTitle}</figcaption>
          <img src={page.qr} alt={page.qrTitle ?? ''} className={clsx('size-[168px] rounded-row bg-white', phone && 'mx-4')} />
        </figure>
      ) : null}
      {page.note ? (
        <figure className="w-full">
          <figcaption className={heading(phone)}>{page.noteTitle ?? "Every new task's instructions end with"}</figcaption>
          <blockquote className={clsx('text-pretty whitespace-pre-wrap text-fg2', phone ? clsx(card, 'px-4 py-3 text-[0.9375rem]') : 'rounded-box bg-hover px-3 py-2.5 text-[0.8125rem]')}>{page.note}</blockquote>
        </figure>
      ) : null}
    </div>
  )
}

/** The level switch, as the window's, at the top of a page a space can set its own of: "Applies to" and a picker
 *  (Everywhere, then every space, by machine; a Find box once there are many), and what that level means under it (a
 *  space's machine and folder). A page that is one for every space has only its line saying so. */
function LevelBar({ level, sections, page, phone, onPick }: { level: string; sections: SettingSection[]; page: Page; phone: boolean; onPick: (level: string) => void }) {
  const snap = useSnap()!
  const wrap = clsx(phone ? 'mx-4 mt-4' : 'mx-6 mt-5 max-w-[672px]')
  if (!SPACE_PAGES.has(page.name)) return <p className={clsx(wrap, 'text-pretty text-fg3', phone ? 'px-4 text-[0.9375rem]' : 'text-[0.8125rem]')}>{ST.LEVEL.global}</p>
  const ids = new Set(levelsOf(sections))
  // this computer's spaces first, then each other machine's
  const spaces = snap.places.filter((p) => ids.has(p.id)).sort((a, b) => Number(a.id.includes('/')) - Number(b.id.includes('/')) || a.machine.localeCompare(b.machine))
  const place = spaces.find((p) => p.id === level)
  const machineOf = (id: string) => (id.includes('/') ? spaces.find((p) => p.id === id)?.machine ?? id.split('/')[0] : ST.THIS_COMPUTER)
  const name = (v: string) => (v === 'all' ? ST.EVERYWHERE : spaces.find((p) => p.id === v)?.name ?? v)
  const more = snap.machines.length > 1
  return (
    <div className={clsx(wrap, 'flex min-w-0 flex-col gap-1.5 rounded-box bg-hover px-3 py-2.5')}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-[0.8125rem] text-fg2">{ST.LEVEL.label}</span>
        <Pick
          label={ST.LEVEL.label}
          value={level}
          options={['all', ...spaces.map((p) => p.id)]}
          ordered
          left
          // where there are more machines, a space says its machine
          show={(v) => (v === 'all' || !more ? name(v) : `${name(v)} · ${machineOf(v)}`)}
          depth={(v) => ({ depth: 0, name: v === 'all' || !more ? name(v) : `${name(v)} · ${machineOf(v)}` })}
          icon={(v) => (v === 'all' ? <GlobeIcon className={clsx(ic, 'shrink-0 text-fg3')} /> : <HashIcon className={clsx(ic, 'shrink-0 text-accent')} />)}
          onPick={onPick}
          className="min-w-0"
        />
      </div>
      <Small className="text-pretty">{place ? ST.LEVEL.space(machineOf(place.id)) : ST.LEVEL.everywhere}</Small>
      {place?.where ? <Small className="truncate font-mono">{place.where}</Small> : null}
    </div>
  )
}

/** Tasks' note (When a task starts / finishes), as the window's: its title and line, then a box as wide as the page,
 *  its example dim while empty, saved a moment after typing stops and on leaving it; "Saved" beside its title a moment */
function NoteBox({ row, under, save, mono = false }: { row: SettingRow; under: ReactNode; save: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(row.value)
  const [saved, setSaved] = useState(false)
  const typing = useRef(false)
  const pending = useRef<string | null>(null)
  const later = useRef<ReturnType<typeof setTimeout>>(undefined)
  const now = useRef({ value: row.value, save })
  now.current = { value: row.value, save }
  useEffect(() => { if (!typing.current) setV(row.value) }, [row.value])
  const flush = () => {
    clearTimeout(later.current)
    const x = pending.current
    pending.current = null
    if (x === null || x === now.current.value) return
    now.current.save(x)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  // Settings closed or another page: a note typed a moment ago is still saved
  useEffect(() => () => flush(), [])
  return (
    <>
      <div className="flex items-start gap-3">
        <dt className="flex min-w-0 flex-1 flex-col">
          {row.label}
          {under}
        </dt>
        {saved ? <Small className="shrink-0">{ST.SAVED}</Small> : null}
      </div>
      <dd className="flex flex-col gap-1.5">
        {/* Autopilot's heartbeat: its file, small, over a monospace box (the window's) */}
        {row.file ? <Small className="truncate font-mono">{row.file}</Small> : null}
        <TextBox label={row.label} value={v} placeholder={row.placeholder} spellCheck={!mono}
          onFocus={() => (typing.current = true)}
          onBlur={() => { typing.current = false; flush() }}
          onChange={(x) => { setV(x); pending.current = x; clearTimeout(later.current); later.current = setTimeout(flush, 500) }}
          className={clsx('max-h-[calc(10lh+1rem)] w-full overflow-y-auto rounded-row bg-bg px-2.5 py-2 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus',
            mono ? 'min-h-[calc(4lh+1rem)] font-mono text-[0.8125rem]/5 phone:text-[0.875rem]/[1.375rem]' : 'min-h-[calc(3lh+1rem)] phone:text-[1rem]')} />
      </dd>
    </>
  )
}

/** Secrets › Kept on: the machine that keeps them, a list of the others to move them to, and a confirm before the move
 *  (shepherdr secrets move-to, run by the service; the page sees it go in the next snapshots). */
function KeptOn({ kept, phone }: { kept: NonNullable<Page['kept']>; phone: boolean }) {
  const W = ST.SECRETS
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const where = kept.here ? ST.THIS_COMPUTER : kept.name || W.notLinked
  // following Serve from: kept there already, or still where they were (they move on their own)
  const serve = kept.serve === null ? W.thisOne : kept.serve || ''
  const same = !!kept.auto && (kept.serve === null ? kept.here : !!kept.serve && kept.serve === kept.name)
  const now = !kept.auto ? where : same ? W.sameAsServe(where) : W.forNow(where)
  const move = async (m: string) => {
    setSure(null)
    const r = (await act({ type: 'secrets-move', machine: m } as never).catch((e: Error) => ({ ok: false, error: e.message }))) as { ok?: boolean; error?: string }
    setErr(r?.ok === false ? r.error ?? "That didn't go through." : '')
  }
  const status = kept.moving ? W.moving(kept.moving) : kept.error || err || (!kept.reachable && kept.name ? W.unreachable(kept.name) : !kept.auto ? W.keptAbout : same || !serve ? W.sameAbout : W.following(serve))
  return (
    <>
      <h3 className={clsx(heading(phone), 'pt-4')}>{W.keptOn}</h3>
      <div className={clsx('flex flex-col gap-2 py-3', phone ? clsx(card, 'px-4') : 'border-b border-line')}>
        <div className="relative flex items-center gap-2">
          <MachineIcon className={clsx(ic, 'text-fg3')} />
          <span className="min-w-0 flex-1 truncate">{now}</span>
          <Ghost aria-haspopup="menu" aria-expanded={open} disabled={!!kept.moving} onClick={() => setOpen(!open)} className="pr-1.5">
            <span>{W.moveVerb}</span><DownIcon className={ic} />
          </Ghost>
          {open ? (
            <Menu label={W.keptOn} select onClose={() => setOpen(false)} className="absolute top-full right-0 z-10 mt-1 max-h-[300px] w-[240px] max-w-[calc(100vw-2rem)] origin-top-right overflow-y-auto">
              {kept.choices.map((c) => {
                const on = c.here ? kept.here : c.name === kept.name
                return (
                  <MenuItem key={c.name || 'here'} role="menuitemradio" aria-checked={on} icon={on ? <CheckIcon className={ic} /> : null}
                    hint={c.state !== 'connected' ? W.offline : undefined} disabled={on || c.state !== 'connected'}
                    onClick={() => { setOpen(false); setSure(c.here ? '' : c.name) }}>
                    {c.here ? ST.THIS_COMPUTER : c.name}
                  </MenuItem>
                )
              })}
            </Menu>
          ) : null}
        </div>
        {sure !== null ? (
          <div className="flex flex-col gap-2 rounded-row border border-line p-3">
            <span className="font-medium">{W.moveConfirm(sure || W.thisOne)}</span>
            <Small className="text-pretty">{W.moveDetail(sure || W.thisOne, kept.here ? W.thisOne : where)}</Small>
            <span className="flex justify-end gap-1">
              <Ghost className="shadow-none!" onClick={() => setSure(null)}>{W.keep}</Ghost>
              <Ghost onClick={() => void move(sure || 'here')} className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg">{W.moveVerb}</Ghost>
            </span>
          </div>
        ) : null}
        <Small role="status" className={clsx('text-pretty', (kept.error || err || (!kept.reachable && kept.name)) && 'text-need-fg!')}>{status}</Small>
      </div>
    </>
  )
}

/** Secrets, as the window's page (secrets-section.js): what it is, the agents waiting on one (Give it fills the form
 *  in), Add (Name, Value, For: Everywhere, a machine or a space; a space's own page starts on that space), and every
 *  kept secret with where it is, each to Replace or Remove. Values never come here: they only go, once, to the vault on
 *  the main machine. */
function SecretsPage({ level, page, phone }: { level: string; page: Page; phone: boolean }) {
  const W = ST.SECRETS
  const snap = useSnap()!
  const vault = page.vault ?? []
  const asks = page.asks ?? []
  const spaceIds = new Set(levelsOf(snap.settings))
  const scopes: { level: string; label: string; sub?: string; group: string }[] = [
    { level: 'all', label: ST.EVERYWHERE, group: '' },
    { level: 'm:', label: ST.THIS_COMPUTER, group: W.machine },
    ...snap.machines.filter((m) => !m.here).map((m) => ({ level: `m:${m.machine}`, label: m.machine, group: W.machine })),
    ...snap.places.filter((p) => spaceIds.has(p.id)).map((p) => ({ level: p.id, label: p.name, sub: p.id.includes('/') ? p.machine : '', group: W.space })),
  ]
  const [scope, setScope] = useState(level)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const valueBox = useRef<HTMLInputElement>(null)
  // another page (a space's own): the form starts on it, nothing half-typed comes along
  useEffect(() => { setScope(level); setValue(''); setErr(''); setNote('') }, [level])
  const picked = scopes.find((x) => x.level === scope) ?? scopes[0]
  const save = async () => {
    const n = name.trim()
    if (busy) return
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(n)) return setErr(W.badName)
    if (!value) return setErr(W.noValue)
    setBusy(true)
    try {
      const r = (await act({ type: 'secret', level: scope, name: n, value })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else { setName(''); setValue(''); setErr(''); setNote(W.keptNote(n, picked.group === W.space ? `Space ${picked.label}` : picked.label)) }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const remove = async (e: (typeof vault)[number]) => {
    setSure(null)
    const at = e.scope === 'everywhere' ? 'all' : e.scope === 'machine' ? `m:${e.machine ?? ''}` : e.space!
    try {
      const r = (await act({ type: 'secret', level: at, name: e.name, value: null })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else setNote(W.removedNote(e.name, e.where))
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)) }
  }
  const sub = clsx(heading(phone), 'pt-4')
  const box = clsx('h-9 w-full min-w-0 rounded-row bg-bg px-2.5 outline-none placeholder:text-fg3 coarse:h-11 phone:h-11 phone:text-[1rem]', field)
  return (
    <div className="flex w-full flex-col">
      <p className={clsx('text-pretty text-fg3', phone ? 'px-4 text-[0.9375rem]' : 'text-[0.8125rem]')}>{W.about}</p>
      {page.kept && level === 'all' ? <KeptOn kept={page.kept} phone={phone} /> : null}
      {asks.length ? (
        <>
          <h3 className={sub}>{W.asked}</h3>
          <div className={phone ? card : undefined}>
            {asks.map((a) => (
              <div key={`${a.address}|${a.name}`} className={rowLook(phone)}>
                <span className="size-[7px] shrink-0 rounded-full bg-need" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{W.asks(a.who, a.name)}</span>
                  {a.why ? <Small className="truncate">{a.why}</Small> : null}
                </span>
                <Ghost onClick={() => { setName(a.name); setScope(a.scope); setNote(''); setErr(''); valueBox.current?.focus() }}>{W.give}</Ghost>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <h3 className={sub}>{W.add}</h3>
      <div className={clsx('flex flex-col gap-2 py-3', phone ? clsx(card, 'px-4') : 'border-b border-line')}>
        <div className={clsx('flex gap-2', phone ? 'flex-col' : 'items-end')}>
          <label className={clsx('flex flex-col gap-1', !phone && 'w-[190px] shrink-0')}>
            <Small>{W.name}</Small>
            <input value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder={W.namePlaceholder} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className={clsx(box, 'font-mono')} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <Small>{W.value}</Small>
            <input ref={valueBox} type="password" value={value} onChange={(e) => { setValue(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void save()}
              placeholder={W.valuePlaceholder} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" className={box} />
          </label>
          <div className="relative flex shrink-0 flex-col gap-1">
            <Small>{W.for}</Small>
            <Ghost aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking(!picking)} className="h-9! max-w-full justify-between pr-1.5 coarse:h-11! phone:h-11!">
              <span className="max-w-[150px] truncate phone:max-w-none">{picked.group === W.space ? `Space ${picked.label}` : picked.label}</span>
              <DownIcon className={ic} />
            </Ghost>
            {picking ? (
              <Menu label={W.for} select onClose={() => setPicking(false)} className="absolute top-full right-0 z-10 mt-1 max-h-[300px] w-[260px] max-w-[calc(100vw-2rem)] origin-top-right overflow-y-auto">
                {[scopes[0], null, ...scopes.filter((x) => x.group === W.machine), null, ...scopes.filter((x) => x.group === W.space)].map((x, i) =>
                  x === null ? <MenuLabel key={`g${i}`}>{i === 1 ? W.machine : W.space}</MenuLabel> : (
                    <MenuItem key={x.level} role="menuitemradio" aria-checked={x.level === scope} icon={x.level === scope ? <CheckIcon className={ic} /> : null} hint={x.sub || undefined}
                      onClick={() => { setScope(x.level); setPicking(false) }}>
                      {x.label}
                    </MenuItem>
                  ))}
              </Menu>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Small role="status" className={clsx('min-w-0 flex-1 text-pretty', err && 'text-need-fg!')}>{err || note || W.hint}</Small>
          <Ghost disabled={busy || !name.trim() || !value} onClick={() => void save()} className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg">{busy ? W.saving : W.save}</Ghost>
        </div>
      </div>
      <h3 className={sub}>{W.kept}</h3>
      <div className={phone ? card : undefined}>
        {!vault.length ? <p className={clsx(rowLook(phone), 'text-fg3')}>{W.none}</p> : null}
        {[...vault].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope)).map((e) => {
          const k = `${e.name}|${e.scope}|${e.machine ?? ''}|${e.space ?? ''}`
          return (
            <div key={k} className={rowLook(phone)}>
              <KeyIcon className={clsx(ic, 'text-fg3')} />
              <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] phone:text-[0.9375rem]">{e.name}</span>
              <Small className="max-w-[180px] shrink truncate">{e.where}</Small>
              <span className="flex shrink-0 items-center gap-1">
                <Ghost className="shadow-none!" onClick={() => {
                  setName(e.name)
                  setScope(e.scope === 'everywhere' ? 'all' : e.scope === 'machine' ? `m:${e.machine ?? ''}` : e.space!)
                  setNote(W.pasteNew(e.name))
                  setErr('')
                  valueBox.current?.focus()
                }}>{W.replace}</Ghost>
                {sure === k ? (
                  <>
                    <Ghost onClick={() => void remove(e)} className="bg-need text-bg! shadow-none! enabled:hover:bg-need">{W.remove}</Ghost>
                    <Ghost className="shadow-none!" onClick={() => setSure(null)}>{W.keep}</Ghost>
                  </>
                ) : <Ghost className="shadow-none!" onClick={() => setSure(k)}>{W.remove}</Ghost>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Settings() {
  const ui = useUI()
  const snap = useSnap()!
  const s = ui.settings!
  const groups = groupsOf(withPluginErrors(snap.settings, usePluginErrors()), ui)
  const pages = groups.flatMap((g) => g.pages)
  const sec = Math.min(s.section ?? 0, pages.length - 1)
  const page = pages[sec]
  // a page that comes or goes (a tablet's Keyboard shortcuts, once a key is pressed) keeps the one shown in view
  const names = pages.map((p) => p.name).join('\n')
  const shownPage = useRef({ names, name: page.name })
  useLayoutEffect(() => {
    const was = shownPage.current
    shownPage.current = { names, name: page.name }
    if (was.names === names || s.section === null) return
    const i = pages.findIndex((p) => p.name === was.name)
    if (i >= 0 && i !== sec) {
      shownPage.current.name = was.name
      setUI({ settings: { ...s, section: i } })
    }
  })
  const phone = ui.device === 'phone'
  const tablet = ui.device === 'tablet'
  // what was refused, by page and key: each machine's page has the same keys
  const [refused, setRefused] = useState<Record<string, string>>({})
  const at = (key: string) => `${page.level ?? ''}|${key}`
  const level = levelOf(snap.settings, ui)
  const set = async (key: string, value: string | null) => {
    // Serve from: another machine picked is confirmed first (screens/ServeFrom.tsx), as the window's
    if (key === 'web.serve') {
      if (value && value !== page.rows.find((r) => r.key === key)?.value) askServeFrom(value)
      return
    }
    const own = registry.settingActions[key]
    if (own) {
      setRefused((r) => ({ ...r, [at(key)]: '' }))
      const said = await own()
      setRefused((r) => ({ ...r, [at(key)]: said }))
      return
    }
    try {
      // set at the page's level: a machine's or a space's goes to that machine
      const r = (await act({ type: 'setting', key, value, ...((page.targets?.[key] ?? page.level) ? { place: page.targets?.[key] ?? page.level } : {}) })) as { ok?: boolean; error?: string; waiting?: boolean }
      setRefused((x) => ({ ...x, [at(key)]: r?.ok === false ? (r.error ?? 'Refused.') : r?.waiting ? `Set once ${machineName(snap.machines, page.machine)} is back.` : '' }))
    } catch (error) {
      let message = error instanceof Error ? error.message : 'That did not save. Try again.'
      try { const body = JSON.parse(message); if (typeof body.error === 'string') message = body.error } catch {}
      setRefused((x) => ({ ...x, [at(key)]: message }))
    }
  }
  const close = () => setUI({ settings: null })
  const scroller = useRef<HTMLDivElement>(null)
  const go = (section: number) => {
    setUI({ settings: { ...s, section } })
    // a new section starts at its top
    requestAnimationFrame(() => scroller.current && (scroller.current.scrollTop = 0))
  }
  const clear = (key: string) => refused[at(key)] && setRefused((r) => ({ ...r, [at(key)]: '' }))
  // a space's own settings: the title says "Space settings", the level switch which space
  const spacePlace = level !== 'all' ? snap.places.find((p) => p.id === level) : undefined
  // another level keeps the page shown where it has it (else its first)
  const pickLevel = (next: string) => {
    const at = sectionOf(page.name, snap.settings, { ...ui, settings: { ...s, level: next } })
    setUI({ settings: { ...s, level: next, section: at < 0 ? 0 : at } })
  }
  const body = <>
    {page.device ? null : <LevelBar level={level} sections={snap.settings} page={page} phone={phone} onPick={pickLevel} />}
    <PageBody key={`${page.level ?? ''}|${page.name}`} page={page} phone={phone} set={set} refused={(key) => refused[at(key)]} clear={clear} /></>

  if (phone) {
    const list = (
      <div className="flex min-h-0 flex-1 flex-col">
        <PhoneTop
          left={
            <RoundButton label="Back" onClick={close}>
              <BackIcon className={ic} />
            </RoundButton>
          }
          name={spacePlace ? ST.SPACE_TITLE : ST.TITLE}
        />
        <nav aria-label="Sections" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-canvas">
          <div className="flex flex-col gap-6 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))]">
            {/* the window's pages in one list, under the title above (no group of this device's own) */}
            {groups.map((g) => (
              <div key={g.name}>
                <ul role="list" aria-label={g.name} className={clsx(card, 'overflow-hidden')}>
                  {g.pages.map((p) => {
                    const Icon = iconOf(p)
                    return (
                      <li key={p.name} className="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-11 not-first:before:h-px not-first:before:bg-line">
                        <button type="button" onClick={() => go(pages.indexOf(p))} className="press flex min-h-12 w-full items-center gap-3 px-4 text-left">
                          <Icon className={clsx(ic, 'text-fg2')} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <NextIcon className={clsx(ic, 'text-fg3')} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </div>
    )
    const back = () => setUI({ settings: { ...s, section: null } })
    return (
      <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
        <Stack
          base={list}
          top={
            s.section === null ? null : (
              <section aria-label={page.name} className="flex min-h-0 flex-1 flex-col">
                <PhoneTop
                  left={
                    <RoundButton label="Back" onClick={back}>
                      <BackIcon className={ic} />
                    </RoundButton>
                  }
                  name={page.name}
                  kind={spacePlace && !page.device ? spacePlace.name : undefined}
                />
                <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-canvas">{body}</div>
              </section>
            )
          }
          topKey={s.section === null ? null : page.name}
          onBack={back}
        />
      </section>
    )
  }

  return (
    <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <Head>
        {/* on a tablet it slid in like a page: Back, at the start */}
        {tablet ? (
          <IconButton label="Back" onClick={close}>
            <BackIcon className={ic} />
          </IconButton>
        ) : null}
        <PlacesToggle when="closed" drawer />
        <Who name={spacePlace ? ST.SPACE_TITLE : ST.TITLE} />
        {tablet ? null : (
          <IconButton label="Close" onClick={close}>
            <XIcon className={ic} />
          </IconButton>
        )}
      </Head>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="flex touch-pan-y flex-col gap-4 overflow-y-auto overscroll-contain border-r border-line px-2 py-3">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="flex flex-col gap-px">
              {g.pages.map((p) => {
                const Icon = iconOf(p)
                const i = pages.indexOf(p)
                return (
                  <button
                    key={p.name}
                    type="button"
                    aria-current={sec === i ? 'page' : undefined}
                    onClick={() => go(i)}
                    className="press flex h-8 items-center gap-2 rounded-row px-2.5 text-left text-fg2 hover:bg-hover aria-[current=page]:bg-sel aria-[current=page]:text-fg coarse:h-11"
                  >
                    <Icon className={ic} />
                    <span className="min-w-0 truncate">{p.name}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div ref={scroller} className="touch-pan-y overflow-y-auto overscroll-contain">
          {body}
        </div>
      </div>
    </section>
  )
}
