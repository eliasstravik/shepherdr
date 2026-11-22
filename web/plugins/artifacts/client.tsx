// Artifacts: things made to keep. An artifact is a web page an agent writes (an HTML file and the files beside it);
// Shepherdr keeps and serves it, in a frame that cannot reach the app itself. The pane lists them as picture tiles
// (search, pinned ones on top); one opens in the pane as the real page it is, with its version, Mark up (the speech
// bubble) and a menu. The same tile shows a page in a chat and a task's proof on its review card.
import { useEffect, useRef, useState } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { renameDialog } from '@client/list.tsx'
import { definePlugin, getState, notice, openArtifact, setUI, togglePane, tryAct, useSnap, useUI } from '@client/kernel.ts'
import { confirm, openDialog, openMenu } from '@client/overlay.tsx'
import { Btn, cx, Empty, Hd, I, IB, Row } from '@client/ui.tsx'
import { copyText } from '@client/copy.ts'
import { useDark } from '@client/prefs.ts'
import type { Artifact, Chat, Message } from '@shared/types.ts'
import { agoShort, artifactsIn, isEverything, spaceLabel } from '@shared/view.ts'

const on = (a: Artifact) => (a.machine ? `&on=${encodeURIComponent(a.machine)}` : '')
/** the page itself, at a version */
export const pageUrl = (a: Artifact, v: number) => `api/artifacts/${encodeURIComponent(a.id)}/page/?v=${v}${on(a)}`
/** the picture of the page taken when it was published */
const thumbUrl = (a: Artifact, dark: boolean) => `api/artifacts/${encodeURIComponent(a.id)}/thumb?v=${a.v}${dark ? '&dark=1' : ''}${on(a)}`

/** a page as a picture tile: a small picture of the page, its title, when it was updated; tap to open */
function Tile({ id }: { id: string }) {
  const snap = useSnap()
  const dark = useDark()
  const a = snap?.artifacts.find((x) => x.id === id)
  if (!snap || !a) return null
  return (
    <button type="button" className="tile" onClick={() => openArtifact(a.id)}>
      <span className="prev"><img src={thumbUrl(a, dark)} alt="" loading="lazy" /></span>
      <span className="l1" style={{ fontWeight: 500 }}>{a.title}</span>
      <span className="l2">{spaceLabel(snap, a.place)} · {agoShort(a.at)}</span>
    </button>
  )
}

/** a page an agent made shows in the chat as its tile */
function InChat({ msg }: { msg: Message; chat: Chat }) {
  if (!msg.artifact) return null
  return <div className="atile"><Tile id={msg.artifact.id} /></div>
}

/* ---------- an open artifact ---------- */

/** Earlier versions: a list (view, Restore) */
function versions(a: Artifact) {
  openDialog(
    (close) => (
      <>
        <h2>{a.title}</h2>
        <div>
          {a.versions.map((v) => {
            const shown = (getState().ui.artV ?? a.v) === v.n
            return (
              <div className="rowx" key={v.n}>
                <Row icon="clock" label={`Version ${v.n}`} sub={`${shown ? 'Now showing · ' : ''}${v.at ? `${agoShort(v.at)} ago` : v.when}`} onClick={() => { close(); setUI({ artV: v.n === a.v ? null : v.n }) }} />
                {v.n !== a.v && <Btn small onClick={() => { close(); void tryAct({ type: 'artifact-restore', place: a.place, artifact: a.id, v: v.n }, `Version ${v.n} is the newest again`).then((ok) => ok && setUI({ artV: null })) }}>Restore</Btn>}
              </div>
            )
          })}
        </div>
        <div className="acts"><Btn onClick={close}>Close</Btn></div>
      </>
    ),
    { label: `${a.title}: earlier versions` },
  )
}

