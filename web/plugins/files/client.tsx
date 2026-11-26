// Files (off by default; Settings › Plugins): the shown space's folder as a tree, like an editor's file explorer, on
// the machine the space lives on. Open folders, see a file (text and pictures), drop files from the computer on a
// folder to put them there, drag a file or folder onto another folder to move it, and Download from a right click
// (a long press on a phone): a file as it is, a folder as a zip. Only inside the space's folder (service/files.ts).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { definePlugin, dismissNotice, notice, setUI, togglePane, useSnap, useUI } from '@client/kernel.ts'
import { confirm, openMenu } from '@client/overlay.tsx'
import { Btn, cx, Empty, Hd, I, IB } from '@client/ui.tsx'
import type { MenuRow } from '@client/kernel.ts'
import { folderOf, isEverything, spaceLabel } from '@shared/view.ts'
import { IMAGE, join, parentOf, sizeWords } from './paths.ts'
import './files.css'

type Entry = { name: string; kind: 'dir' | 'file' | 'link'; size?: number }
type Dir = { entries?: Entry[]; more?: boolean; error?: string }

/* ---------- what is open and loaded, per space (kept while the page is open) ---------- */

const dirs = new Map<string, Dir>()
const opened = new Map<string, Set<string>>()
const viewing = new Map<string, string | null>()
let ver = 0
const subs = new Set<() => void>()
const emit = () => { ver++; for (const f of subs) f() }
const useStore = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => ver)
const k = (space: string, path: string) => `${space}\0${path}`
const openOf = (space: string) => { let s = opened.get(space); if (!s) opened.set(space, (s = new Set())); return s }

const q = (space: string, what: string, path: string) => `api/files?space=${encodeURIComponent(space)}&what=${what}&path=${encodeURIComponent(path)}`
async function ask<T>(url: string, init?: RequestInit): Promise<T & { error?: string }> {
  const r = await fetch(url, { ...init, headers: { 'x-shepherdr': '1', ...(init?.headers ?? {}) } }).catch(() => null)
  if (!r) return { error: "Shepherdr can't be reached." } as T & { error?: string }
  return r.json().catch(() => ({ error: `It didn't work (${r.status}).` }))
}

async function load(space: string, path: string) {
  const d = await ask<Dir>(q(space, 'ls', path))
  dirs.set(k(space, path), d)
  emit()
}
function toggle(space: string, path: string) {
  const s = openOf(space)
  if (s.has(path)) s.delete(path)
  else { s.add(path); void load(space, path) }
  emit()
}
/** a folder shown again, with the folders open under it */
function reload(space: string, path: string) {
  void load(space, path)
  for (const p of openOf(space)) if (p !== path && p.startsWith(path ? path + '/' : '')) void load(space, p)
}

/* ---------- download, upload, move ---------- */

