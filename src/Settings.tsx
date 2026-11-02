// Settings: the app's few settings. Most are defaults set at three levels, All machines, a machine or a project, and
// the most specific one set wins: how tasks work (what every new brief ends with), each kind of agent's app, model and
// effort, Autopilot's heartbeat and checklist, a machine's limits. Settings opens on Everywhere, a picker at its top switches,
// and each row offers the space it was opened from; each row says where a value it doesn't set comes from, and one it sets can be reset.
// Alerts and voice are one for all; a task has none of its own. Appearance is each device's own, as are the pages
// plugins add (a desktop's keyboard shortcuts). A phone lists the sections in rounded groups, as iOS's Settings does, and a tap pushes one over
// the list; a wider screen keeps the list down its side.
import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FC, type ReactNode } from 'react'
import { machineName, type SettingRow, type SettingSection, type Snapshot } from '@shared/types.ts'
import { act, registry, setUI, useSnap, useUI, type UI } from './kernel.ts'
import { usePluginErrors } from './guard.tsx'
import { PlacesToggle } from './Frame.tsx'
import { Stack } from './Stack.tsx'
import { APPEARANCES, setAppearance, useAppearance, type Appearance } from './theme.ts'
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
  Head,
  ic,
  IconButton,
  KeyIcon,
  MachineIcon,
  Menu,
  MenuItem,
  MinusIcon,
  ModelIcon,
  NextIcon,
  PhoneTop,
  PlaceIcon,
  PlanIcon,
  PluginIcon,
  PlusIcon,
  RoundButton,
  SecretField,
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
export function TextValue({ value, onSave, onEdit, label }: { value: string; onSave: (v: string) => void; onEdit: () => void; label: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    // as tall and round as the pickers beside it, its edge a shade darker while you type (a text box's look)
    <span className="relative inline-flex h-7 max-w-full items-center rounded-full shadow-[inset_0_0_0_1px_var(--line2)] has-focus:shadow-box-focus coarse:h-9 phone:h-9">
      <span aria-hidden="true" className="invisible block truncate px-2.5 whitespace-pre">
        {v || ' '}
      </span>
      <input
        name={label}
        aria-label={label}
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
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="group relative inline-flex w-9 shrink-0 rounded-full bg-line2 p-0.5 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-200 ease-in-out after:absolute after:-inset-2 aria-checked:bg-ready aria-checked:shadow-none coarse:w-12 phone:w-12"
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
  const picked = t.presets.find((p) => p.value === row.value)?.label ?? ''
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-pretty text-fg">{t.words}</p>
        {t.next.length ? <Small className="tabular-nums">Next: {t.next.join(' · ')}</Small> : null}
      </div>
      <Segments label={row.label} value={picked} options={t.presets.map((p) => p.label)} fill={phone} onPick={(l) => onPick(t.presets.find((p) => p.label === l)!.value)} />
      <Small className="text-pretty">{row.key === 'heartbeat.on' ? 'Other news waits for the next heartbeat. ' : ''}Ask the coordinator for anything else.</Small>
    </div>
  )
}

/** a whole file's words (a coordinator's HEARTBEAT.md): an editor as wide as the page that grows with them, its
 *  name on top; Save (⌘S, Ctrl+S) and Undo show once it changed, Undo putting back what is saved */
