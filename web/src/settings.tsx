// The settings window: sections on the left, rows with switches and choices on the right; on a phone a list of
// sections that each push in. 880×640 with a 200 px nav on a desktop. Opened for one space from its menu, it shows
// only Agents, Tasks and Secrets, and every row there carries small print under its value: "Same as
// Everything", or "Set here" with a Reset button beside it. A row is a label and a control: no hint lines under one.
import { useState, type ReactNode } from 'react'
import { choose, TELL, turnOn, useDeviceAlerts, WHY, type Tell } from '@plugins/alerts/device.ts'
import type { Config, LevelConfig, RepoConfig, Snapshot } from '@shared/types.ts'
import { everything, isEverything, machineLabel, machineWarn, placeOf, spaceLabel, unreachable } from '@shared/view.ts'
import { copyText } from './copy.ts'
import type { IconName } from './icons.ts'
import { newerServed, notice, openSettings, registry, setUI, tryAct, updateNow, useStore, useUI } from './kernel.ts'
import { confirm, openDialog, openForm } from './overlay.tsx'
import { openPicker, PickerHead, pickFor, PickSummary, useCatalog, type Role } from './picker.tsx'
import { MOTIONS, setPref, THEMES, usePrefs, WIDTHS } from './prefs.ts'
import { canKeepAwake, setAwake, useAwake } from './awake.ts'
import { setChatSide, useSides, type Layout, type Side } from './sides.ts'
import { OWN_VERSION } from './update.ts'
import { IconButton } from './space-icon.tsx'
import { Btn, cx, I, IB, Meter, Row, Seg, Tgl } from './ui.tsx'

export const ALL: [string, IconName][] = [['General', 'gear'], ['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key'], ['Machines', 'server'], ['Usage', 'gauge'], ['Plugins', 'plug'], ['About', 'info']]
const SPACE: [string, IconName][] = [['Space', 'hash'], ['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key']]

/** a settings row: a label and a control */
export function SRow({ label, wrap, children }: { label: ReactNode; wrap?: boolean; children?: ReactNode }) {
  return (
    <div className={cx('srow', wrap && 'wrap')}>
      <span className="n">{label}</span>
      {children}
    </div>
  )
}

const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key, value })

/** the small print under a space's value: "Same as Everything", or "Set here" with Reset beside it */
function Own({ place, own, k }: { place: string; own: boolean; k: string }) {
  if (place === 'all') return null
  return (
    <small>
      {own ? (
        <>
          Set here · <span className="lk" role="button" tabIndex={0} onClick={() => void set(place, k, null)} onKeyDown={(e) => e.key === 'Enter' && void set(place, k, null)}>Reset</span>
        </>
      ) : (
        'Same as Everything'
      )}
    </small>
  )
}

function levelOf(c: Config, place: string): { lv: LevelConfig; own: (k: string) => boolean } {
  const sp = place === 'all' ? undefined : place.startsWith('repo:') ? c.repos?.find((r) => r.key === place.slice(5)) : c.spaces[place]
  return { lv: sp ?? c.all, own: (k) => !!sp?.own.includes(k) }
}

const SIDES: [Side, string][] = [['left', 'Chat on the left'], ['right', 'Chat on the right']]

/** SHEP-336: which side the chat is on beside a pane, for this device in the layout it is in now. A phone has no
 *  split, so no row. */
export function SidesRow({ layout, side }: { layout: Layout; side: Side }) {
  if (layout === 'phone') return null
  return (
    <SRow label="Sides" wrap>
      <Seg label="Sides" values={SIDES.map((x) => x[1])} value={SIDES.find((x) => x[0] === side)![1]} onChange={(v) => setChatSide(layout, SIDES.find((x) => x[1] === v)![0])} />
    </SRow>
  )
}

/* ---------- SHEP-335: task settings are a repo's ---------- */