function del(a: Artifact) {
  confirm({
    title: 'Delete this page?',
    body: `“${a.title}” and its earlier versions are deleted. This can't be undone.`,
    ok: 'Delete',
    danger: true,
    run: async () => {
      if (await tryAct({ type: 'artifact-delete', place: a.place, artifact: a.id }) && getState().ui.art === a.id) setUI({ art: null, artWide: false })
    },
  })
}

function menu(anchor: Element, a: Artifact, v: number) {
  const link = new URL(`?artifact=${encodeURIComponent(a.id)}`, location.href).href
  openMenu(
    anchor,
    [
      { icon: 'ext', label: 'Open in a new tab', run: () => void window.open(pageUrl(a, v), '_blank', 'noopener') },
      // Expand gives the page the middle, like a task
      { icon: 'expand', label: getState().ui.artWide ? 'Back to the pane' : 'Expand', run: () => setUI({ artWide: !getState().ui.artWide }) },
      // a proof stays on its task until kept: Keep moves it to Artifacts
      ...(a.proof ? [{ icon: 'archive' as const, label: 'Keep', run: () => void tryAct({ type: 'artifact-keep', place: a.place, artifact: a.id }, 'Kept in Artifacts') }] : [{ icon: 'pin' as const, label: a.pinned ? 'Unpin' : 'Pin', run: () => void tryAct({ type: 'artifact-pin', place: a.place, artifact: a.id, on: !a.pinned }) }]),
      { icon: 'clock', label: 'Earlier versions', value: a.versions.length > 1 ? String(a.versions.length - 1) : undefined, run: () => versions(a) },
      { icon: 'copy', label: 'Copy link', run: () => void copyText(link).then((ok) => ok && notice('Link copied')) },
      { icon: 'pen', label: 'Rename', run: () => renameDialog(a.title, (name) => tryAct({ type: 'artifact-rename', place: a.place, artifact: a.id, name })) },
      { icon: 'bin', label: 'Delete', danger: true, line: true, run: () => del(a) },
    ],
    { label: a.title },
  )
}

/** The page, in a frame that cannot reach the app. Marking up: tap the page to drop a pin, then write. */
function Page({ a, v, markup, pin, setPin }: { a: Artifact; v: number; markup: boolean; pin: { x: number; y: number } | null; setPin: (p: { x: number; y: number } | null) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  // a page can send the person's answer back to its agent: parent.postMessage({ shepherdr: 'answer', text }, '*')
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { shepherdr?: string; text?: unknown } | null
      if (e.source !== frame.current?.contentWindow || d?.shepherdr !== 'answer' || typeof d.text !== 'string' || !d.text.trim()) return
      void tryAct({ type: 'artifact-say', place: a.place, artifact: a.id, v, text: d.text.slice(0, 4000) }, 'Sent to the agent that made it')
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [a.id, a.place, v])
  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0 }}>
      <iframe ref={frame} className="page" title={a.title} src={pageUrl(a, v)} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" />
      {markup && (
        <div
          role="button"
          aria-label="Tap the page where you mean"
          style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPin({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
          }}
        >
          {pin && <span className="pinmark" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} />}
        </div>
      )}
    </div>
  )
}

