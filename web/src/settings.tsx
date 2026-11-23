// The settings window: sections on the left, rows with switches and choices on the right; on a phone a list of
// sections that each push in. 880×640 with a 200 px nav on a desktop. Opened for one space from its menu, it shows
// only Agents, Tasks and Secrets, and every row there carries small print under its value: "Same as
// Everything", or "Set here" with a Reset button beside it. A row is a label and a control: no hint lines under one.
import { useState, type ReactNode } from 'react'
import { choose, TELL, turnOn, useDeviceAlerts, WHY, type Tell } from '@plugins/alerts/device.ts'
import type { Config, LevelConfig, Snapshot } from '@shared/types.ts'
import { isEverything, machineWarn, placeOf, spaceLabel, unreachable } from '@shared/view.ts'
import { copyText } from './copy.ts'
import type { IconName } from './icons.ts'
import { notice, registry, setUI, tryAct, useUI } from './kernel.ts'
import { openDialog, openForm } from './overlay.tsx'
import { openPicker, pickFor, sayPick, useCatalog, type Role } from './picker.tsx'
import { MOTIONS, setPref, THEMES, usePrefs, WIDTHS } from './prefs.ts'
import { Btn, cx, I, IB, Meter, Row, Seg, Tgl } from './ui.tsx'

const ALL: [string, IconName][] = [['General', 'gear'], ['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key'], ['Machines', 'server'], ['Usage', 'gauge'], ['Plugins', 'plug']]
const SPACE: [string, IconName][] = [['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key']]

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
  const sp = place === 'all' ? undefined : c.spaces[place]
  return { lv: sp ?? c.all, own: (k) => !!sp?.own.includes(k) }
}

function General() {
  const p = usePrefs()
  const { now, read } = useDeviceAlerts()
  const run = async (f: () => Promise<string | void>) => {
    try {
      const said = await f()
      if (said) notice(said)
    } catch (e) {
      notice(e instanceof Error ? e.message : 'That did not work. Try again.')
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

function Agents({ snap, place }: { snap: Snapshot; place: string }) {
  const c = snap.config!
  const { own } = levelOf(c, place)
  const machine = (place !== 'all' && snap.places.find((p) => p.id === place)?.machine) || snap.host
  const cat = useCatalog(machine)
  const row = (role: Role, title: string) => {
    const pick = pickFor(snap, place, role)
    return (
      <SRow key={role} label={role} wrap>
        <span className="val">
          {sayPick(pick, cat)}
          <Own place={place} own={own(`agents.${role}`)} k={`agents.${role}`} />
        </span>
        <Btn small onClick={() => openPicker({ title, machine, pick, onChange: () => undefined, onClose: (now) => JSON.stringify(now) !== JSON.stringify(pick) && void set(place, `agents.${role}`, now) })}>Change</Btn>
      </SRow>
    )
  }
  return <>{row('Chats', 'Chats run on')}{row('Tasks', 'Tasks run on')}{row('Reviews', 'Reviews run on')}</>
}

const MERGE: [LevelConfig['merge'], string][] = [['done', 'When I mark it as done'], ['checks', 'When checks pass'], ['now', 'Right away']]

function Tasks({ snap, place }: { snap: Snapshot; place: string }) {
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
function secretDialog(snap: Snapshot, place: string, name?: string, scope?: string) {
  openForm(
    function Form({ close }) {
      const [n, setN] = useState(name ?? '')
      const [v, setV] = useState('')
      const level = scope ?? place
      const ok = async () => {
        const key = n.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        if (!key || !v) return
        close()
        await tryAct({ type: 'secret', level, name: key, value: v }, 'Saved')
      }
      return (
        <>
          <h2>{name ? `Replace ${name}` : 'Add a secret'}</h2>
          <p>{level === 'all' ? 'Every space can use it.' : `Only ${spaceLabel(snap, level)} can use it.`}</p>
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
    { label: name ? `Replace ${name}` : 'Add a secret' },
  )
}

function Secrets({ snap, place }: { snap: Snapshot; place: string }) {
  const all = place === 'all'
  const list = snap.config!.secrets.filter((s) => all || s.scope === place)
  return (
    <>
      <p className="hint">Agents use these by name and never see them.</p>
      {list.map((s) => (
        <SRow key={`${s.scope}:${s.name}`} label={<>{s.name}<small>{s.scope === 'all' ? 'Every space' : `Only ${spaceLabel(snap, s.scope)}`}</small></>}>
          <Btn small onClick={() => secretDialog(snap, place, s.name, s.scope)}>Replace</Btn>
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
        const agents = m.health?.working ?? 0
        const tri: [string, number | undefined][] = [['Processor', meterOf(m, /cpu|processor|load/i)], ['Memory', meterOf(m, /mem/i)], ['Disk', meterOf(m, /disk/i)]]
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
                  </div>
                ))}
              </div>
            )}
            {!off && snap.config?.desktops?.includes(m.machine) && (
              <div className="acts" style={{ justifyContent: 'flex-start' }}>
                <Btn small onClick={() => setUI({ settings: null, pane: 'screen', scr: { key: `machine:${m.machine}`, src: 'd', drive: false }, task: null, art: null })}>Open desktop</Btn>
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

function Usage({ snap }: { snap: Snapshot }) {
  const plans = snap.config?.plans ?? []
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
      {!plans.length && <div className="empty"><span>No plan to show yet.</span></div>}
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

function Section({ snap, place, sec }: { snap: Snapshot; place: string; sec: string }) {
  const extra = registry.settings.find((s) => s.name === sec)
  if (extra) return <extra.View place={place} />
  if (!snap.config) return null
  if (sec === 'General') return <General />
  if (sec === 'Agents') return <Agents snap={snap} place={place} />
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
  const L = [...(space ? SPACE : ALL), ...own]
  const title = space ? `Settings for #${space.name}` : 'Settings'
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