/** a folder as it shows: a home folder as ~ */
const tilde = (f: string) => f.replace(/^\/(home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/, '~')
/** a task's repo key, as the service keys Config.repos (its folder here, machine:folder on another machine) */
const taskRepo = (snap: Snapshot, t: { on?: string; taskFolder?: string; work?: { folder: string } }) => {
  const f = t.work?.folder ?? t.taskFolder
  return f ? (!t.on || t.on === snap.host ? f : `${t.on}:${f}`) : null
}
/** the repo a space sits on */
export const repoOfSpace = (snap: Snapshot, id: string): RepoConfig | undefined => snap.config?.repos?.find((r) => r.spaces.includes(id))
/** the repos a space's tasks work in, most tasks first, with how many; the one it sits on first, unless that isn't a repo
 *  and its tasks all work elsewhere (root, on /) */
function reposOfSpace(snap: Snapshot, id: string): [RepoConfig, number][] {
  const n = new Map<string, number>()
  // the space that asked for it (SHEP-325: `place` may be the space working in its folder)
  for (const t of snap.tasks) if ((t.asked ?? t.place) === id) { const k = taskRepo(snap, t); if (k) n.set(k, (n.get(k) ?? 0) + 1) }
  const own = repoOfSpace(snap, id)
  const used = (snap.config?.repos ?? []).filter((r) => n.has(r.key) && r.key !== own?.key).sort((a, b) => n.get(b.key)! - n.get(a.key)!)
  const git = !!snap.places.find((p) => p.id === id)?.git
  const first = own && (git || n.has(own.key) || !used.length) ? [own] : []
  return [...first, ...used].map((r) => [r, n.get(r.key) ?? 0])
}
const repoMachine = (snap: Snapshot, r: RepoConfig) => machineLabel(snap, r.machine ?? snap.host)

function RepoPicker({ snap, value, onPick, close }: { snap: Snapshot; value: string | null; onPick: (key: string | null) => void; close: () => void }) {
  const [q, setQ] = useState('')
  const repos = snap.config?.repos ?? []
  const hit = (...words: string[]) => !q.trim() || words.join(' ').toLowerCase().includes(q.trim().toLowerCase())
  const pick = (key: string | null) => {
    onPick(key)
    close()
  }
  const machines = [...new Set(repos.map((r) => r.machine ?? snap.host))]
  const blocks = machines.map((m) => ({ m, list: repos.filter((r) => (r.machine ?? snap.host) === m && hit(r.name, r.folder, machineLabel(snap, m))) })).filter((b) => b.list.length)
  const all = hit('Everything')
  return (
    <div className="pk">
      <PickerHead title="Applies to" close={close} />
      <input className="inp" name="rq" aria-label="Search repos and folders" placeholder="Search repos and folders" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {all && <Row icon="layers" label="Everything" current={!value} end={!value ? <I n="check" /> : undefined} onClick={() => pick(null)} />}
        {blocks.map((b) => (
          <div key={b.m} style={{ display: 'contents' }}>
            <div className="lab">{machineLabel(snap, b.m)}</div>
            {b.list.map((r) => (
              <Row key={r.key} icon="folder" label={r.name} sub={tilde(r.folder)} current={value === r.key} end={value === r.key ? <I n="check" /> : undefined} onClick={() => pick(r.key)} />
            ))}
          </div>
        ))}
        {!all && !blocks.length && <p className="hint" style={{ padding: 8 }}>No repo or folder matches.</p>}
      </div>
    </div>
  )
}

/** Everything's Tasks page: which level its rows set, Everything or one repo (a searchable picker: there can be dozens) */
function AppliesTo({ snap, repo }: { snap: Snapshot; repo: RepoConfig | undefined }) {
  const s = useUI((u) => u.settings)!
  const name = repo ? repo.name : 'Everything'
  const where = repo ? `${tilde(repo.folder)}${repo.machine ? ` · ${repoMachine(snap, repo)}` : ''}` : ''
  return (
    <div className="fld">
      <span>Applies to</span>
      <button type="button" className="fake" aria-label={`Applies to ${name}. Change`}
        onClick={() => openDialog((close) => <RepoPicker snap={snap} value={repo?.key ?? null} close={close} onPick={(key) => setUI({ settings: { ...s, repo: key } })} />, { wide: true, bare: true, label: 'Applies to' })}>
        <I n={repo ? 'folder' : 'layers'} />
        <span className="n"><b>{name}</b> {where && <span>{where}</span>}</span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}

/** A space's Tasks page: its tasks follow the repos they work in; each opens that repo's settings */
function SpaceRepos({ snap, place }: { snap: Snapshot; place: string }) {
  const list = reposOfSpace(snap, place)
  return (
    <>
      <p className="hint">Tasks get the settings of the repo they work in.</p>
      {list.map(([r, n]) => (
        <Row key={r.key} icon="folder" label={r.name} sub={`${tilde(r.folder)}${r.machine ? ` · ${repoMachine(snap, r)}` : ''}`} value={n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined}
          end={<I n="right" c="s16" />} onClick={() => openSettings('all', 'Tasks', r.key)} />
      ))}
      {!list.length && <div className="empty"><span>No tasks yet.</span></div>}
    </>
  )
}

function General() {
  const p = usePrefs()
  const sides = useSides()
  const awake = useAwake()
  const { now, read } = useDeviceAlerts()
  const run = async (f: () => Promise<string | void>) => {
    try {
      const said = await f()
      if (said) notice(said)
    } catch (e) {
      notice(e instanceof Error ? e.message : 'That did not work. Try again.', { tone: 'error' })
    }
    await read()
  }
  const why = now && WHY[now.state]
  return (
    <>
      <h3>Appearance</h3>
      <SRow label="Theme"><Seg label="Theme" values={THEMES} value={p.theme} onChange={(v) => setPref('theme', v)} /></SRow>
      <SRow label="Chat width" wrap><Seg label="Chat width" values={WIDTHS} value={p.width} onChange={(v) => setPref('width', v)} /></SRow>
      <SRow label="Motion"><Seg label="Motion" values={MOTIONS} value={p.motion} onChange={(v) => setPref('motion', v)} /></SRow>
      <SidesRow {...sides} />
      {canKeepAwake() && <SRow label="Keep the screen on"><Tgl label="Keep the screen on" on={awake} onChange={setAwake} /></SRow>}
      <h3>Notifications</h3>
      {now && now.state !== 'on' && (
        <div className="banner" style={{ margin: '0 0 4px' }}>
          <I n="bell" />
          <span className="n">{why ?? "Alerts aren't on in this browser yet"}</span>
          {now.state === 'off' && <Btn small onClick={() => void run(() => turnOn(now.tell === 'Off' ? 'Needs me' : now.tell))}>Turn on</Btn>}
        </div>
      )}
      <SRow label="Alerts on this device" wrap>
        <Seg<Tell> label="Alerts on this device" values={TELL} value={now?.tell ?? 'Needs me'} onChange={(v) => now && void run(() => choose(v, now))} />
      </SRow>
    </>
  )
}

function Agents({ snap, place, only }: { snap: Snapshot; place: string; only?: Role[] }) {
  const c = snap.config!
  const { own } = levelOf(c, place)
  const repo = place.startsWith('repo:') ? c.repos?.find((r) => r.key === place.slice(5)) : undefined
  const machine = (repo ? repo.machine : place !== 'all' && snap.places.find((p) => p.id === place)?.machine) || snap.host
  const cat = useCatalog(machine)
  // on a repo's Tasks page: what its tasks and their reviews run on
  const name = (role: Role) => (repo ? (role === 'Tasks' ? 'Agent' : role === 'Reviews' ? 'Reviewer' : role) : role)
  const row = (role: Role, title: string) => {
    const pick = pickFor(snap, place, role)
    // the small print under the name, as Review, Merge and Proof have it (beside the value it ran into the value)
    return (
      <SRow key={role} label={<>{name(role)}<Own place={place} own={own(`agents.${role}`)} k={`agents.${role}`} /></>} wrap>
        <span className="val"><PickSummary pick={pick} cat={cat} full /></span>
        <Btn small onClick={() => openPicker({ title, machine, pick, onChange: () => undefined, onClose: (now) => JSON.stringify(now) !== JSON.stringify(pick) && void set(place, `agents.${role}`, now) })}>Change</Btn>
      </SRow>
    )
  }
  const rows: [Role, string][] = [['Chats', 'Chats run on'], ['Tasks', 'Tasks run on'], ['Reviews', 'Reviews run on']]
  return <>{rows.filter(([r]) => !only || only.includes(r)).map(([r, t]) => row(r, t))}</>
}

const MERGE: [LevelConfig['merge'], string][] = [['done', 'When I mark it as done'], ['checks', 'When all checks pass'], ['now', 'Right away']]

function Tasks({ snap, place }: { snap: Snapshot; place: string }) {
  // a space's page: the repos its tasks work in (SHEP-335); Everywhere's: Everywhere or one repo
  const ui = useUI((u) => u.settings)
  if (place !== 'all') return <SpaceRepos snap={snap} place={place} />
  const repo = ui?.repo ? snap.config?.repos?.find((r) => r.key === ui.repo) : undefined
  return (
    <>
      <AppliesTo snap={snap} repo={repo} />
      {repo && <Agents snap={snap} place={`repo:${repo.key}`} only={['Tasks', 'Reviews']} />}
      <TaskRows snap={snap} place={repo ? `repo:${repo.key}` : 'all'} />
    </>
  )
}

function TaskRows({ snap, place }: { snap: Snapshot; place: string }) {
  const { lv, own } = levelOf(snap.config!, place)
  return (
    <>
      <SRow label={<>Review by a second agent<Own place={place} own={own('review')} k="review" /></>}><Tgl label="Review by a second agent" on={lv.review} onChange={(v) => void set(place, 'review', v)} /></SRow>
      <SRow label={<>Merge<Own place={place} own={own('merge')} k="merge" /></>} wrap>
        <Seg label="Merge" values={MERGE.map((m) => m[1])} value={MERGE.find((m) => m[0] === lv.merge)?.[1] ?? MERGE[0]![1]} onChange={(v) => void set(place, 'merge', MERGE.find((m) => m[1] === v)![0])} />
      </SRow>
      <SRow label={<>Proof<Own place={place} own={own('proof')} k="proof" /></>}><Tgl label="Proof" on={lv.proof} onChange={(v) => void set(place, 'proof', v)} /></SRow>
    </>
  )
}

/** Add or replace a secret: its name, the value in a masked box, and who may use it. Agents use it by name and never
 *  see it. */
export function secretDialog(snap: Snapshot, place: string, name?: string, scope?: string, opts: { fresh?: boolean; done?(): void } = {}) {
  openForm(
    function Form({ close }) {
      const [n, setN] = useState(name ?? '')
      const [v, setV] = useState('')
      const level = scope ?? place
      const ok = async () => {
        const key = n.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        if (!key || !v) return
        close()
        if (await tryAct({ type: 'secret', level, name: key, value: v }, 'Saved')) opts.done?.()
      }
      return (
        <>
          <h2>{name ? `${opts.fresh ? 'Set' : 'Replace'} ${name}` : 'Add a secret'}</h2>
          <p>{level === 'all' ? 'Every space can use it.' : `Only ${secretWhere(snap, level)} can use it.`}</p>
          {!name && (
            <label className="fld">
              <span>Name</span>
              <input className="inp" name="secret-name" value={n} placeholder="GITHUB_TOKEN" autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setN(e.target.value)} />
            </label>
          )}
          <label className="fld">
            <span>Value</span>
            <input className="inp" type="password" name="secret-value" value={v} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ok()} />
          </label>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={() => void ok()}>Save</Btn>
          </div>
        </>
      )
    },
    { label: name ? `${opts.fresh ? 'Set' : 'Replace'} ${name}` : 'Add a secret' },
  )
}

