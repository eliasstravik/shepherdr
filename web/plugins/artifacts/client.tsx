// Artifacts: things made to keep. An artifact is a web page an agent writes (an HTML file and the files beside it);
// Shepherdr keeps and serves it, in a frame that cannot reach the app itself. The pane lists them as picture tiles
// (search, pinned ones on top); one opens in the pane as the real page it is, with its version, Mark up (the speech
// bubble) and a menu. The same tile shows a page in a chat and a task's proof on its review card.
import { useEffect, useRef, useState } from 'react'
import { PaneFrame } from '@client/App.tsx'
import { renameDialog } from '@client/list.tsx'
import { definePlugin, getState, notice, openArtifact, openLink, setUI, togglePane, tryAct, useSnap, useUI } from '@client/kernel.ts'
import { confirm, openDialog, openMenu } from '@client/overlay.tsx'
import { Btn, cx, Empty, Hd, I, IB, Row } from '@client/ui.tsx'
import { copyText } from '@client/copy.ts'
import { appLink } from '@client/applink.ts'
import { useDark } from '@client/prefs.ts'
import type { Artifact, Chat, Message } from '@shared/types.ts'
import { agoShort, artifactsIn, isEverything, spaceLabel } from '@shared/view.ts'
import { failed, firstLines, loaded, startShot, type Shot } from './preview.ts'

const on = (a: Artifact) => (a.machine ? `&on=${encodeURIComponent(a.machine)}` : '')
/** the page itself, at a version */
export const pageUrl = (a: Artifact, v: number) => `api/artifacts/${encodeURIComponent(a.id)}/page/?v=${v}${on(a)}`
/** the picture of the page taken when it was published */
const thumbUrl = (a: Artifact, dark: boolean, tries = 0) =>
  `api/artifacts/${encodeURIComponent(a.id)}/thumb?v=${a.v}${dark ? '&dark=1' : ''}${on(a)}${tries ? `&try=${tries}` : ''}`

// a page's first lines, read once per version (a tile shows them when its version has no picture)
const lines = new Map<string, Promise<{ text: string; head: boolean }[]>>()
function linesOf(a: Artifact) {
  const k = `${a.machine ?? ''}|${a.id}|${a.v}`
  let p = lines.get(k)
  if (!p) {
    p = fetch(pageUrl(a, a.v)).then((r) => (r.ok ? r.text() : '')).then((h) => firstLines(h)).catch(() => [])
    lines.set(k, p)
  }
  return p
}

/** A tile's picture, never a broken one (SHEP-344): a calm empty frame until it has loaded, a few tries again, else
 *  the page's first lines (preview.ts). */
export function Preview({ a, dark }: { a: Artifact; dark: boolean }) {
  const key = `${a.machine ?? ''}|${a.id}|${a.v}|${a.thumb ? 1 : 0}`
  const [shot, setShot] = useState<{ key: string; s: Shot }>({ key, s: startShot(!!a.thumb) })
  const s = shot.key === key ? shot.s : startShot(!!a.thumb)
  const [words, setWords] = useState<{ key: string; l: { text: string; head: boolean }[] } | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current) }, [key])
  useEffect(() => {
    if (s.shown !== 'lines') return
    let live = true
    void linesOf(a).then((l) => live && setWords({ key, l }))
    return () => { live = false }
  }, [key, s.shown])
  const onError = () => {
    const { shot: next, retryIn } = failed(s)
    if (retryIn === null) return setShot({ key, s: next })
    retry.current = setTimeout(() => setShot({ key, s: next }), retryIn)
  }
  const l = words?.key === key ? words.l : null
  return (
    <span className={cx('prev', s.shown === 'wait' && 'wait')}>
      {s.shown !== 'lines' && (
        <img key={s.tries} src={thumbUrl(a, dark, s.tries)} alt="" loading="lazy" className={s.shown === 'pic' ? 'in' : undefined}
          onLoad={() => setShot({ key, s: loaded(s) })} onError={onError} />
      )}
      {s.shown === 'lines' && !!l?.length && (
        <span className="plines" aria-hidden="true">{l.map((x, i) => <span key={i} className={x.head ? 'h' : undefined}>{x.text}</span>)}</span>
      )}
    </span>
  )
}

/** the older version a chat's card was posted with, still kept; null: the newest (or one no longer kept) */
export const postedVersion = (a: Artifact, v?: number) => (v && v < a.v ? a.versions.find((x) => x.n === v) ?? null : null)

/** a page as a picture tile: a small picture of the page, its title, when it was updated; tap to open. In a chat, the
 *  version it was posted with (v): an older one shows and opens that version, not the newest. */
export function Tile({ id, v }: { id: string; v?: number }) {
  const snap = useSnap()
  const dark = useDark()
  const a = snap?.artifacts.find((x) => x.id === id)
  if (!snap || !a) return null
  const old = postedVersion(a, v)
  // an older version's own picture (a missing one falls back to its first lines)
  const shown = old ? { ...a, v: old.n, thumb: true } : a
  return (
    <button type="button" className="tile" onClick={() => openArtifact(a.id, old ? old.n : null)}>
      <Preview a={shown} dark={dark} />
      <span className="l1" style={{ fontWeight: 500 }}>{a.title}</span>
      <span className="l2">{old ? `Version ${old.n} · ` : ''}{spaceLabel(snap, a.place)} · {agoShort(old?.at ?? a.at)}</span>
    </button>
  )
}

