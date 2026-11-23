// The list: Shepherdr and search, Everything, machines as headings (each with its own filter and New space, SHEP-342),
// groups that fold, spaces with a "needs you" count, and at the foot Feedback and Settings. Left on a desktop, behind
// the menu button on a phone. With it, a space's menu and the small dialogs it opens (New space, New group, Rename,
// Archive, Remove, Feedback).
import { useState } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { everything, folderOf, groupOf, isEverything, isHomeSpace, isTilde, listOf, machineLabel, needsCount, placeDown, placeOf, spaceLabel, tasksIn, tstate, unreachable, type ListMachine, type Space } from '@shared/view.ts'
import { act, getState, go, notice, openSettings, registry, setUI, shownOn, tryAct, useUI, type Filter, type MenuRow } from './kernel.ts'
import { confirm, openDialog, openForm, openMenu } from './overlay.tsx'
import { AgentField, MachineField, pickFor, type Pick } from './picker.tsx'
import { Btn, Cnt, I, IB, MenuGroup, Row } from './ui.tsx'
import { copyText } from './copy.ts'
import { DictateButton } from './dictate.tsx'
import { press } from './drag.ts'
import { swapRow } from './sides.ts'
import { NameWithIcon, SpaceIcon } from './space-icon.tsx'

const FILTERS: Filter[] = ['Active', 'Archived', 'All']

/** a machine's filter (SHEP-342): which of its spaces its heading shows, Active, Archived (with how many) or All. The
 *  same filter button as the Tasks panel's. */
export function filterMenu(anchor: Element, machine: string, name: string, archived: number) {
  openMenu(
    anchor,
    (close) => (
      <MenuGroup cap="Show">
        {FILTERS.map((f) => {
          const on = shownOn(getState().ui, machine) === f
          return (
            <Row
              key={f}
              label={f}
              role="menuitemradio"
              aria-checked={on}
              value={!on && f === 'Archived' && archived ? String(archived) : undefined}
              current={on}
              end={on ? <I n="check" /> : undefined}
              onClick={() => {
                close()
                const shown = { ...getState().ui.shown }
                if (f === 'Active') delete shown[machine]
                else shown[machine] = f
                setUI({ shown })
              }}
            />
          )
        })}
      </MenuGroup>
    ),
    { label: `Show which spaces on ${name}` },
  )
}

/** the working tasks a space has, named in the confirmation before it is archived or removed */
function busyWords(snap: Snapshot, placeId: string): string {
  const w = tasksIn(snap, placeId).filter((t) => t.place === placeId && tstate(t) === 'working')
  return w.length ? `${w.length === 1 ? '1 task is' : `${w.length} tasks are`} working there and will be stopped: ${w.map((t) => t.name).join(', ')}. ` : ''
}

function archive(snap: Snapshot, p: Space) {
  const run = async () => {
    if (await tryAct({ type: 'space-archive', place: p.id, on: !p.archived })) {
      const { ui } = getState()
      if (!p.archived && shownOn(ui, p.machine) === 'Active' && ui.at === p.id) go(everything(snap)?.id ?? '')
    }
  }
  const busy = p.archived ? '' : busyWords(snap, p.id)
  // asked only when tasks run there: archiving itself deletes nothing
  if (busy) confirm({ title: `Archive ${spaceLabel(snap, p.id)}?`, body: `${busy}Nothing is deleted; the filter in the list shows it again.`, ok: 'Archive', run })
  else void run()
}

function remove(snap: Snapshot, p: Space) {
  confirm({
    title: `Remove ${spaceLabel(snap, p.id)}?`,
    body: `${busyWords(snap, p.id)}It leaves Shepherdr, with its chat history and the pages its agents made. Its folder and everything in it stay where they are.`,
    ok: 'Remove',
    danger: true,
    run: async () => {
      if (await tryAct({ type: 'space-remove', place: p.id, stop: true }) && getState().ui.at === p.id) go(everything(snap)?.id ?? '')
    },
  })
}

/** one field and Save: Rename (a space, a group, a task, an artifact). blank: what an empty name shows (a machine's
 *  home space: ~), saved as no name */