function DocValue({ value, onSave, label, file, phone, privateRules = false }: { value: string; onSave: (v: string) => void; label: string; file: string; phone: boolean; privateRules?: boolean }) {
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
        placeholder={privateRules ? 'Empty: no private rules for this role' : 'Empty: nothing to go through'}
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

/** a page of settings: one of the server's sections (set Everywhere), or this device's own (Appearance, or a plugin's
 *  drawn by its View) */
interface Page extends SettingSection {
  targets?: Record<string, string>
  device?: boolean
  Icon?: ComponentType<{ className?: string }>
  View?: FC<{ phone: boolean }>
}

const APPEARANCE: Page = { name: 'Appearance', device: true, about: 'How Shepherdr looks on this device. Your other devices keep their own.', rows: [] }

const LOOKS: Record<Appearance, { label: string; hint?: string }> = {
  system: { label: 'System', hint: "Light or dark, as this device's own setting is" },
  light: { label: 'Light' },
  dark: { label: 'Dark' },
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
  Notify: ChatIcon,
  Notifications: BellIcon,
  Voice: ChatIcon,
  'Alerts and voice': BellIcon,
  Appearance: AppearanceIcon,
  Plugins: PluginIcon,
  Machines: MachineIcon,
  Secrets: KeyIcon,
}

/** every level defaults are set at: Everywhere, then each machine and its spaces */
export const levelsOf = (sections: SettingSection[]) => [...new Set(sections.flatMap((x) => (x.level && !x.global ? [x.level] : [])))]

/** the level Settings edits: the one picked, else Everywhere: a default set without thinking must not stay with one space */
export function levelOf(sections: SettingSection[], ui: UI) {
  const want = ui.settings?.level
  return want && levelsOf(sections).includes(want) ? want : 'all'
}

/** the space Everywhere's rows offer: the one Settings was opened from */
function spaceOf(snap: Snapshot, ui: UI) {
  const level = levelOf(snap.settings, ui), place = snap.places.find((p) => p.id === ui.place)
  return level === 'all' && place && levelsOf(snap.settings).includes(place.id) ? place : undefined
}

/** a level's name: Everywhere, a machine's, or a space's (with its machine's, where there are more machines) */
export function levelName(level: string, sections: SettingSection[], snap: Pick<Snapshot, 'places' | 'machines'> = { places: [], machines: [] }) {
  if (level === 'all') return 'Everywhere'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  if (kind === 'm') return machine
  const name = snap.places.find((p) => p.id === level)?.name ?? (space === '~' ? 'home' : space)
  const machines = new Set(levelsOf(sections).filter((l) => l.startsWith('m:')))
  return machines.size > 1 ? `${name} · ${machine}` : name
}

/** what a level's defaults are, and what it follows where it sets none */
function levelHint(level: string, snap: Pick<Snapshot, 'places' | 'machines'>) {
  if (level === 'all') return 'For every machine and space, unless one sets its own.'
  const [kind, key, space] = level.split(':')
  const machine = machineName(snap.machines, key)
  if (kind === 'm') return `For ${machine} and its spaces. The rest follows Everywhere.`
  return `For ${snap.places.find((p) => p.id === level)?.name ?? space}. The rest follows ${machine}, then Everywhere.`
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

/** the list of pages, in groups: the defaults of the level picked (what agents are told, only words in their prompts,
 *  apart from how Shepherdr runs, with what is one for all), this device's own, and what is only shown */
function groupsOf(sections: SettingSection[], ui: UI): { name: string; pages: Page[] }[] {
  const level = levelOf(sections, ui)
  // Present one delivery page without changing stored keys or the server/plugin section contract.
  const delivery = sections.find((x) => x.global && x.name === 'Alerts and voice')
  const scoped = sections.filter((x) => x.level === level && !x.global).map((x): Page => x.name === 'Notify' ? {
    ...x, name: 'Notifications',
    targets: Object.fromEntries((delivery?.rows.filter((r) => !r.key.startsWith('voice.')) ?? []).map((r) => [r.key, delivery!.level ?? 'all'])),
    about: 'All: every new coordinator message, question and alert. Needs me: questions and alerts. Off: none, and the space stays quiet. Task alerts reach you either way. Spaces can override the delivery rule here or from their sidebar menu. Device delivery below applies Everywhere.',
    rows: [...x.rows.map((r) => ({ ...r, group: 'Delivery rules' })), ...(delivery?.rows.filter((r) => !r.key.startsWith('voice.')).map((r) => ({ ...r, group: 'Devices · Everywhere' })) ?? [])],
  } : x)
  const globals = sections.filter((x) => x.global).map((x): Page => x === delivery ? {
    ...x, name: 'Voice', rows: x.rows.filter((r) => r.key.startsWith('voice.')),
  } : x)
  const own = registry.settingsPages.filter((x) => x.when(ui)).map(({ name, about, Icon, View }): Page => ({ name, about, Icon, View, device: true, rows: [] }))
  return [
    { name: 'What agents are told', pages: scoped.filter((x) => x.told) },
    // what is one for all (alerts and voice) runs Shepherdr too, whatever level is picked: its page says so
    { name: 'How Shepherdr runs', pages: [...scoped.filter((x) => !x.told), ...globals] },
    { name: 'This device', pages: [APPEARANCE, ...own] },
    { name: 'About', pages: sections.filter((x) => !x.level && !x.global) },
  ].filter((g) => g.pages.length)
}

/** where a page sits in the list of them (for ui.settings.section), or -1 where it doesn't show */
export const sectionOf = (name: string, sections: SettingSection[], ui: UI) =>
  groupsOf(sections, ui)
    .flatMap((g) => g.pages)
    .findIndex((p) => p.name === ({ Notify: 'Notifications', 'Alerts and voice': 'Voice' }[name] ?? name))

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

/** Appearance: System, Light or Dark, kept on this device */
function AppearancePick({ phone }: { phone: boolean }) {
  const now = useAppearance()
  return (
    <div role="radiogroup" aria-label="Appearance" className={phone ? clsx(card, 'overflow-hidden') : 'w-full'}>
      {APPEARANCES.map((a) => (
        <label key={a} className={clsx(rowLook(phone), 'group cursor-pointer keys:has-focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]', phone && 'press')}>
          <input type="radio" name="appearance" value={a} checked={now === a} onChange={() => setAppearance(a)} className="sr-only" />
          <span className="flex min-w-0 flex-col">
            {LOOKS[a].label}
            {LOOKS[a].hint ? <Small className="text-pretty">{LOOKS[a].hint}</Small> : null}
          </span>
          <CheckIcon className={clsx(ic, 'text-accent group-not-has-checked:invisible')} />
        </label>
      ))}
    </div>
  )
}

/** a row's control, by what its value is: on or off a switch, two or three short words segments, a number a stepper,
 *  free words a box, a list a menu; one with no other choice, or only shown,
 *  its words */
function Control({ row, phone, set, edit }: { row: SettingRow; phone: boolean; set: (value: string) => void; edit: () => void }) {
  const options = row.options ?? []
  const action = row.key in registry.settingActions
  const only = !row.num && !row.text && !action && options.length <= 1 && (options[0] ?? row.value) === row.value
  if (row.fixed || !row.key || only) return <span className="text-right text-pretty text-fg2 [overflow-wrap:anywhere]">{shown(row.value)}</span>
  if (row.num) return <NumberValue label={row.label} value={row.value} num={row.num} onEdit={edit} onSave={set} />
  if (row.text) return <TextValue label={row.label} value={row.value} onEdit={edit} onSave={set} />
  // an action (alerts: turn them on for this device) is a button, its row's value the words under its label
  if (action) return <Ghost onClick={() => set(options[0])}>{options[0]}</Ghost>
  if (options.length === 2 && options.includes('on') && options.includes('off')) return <Switch label={row.label} on={row.value === 'on'} onChange={(on) => set(on ? 'on' : 'off')} />
  if (SEGMENTS.has(row.key)) return <Segments label={row.label} value={row.value} options={options} onPick={set} fill={phone} />
  return <Pick label={row.label} plain={phone} value={row.value} options={options} onPick={set} />
}

/** a value set here that is what the row would follow anyway unsets it: it follows again */
const follows = (row: SettingRow, value: string) => (row.inherits && value === row.inherits.value ? null : value)

/** the rows whose few short choices sit side by side */
const SEGMENTS = new Set(['notify', 'review.mustFix'])

/** on Everywhere's rows: the way to the space Settings was opened from, and that it already sets its own */
function SpaceOnly({ row }: { row: SettingRow }) {
  const ui = useUI()
  const snap = useSnap()!
  const place = spaceOf(snap, ui)
  const own = place && row.key ? snap.settings.find((x) => x.level === place.id && !x.global && x.rows.some((r) => r.key === row.key))?.rows.find((r) => r.key === row.key) : undefined
  if (!own || row.fixed) return null
  return (
    <button type="button" onClick={() => setUI({ settings: { ...ui.settings!, level: place!.id } })} className="press-dim relative self-start text-left text-[0.75rem] text-fg2 underline decoration-fg3 underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-1.5 coarse:after:-inset-y-3 phone:text-[0.8125rem]">
      {own.inherits ? `${place!.name} sets its own` : `For this space only: ${place!.name}`}
    </button>
  )
}

/** a page's settings: its rows under their group's heading (Tasks, Coordinators, Reviewer), and what it notes under them */
function PageBody({ page, phone, set, refused, clear, hint }: { page: Page; phone: boolean; set: (key: string, value: string | null) => void; refused: (key: string) => string | undefined; clear: (key: string) => void; hint?: string }) {
  const [pilotError, setPilotError] = useState('')
  const [running, setRunning] = useState(false)
  const groups: { name?: string; rows: Page['rows'] }[] = []
  for (const row of page.rows) {
    if (groups.length && groups.at(-1)!.name === row.group) groups.at(-1)!.rows.push(row)
    else groups.push({ name: row.group, rows: [row] })
  }
  // what is said under a row's label: where its value comes from, or a reset for one set here; then what went wrong
  const under = (row: SettingRow) => (
    <>
      {row.key in registry.settingActions ? <Small className="text-pretty">{row.value}</Small> : null}
      {row.hint ? <Small className="text-pretty">{row.hint}</Small> : null}
      {/* the exact words it adds to every new task's brief, as it is set now */}
      {row.line ? <details className="text-[0.8125rem] text-fg2"><summary className="cursor-pointer">Words this adds to each new task</summary><p className="text-pretty">“{row.line}”</p></details> : null}
      {row.from ? <Small className="text-pretty">From {row.from}</Small> : null}
      <SpaceOnly row={row} />
      {row.inherits ? (
        // set here: Reset, back to what it would be (its title says where that comes from)
        <Small className="text-pretty">
          <span className="font-medium text-accent">Set here</span>
          <span className="block">Inherits {row.multiline ? (row.inherits.value ? 'private rules' : 'no private rules') : row.num ? numShown(row.inherits.value, row.num) : row.trigger ? (row.trigger.presets.find((p) => p.value === row.inherits!.value)?.label ?? 'Custom rule') : shown(row.inherits.value)} · {row.inherits.from}</span>
          {row.trigger && !row.trigger.presets.some((p) => p.value === row.inherits!.value) ? <details><summary className="cursor-pointer">Inherited rule</summary><span className="[overflow-wrap:anywhere]">{row.inherits.value}</span></details> : null}
          <button
            type="button"
            title={`Set here. Back to ${row.inherits.from === 'Default' ? 'the default' : row.inherits.from}'s`}
            onClick={() => set(row.key, null)}
            className="press-dim relative font-medium text-accent after:absolute after:-inset-x-1 after:-inset-y-1.5 coarse:after:-inset-y-3"
          >
            Reset to {row.multiline ? (row.inherits.value ? 'private rules' : 'no private rules') : row.num ? numShown(row.inherits.value, row.num) : row.trigger ? (row.inherits.from === 'Default' ? 'the default' : `${row.inherits.from}'s`) : shown(row.inherits.value)}
          </button>
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
      {page.name === 'Autopilot' && page.level?.startsWith('p:') ? <div className="flex flex-col items-start gap-2"><Ghost disabled={running} onClick={async () => { setRunning(true); try { const result = await act({ type: 'autopilot-run', place: page.level! }); setPilotError(result.error ?? '') } finally { setRunning(false) } }}>{running ? 'Queuing…' : 'Run now'}</Ghost>{pilotError ? <p role="alert" className="text-need">{pilotError}</p> : null}</div> : null}
      {page === APPEARANCE ? <AppearancePick phone={phone} /> : null}
      {page.secrets && page.level ? <SecretsList level={page.level} secrets={page.secrets} phone={phone} /> : null}
      {page.View ? <page.View phone={phone} /> : null}
      {groups.map(({ name, rows }, g) => {
        const Group = name === 'Access and limits' ? 'details' : 'div'
        return <Group key={name ?? g} className="w-full">
          {name === 'Access and limits' ? <summary className={clsx(heading(phone), 'cursor-pointer')}>Access and limits</summary> : null}
          {name && name !== 'Access and limits' ? <h3 className={heading(phone)}>{name}</h3> : null}
          <dl className={phone ? card : undefined}>
            {rows.map((row) =>
              row.doc || row.multiline ? (
                <div key={row.key} className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2.5 pb-3!', row.inherits && 'border-l-2 border-accent pl-3')}>
                  <dt className="flex min-w-0 flex-col">
                    {row.label}
                    {row.doc ? <Small className="text-pretty">What to do, how to judge progress, when to report or ask you, and when to stop.</Small> : null}
                    {under(row)}
                  </dt>
                  <dd>
                    <DocValue label={row.label} file={row.multiline ? 'Private · this role only' : 'HEARTBEAT.md'} privateRules={row.multiline} phone={phone} value={row.value} onSave={(x) => set(row.key, row.multiline ? follows(row, x) : x)} />
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
                <div key={row.key || row.label} className={clsx(rowLook(phone), row.inherits && 'border-l-2 border-accent pl-3', phone && SEGMENTS.has(row.key) && 'flex-col items-stretch! gap-2.5 pb-3!')}>
                  <dt className="flex min-w-0 flex-1 flex-col">
                    {row.label}
                    {under(row)}
                  </dt>
                  <dd className={clsx('flex min-w-0 shrink-0 flex-col', phone && SEGMENTS.has(row.key) ? 'items-stretch' : 'max-w-[65%] items-end')}>
                    <Control row={row} phone={phone} set={(x) => set(row.key, follows(row, x))} edit={() => clear(row.key)} />
                  </dd>
                </div>
              ),
            )}
          </dl>
        </Group>
      })}
      {page.note ? (
        <figure className="w-full">
          <figcaption className={heading(phone)}>{page.noteTitle ?? "Every new task's instructions end with"}</figcaption>
          <blockquote className={clsx('text-pretty whitespace-pre-wrap text-fg2', phone ? clsx(card, 'px-4 py-3 text-[0.9375rem]') : 'rounded-box bg-hover px-3 py-2.5 text-[0.8125rem]')}>{page.note}</blockquote>
        </figure>
      ) : null}
    </div>
  )
}

/** how long ago, in a word or two */
function ago(at: number) {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** a level's secrets, by name: each replaced or removed, and new ones added, in masked boxes. Values never come here:
 *  they only go, once, to be kept on the main machine */
function SecretsList({ level, secrets, phone }: { level: string; secrets: { name: string; at: number }[]; phone: boolean }) {
  // the name being replaced, or '' for a new one; none: no box open
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [sure, setSure] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [only, setOnly] = useState(false)
  const ui = useUI()
  const snap = useSnap()!
  const place = spaceOf(snap, ui)
  const own = snap.settings.find((x) => x.level === place?.id && x.secrets)?.secrets ?? []
  // another level's page: nothing half-typed comes along
  useEffect(() => {
    setOpen(null)
    setValue('')
    setSure(null)
    setOnly(false)
  }, [level])
  const close = () => {
    setOpen(null)
    setName('')
    setValue('')
    setErr('')
    setOnly(false)
  }
  const save = async (n: string, v: string | null) => {
    setBusy(true)
    setErr('')
    try {
      const target = only && place ? place.id : level
      const r = (await act({ type: 'secret', level: target, name: n, value: v })) as { ok?: boolean; error?: string }
      if (r?.ok === false) setErr(r.error ?? "That didn't go through.")
      else if (v !== null) {
        close()
        // there is where it is listed
        if (target !== level) setUI({ settings: { ...ui.settings!, level: target } })
      } else setSure(null)
    } catch {
      setErr("That didn't go through: Shepherdr can't be reached.")
    } finally {
      setBusy(false)
    }
  }
  const box = (n: string) => (
    <div className="flex w-full flex-col gap-2">
      <SecretField label={n ? `New value for ${n}` : 'Value'} value={value} onChange={setValue} onEnter={() => (n || name) && value && save(n || name.trim(), value)} autoFocus={!!n} />
      {!n && place ? <div className="flex min-h-9 items-center justify-between gap-3"><span className="min-w-0">For this space only: {place.name}</span><Switch label={`For this space only: ${place.name}`} on={only} onChange={setOnly} /></div> : null}
      <div className="flex items-center justify-end gap-2">
        {err ? <span role="status" className="mr-auto text-[0.75rem] text-need-fg phone:text-[0.8125rem]">{err}</span> : null}
        <Ghost onClick={close}>Cancel</Ghost>
        <Ghost disabled={busy || !value || (!n && !name.trim())} onClick={() => save(n || name.trim(), value)} className="bg-fg text-bg! shadow-none! enabled:hover:bg-fg">
          Save
        </Ghost>
      </div>
    </div>
  )
  return (
    <div className="flex w-full flex-col gap-1.5">
      <dl className={phone ? card : undefined}>
        {secrets.map((x) => (
          <div key={x.name} className={clsx(rowLook(phone), open === x.name && 'flex-col items-stretch! gap-2.5 pb-3!')}>
            <dt className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[0.8125rem] phone:text-[0.9375rem]">{x.name}</span>
              <Small>Saved {ago(x.at)}</Small>
            </dt>
            <dd className={clsx('flex shrink-0 items-center gap-1.5', open === x.name && 'w-full')}>
              {open === x.name ? (
                box(x.name)
              ) : sure === x.name ? (
                <>
                  <Ghost onClick={() => setSure(null)}>Keep</Ghost>
                  <Ghost disabled={busy} onClick={() => save(x.name, null)} className="text-need-fg!">
                    Remove it
                  </Ghost>
                </>
              ) : (
                <>
                  <Ghost
                    onClick={() => {
                      close()
                      setOpen(x.name)
                    }}
                  >
                    Replace
                  </Ghost>
                  <Ghost onClick={() => setSure(x.name)}>Remove</Ghost>
                </>
              )}
            </dd>
          </div>
        ))}
        {open === '' ? (
          <div className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2 py-3!')}>
            <input
              aria-label="Name"
              placeholder="NAME, like GITHUB_TOKEN"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              className={clsx('min-h-10 w-full min-w-0 rounded-row bg-transparent px-3 py-[9px] font-mono placeholder:font-sans placeholder:text-fg3 coarse:min-h-11 phone:min-h-11 phone:text-[1rem]', field)}
            />
            {box('')}
          </div>
        ) : (
          <div className={rowLook(phone)}>
            <dt className="min-w-0 flex-1 text-fg2">{secrets.length ? null : 'None here yet.'}</dt>
            <dd>
              <Ghost
                onClick={() => {
                  close()
                  setOpen('')
                }}
              >
                Add a secret
              </Ghost>
            </dd>
          </div>
        )}
      </dl>
      {err && open === null ? <Small role="status" className="text-need-fg!">{err}</Small> : null}
      <p className={clsx('text-pretty text-fg3', phone ? 'px-4 text-[0.8125rem]' : 'text-[0.75rem]')}>
        Agents run commands with them by name (shepherdr secret run), and ask for one in their chat when they need it.
      </p>
      {own.length ? <Small className="text-pretty">{place!.name} sets its own: {own.map((x) => x.name).join(', ')}. <button type="button" onClick={() => setUI({ settings: { ...ui.settings!, level: place!.id } })} className="press-dim underline decoration-fg3 underline-offset-2">Open</button></Small> : null}
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
  const appearance = useAppearance()
  // what was refused, by page and key: each machine's page has the same keys
  const [refused, setRefused] = useState<Record<string, string>>({})
  const at = (key: string) => `${page.level ?? ''}|${key}`
  const level = levelOf(snap.settings, ui)
  const levels = levelsOf(snap.settings)
  const name = (l: string) => levelName(l, snap.settings, snap)
  const pickLevel = (l: string) => setUI({ settings: { ...s, level: l } })
  // the picker is the sidebar's tree: Everywhere, then each machine with its spaces under it, in its order
  const order = ['all', ...(snap.machines ?? []).flatMap((m) => [m.id, ...snap.places.filter((p) => p.machine === m.machine).map((p) => p.id)])]
  const rank = (l: string) => (order.includes(l) ? order.indexOf(l) : Infinity)
  const tree = [...levels].sort((a, b) => rank(a) - rank(b))
  const inTree = (l: string) => {
    return { depth: l === 'all' ? 0 : l.startsWith('m:') ? 1 : 2, name: name(l) }
  }
  const levelPick = (where: string) =>
    levels.length > 1 ? (
      <Pick
        label="Editing"
        value={level}
        options={tree}
        show={name}
        depth={inTree}
        icon={(l) => <PlaceIcon level={inTree(l).depth} className={clsx(ic, 'text-fg2')} />}
        onPick={pickLevel}
        ordered
        left={where !== 'phone'}
        plain={where === 'phone'}
        className={where === 'nav' ? 'px-0.5' : undefined}
      />
    ) : null
  const set = async (key: string, value: string | null) => {
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
  const body = <>
    <div className={clsx('flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-6 py-3', phone && 'px-4')}>
      <span className="text-fg2">Editing:</span>
      {page.device ? <span>This device</span> : page.global || !page.level ? <span>Everywhere</span> : levelPick(phone ? 'phone' : 'content') ?? <span>{name(level)}</span>}
    </div>
    <PageBody key={`${page.level ?? ''}|${page.name}`} page={page} phone={phone} set={set} refused={(key) => refused[at(key)]} clear={clear} hint={page.rows.some((r) => r.key === 'space.base') ? 'This repository’s branch for new tasks.' : page.level && !page.global && page.name !== 'Task IDs' ? levelHint(page.level, snap) : undefined} /></>

  if (phone) {
    const list = (
      <div className="flex min-h-0 flex-1 flex-col">
        <PhoneTop
          left={
            <RoundButton label="Back" onClick={close}>
              <BackIcon className={ic} />
            </RoundButton>
          }
          name="Settings"
        />
        <nav aria-label="Sections" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-canvas">
          <div className="flex flex-col gap-6 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+--spacing(8))]">
            {/* which level's defaults the two groups below set */}
            {levels.length > 1 ? (
              <div className={clsx(card, 'flex min-h-12 items-center justify-between gap-3 px-4')}>
                <span>Editing:</span>
                {levelPick('phone')}
              </div>
            ) : null}
            {groups.map((g) => (
              <div key={g.name}>
                <h3 className={heading(true)}>{g.name}</h3>
                <ul role="list" className={clsx(card, 'overflow-hidden')}>
                  {g.pages.map((p) => {
                    const Icon = iconOf(p)
                    return (
                      <li key={p.name} className="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-11 not-first:before:h-px not-first:before:bg-line">
                        <button type="button" onClick={() => go(pages.indexOf(p))} className="press flex min-h-12 w-full items-center gap-3 px-4 text-left">
                          <Icon className={clsx(ic, 'text-fg2')} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {p === APPEARANCE ? <span className="text-fg2">{LOOKS[appearance].label}</span> : null}
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
                  kind={page.device ? 'This device' : page.global ? 'Everywhere' : page.level ? name(page.level) : undefined}
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
        <Who name="Settings" />
        {tablet ? null : (
          <IconButton label="Close" onClick={close}>
            <XIcon className={ic} />
          </IconButton>
        )}
      </Head>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections" className="flex touch-pan-y flex-col gap-4 overflow-y-auto overscroll-contain border-r border-line px-2 py-3">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-px">
              <h3 className="px-2.5 pb-1 text-[0.75rem] font-medium text-fg3">{g.name}</h3>
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