/** who may use a secret kept at a level, in words: "#shop", "agents on mini" */
const secretWhere = (snap: Snapshot, level: string) => {
  const m = /^m:(.*)$/.exec(level)
  return m ? `agents on ${m[1] ? machineLabel(snap, m[1]) : snap.host}` : spaceLabel(snap, level)
}

/** Every kept secret, by name only, never its value: Everywhere's, each machine's and each space's (a space's own
 *  page: its own), each with Replace and Remove, so a leaked key goes from a phone in two taps. */
export function Secrets({ snap, place }: { snap: Snapshot; place: string }) {
  const all = place === 'all'
  const vault = snap.settings?.find((x) => x.name === 'Secrets')?.vault
  // each with the level the service keeps it at: all, m:<machine> ('' this computer) or the space's id
  const kept = vault
    ? vault.map((e) => ({ name: e.name, level: e.scope === 'everywhere' ? 'all' : e.scope === 'machine' ? `m:${e.machine ?? ''}` : e.space ?? '' }))
    : snap.config!.secrets.map((s) => ({ name: s.name, level: s.scope }))
  const list = kept.filter((s) => s.level && (all || s.level === place))
  const remove = (s: { name: string; level: string }) =>
    confirm({
      title: `Remove ${s.name}?`,
      body: 'Agents can no longer use it. To use it again, add it again.',
      ok: 'Remove',
      danger: true,
      run: () => tryAct({ type: 'secret', level: s.level, name: s.name, value: null }, `Removed ${s.name}`),
    })
  return (
    <>
      <p className="hint">Agents use these by name and never see them.</p>
      {list.map((s) => (
        <SRow key={`${s.level}:${s.name}`} label={<>{s.name}<small>{s.level === 'all' ? 'Every space' : `Only ${secretWhere(snap, s.level)}`}</small></>}>
          <span className="acts">
            <Btn small onClick={() => secretDialog(snap, place, s.name, s.level)}>Replace</Btn>
            <Btn small onClick={() => remove(s)}>Remove</Btn>
          </span>
        </SRow>
      ))}
      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <Btn small onClick={() => secretDialog(snap, place)}>Add a secret</Btn>
      </div>
    </>
  )
}