export function renameDialog(name: string, save: (name: string) => void | Promise<unknown>, blank?: string) {
  openForm(
    function Form({ close }) {
      const [v, setV] = useState(name)
      const ok = () => {
        const t = v.trim()
        if (!t && blank === undefined) return
        close()
        if (t !== name) void save(t)
      }
      return (
        <>
          <h2>Rename</h2>
          <label className="fld">
            <span>Name</span>
            <input className="inp" name="name" value={v} placeholder={blank} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
          </label>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={ok}>Save</Btn>
          </div>
        </>
      )
    },
    { label: 'Rename' },
  )
}

/** the last part of a folder typed in New space: what the space is called when no name is given */
const folderName = (f: string) => f.trim().replace(/\/+$/, '').split('/').pop()?.replace(/^~$/, '') ?? ''

/** Rename a space: its icon's own button, then its name (blank: what an empty name shows, a machine's home space: ~,
 *  saved as no name). Everything's icon is set in Settings. */
export function renameSpace(id: string, name: string, icon: string | null, blank?: string) {
  openForm(
    function Form({ close }) {
      const [v, setV] = useState(name)
      const [ic, setIc] = useState(icon)
      const ok = () => {
        const t = v.trim()
        if (!t && blank === undefined) return
        close()
        if (t === name && ic === icon) return
        void tryAct({ type: 'rename', id, name: t, ...(ic !== icon ? { emoji: ic ?? '' } : {}), ...(blank !== undefined && !t ? { unname: true } : {}) })
      }
      return (
        <>
          <h2>Rename</h2>
          <NameWithIcon icon={ic} onIcon={setIc}>
            <input className="inp" name="name" aria-label="Name" value={v} placeholder={blank} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
          </NameWithIcon>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={ok}>Save</Btn>
          </div>
        </>
      )
    },
    { label: 'Rename' },
  )
}

export function newGroupDialog(machine?: string, then?: (id: string) => void) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const [name, setName] = useState('')
      const [m, setM] = useState(machine ?? snap.host)
      const ok = async () => {
        if (!name.trim()) return
        close()
        const r = await act<{ ok?: boolean; id?: string; error?: string }>({ type: 'section', op: 'new', name: name.trim(), machine: m }).catch(() => ({ ok: false, error: 'That did not work.' }) as { ok?: boolean; id?: string; error?: string })
        if (r.ok === false) return notice(r.error || 'That did not work.')
        if (r.id) then?.(r.id)
      }
      return (
        <>
          <h2>New group</h2>
          <p>A folder for spaces on one machine.</p>
          <label className="fld">
            <span>Name</span>
            <input className="inp" name="group" value={name} placeholder="Clients" autoComplete="off" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ok()} />
          </label>
          <MachineField value={m} onChange={setM} />
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={() => void ok()}>Create group</Btn>
          </div>
        </>
      )
    },
    { label: 'New group' },
  )
}

/** New space; from a repo's tasks (SHEP-325, "Make it a space") with its name and folder filled in */
export function newSpaceDialog(machine?: string, pre?: { name: string; folder: string }) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const [name, setName] = useState(pre?.name ?? '')
      const [icon, setIcon] = useState<string | null>(null)
      const [m, setM] = useState(machine ?? snap.host)
      const [folder, setFolder] = useState(pre?.folder ?? '')
      // it starts on Everything's choice for chats
      const [pick, setPick] = useState<Pick | null>(null)
      const [busy, setBusy] = useState(false)
      const ok = async () => {
        const path = folder.trim() || (name.trim() ? `~/dev/${name.trim().replace(/^#\s*/, '')}` : '')
        if (!path || busy) return
        setBusy(true)
        try {
          const r = await fetch('api/spaces', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ machine: m === snap.host ? undefined : m, path, name: name.trim().replace(/^#\s*/, '') || undefined, ...(icon ? { icon } : {}), agent: pick ?? undefined, create: true }) })
          const j = (await r.json().catch(() => ({}))) as { place?: string; error?: string; warning?: string; existed?: boolean }
          if (!r.ok || !j.place) throw new Error(j.error || 'The space could not be made.')
          close()
          go(j.place)
          // made, but its agent didn't start: said, not hidden (its first message starts one); the folder had its
          // space already (a machine's home one too): that one opened, said by the name the list shows
          const now = getState().snap
          const had = j.existed && now && !isEverything(now, j.place) && spaceLabel(now, j.place)
          if (had || j.warning) notice(had ? `${had} already works in that folder, so it's open now.` : j.warning!, 10000)
        } catch (e) {
          setBusy(false)
          notice(e instanceof Error ? e.message : 'The space could not be made.')
        }
      }
      return (
        <>
          <h2>New space</h2>
          <p>A folder on one of your machines, with its own chat.</p>
          <NameWithIcon icon={icon} onIcon={setIcon}>
            <input className="inp" name="space" aria-label="Name" value={name} placeholder={folderName(folder) || 'docs'} autoComplete="off" autoCapitalize="off" onChange={(e) => setName(e.target.value)} />
          </NameWithIcon>
          <MachineField value={m} onChange={setM} />
          <label className="fld">
            <span>Folder</span>
            <input className="inp" name="folder" value={folder} placeholder={name.trim() ? `~/dev/${name.trim().replace(/^#\s*/, '')}` : '~/dev/docs'} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ok()} />
          </label>
          <AgentField title="The new space runs on" machine={m} pick={pick ?? pickFor(snap, 'all', 'Chats')} onChange={setPick} />
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" disabled={busy} onClick={() => void ok()}>Create</Btn>
          </div>
        </>
      )
    },
    { label: 'New space' },
  )
}