async function download(space: string, path: string, dir: boolean) {
  const name = (path.split('/').pop() || 'folder') + (dir ? '.zip' : '')
  const spin = notice(dir ? `Zipping ${name}…` : `Getting ${name}…`, {}, true)
  const r = await fetch(dir ? q(space, 'zip', path) : `${q(space, 'file', path)}&download=1`).catch(() => null)
  if (!r?.ok) {
    dismissNotice(spin)
    const e = r ? ((await r.json().catch(() => null)) as { error?: string } | null)?.error : null
    return void notice(e ?? "That couldn't be downloaded.", { tone: 'error' })
  }
  const url = URL.createObjectURL(await r.blob())
  dismissNotice(spin)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function upload(space: string, dir: string, list: File[]) {
  const where = dir || 'the space folder'
  let done = 0
  for (const f of list) {
    const send = async (replace: boolean): Promise<void> => {
      const body = new FormData()
      body.append('file', f, f.name)
      if (replace) body.append('replace', '1')
      const spin = notice(`Uploading ${f.name}…`, {}, true)
      const r = await ask<{ ok?: boolean; exists?: boolean }>(q(space, 'put', dir), { method: 'POST', body })
      dismissNotice(spin)
      if (r.exists) {
        return new Promise((res) => confirm({ title: `Replace ${f.name}?`, body: `A file with that name is already in ${where}.`, ok: 'Replace', danger: true, run: () => send(true).then(res) }))
      }
      if (r.error) notice(`${f.name}: ${r.error}`, { tone: 'error' })
      else done++
    }
    await send(false)
  }
  if (done) notice(done === 1 ? `Uploaded to ${where}` : `Uploaded ${done} files to ${where}`, { tone: 'ok' })
  reload(space, dir)
}

async function move(space: string, from: string, to: string) {
  if (parentOf(from) === to || from === to) return
  const r = await ask<{ ok?: boolean }>(q(space, 'mv', ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }) })
  if (r.error) notice(r.error, { tone: 'error' })
  else {
    // a folder moved: what was open under it opens at its new place
    const s = openOf(space)
    for (const p of [...s]) if (p === from || p.startsWith(from + '/')) { s.delete(p); s.add(join(to, p.slice(parentOf(from).length).replace(/^\//, ''))) }
    if (viewing.get(space) === from) viewing.set(space, join(to, from.split('/').pop()!))
  }
  reload(space, parentOf(from))
  reload(space, to)
}

/** files from the computer: a dropped folder can't be read as files, said plainly */
function droppedFiles(dt: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = []
  let folders = 0
  const items = [...(dt.items ?? [])]
  if (items.length) {
    for (const it of items) {
      if (it.kind !== 'file') continue
      const e = (it as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.()
      if (e?.isDirectory) { folders++; continue }
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  } else files.push(...dt.files)
  return { files, folders }
}

let picking: { space: string; dir: string } | null = null
let picker: HTMLInputElement | null = null
function pickFiles(space: string, dir: string) {
  picking = { space, dir }
  if (!picker) {
    picker = document.createElement('input')
    picker.type = 'file'
    picker.multiple = true
    picker.style.display = 'none'
    picker.onchange = () => {
      const files = [...(picker!.files ?? [])]
      picker!.value = ''
      if (picking && files.length) void upload(picking.space, picking.dir, files)
    }
    document.body.append(picker)
  }
  picker.click()
}

/* ---------- the menu: a right click, or a finger held on a row ---------- */

let heldAt = 0
function menu(anchor: Element, space: string, path: string, e: Entry | null) {
  if (Date.now() - heldAt < 700) return
  heldAt = Date.now()
  const dir = !e || e.kind === 'dir'
  const rows: MenuRow[] = dir
    ? [
        { icon: 'download', label: 'Download as zip', run: () => void download(space, path, true) },
        { icon: 'plus', label: 'Upload files here', run: () => pickFiles(space, path) },
        { icon: 'reload', label: 'Refresh', line: true, run: () => reload(space, path) },
      ]
    : [
        { icon: 'doc', label: 'Open', run: () => { viewing.set(space, path); emit() } },
        { icon: 'download', label: 'Download', run: () => void download(space, path, false) },
      ]
  openMenu(anchor, rows, { label: path || 'Space folder' })
}
function useHold(open: (el: Element) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  return {
    onContextMenu: (ev: React.MouseEvent<HTMLElement>) => { ev.preventDefault(); stop(); open(ev.currentTarget) },
    onTouchStart: (ev: React.TouchEvent<HTMLElement>) => { const el = ev.currentTarget; stop(); timer.current = setTimeout(() => { timer.current = null; open(el) }, 500) },
    onTouchMove: stop,
    onTouchEnd: stop,
    onTouchCancel: stop,
    // the tap that ends a hold opens nothing
    onClickCapture: (ev: React.MouseEvent) => { if (Date.now() - heldAt < 700) { ev.preventDefault(); ev.stopPropagation() } },
  }
}

/* ---------- the tree ---------- */

const MOVING = 'application/x-shepherdr-file'
let dragging: string | null = null

function Row({ space, path, e, depth, target, setTarget }: { space: string; path: string; e: Entry; depth: number; target: string | null; setTarget: (t: string | null) => void }) {
  useStore()
  const phone = useUI((u) => u.phone)
  const dir = e.kind === 'dir'
  const open = dir && openOf(space).has(path)
  const hold = useHold((el) => menu(el, space, path, e))
  const into = dir ? path : parentOf(path)
  const icon = dir ? 'folder' : IMAGE.test(e.name) ? 'image' : 'doc'
  return (
    <>
      <button
        type="button"
        className={cx('row', 'ft', target === into && dir && 'drop', e.kind === 'link' && 'off', viewing.get(space) === path && 'on')}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-expanded={dir ? open : undefined}
        aria-current={viewing.get(space) === path ? 'true' : undefined}
        draggable={!phone && e.kind !== 'link'}
        onDragStart={(ev) => { dragging = path; ev.dataTransfer.setData(MOVING, path); ev.dataTransfer.effectAllowed = 'move' }}
        onDragEnd={() => { dragging = null; setTarget(null) }}
        onDragOver={(ev) => {
          if (dragging && (dragging === into || into.startsWith(dragging + '/'))) return
          ev.preventDefault()
          ev.stopPropagation()
          ev.dataTransfer.dropEffect = ev.dataTransfer.types.includes(MOVING) ? 'move' : 'copy'
          if (target !== into) setTarget(into)
        }}
        onDrop={(ev) => drop(ev, space, into, setTarget)}
        onClick={() => {
          if (dir) toggle(space, path)
          else if (e.kind === 'file') { viewing.set(space, path); emit() }
          else notice('That link leads out of the space folder.', { tone: 'error' })
        }}
        {...hold}
      >
        <span className={cx('chev', !dir && 'none')}><I n={open ? 'down' : 'right'} c="s16" /></span>
        <I n={icon} c="s16" />
        <span className="n">{e.name}</span>
        {e.size != null && !phone && <span className="v">{sizeWords(e.size)}</span>}
      </button>
      {open && <Level space={space} path={path} depth={depth + 1} target={target} setTarget={setTarget} />}
    </>
  )
}

function drop(ev: React.DragEvent, space: string, into: string, setTarget: (t: string | null) => void) {
  ev.preventDefault()
  ev.stopPropagation()
  setTarget(null)
  const from = ev.dataTransfer.getData(MOVING)
  dragging = null
  if (from) return void move(space, from, into)
  const { files, folders } = droppedFiles(ev.dataTransfer)
  if (folders) notice(folders === 1 ? 'A folder can’t be uploaded: zip it first, or drop the files in it.' : 'Folders can’t be uploaded: zip them first, or drop the files in them.', { tone: 'error' })
  if (files.length) void upload(space, into, files)
}

function Level({ space, path, depth, target, setTarget }: { space: string; path: string; depth: number; target: string | null; setTarget: (t: string | null) => void }) {
  useStore()
  const d = dirs.get(k(space, path))
  const pad = { paddingLeft: 8 + depth * 14 + 22 }
  if (!d) return <div className="ftnote" style={pad}>Loading…</div>
  if (d.error) return <div className="ftnote" style={pad}>{d.error}</div>
  if (!d.entries?.length) return <div className="ftnote" style={pad}>{depth ? 'Empty folder' : 'This folder is empty.'}</div>
  return (
    <div role="group">
      {d.entries.map((e) => <Row key={e.name} space={space} path={join(path, e.name)} e={e} depth={depth} target={target} setTarget={setTarget} />)}
      {d.more && <div className="ftnote" style={pad}>Only the first {d.entries.length} are shown.</div>}
    </div>
  )
}

/* ---------- one file, read ---------- */

function Viewer({ space, path }: { space: string; path: string }) {
  const [f, setF] = useState<{ path: string; size?: number; text?: string; binary?: boolean; cut?: boolean; error?: string } | null>(null)
  useEffect(() => {
    let live = true
    setF(null)
    if (IMAGE.test(path)) return
    void ask<{ size: number; text?: string; binary?: boolean; cut?: boolean }>(q(space, 'read', path)).then((r) => live && setF({ path, ...r }))
    return () => { live = false }
  }, [space, path])
  if (IMAGE.test(path)) return <div className="ftimg"><img src={q(space, 'file', path)} alt={path.split('/').pop()} /></div>
  if (!f || f.path !== path) return <Empty>Opening…</Empty>
  if (f.error) return <Empty>{f.error}</Empty>
  if (f.binary)
    return (
      <Empty>
        This file can’t be shown here ({sizeWords(f.size ?? 0)}).{' '}
        <Btn small onClick={() => void download(space, path, false)}>Download</Btn>
      </Empty>
    )
  return (
    <>
      {f.cut && <div className="ftnote">Only the first 400 KB of {sizeWords(f.size ?? 0)} is shown. Download it for the rest.</div>}
      <pre className="ftext">{f.text}</pre>
    </>
  )
}

/* ---------- the pane ---------- */

function FilesPane() {
  useStore()
  const snap = useSnap()
  const ui = useUI()
  const [target, setTarget] = useState<string | null>(null)
  const space = ui.at
  const root = useHoldRoot(space)
  const sp = snap?.places.find((p) => p.id === space)
  const every = !snap || !sp || isEverything(snap, space)
  useEffect(() => { if (!every && !dirs.has(k(space, ''))) void load(space, '') }, [space, every])
  const close = !ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />
  if (every)
    return (
      <PaneFrame head={(sc) => <Hd title="Files" pad={ui.phone ? 12 : 4} scrolled={sc}>{close}</Hd>}>
        <Empty>Pick a space to see its folder.</Empty>
      </PaneFrame>
    )
  const open = viewing.get(space) ?? null
  if (open)
    return (
      <PaneFrame
        scrollKey={`files:${space}:${open}`}
        head={(sc) => (
          <Hd back={{ label: 'All files', run: () => { viewing.set(space, null); emit() } }} title={open.split('/').pop()} sub={parentOf(open) || undefined} scrolled={sc}>
            <IB icon="download" label="Download" onClick={() => void download(space, open, false)} />
            {close}
          </Hd>
        )}
      >
        <Viewer space={space} path={open} />
      </PaneFrame>
    )
  return (
    <PaneFrame
      scrollKey={`files:${space}`}
      head={(sc) => (
        <Hd title={`Files in ${spaceLabel(snap!, space)}`} sub={((f) => (f.machine ? `${f.machine} · ${f.short}` : f.short))(folderOf(snap!, sp!))} pad={ui.phone ? 12 : 4} scrolled={sc}>
          <IB icon="plus" label="Upload files" onClick={() => pickFiles(space, '')} />
          <IB icon="reload" label="Refresh" onClick={() => reload(space, '')} />
          {close}
        </Hd>
      )}
    >
      <div
        className={cx('ftree', target === '' && 'drop')}
        role="tree"
        aria-label="Files"
        onDragOver={(ev) => { if (dragging && !dragging.includes('/')) return; ev.preventDefault(); if (target !== '') setTarget('') }}
        onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setTarget(null) }}
        onDrop={(ev) => drop(ev, space, '', setTarget)}
        {...root}
      >
        <Level space={space} path="" depth={0} target={target} setTarget={setTarget} />
      </div>
    </PaneFrame>
  )
}
function useHoldRoot(space: string) {
  const h = useHold((el) => menu(el, space, '', null))
  // only on the tree's empty space, not on a row (a row has its own)
  const mine = (ev: React.SyntheticEvent) => ev.target === ev.currentTarget
  return { onContextMenu: (ev: React.MouseEvent<HTMLElement>) => mine(ev) && h.onContextMenu(ev), onTouchStart: (ev: React.TouchEvent<HTMLElement>) => mine(ev) && h.onTouchStart(ev), onTouchMove: h.onTouchMove, onTouchEnd: h.onTouchEnd }
}

function FilesButton() {
  const on = useUI((u) => u.pane === 'files')
  return <IB icon="folder" label="Files" pressed={on} onClick={() => togglePane('files')} />
}

export default definePlugin({
  name: 'files',
  setup(reg) {
    reg.commands.push({ id: 'files.open', title: 'Open Files', area: 'Go to', icon: 'folder', keys: ['G F'], words: 'folder explorer tree upload download', run: () => setUI((ui) => (ui.pane === 'files' ? {} : { pane: 'files', task: null, art: null, artWide: false })) })
    reg.header.push({ order: 44, View: FilesButton })
    reg.bar.push({ order: 30, pane: 'files', label: 'Files', icon: 'folder' })
    reg.panes.push({ id: 'files', View: FilesPane })
  },
})
