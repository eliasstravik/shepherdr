// The pickers: a choice that can grow (agents, models, machines, spaces) is a picker row (what is picked, a chevron)
// that opens a searchable list, never a row of buttons. The agent picker always shows what is picked first, then lets
// you change one thing at a time: Agent, Model, Effort, Speed and Permissions, each the same row (its label, what is
// picked, a chevron) that opens its own list, and Done.
// A sheet on a phone, a 560 px dialog on a desktop; an open list takes the form's place, with a back arrow.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AgentPick, Catalog, CatalogAgent, CatalogModel, Snapshot } from '@shared/types.ts'
import { everything, isEverything, machineLabel, machineOf, spacesOf, unreachable } from '@shared/view.ts'
import { act, getState } from './kernel.ts'
import { openDialog } from './overlay.tsx'
import { Btn, I, IB, Logo, Row } from './ui.tsx'

/** what runs: the agent, its model, effort, speed and permission mode; `label`: the model's name as a running agent reports it */
export type Pick = AgentPick & { label?: string | null }

/* ---------- each machine's catalog: its agents and their own models, read once and kept ---------- */

const catalogs = new Map<string, Catalog | 'loading'>()
const catListeners = new Set<() => void>()
let catTick = 0

function loadCatalog(machine: string) {
  if (catalogs.has(machine)) return
  catalogs.set(machine, 'loading')
  act<{ ok?: boolean; catalog?: Catalog }>({ type: 'catalog', machine })
    .then((r) => {
      if (r.catalog) catalogs.set(machine, r.catalog)
      else catalogs.delete(machine)
    })
    .catch(() => void catalogs.delete(machine))
    .finally(() => {
      catTick++
      catListeners.forEach((l) => l())
    })
}

/** a machine's agents and models (undefined while they load) */
export function useCatalog(machine: string | undefined): Catalog | undefined {
  useSyncExternalStore(
    (l) => {
      catListeners.add(l)
      return () => void catListeners.delete(l)
    },
    () => catTick,
  )
  useEffect(() => {
    if (machine) loadCatalog(machine)
  }, [machine])
  const c = machine ? catalogs.get(machine) : undefined
  return c && c !== 'loading' ? c : undefined
}

/** a new Shepherdr may know more agents: the lists are read again */
export function forgetCatalogs() {
  catalogs.clear()
  catTick++
  catListeners.forEach((l) => l())
}

const agentOf = (cat: Catalog | undefined, id: string): CatalogAgent | undefined => cat?.agents.find((a) => a.id === id)
/** the model a pick names: by its id, else by the name the agent itself reports for it (a running agent says
 *  "claude-opus-5-5" where its menu says "opus"), else the agent's first */
const modelOf = (a: CatalogAgent | undefined, p: Pick & { label?: string | null }): CatalogModel | undefined =>
  a?.models.find((m) => m.id === p.model) ?? (p.label ? a?.models.find((m) => m.name === p.label) : undefined) ?? (p.model ? undefined : (a?.models.find((m) => m.id === a.defaultModel) ?? a?.models[0]))

const SPEEDS: Record<string, string> = { regular: 'Regular', fast: 'Fast', ultrafast: 'Ultra-fast' }
const speedOf = (p: Pick) => (p.fast === 'ultrafast' ? 'ultrafast' : p.fast ? 'fast' : 'regular')
const cap = (s: string) => (s === 'xhigh' ? 'Extra high' : s.charAt(0).toUpperCase() + s.slice(1))
const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi' }

/** the words a pick shows: the agent's and model's own names once the catalog has them */
export function pickWords(p: Pick, cat?: Catalog) {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const effort = p.effort ?? m?.defaultEffort ?? a?.defaultEffort ?? ''
  const perm = p.perm && a && p.perm !== a.permDefault ? (a.perms.find((x) => x.id === p.perm)?.label ?? p.perm) : ''
  return { agent: a?.name ?? NAMES[p.agent] ?? p.agent, model: m?.name ?? (p as { label?: string | null }).label ?? p.model ?? '', group: m?.group ?? '', effort: effort ? cap(effort) : '', speed: speedOf(p), perm }
}