/** Adding a machine: the one command to run on the new machine; it appears in Machines and in the list once linked. */
function addMachineDialog(snap: Snapshot) {
  const cmd = snap.config?.addMachine ?? 'hc machine add <its name on your Tailscale network>'
  openDialog(
    (close) => (
      <>
        <h2>Add a machine</h2>
        <p>Run this on the machine that serves Shepherdr. The new machine shows here and in the list once it is linked.</p>
        <div className="code">
          <code>{cmd}</code>
          <IB icon="copy" label="Copy" onClick={(e) => void copyText(cmd, e.currentTarget).then((ok) => ok && notice('Copied'))} />
        </div>
        <div className="acts"><Btn onClick={close}>Close</Btn></div>
      </>
    ),
    { label: 'Add a machine' },
  )
}

const meterOf = (m: Snapshot['machines'][number], re: RegExp) => m.health?.meters.find((x) => re.test(x.name))?.pct

type Mach = Snapshot['machines'][number]
/** #1548: the agents live on a machine now, as the Tasks list and the spaces show them: its tasks' agents and its
 *  spaces' Assistants that are working or waiting on you */
const agentsOn = (snap: Snapshot, m: Mach) =>
  snap.tasks.filter((t) => (t.on || snap.host) === m.machine && (t.status === 'work' || t.status === 'need')).length +
  snap.places.filter((p) => p.machine === m.machine && (p.status === 'work' || p.status === 'need')).length