/** Feedback: a small box to write in, with a mic to dictate. Send posts it as your message in Everything's chat with a
 *  fixed instruction in front; Everything's agent files the issue. No separate service. */
export function feedbackDialog() {
  openForm(
    function Form({ close }) {
      const [text, setText] = useState('')
      const send = async () => {
        const t = text.trim()
        const snap = getState().snap
        const ev = snap && everything(snap)
        if (!t || !ev) return
        close()
        if (await tryAct({ type: 'send', chat: ev.chat, text: `File this feedback as an issue on the Shepherdr GitHub repository: “${t}”`, human: true, cid: `fb-${Date.now().toString(36)}` }, 'Sent to Shepherdr in Everything')) go(ev.id)
      }
      return (
        <>
          <h2>Feedback</h2>
          <div className="cbox">
            <textarea className="cin fb" name="fb" rows={4} aria-label="Your feedback" placeholder="What should be better?" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="cbar">
              <span className="sp" />
              <DictateButton setText={setText} />
            </div>
          </div>
          <p>This is sent as a message to Shepherdr in Everything, which files it as an issue on Shepherdr's GitHub repository.</p>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={() => void send()}>Send</Btn>
          </div>
        </>
      )
    },
    { label: 'Feedback' },
  )
}

/** A space's whole folder, set like a menu row (SHEP-302): its whole path, and
 *  its machine when it is another (SHEP-316) */
function FolderTop({ f }: { f: { short: string; full: string; machine: string | null } }) {
  const under = f.machine ? `on ${f.machine}` : ''
  return (
    <div className="fwhere">
      <I n="folder" />
      <span className="n">
        <span className="l1">{f.full}</span>
        {under && <span className="l2">{under}</span>}
      </span>
    </div>
  )
}

const copyFolder = (full: string): MenuRow => ({ icon: 'copy', label: 'Copy folder path', run: () => void copyText(full).then((ok) => ok && notice('Copied')) })

/** The header's folder line's menu (SHEP-316, SHEP-360): the whole path and its machine, and Copy */
export function folderMenu(anchor: Element, placeId: string) {
  const snap = getState().snap
  const p = snap && placeOf(snap, placeId)
  if (!snap || !p) return
  const f = folderOf(snap, p)
  openMenu(anchor, [copyFolder(f.full)], { label: 'Folder', top: () => <FolderTop f={f} /> })
}

/** A space's menu: from its name in the header and from its row's ⋯. From the header it starts with Terminal and Screen
 *  (the header has no buttons for them), then below a line View as terminal / View as chat; Everything's then has Settings. From the header
 *  beside a pane it also swaps the chat and the pane (SHEP-352). */
