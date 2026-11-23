// The list: Shepherdr and search, Everything, machines as headings, groups that fold, spaces with a "needs you" count,
// and at the foot New space, Feedback and Settings. Left on a desktop, behind the menu button on a phone. With it, a
// space's menu and the small dialogs it opens (New space, New group, Rename, Archive, Remove, Feedback).
import { useState } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { everything, folderName, folderOf, groupOf, isEverything, listOf, machineLabel, needsCount, placeDown, placeOf, tasksIn, tstate, unreachable, type Space } from '@shared/view.ts'
import { act, getState, go, notice, openSettings, registry, setUI, tryAct, useUI, type Filter, type MenuRow } from './kernel.ts'
import { confirm, openDialog, openForm, openMenu } from './overlay.tsx'
import { AgentField, MachineField, pickFor, type Pick } from './picker.tsx'
import { Btn, Cnt, I, IB, Row } from './ui.tsx'
import { copyText } from './copy.ts'
import { DictateButton } from './dictate.tsx'
import { press } from './drag.ts'

const FILTERS: Filter[] = ['Active', 'Archived', 'All']

function filterMenu(anchor: Element) {
  openMenu(
    anchor,
    (close) => (
      <>
        <div className="cap">Show</div>
        {FILTERS.map((f) => (
          <Row
            key={f}
            label={f}
            role="menuitemradio"
            current={getState().ui.filter === f}
            end={getState().ui.filter === f ? <I n="check" /> : undefined}
            onClick={() => {
              close()
              setUI({ filter: f })
            }}
          />
        ))}
      </>
    ),
    { label: 'Show which spaces' },
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
      if (!p.archived && ui.filter === 'Active' && ui.at === p.id) go(everything(snap)?.id ?? '')
    }
  }
  const busy = p.archived ? '' : busyWords(snap, p.id)
  // asked only when tasks run there: archiving itself deletes nothing
  if (busy) confirm({ title: `Archive #${p.name}?`, body: `${busy}Nothing is deleted; the filter in the list shows it again.`, ok: 'Archive', run })
  else void run()
}

function remove(snap: Snapshot, p: Space) {
  confirm({
    title: `Remove #${p.name}?`,
    body: `${busyWords(snap, p.id)}It leaves Shepherdr, with its chat history and the pages its agents made. Its folder and everything in it stay where they are.`,
    ok: 'Remove',
    danger: true,
    run: async () => {
      if (await tryAct({ type: 'space-remove', place: p.id, stop: true }) && getState().ui.at === p.id) go(everything(snap)?.id ?? '')
    },
  })
}