function Open({ a, where }: { a: Artifact; where: 'pane' | 'middle' }) {
  const snap = useSnap()!
  const ui = useUI()
  const [markup, setMarkup] = useState(false)
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const v = ui.artV ?? a.v
  useEffect(() => {
    if (markup) input.current?.focus()
    else setPin(null)
  }, [markup])
  const send = async () => {
    const t = note.trim()
    if (!t) return
    // the note goes to the agent that made it, with the spot pointed at; if that agent is gone, to its space's chat.
    // One that did not go through stays in the box, with its pin, to send again
    if (!(await tryAct({ type: 'artifact-note', place: a.place, artifact: a.id, v, note: t, ...(pin ? { spot: pin } : {}) }, 'Sent to the agent that made it'))) return
    setNote('')
    setMarkup(false)
  }
  const back = where === 'middle' ? { label: 'Back', run: () => setUI({ artWide: false }) } : { label: 'Back to artifacts', run: () => setUI({ art: null }) }
  return (
    <PaneFrame
      flush
      head={(sc) => (
        <Hd back={back} title={a.title} sub={`Version ${v} · ${spaceLabel(snap, a.place)} · ${agoShort(a.versions.find((x) => x.n === v)?.at ?? a.at)} ago`} scrolled={sc}>
          <IB icon="chat" label="Mark up" pressed={markup} onClick={() => setMarkup(!markup)} />
          <IB icon="dots" label="More" aria-haspopup="menu" onClick={(e) => menu(e.currentTarget, a, v)} />
          {where === 'pane' && !ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
        </Hd>
      )}
      foot={markup ? <input ref={input} className="inp" name="note" aria-label="Say what to change" placeholder="Say what to change. It goes to the agent that made this." enterKeyHint="send" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void send()} /> : undefined}
    >
      <Page a={a} v={v} markup={markup} pin={pin} setPin={setPin} />
    </PaneFrame>
  )
}

function ArtifactsPane() {
  const snap = useSnap()
  const ui = useUI()
  if (!snap) return null
  const a = ui.art ? snap.artifacts.find((x) => x.id === ui.art) : undefined
  if (a && !ui.artWide) return <Open a={a} where="pane" />
  const every = isEverything(snap, ui.at)
  const q = (ui.artq ?? '').trim().toLowerCase()
  const list = artifactsIn(snap, ui.at).filter((x) => !q || x.title.toLowerCase().includes(q))
  const pinned = list.filter((x) => x.pinned)
  const rest = list.filter((x) => !x.pinned)
  const grid = (l: Artifact[]) => <div className="grid">{l.map((x) => <Tile key={x.id} id={x.id} />)}</div>
  return (
    <PaneFrame
      head={(sc) => (
        <Hd title={`Artifacts${every ? '' : ` in ${spaceLabel(snap, ui.at)}`}`} pad={ui.phone ? 12 : 4} scrolled={sc}>
          <IB icon="search" label="Search artifacts" pressed={ui.artq !== null} onClick={() => setUI({ artq: ui.artq === null ? '' : null })} />
          {!ui.phone && <IB icon="x" label="Close" onClick={() => togglePane(null)} />}
        </Hd>
      )}
    >
      {ui.artq !== null && <input className="inp" name="aq" aria-label="Search artifacts" placeholder="Search artifacts" value={ui.artq} autoComplete="off" autoFocus style={{ marginBottom: 12 }} onChange={(e) => setUI({ artq: e.target.value })} />}
      {list.length ? (
        <>
          {pinned.length > 0 && <div className="lab">Pinned</div>}
          {pinned.length > 0 && grid(pinned)}
          {pinned.length > 0 && <div className="lab">Everything else</div>}
          {grid(rest)}
        </>
      ) : (
        <Empty>{q ? 'No artifact matches.' : 'Nothing made here yet.'}</Empty>
      )}
    </PaneFrame>
  )
}

function Middle() {
  const snap = useSnap()
  const art = useUI((u) => u.art)
  const a = snap?.artifacts.find((x) => x.id === art)
  return a ? <Open a={a} where="middle" /> : null
}

function ArtifactsButton() {
  const on = useUI((u) => u.pane === 'artifacts')
  return <IB icon="doc" label="Artifacts" pressed={on} onClick={() => togglePane('artifacts')} />
}

export default definePlugin({
  name: 'artifacts',
  setup(reg) {
    reg.header.push({ order: 40, View: ArtifactsButton })
    reg.bar.push({ order: 20, pane: 'artifacts', label: 'Artifacts', icon: 'doc' })
    reg.panes.push({ id: 'artifacts', View: ArtifactsPane })
    reg.views.tile = Tile
    reg.messageParts.push({ order: 50, View: InChat })
    reg.middle.push({ when: (ui) => ui.artWide && !!ui.art, View: Middle })
  },
})

export { cx, I }