/* ---------- #1547: a machine's start limits (herdr-task holds new tasks while it is busier) ---------- */

const LIMITS: [string, string][] = [['start_load', 'Processor'], ['start_memory', 'Memory'], ['start_disk', 'Disk']]
/** its three limit rows as the service keeps them (machine.<field>@<machine>, "local" for the one serving the app) */
function limitsOf(snap: Snapshot, m: Mach) {
  const at = m.machine === snap.host ? 'local' : m.machine
  const rows = snap.settings?.find((x) => x.name === 'Machines')?.rows ?? []
  return LIMITS.flatMap(([f, name]) => {
    const row = rows.find((r) => r.key === `machine.${f}@${at}`)
    return row ? [{ name, row, off: /^off$/i.test(row.value), own: !!row.inherits }] : []
  })
}
const setLimit = (key: string, value: string | null) => tryAct({ type: 'setting', key, value, place: 'all' })
/** the next word up or down its stepper's list (a value off the list starts from the nearest) */
function stepTo(steps: string[], value: string, by: number) {
  const n = parseFloat(value)
  let i = steps.indexOf(value)
  if (i < 0) i = steps.reduce((b, s, j) => (Math.abs(parseFloat(s) - n) < Math.abs(parseFloat(steps[b]!) - n) ? j : b), 0)
  return steps[Math.max(0, Math.min(steps.length - 1, i + by))]!
}