/** one field and Save: Rename (a space, a group, a task, an artifact) */
export function renameDialog(name: string, save: (name: string) => void | Promise<unknown>) {
  openForm(
    function Form({ close }) {
      const [v, setV] = useState(name)
      const ok = () => {
        const t = v.trim()
        if (!t) return
        close()
        if (t !== name) void save(t)
      }
      return (
        <>
          <h2>Rename</h2>
          <label className="fld">
            <span>Name</span>
            <input className="inp" name="name" value={v} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
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

export function newSpaceDialog(machine?: string) {
  openForm(
    function Form({ close }) {
      const snap = getState().snap!
      const [name, setName] = useState('')
      const [m, setM] = useState(machine ?? snap.host)
      const [folder, setFolder] = useState('')
      // it starts on Everything's choice for chats
      const [pick, setPick] = useState<Pick | null>(null)
      const [busy, setBusy] = useState(false)
      const ok = async () => {
        const path = folder.trim() || (name.trim() ? `~/dev/${name.trim().replace(/^#\s*/, '')}` : '')
        if (!path || busy) return
        setBusy(true)
        try {
          const r = await fetch('api/spaces', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ machine: m === snap.host ? undefined : m, path, name: name.trim().replace(/^#\s*/, '') || undefined, agent: pick ?? undefined, create: true }) })
          const j = (await r.json().catch(() => ({}))) as { place?: string; error?: string; warning?: string }
          if (!r.ok || !j.place) throw new Error(j.error || 'The space could not be made.')
          close()
          go(j.place)
          // made, but its agent didn't start: said, not hidden (its first message starts one)
          if (j.warning) notice(j.warning, 10000)
        } catch (e) {
          setBusy(false)
          notice(e instanceof Error ? e.message : 'The space could not be made.')
        }
      }
      return (
        <>
          <h2>New space</h2>
          <p>A folder on one of your machines, with its own chat.</p>
          <label className="fld">
            <span>Name</span>
            <input className="inp" name="space" value={name} placeholder="# docs" autoComplete="off" autoCapitalize="off" onChange={(e) => setName(e.target.value)} />
          </label>
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
              <DictateButton write={(t) => setText((was) => (was ? `${was.replace(/\s+$/, '')} ${t}` : t))} />
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

/** A space's whole folder, set like a menu row (SHEP-302): Home folder / Root folder in words, the path beneath, and
 *  its machine when it is another (SHEP-316) */
function FolderTop({ f }: { f: { short: string; full: string; machine: string | null } }) {
  const name = folderName(f.short === '/' ? '/' : f.short)
  const under = [name !== f.short && f.full !== '/' ? f.full : '', f.machine ? `on ${f.machine}` : ''].filter(Boolean).join(' ')
  return (
    <div className="fwhere">
      <I n="folder" />
      <span className="n">
        <span className="l1">{name === f.short ? f.full : name}</span>
        {under && <span className="l2">{under}</span>}
      </span>
    </div>
  )
}

const copyFolder = (full: string): MenuRow => ({ icon: 'copy', label: 'Copy folder path', run: () => void copyText(full).then((ok) => ok && notice('Copied')) })

/** The header's folder chip's menu (SHEP-316): the whole path and its machine, and Copy */
export function folderMenu(anchor: Element, placeId: string) {
  const snap = getState().snap
  const p = snap && placeOf(snap, placeId)
  if (!snap || !p) return
  const f = folderOf(snap, p)
  openMenu(anchor, [copyFolder(f.full)], { label: 'Folder', top: () => <FolderTop f={f} /> })
}

/** A space's menu: from its name in the header and from its row's ⋯. Everything's has Switch to terminal and Settings. */
export function spaceMenu(anchor: Element, placeId: string) {
  const snap = getState().snap
  const p = snap && placeOf(snap, placeId)
  if (!snap || !p) return
  // no folder here (SHEP-328): the header's folder chip shows it and copies it
  const first = registry.spaceMenu.flatMap((m) => m.rows(p))
  const line = first.length > 0
  if (isEverything(snap, p.id)) return openMenu(anchor, [...first, { icon: 'gear', label: 'Settings', line, run: () => openSettings('all') }], { label: 'Everything' })
  const mine = groupOf(snap, p.id)
  const groups = (snap.sections ?? []).filter((s) => s.id !== 'pinned' && (s.machine ?? snap.host) === p.machine && s.id !== mine?.id)
  const moveTo = (to: string) => void tryAct({ type: 'move', id: p.id, to })
  const rows: MenuRow[] = [
    ...first,
    { icon: 'gear', label: 'Settings', line, run: () => openSettings(p.id) },
    { icon: 'pen', label: 'Rename', run: () => renameDialog(p.name, (name) => tryAct({ type: 'rename', id: p.id, name })) },
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
  openMenu(anchor, rows, { label: `#${p.name}` })
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
  const wide = useUI((u) => u.wide)
  const n = needsCount(snap, p.id)
  const dim = !!placeDown(snap, p.id) || p.archived
  return (
    <div className="rowx" data-project={p.id} data-section={section} data-drop={under} onPointerDown={dragSpace(snap, p, under, siblings)}>
      <Row icon="hash" label={p.name} className={[sub ? 'sub' : '', dim ? 'dim' : ''].join(' ')} current={at === p.id && !wide} end={<Cnt n={n} />} onClick={() => go(p.id)} />
      <IB
        icon="dots"
        label={`More for ${p.name}`}
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

export function List({ snap }: { snap: Snapshot }) {
  const ui = useUI()
  const ph = ui.phone
  const f = ui.filter
  const ev = everything(snap)
  const machines = listOf(snap, f)
  const FilterBtn = <IB icon="filter" label="Show which spaces" aria-haspopup="menu" data-marks="" onClick={(e) => filterMenu(e.currentTarget)} />
  const anyArchived = snap.places.some((p) => p.archived && !p.home)
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
          <Row icon="layers" label="Everything" current={ui.at === ev.id && !ui.wide} onClick={() => go(ev.id)} />
          {!ph && FilterBtn}
          {!ph && (
            <IB
              icon="plus"
              label="New"
              aria-haspopup="menu"
              onClick={(e) =>
                openMenu(e.currentTarget, [
                  { icon: 'hash', label: 'New space', run: () => newSpaceDialog() },
                  { icon: 'folder', label: 'New group', run: () => newGroupDialog() },
                ])
              }
            />
          )}
        </div>
      )}
      {ph && <div className="h2">Spaces{FilterBtn}</div>}
      {f === 'Archived' && <p className="hint" style={{ padding: '4px 8px' }}>Archived spaces and their messages are kept until you remove them.</p>}
      {f === 'Archived' && !anyArchived && <p className="hint" style={{ padding: '4px 8px' }}>No archived spaces.</p>}
      {(f === 'Archived' ? machines : listOf(snap, f)).map(({ machine, warn, groups, spaces }) => (
        <div key={machine.id} style={{ display: 'contents' }}>
          {f !== 'Archived' &&
            (warn ? (
              <button type="button" className="row lab" style={{ paddingTop: 0, paddingBottom: 0, marginTop: 8 }} aria-label={`${machine.name}: ${warn}. Open Machines`} onClick={() => openSettings('all', 'Machines')}>
                <span className="n">{machine.name}</span>
                <I n="warn" c="c-ask s16" />
              </button>
            ) : (
              <div className="lab" data-heading={`m:${machine.machine}`} data-drop={`m:${machine.machine}`}>{machineLabel(snap, machine.machine)}</div>
            ))}
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
      ))}
      <div className="foot">
        <Row icon="plus" label="New space" onClick={() => { setUI({ drawer: false }); newSpaceDialog() }} />
        {ph && <Row icon="archive" label={f === 'Archived' ? 'Back to spaces' : 'Archived'} onClick={() => setUI({ filter: f === 'Archived' ? 'Active' : 'Archived' })} />}
        <Row icon="feedback" label="Feedback" onClick={() => { setUI({ drawer: false }); feedbackDialog() }} />
        <Row icon="gear" label="Settings" onClick={() => openSettings('all')} />
      </div>
    </>
  )
}

export { unreachable }