/** "Claude Code · Sonnet 5.5 · medium effort · fast · plan" */
export function sayPick(p: Pick, cat?: Catalog): string {
  const w = pickWords(p, cat)
  return [w.agent, w.model, w.effort && `${w.effort.toLowerCase()} effort`, w.speed !== 'regular' && SPEEDS[w.speed].toLowerCase(), w.perm.toLowerCase()].filter(Boolean).join(' · ')
}

export type Role = 'Chats' | 'Tasks' | 'Reviews'

/** what a role runs on, at a level ('all', or a space's id): Settings › Agents */
export function pickFor(snap: Snapshot, level: string, role: Role): Pick {
  const c = snap.config
  // a repo's (SHEP-335: "repo:<key>"), a space's own, else Everywhere's
  const own = level.startsWith('repo:') ? c?.repos?.find((r) => r.key === level.slice(5)) : level !== 'all' ? c?.spaces[level] : undefined
  return own?.agents[role] || c?.all.agents[role] || { agent: 'claude' }
}

/* ---------- the agent picker ---------- */

function Bolts({ speed, c = 's16 bolt' }: { speed: string; c?: string }) {
  return speed === 'fast' ? <I n="bolt" c={c} /> : speed === 'ultrafast' ? <><I n="bolt" c={c} /><I n="bolt" c={c} /></> : null
}

/** the message box's agent line: the logo, the model, the effort as a quiet word, a bolt when fast (two for
 *  ultra-fast), the permission mode when it is not the agent's own default */
export function AgentLine({ pick, machine, onClick }: { pick: Pick; machine: string; onClick: () => void }) {
  const cat = useCatalog(machine)
  const w = pickWords(pick, cat)
  const ref = useRef<HTMLButtonElement>(null)
  const words = `${w.model}|${w.agent}|${w.effort}|${w.perm}|${w.speed}`
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => fitAgentLine(el)
    fit()
    if (typeof ResizeObserver === 'undefined' || !el.parentElement) return
    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [words])
  return (
    <button ref={ref} type="button" className="agent" aria-label={`${sayPick(pick, cat).replace(/ · /g, ', ')}. Change`} onClick={onClick}>
      <Logo agent={pick.agent} name={w.agent} />
      <span className="m">{w.model || w.agent}</span>
      {w.effort && <span className="e">{w.effort.toLowerCase()}</span>}
      <Bolts speed={w.speed} />
      {w.perm && <span className="e pm">· {w.perm.toLowerCase()}</span>}
      <I n="down" c="s16" />
    </button>
  )
}

/** what goes from the message box's agent line when it is short of room (SHEP-356), in this order, so the model and
 *  its effort stay whole: the logo (the model's name says whose it is), the chevron (the whole line is the button), the
 *  permission mode. Only past all three does the effort get cut. */
export const AGENT_DROPS = ['logo', 'chev', 'perm'] as const

/** sets the agent line's data-drop to the fewest drops that let its words fit */
export function fitAgentLine(el: HTMLElement) {
  const cut = () => el.scrollWidth > el.clientWidth + 0.5 || [...el.querySelectorAll<HTMLElement>('.m,.e')].some((s) => s.scrollWidth > s.clientWidth + 0.5)
  for (let n = 0; n <= AGENT_DROPS.length; n++) {
    el.dataset.drop = AGENT_DROPS.slice(0, n).join(' ')
    if (!cut()) return n
  }
  return AGENT_DROPS.length
}