function limitsDialog(id: string) {
  openForm(
    function Form({ close }) {
      const snap = useStore((s) => s.snap)
      const m = snap?.machines.find((x) => x.id === id)
      const lims = snap && m ? limitsOf(snap, m) : []
      return (
        <>
          <h2>Start limits{m ? ` · ${m.name}` : ''}</h2>
          <p>New tasks wait while {m?.name ?? 'this machine'} is busier than this.</p>
          {lims.map(({ name, row, off, own }) => {
            const steps = row.steps ?? []
            const at = steps.indexOf(row.value)
            return (
              <SRow key={row.key} label={<>{name}<small>{own ? <>Set here · <span className="lk" role="button" tabIndex={0} onClick={() => void setLimit(row.key, null)} onKeyDown={(e) => e.key === 'Enter' && void setLimit(row.key, null)}>Reset</span></> : 'Default'}</small></>}>
                <span className="stp">
                  {!off && (
                    <>
                      <IB icon="minus" label={`Lower ${name}`} disabled={at === 0} onClick={() => void setLimit(row.key, stepTo(steps, row.value, -1))} />
                      <span className="num">{row.value}</span>
                      <IB icon="plus" label={`Raise ${name}`} disabled={at === steps.length - 1} onClick={() => void setLimit(row.key, stepTo(steps, row.value, 1))} />
                    </>
                  )}
                  <Tgl label={`${name} limit`} on={!off} onChange={(on) => void setLimit(row.key, on ? row.stepFrom ?? steps[steps.length - 1] ?? null : 'Off')} />
                </span>
              </SRow>
            )
          })}
          {!lims.length && <p className="hint">Its limits can't be read now.</p>}
          <div className="acts"><Btn onClick={close}>Done</Btn></div>
        </>
      )
    },
    { label: 'Start limits' },
  )
}

function Machines({ snap }: { snap: Snapshot }) {
  const warns = snap.machines.filter((m) => machineWarn(m))
  return (
    <>
      {warns.map((m) => (
        <div className="banner" key={m.id}>
          <I n="warn" c="c-ask" />
          <span className="n">{unreachable(m) ? `Can't reach ${m.name}${m.unreachableSince ? ` · last seen ${m.unreachableSince}` : ''}${m.linkWhy ? ' · its link is broken' : ''}` : `${m.name}: ${machineWarn(m).toLowerCase()}`}</span>
        </div>
      ))}
      {snap.machines.map((m) => {
        const off = unreachable(m)
        const agents = agentsOn(snap, m)
        const tri: [string, number | undefined][] = [['Processor', meterOf(m, /cpu|processor|load/i)], ['Memory', meterOf(m, /mem/i)], ['Disk', meterOf(m, /disk/i)]]
        // #1547: each meter's start limit under it (new tasks wait above it), and Start limits to change them
        const lims = limitsOf(snap, m)
        const desk = !off && snap.config?.desktops?.includes(m.machine)
        const noUsage = noUsageOf(m.limits)
        return (
          <div className="mcard" key={m.id}>
            <div>
              <div className="nm">{m.name}</div>
              <div className="hint">{m.machine === snap.host ? 'Serves this app' : 'Linked'} · {off ? `can't reach it${m.unreachableSince ? ` since ${m.unreachableSince}` : ''}${m.linkWhy ? ': its link is broken' : ''}` : `${agents} ${agents === 1 ? 'agent' : 'agents'} running`}</div>
              {off && m.linkWhy && <div className="hint" style={{ whiteSpace: 'normal', marginTop: 6 }}>{m.linkWhy}</div>}
            </div>
            {!off && (
              <div className="tri">
                {tri.map(([name, pct]) => (
                  <div key={name}>
                    <span className="hint">{name}</span>
                    <span className="num">{pct === undefined ? '–' : `${Math.round(pct)}%`}</span>
                    <Meter pct={pct ?? 0} />
                    {((l) => l && <span className="hint">{l.off ? 'No limit' : `Limit ${l.row.value}`}</span>)(lims.find((x) => x.name === name))}
                  </div>
                ))}
              </div>
            )}
            {!off && noUsage.map(([name, why]) => <div className="hint" key={name}>{name}. {why}</div>)}
            {(desk || lims.length > 0) && (
              <div className="acts" style={{ justifyContent: 'flex-start' }}>
                {lims.length > 0 && <Btn small onClick={() => limitsDialog(m.id)}>Start limits</Btn>}
                {desk && <Btn small onClick={() => setUI({ settings: null, pane: 'screen', scr: { key: `machine:${m.machine}`, src: 'd', drive: false }, task: null, art: null })}>Open desktop</Btn>}
              </div>
            )}
          </div>
        )
      })}
      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <Btn small onClick={() => addMachineDialog(snap)}>Add a machine</Btn>
      </div>
    </>
  )
}

/** The agents whose plan usage Shepherdr doesn't read, with where to see it ("Open Codex and run /status"). */
const USAGE_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
function noUsageOf(limits: Snapshot['machines'][number]['limits']): [string, string][] {
  return Object.entries(limits ?? {}).filter(([, l]) => l?.state === 'no-access').map(([k, l]) => [USAGE_NAMES[k] ?? k, l.why ?? ''])
}

function Usage({ snap }: { snap: Snapshot }) {
  const plans = snap.config?.plans ?? []
  const noUsage = noUsageOf((snap.machines.find((m) => m.here) ?? snap.machines[0])?.limits)
  return (
    <>
      <p className="hint">How much of each plan your agents have used.</p>
      {plans.map((p) => (
        <div className="mcard" key={p.name}>
          <div className="nm">{p.name}</div>
          {p.windows.map((u) => (
            <div className="um" key={u.name}>
              <span className="num">{Math.round(u.used)}%</span>
              <span>
                <span className="l1">{u.name}</span>
                <span className="l2">{u.resets}</span>
              </span>
              <span />
              <Meter pct={u.used} />
            </div>
          ))}
        </div>
      ))}
      {noUsage.map(([name, why]) => <div className="mcard" key={name}><div className="nm">{name}</div><p className="hint">{why}</p></div>)}
      {!plans.length && !noUsage.length && <div className="empty"><span>No plan to show yet.</span></div>}
    </>
  )
}

function Plugins({ snap }: { snap: Snapshot }) {
  return (
    <>
      <p className="hint">Every feature is a plugin. Turn off what you don't use.</p>
      {(snap.config?.plugins ?? []).map((p) => (
        <SRow key={p.id} label={p.name}>{p.always ? <span className="val">Always on</span> : <Tgl label={p.name} on={p.on} onChange={(v) => void set('all', `plugin.${p.id}`, v)} />}</SRow>
      ))}
    </>
  )
}

/** the version this device runs and the one the service serves (SHEP-337) */
function About() {
  const served = useStore((s) => s.served)
  const newer = useStore(newerServed)
  return (
    <>
      <SRow label="This device"><span className="val">{OWN_VERSION || 'Unknown'}</span></SRow>
      <SRow label="Shepherdr serves"><span className="val">{served?.version || 'Unknown'}{newer && ' · newer'}</span></SRow>
      {newer && (
        <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <Btn small onClick={updateNow}>Update this device</Btn>
        </div>
      )}
    </>
  )
}

/** a space's icon (Everything's too): its own button, as in Rename (web/src/space-icon.tsx) */
function IconRow({ snap, id }: { snap: Snapshot; id: string }) {
  const p = placeOf(snap, id)
  if (!p) return null
  return (
    <SRow label="Icon">
      <IconButton icon={p.emoji ?? null} root={isEverything(snap, id)} onChange={(v) => void tryAct({ type: 'rename', id, name: '', emoji: v ?? '' })} />
    </SRow>
  )
}

function Section({ snap, place, sec }: { snap: Snapshot; place: string; sec: string }) {
  const extra = registry.settings.find((s) => s.name === sec)
  if (extra) return <extra.View place={place} />
  if (sec === 'About') return <About />
  if (!snap.config) return null
  if (sec === 'General') return <><General /><h3>Everything</h3><IconRow snap={snap} id={everything(snap)?.id ?? ''} /></>
  if (sec === 'Space') return <IconRow snap={snap} id={place} />
  // a space's Agents: its own Assistant only (its tasks' agents are its repos', SHEP-335)
  if (sec === 'Agents') return <Agents snap={snap} place={place} only={place === 'all' ? undefined : ['Chats']} />
  if (sec === 'Tasks') return <Tasks snap={snap} place={place} />
  if (sec === 'Secrets') return <Secrets snap={snap} place={place} />
  if (sec === 'Machines') return <Machines snap={snap} />
  if (sec === 'Usage') return <Usage snap={snap} />
  if (sec === 'Plugins') return <Plugins snap={snap} />
  return null
}

export function SettingsWindow({ snap }: { snap: Snapshot }) {
  const s = useUI((u) => u.settings)!
  const ph = useUI((u) => u.phone)
  const space = s.scope !== 'all' && !isEverything(snap, s.scope) ? placeOf(snap, s.scope) : undefined
  const place = space ? space.id : 'all'
  const own = registry.settings.filter((x) => (space ? x.scope !== 'all' : x.scope !== 'space')).map((x) => [x.name, x.icon] as [string, IconName])
  // a plugin's own sections go before About
  const L = space ? [...SPACE, ...own] : [...ALL.slice(0, -1), ...own, ...ALL.slice(-1)]
  const title = space ? `Settings for ${spaceLabel(snap, space.id)}` : 'Settings'
  const cur = s.sec ?? (ph ? null : L[0]![0])
  const close = () => setUI({ settings: null })
  const X = <IB icon="x" label="Close settings" onClick={close} />
  const nav = L.map(([n, ic]) => <Row key={n} icon={ic} label={n} current={!ph && n === cur} end={ph ? <I n="right" c="s16" /> : undefined} onClick={() => setUI({ settings: { ...s, sec: n } })} />)
  if (ph)
    return (
      <div className="win in" role="dialog" aria-modal="true" aria-label={title}>
        {cur ? (
          <>
            <div className="hd">
              <IB icon="back" label="Back" onClick={() => setUI({ settings: { ...s, sec: null } })} />
              <div className="ttl"><span className="t1">{cur}</span></div>
              {X}
            </div>
            <div className="pg"><Section snap={snap} place={place} sec={cur} /></div>
          </>
        ) : (
          <>
            <div className="hd">
              <div className="ttl" style={{ paddingLeft: 12 }}><span className="t1">{title}</span></div>
              {X}
            </div>
            <div className="nav">{nav}</div>
          </>
        )}
      </div>
    )
  // a section that opens with its own heading (General's "Appearance") has no second one above it
  const headed = cur === 'General'
  return (
    <div className="win in" role="dialog" aria-modal="true" aria-label={title}>
      <div className="nav">
        <div className="lab" style={{ paddingTop: 0 }}>{title}</div>
        {nav}
      </div>
      <div className="pg">
        <span className="x">{X}</span>
        {!headed && <h3>{cur}</h3>}
        {cur && <Section snap={snap} place={place} sec={cur} />}
      </div>
    </div>
  )
}