export function spaceMenu(anchor: Element, placeId: string, head = false) {
  const snap = getState().snap
  const p = snap && placeOf(snap, placeId)
  if (!snap || !p) return
  // no folder here (SHEP-328): the header's folder line shows it and copies it
  const first = [...registry.spaceMenu.flatMap((m) => m.rows(p, head)), ...(head ? swapRow(getState().ui) : [])]
  const line = first.length > 0
  if (isEverything(snap, p.id)) return openMenu(anchor, [...first, { icon: 'gear', label: 'Settings', line, run: () => openSettings('all') }], { label: 'Everything' })
  // a machine's home space is a space like any other; unnamed it shows as ~, and an emptied name goes back to that
  const home = isHomeSpace(snap, p)
  const tilde = isTilde(snap, p)
  const mine = groupOf(snap, p.id)
  const groups = (snap.sections ?? []).filter((s) => s.id !== 'pinned' && (s.machine ?? snap.host) === p.machine && s.id !== mine?.id)
  const moveTo = (to: string) => void tryAct({ type: 'move', id: p.id, to })
  const rows: MenuRow[] = [
    ...first,
    { icon: 'gear', label: 'Settings', line, run: () => openSettings(p.id) },
    // SHEP-335: a space on a repo opens that repo's task settings
    ...((r) => (p.git && r ? [{ icon: 'folder' as const, label: 'Repo settings', run: () => openSettings('all', 'Tasks', r.key) }] : []))(snap.config?.repos?.find((x) => x.spaces.includes(p.id))),
    {
      icon: 'pen',
      label: 'Rename',
      run: () => renameSpace(p.id, home ? (tilde ? '' : p.name) : p.name, p.emoji ?? null, home ? '~' : undefined),
    },
    {
      icon: 'folder',
      label: 'Move to group',
      sub: [
        ...groups.map((g) => ({ label: g.name, run: () => moveTo(g.id) })),
        ...(mine ? [{ label: 'No group', run: () => moveTo(`m:${p.machine}`) }] : []),
        { label: 'New group…', run: () => newGroupDialog(p.machine, (id) => moveTo(id)) },
      ],
    },
    { icon: 'archive', label: p.archived ? 'Unarchive' : 'Archive', run: () => archive(snap, p) },
    { icon: 'bin', label: 'Remove', danger: true, line: true, run: () => remove(snap, p) },
  ]
  openMenu(anchor, rows, { label: spaceLabel(snap, p.id), ...(nameCut(anchor) && !tilde ? { top: () => <WholeName name={p.name} id={p.id} /> } : {}) })
}

/** a cut-off name (one line, or two that wrap) shows whole where it opens: its menu's first line (SHEP-356) */
export const isCut = (el: Element | null | undefined) => !!el && (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5)
/** the space's name as its header button or its row in the list shows it, cut or not */
const nameCut = (anchor: Element) => isCut(anchor.classList.contains('tbtn') ? anchor.querySelector('span') : anchor.closest('.rowx')?.querySelector('.row>.n'))

function WholeName({ name, id }: { name: string; id: string }) {
  return (
    <div className="fwhere">
      <SpaceIcon snap={getState().snap!} id={id} />
      <span className="n"><span className="l1">{name}</span></span>
    </div>
  )
}

function groupMenu(anchor: Element, id: string, name: string) {
  openMenu(
    anchor,
    [
      { icon: 'pen', label: 'Rename', run: () => renameDialog(name, (n) => tryAct({ type: 'rename', id, name: n })) },
      // removing a group keeps its spaces, ungrouped
      { icon: 'bin', label: 'Remove group', danger: true, line: true, run: () => void tryAct({ type: 'section', op: 'delete', id }) },
    ],
    { label: name },
  )
}

/** Spaces are dragged into the order you want: among those beside them, or onto another group of the same machine
 *  (its heading, or a row in it: before that one). `under`: the group's id, or its machine's ("m:<key>"). */
function dragSpace(snap: Snapshot, p: Space, under: string, siblings: string[]) {
  return (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('.ib')) return
    press(e, {
      id: p.id,
      siblings,
      level: 'project',
      drop: (ids) => void tryAct({ type: 'order', under, ids }),
      into: {
        group: under,
        may: (g) => g !== under && (g === `m:${p.machine}` || (snap.sections ?? []).some((s) => s.id === g && (s.machine ?? snap.host) === p.machine)),
        go: (g, before) => void tryAct({ type: 'move', id: p.id, to: g, ...(before ? { before } : {}) }),
      },
    })
  }
}