/** a page an agent made shows in the chat as its tile, at the version it came with */
function InChat({ msg }: { msg: Message; chat: Chat }) {
  if (!msg.artifact) return null
  return <div className="atile"><Tile id={msg.artifact.id} v={msg.artifact.v} /></div>
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

/** What the page's frame says (the link catcher the service puts first in every artifact page): a link to open, and
 *  whether it shows a page of the artifact. "link": another site in a new tab, this app's own (an artifact, a task, a
 *  space) in place; "inside": the next load is the artifact's own file (a picture or a PDF says nothing). */
export function onFrameSaid(d: unknown, here: string, open: (href: string) => void, newTab: (href: string) => void): 'page' | 'inside' | null {
  const m = d as { shepherdr?: unknown; href?: unknown } | null
  if (!m || typeof m !== 'object') return null
  if (m.shepherdr === 'link' && typeof m.href === 'string') {
    if (appLink(m.href, here)) open(m.href)
    else if (/^https?:\/\//i.test(m.href)) newTab(m.href)
    return null
  }
  return m.shepherdr === 'page' || m.shepherdr === 'inside' ? m.shepherdr : null
}

/** what the page says about a tap while marking up (its link catcher): where on the whole page, as fractions */
export function spotOf(d: unknown): { x: number; y: number } | null {
  const m = d as { shepherdr?: unknown; x?: unknown; y?: unknown } | null
  if (!m || typeof m !== 'object' || m.shepherdr !== 'spot' || typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return null
  const f = (n: number) => Math.min(1, Math.max(0, n))
  return { x: f(m.x), y: f(m.y) }
}

/** The page, in a frame that cannot reach the app. Marking up: tap the page to drop a pin, then write. The page's own
 *  link catcher takes the tap and draws the pin (SHEP-464: a layer over the frame stopped it scrolling), so the page
 *  scrolls as ever while the box is open. A frame that ends on a page it can't show (another site that refuses
 *  frames, sent there by the page's own script) gets a calm notice with Back to the artifact, never a dead grey panel. */
function Page({ a, v, markup, setPin }: { a: Artifact; v: number; markup: boolean; setPin: (p: { x: number; y: number } | null) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [load, setLoad] = useState(0)
  const [lost, setLost] = useState(false)
  // when the frame last said it shows a page of the artifact (its catcher says so as the page starts and on its load),
  // whether a tap sent it to the artifact's own file, and the timer that looks after a load
  const said = useRef(0)
  const inside = useRef(false)
  const look = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    inside.current = false
    setLost(false)
    return () => { if (look.current) clearTimeout(look.current) }
  }, [a.id, v, load])
  // marking up or not, told to the page (again whenever a page of it starts: it says so)
  const marking = useRef(markup)
  marking.current = markup
  const tell = () => frame.current?.contentWindow?.postMessage({ shepherdr: 'markup', on: marking.current }, '*')
  useEffect(tell, [markup])
  // a page can send the person's answer back to its agent: parent.postMessage({ shepherdr: 'answer', text }, '*')
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { shepherdr?: string; text?: unknown } | null
      const what = onFrameSaid(d, location.href, (href) => openLink(href, true), (href) => void window.open(href, '_blank', 'noopener,noreferrer'))
      if (what === 'page') { said.current = Date.now(); setLost(false); tell() }
      else if (what === 'inside') inside.current = true
      const spot = marking.current ? spotOf(d) : null
      if (spot) setPin(spot)
      if (d?.shepherdr !== 'answer' || typeof d.text !== 'string' || !d.text.trim()) return
      void tryAct({ type: 'artifact-say', place: a.place, artifact: a.id, v, text: d.text.slice(0, 4000) }, 'Sent to the agent that made it')
    }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [a.id, a.place, v])
  // after each load, a moment for the page's word (it comes just before or just after the load; a message sent as the
  // frame leaves a page can't be told from another's, so there's none): no word near the load, and no tap to the
  // artifact's own file, is a page that can't be shown here
  const loaded = () => {
    const at = Date.now()
    if (look.current) clearTimeout(look.current)
    look.current = setTimeout(() => {
      setLost(Math.abs(said.current - at) > 1000 && !inside.current)
      inside.current = false
    }, 1200)
  }
  return (
    <div className="pagebox">
      <iframe key={`${a.id}|${v}|${load}`} ref={frame} className="page" title={a.title} src={pageUrl(a, v)} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" onLoad={loaded} />
      {lost && (
        <div className="page-lost empty" role="status">
          <b>Couldn't show this page</b>
          <span>It doesn't open inside Shepherdr.</span>
          <div className="acts"><Btn kind="pri" onClick={() => setLoad(load + 1)}>Back to the artifact</Btn></div>
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
      <Page a={a} v={v} markup={markup} setPin={setPin} />
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
    // G A (Linear's and GitHub's "go to")
    reg.commands.push({ id: 'artifacts.open', title: 'Open Artifacts', area: 'Go to', icon: 'doc', keys: ['G A'], words: 'pages pane proofs', run: () => setUI((ui) => (ui.pane === 'artifacts' && !ui.art ? {} : { pane: 'artifacts', art: null, task: null, artWide: false })) })
    reg.header.push({ order: 40, View: ArtifactsButton })
    reg.bar.push({ order: 20, pane: 'artifacts', label: 'Artifacts', icon: 'doc' })
    reg.panes.push({ id: 'artifacts', View: ArtifactsPane })
    reg.views.tile = Tile
    reg.messageParts.push({ order: 50, View: InChat })
    reg.middle.push({ when: (ui) => ui.artWide && !!ui.art, View: Middle })
  },
})

export { cx, I }