/** a dialog's Agent row: what is picked, a chevron; it opens the picker */
export function AgentField({ title, machine, pick, onChange }: { title: string; machine: string; pick: Pick; onChange: (p: Pick) => void }) {
  const cat = useCatalog(machine)
  const w = pickWords(pick, cat)
  return (
    <div className="fld">
      <span>Agent</span>
      <button type="button" className="fake" aria-label={`Agent: ${sayPick(pick, cat).replace(/ · /g, ', ')}. Change`} onClick={() => openPicker({ title, machine, pick, onChange })}>
        <Logo agent={pick.agent} name={w.agent} />
        <span className="n">
          <b>{w.agent}</b> <span>{[w.model, w.effort.toLowerCase(), w.speed !== 'regular' && SPEEDS[w.speed].toLowerCase(), w.perm.toLowerCase()].filter(Boolean).join(' · ')}</span>
        </span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}

export function PickerHead({ title, back, close }: { title: ReactNode; back?: () => void; close: () => void }) {
  return (
    <div className="hd">
      {back && <IB icon="back" label="Back" onClick={back} />}
      <div className="ttl" style={back ? undefined : { padding: 0 }}>
        <h2>{title}</h2>
      </div>
      <IB icon="x" label="Close" onClick={close} />
    </div>
  )
}

export type Field = 'agent' | 'model' | 'effort' | 'speed' | 'mode'

/** the agent picker's rows, in order: each one's label and what is picked; Effort, Speed and Permissions only when
 *  the agent or model has a choice there */
export function pickerRows(p: Pick, cat?: Catalog): { f: Field; label: string; value: string }[] {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  const efforts = m?.efforts?.length ? m.efforts : (a?.efforts ?? [])
  const rows: { f: Field; label: string; value: string }[] = [
    { f: 'agent', label: 'Agent', value: w.agent },
    { f: 'model', label: 'Model', value: w.model + (w.group ? ` · ${w.group}` : '') },
  ]
  if (efforts.length) rows.push({ f: 'effort', label: 'Effort', value: w.effort })
  if ((m?.speeds?.length ?? 0) > 1) rows.push({ f: 'speed', label: 'Speed', value: SPEEDS[w.speed] ?? cap(w.speed) })
  if (a?.perms.length) rows.push({ f: 'mode', label: 'Permissions', value: a.perms.find((x) => x.id === (p.perm ?? a.permDefault))?.label ?? '' })
  return rows
}

/** a short list a row opens (Effort, Speed, Permissions): its title, its choices, which one is on, and the pick
 *  each one makes */
export function choiceList(f: 'effort' | 'speed' | 'mode', p: Pick, cat?: Catalog): { title: string; items: { id: string; label: string; sub?: string; on: boolean; pick: Pick }[] } {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  if (f === 'effort') {
    const efforts = m?.efforts?.length ? m.efforts : (a?.efforts ?? [])
    return { title: `Effort · ${w.model || w.agent}`, items: efforts.map((e) => ({ id: e, label: cap(e), on: cap(e) === w.effort, pick: { ...p, effort: e } })) }
  }
  if (f === 'speed')
    return {
      title: `Speed · ${w.model || w.agent}`,
      items: (m?.speeds ?? ['regular']).map((s) => ({ id: s, label: SPEEDS[s] ?? cap(s), on: s === w.speed, pick: { ...p, fast: s === 'ultrafast' ? 'ultrafast' : s === 'fast' } })),
    }
  return {
    title: `Permissions · ${w.agent}`,
    items: (a?.perms ?? []).map((x) => ({ id: x.id, label: x.label, sub: x.about, on: (p.perm ?? a?.permDefault) === x.id, pick: { ...p, perm: x.id } })),
  }
}

function AgentPicker({ title, machine, start, onChange, close }: { title: string; machine: string; start: Pick; onChange: (p: Pick) => void; close: () => void }) {
  const snap = getState().snap
  const cat = useCatalog(machine)
  const [p, setP] = useState<Pick>(start)
  const [field, setField] = useState<'' | Field>('')
  const [q, setQ] = useState('')
  const set = (next: Pick) => {
    setP(next)
    onChange(next)
  }
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  const mach = snap ? machineLabel(snap, machine) : machine
  const open = (f: typeof field) => {
    setField(f)
    setQ('')
  }
  const hit = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase())

  // every row the same: the agent's logo in the first column (kept empty on the others, so they all line up), its
  // label over what is picked, a chevron
  if (!field)
    return (
      <div className="pk">
        <PickerHead title={title} close={close} />
        {pickerRows(p, cat).map((r) => (
          <button key={r.f} type="button" className="row row2" aria-label={`${r.label}: ${r.value}. Change`} onClick={() => open(r.f)}>
            {r.f === 'agent' ? <Logo agent={p.agent} name={w.agent} /> : <span className="pk-gap" />}
            <span className="n">
              <span className="l2">{r.label}</span>
              <span className="l1 pk-v">{r.value}</span>
            </span>
            <I n="right" c="s16" />
          </button>
        ))}
        <div className="acts" style={{ marginTop: 8 }}>
          <Btn kind="pri" onClick={close}>Done</Btn>
        </div>
      </div>
    )

  if (field === 'effort' || field === 'speed' || field === 'mode') {
    const c = choiceList(field, p, cat)
    return (
      <div className="pk">
        <PickerHead title={c.title} back={() => open('')} close={close} />
        <div className="list" style={{ minHeight: 0 }}>
          {c.items.map((x) => (
            <Row
              key={x.id}
              label={x.label}
              sub={x.sub}
              current={x.on}
              end={
                <>
                  {field === 'speed' && <Bolts speed={x.id} c="s16 bolt c-mute" />}
                  {x.on && <I n="check" />}
                </>
              }
              onClick={() => {
                set(x.pick)
                open('')
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (field === 'agent') {
    const here = (cat?.agents ?? []).filter((x) => x.installed && hit(x.name))
    const not = (cat?.agents ?? []).filter((x) => !x.installed && hit(x.name))
    return (
      <div className="pk">
        <PickerHead title="Agent" back={() => open('')} close={close} />
        <input className="inp" name="pq" aria-label="Search" placeholder="Search agents" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {!cat && <p className="hint" style={{ padding: 8 }}>Reading the agents on {mach}…</p>}
          {here.length > 0 && <div className="lab">On {mach}</div>}
          {here.map((x) => (
            <Row
              key={x.id}
              lead={<Logo agent={x.id} name={x.name} />}
              label={x.name}
              current={p.agent === x.id}
              end={p.agent === x.id ? <I n="check" /> : undefined}
              onClick={() => {
                // another agent starts on its own first model; picking it moves straight on to its models
                if (x.id !== p.agent) {
                  const first = x.models.find((y) => y.id === x.defaultModel) ?? x.models[0]
                  const eff = first?.efforts?.length ? first.efforts : x.efforts
                  set({ agent: x.id, model: first?.id ?? null, effort: p.effort && eff.includes(p.effort) ? p.effort : (first?.defaultEffort ?? x.defaultEffort ?? eff[Math.min(2, eff.length - 1)] ?? null), fast: false, perm: null })
                }
                open('model')
              }}
            />
          ))}
          {not.length > 0 && <div className="lab">Not installed on {mach}</div>}
          {not.map((x) => (
            <div key={x.id} className="row off">
              <Logo agent={x.id} name={x.name} />
              <span className="n">{x.name}</span>
              {x.why && <span className="v">{x.why}</span>}
            </div>
          ))}
          {cat && !here.length && !not.length && <p className="hint" style={{ padding: 8 }}>No agent matches.</p>}
        </div>
      </div>
    )
  }

  const models = (a?.models ?? []).filter((x) => hit(`${x.name} ${x.group ?? ''}`))
  const groups = [...new Set(models.map((x) => x.group ?? ''))]
  return (
    <div className="pk">
      <PickerHead title={`Model · ${w.agent}`} back={() => open('')} close={close} />
      <input className="inp" name="pq" aria-label="Search" placeholder={`Search ${a?.models.length ?? 0} models`} value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {groups.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            {g && <div className="lab">{g}</div>}
            {models
              .filter((x) => (x.group ?? '') === g)
              .map((x) => {
                const on = m?.id === x.id
                return (
                  <Row
                    key={x.id}
                    label={x.name}
                    current={on}
                    end={
                      <>
                        {(x.speeds?.length ?? 0) > 1 && <I n="bolt" c="s16 c-mute" />}
                        {on && <I n="check" />}
                      </>
                    }
                    onClick={() => {
                      const eff = x.efforts?.length ? x.efforts : (a?.efforts ?? [])
                      set({ ...p, model: x.id, effort: p.effort && eff.includes(p.effort) ? p.effort : (x.defaultEffort ?? p.effort ?? null), fast: (x.speeds ?? ['regular']).includes(speedOf(p)) ? p.fast : false })
                      open('')
                    }}
                  />
                )
              })}
          </div>
        ))}
        {!models.length && <p className="hint" style={{ padding: 8 }}>{cat ? 'No model matches.' : `Reading the models on ${mach}…`}</p>}
      </div>
    </div>
  )
}

/** Open the agent picker. `title` says what it sets: "This chat runs on", "Tasks run on", "The new space runs on". */
export function openPicker(o: { title: string; machine: string; pick: Pick; onChange: (p: Pick) => void; onClose?: (p: Pick) => void }) {
  let last = o.pick
  openDialog((close) => <AgentPicker title={o.title} machine={o.machine} start={o.pick} onChange={(p) => { last = p; o.onChange(p) }} close={close} />, { wide: true, bare: true, label: o.title, onClose: () => o.onClose?.(last) })
}

/* ---------- machines and spaces ---------- */

function MachinePicker({ value, onPick, close }: { value: string; onPick: (m: string) => void; close: () => void }) {
  const snap = getState().snap!
  const [q, setQ] = useState('')
  const list = snap.machines.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="pk">
      <PickerHead title="Machine" close={close} />
      <input className="inp" name="pq" aria-label="Search machines" placeholder="Search machines" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {list.map((m) =>
          unreachable(m) ? (
            <div key={m.id} className="row off">
              <I n="server" />
              <span className="n">{m.name}</span>
              <span className="v">Can't reach</span>
            </div>
          ) : (
            <Row
              key={m.id}
              icon="server"
              label={m.name}
              current={value === m.machine}
              end={value === m.machine ? <I n="check" /> : undefined}
              onClick={() => {
                onPick(m.machine)
                close()
              }}
            />
          ),
        )}
        {!list.length && <p className="hint" style={{ padding: 8 }}>No machine matches.</p>}
      </div>
    </div>
  )
}

/** a dialog's Machine row: built for dozens of machines; one you can't reach is greyed out */
export function MachineField({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const snap = getState().snap!
  const name = machineOf(snap, value)?.name ?? value
  return (
    <div className="fld">
      <span>Machine</span>
      <button type="button" className="fake" aria-label={`Machine: ${name}. Change`} onClick={() => openDialog((close) => <MachinePicker value={value} onPick={onChange} close={close} />, { wide: true, bare: true, label: 'Machine' })}>
        <I n="server" />
        <span className="n"><b>{name}</b></span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}

function SpacePicker({ value, onPick, close }: { value: string; onPick: (place: string) => void; close: () => void }) {
  const snap = getState().snap!
  const [q, setQ] = useState('')
  const ev = everything(snap)
  // the search matches a space's name or its machine's
  const hit = (name: string, machine: string) => !q.trim() || `${name} ${machineLabel(snap, machine)}`.toLowerCase().includes(q.trim().toLowerCase())
  const spaces = spacesOf(snap).filter((p) => !p.archived)
  const row = (id: string, name: string, root: boolean, machine: string) => (
    <Row
      key={id}
      icon={root ? 'layers' : 'hash'}
      label={name}
      value={root ? machineLabel(snap, machine) : undefined}
      current={value === id}
      end={value === id ? <I n="check" /> : undefined}
      onClick={() => {
        onPick(id)
        close()
      }}
    />
  )
  const blocks = snap.machines
    .map((m) => ({ m, list: spaces.filter((p) => p.machine === m.machine && hit(p.name, p.machine)) }))
    .filter((b) => b.list.length)
  const evHit = ev && hit('Everything', ev.machine)
  return (
    <div className="pk">
      <PickerHead title="Space" close={close} />
      <input className="inp" name="pq" aria-label="Search spaces and machines" placeholder="Search spaces and machines" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {evHit && row(ev.id, 'Everything', true, ev.machine)}
        {blocks.map((b) => (
          <div key={b.m.id} style={{ display: 'contents' }}>
            <div className="lab">{b.m.name}</div>
            {b.list.map((p) => row(p.id, p.name, false, p.machine))}
          </div>
        ))}
        {!evHit && !blocks.length && <p className="hint" style={{ padding: 8 }}>No space matches.</p>}
      </div>
    </div>
  )
}

/** a dialog's Space row: spaces under their machines; its search matches either name */
export function SpaceField({ value, onChange }: { value: string; onChange: (place: string) => void }) {
  const snap = getState().snap!
  const p = snap.places.find((x) => x.id === value)
  const root = isEverything(snap, value)
  const name = root ? 'Everything' : (p?.name ?? '')
  const mach = p ? machineLabel(snap, p.machine) : ''
  return (
    <div className="fld">
      <span>Space</span>
      <button type="button" className="fake" aria-label={`Space: ${name} on ${mach}. Change`} onClick={() => openDialog((close) => <SpacePicker value={value} onPick={onChange} close={close} />, { wide: true, bare: true, label: 'Space' })}>
        <I n={root ? 'layers' : 'hash'} />
        <span className="n"><b>{name}</b> <span>{mach}</span></span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}