function SpaceRow({ snap, p, sub, under, siblings, section }: { snap: Snapshot; p: Space; sub?: boolean; under: string; siblings: string[]; section?: string }) {
  const at = useUI((u) => u.at)
  const n = needsCount(snap, p.id)
  const dim = !!placeDown(snap, p.id) || p.archived
  const tilde = isTilde(snap, p)
  return (
    <div className="rowx" data-project={p.id} data-section={section} data-drop={under} onPointerDown={dragSpace(snap, p, under, siblings)}>
      <Row lead={<SpaceIcon snap={snap} id={p.id} />} label={tilde ? '~' : p.name} {...(tilde ? { 'aria-label': spaceLabel(snap, p.id) } : {})} className={[sub ? 'sub' : '', dim ? 'dim' : ''].join(' ')} current={at === p.id} end={<Cnt n={n} />} onClick={() => go(p.id)} />
      <IB
        icon="dots"
        label={`More for ${tilde ? spaceLabel(snap, p.id) : p.name}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const el = e.currentTarget
          go(p.id)
          spaceMenu(el, p.id)
        }}
      />
    </div>
  )
}

/** a machine's menu (long-press or right click on its heading): Rename, and back to its own name once renamed, then
 *  Settings › Machines. Its first line shows the real name beside the given one: links, commands and "machine/…"
 *  addresses keep the real one, the name is only what the list shows. */
export function machineMenu(anchor: Element | null, key: string, snap = getState().snap) {
  const m = snap?.machines.find((x) => x.machine === key)
  if (!snap || !m) return
  const own = m.ownName ?? m.machine
  const renamed = m.name !== own
  const rename = (name: string) => tryAct({ type: 'rename', id: m.id, name })
  const rows: MenuRow[] = [
    { icon: 'pen', label: 'Rename', run: () => renameDialog(m.name, rename) },
    ...(renamed ? [{ icon: 'reload' as const, label: `Use its own name (${own})`, run: () => void rename('') }] : []),
    { icon: 'gear', label: 'Machine settings', line: true, run: () => openSettings('all', 'Machines') },
  ]
  openMenu(anchor, rows, { label: m.name, top: () => <MachineTop name={m.name} real={m.here ? `${key} · this computer` : key} /> })
}

function MachineTop({ name, real }: { name: string; real: string }) {
  return (
    <div className="fwhere">
      <I n="server" />
      <span className="n">
        <span className="l1">{name}</span>
        {real !== name && <span className="l2">{real}</span>}
      </span>
    </div>
  )
}

/** a finger held on a machine's heading: its menu. A right click opens it too (Android's long-press sends one as well,
 *  so whichever comes first wins and the other is skipped); the filter and plus buttons keep their own taps. */
const HOLD_MS = 450
let holding: { t: ReturnType<typeof setTimeout>; x: number; y: number } | null = null
let heldAt = 0
const stopHold = () => {
  if (holding) clearTimeout(holding.t)
  holding = null
}
const justHeld = () => Date.now() - heldAt < 800
const onButton = (e: { target: EventTarget }) => !!(e.target as HTMLElement).closest?.('.ib')
const anchorOf = (el: Element) => el.querySelector('.mn') ?? el
export function headHold(key: string) {
  const open = (el: Element) => {
    stopHold()
    heldAt = Date.now()
    machineMenu(anchorOf(el), key)
  }
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' || onButton(e)) return
      stopHold()
      const el = e.currentTarget
      holding = {
        x: e.clientX,
        y: e.clientY,
        t: setTimeout(() => {
          navigator.vibrate?.(10)
          open(el)
        }, HOLD_MS),
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (holding && Math.hypot(e.clientX - holding.x, e.clientY - holding.y) > 8) stopHold()
    },
    onPointerUp: stopHold,
    onPointerCancel: stopHold,
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (onButton(e)) return
      e.preventDefault()
      if (!justHeld()) open(e.currentTarget)
    },
    // the tap that ends a hold doesn't also press the name (Machines, when it carries a warning mark)
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (justHeld() && !onButton(e)) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
  }
}

/** a machine's heading (SHEP-342): its name (a button to Settings › Machines when it carries a warning mark), what its
 *  filter shows when that is not Active, then its own filter and New space on it */
function MachineHead({ snap, m }: { snap: Snapshot; m: ListMachine }) {
  const { machine, warn, filter, archived } = m
  const key = machine.machine
  const name = machineLabel(snap, key)
  const label = (
    <>
      <span className="n">{name}</span>
      {filter !== 'Active' && <span className="mf">{filter}</span>}
    </>
  )
  return (
    <div className="lab mh" data-machine={key} data-heading={`m:${key}`} data-drop={`m:${key}`} {...headHold(key)}>
      {warn ? (
        <button type="button" className="mn" aria-label={`${machine.name}: ${warn}. Open Machines`} onClick={() => openSettings('all', 'Machines')}>
          {label}
          <I n="warn" c="c-ask s16" />
        </button>
      ) : (
        <span className="mn">{label}</span>
      )}
      {/* the Tasks panel's filter button: a dot while it is on */}
      <IB icon="filter" label={`Show which spaces on ${machine.name}${filter !== 'Active' ? ' (on)' : ''}`} aria-haspopup="menu" data-marks="" onClick={(e) => filterMenu(e.currentTarget, key, machine.name, archived)}>
        {filter !== 'Active' && <span className="fdot" />}
      </IB>
      <IB
        icon="plus"
        label={`New space on ${machine.name}`}
        onClick={() => {
          setUI({ drawer: false })
          newSpaceDialog(key)
        }}
      />
    </div>
  )
}

export function List({ snap }: { snap: Snapshot }) {
  const ui = useUI()
  const ph = ui.phone
  const ev = everything(snap)
  const machines = listOf(snap, (m) => shownOn(ui, m))
  return (
    <>
      <div className="brand">
        {!ph && <IB icon="panel" label="Hide the list" onClick={() => setUI({ sideOff: true })} />}
        <b>Shepherdr</b>
        {registry.sideHead.map((V, i) => <V key={i} />)}
        <IB icon="search" label="Search" onClick={() => setUI({ search: true, drawer: false })} />
      </div>
      {ev && (
        <div className="rowx">
          <Row lead={<SpaceIcon snap={snap} id={ev.id} />} label="Everything" current={ui.at === ev.id} onClick={() => go(ev.id)} />
        </div>
      )}
      {machines.map((m) => {
        const { machine, groups, spaces, filter } = m
        return (
          <div key={machine.id} style={{ display: 'contents' }}>
            <MachineHead snap={snap} m={m} />
            {filter === 'Archived' && !spaces.length && <p className="hint mempty">No archived spaces.</p>}
            {groups.flatMap((g) => [
              // a group is dragged by its heading, among the groups of its machine; its spaces go with it
              <div
                className="rowx"
                key={g.id}
                data-section={g.id}
                data-heading={g.id}
                data-drop={g.id}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('.ib')) return
                  press(e, { id: g.id, siblings: groups.map((x) => x.id), level: 'section', drop: (ids) => void tryAct({ type: 'order', under: `sections:m:${machine.machine}`, ids }) })
                }}
              >
                <Row icon={ui.shut[g.id] ? 'right' : 'down'} label={g.name} expanded={!ui.shut[g.id]} onClick={() => setUI({ shut: { ...ui.shut, [g.id]: !ui.shut[g.id] } })} />
                <IB icon="dots" label={`More for ${g.name}`} aria-haspopup="menu" onClick={(e) => groupMenu(e.currentTarget, g.id, g.name)} />
              </div>,
              ...(ui.shut[g.id] ? [] : g.spaces.map((p) => <SpaceRow key={p.id} snap={snap} p={p} sub under={g.id} siblings={g.spaces.map((x) => x.id)} section={g.id} />)),
            ])}
            {spaces.map((p) => <SpaceRow key={p.id} snap={snap} p={p} under={`m:${machine.machine}`} siblings={spaces.map((x) => x.id)} />)}
          </div>
        )
      })}
      <div className="foot">
        <Row icon="feedback" label="Feedback" onClick={() => { setUI({ drawer: false }); feedbackDialog() }} />
        <Row icon="gear" label="Settings" onClick={() => openSettings('all')} />
      </div>
    </>
  )
}

export { unreachable }
