// Everything that opens over the app: a menu (a popover anchored to its button on a desktop, a sheet rising from the
// bottom on a phone), a dialog (400 px, or 560 px for a picker; a sheet on a phone) and a confirmation. One stack: the
// top one takes Escape and the scrim's tap. Sheets slide up 200 ms, popovers and dialogs fade 120 ms, only as they open.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useUI, type MenuRow } from './kernel.ts'
import { Btn, cx, I, Row } from './ui.tsx'
import { KeysOf } from './kbd.tsx'

interface Layer {
  id: number
  kind: 'menu' | 'dialog'
  /** what opened a menu: it anchors there, and the same button pressed again closes it */
  anchor?: Element | null
  wide?: boolean
  /** a dialog without the form's own padding and gaps (search, the picker) */
  bare?: boolean
  /** a picture or file shown on its own, over the whole screen (chat/preview.tsx) */
  view?: boolean
  label?: string
  /** a small menu that floats at its button on a phone too, above it where it fits (a message's emoji strip) */
  float?: boolean
  /** a menu kept inside this box (its panel) and lined up with its button's end, as tall as the room under it allows
   *  (its own body scrolls): the Tasks filter */
  within?: Element | null
  render: (close: () => void) => ReactNode
  onClose?: () => void
}

let layers: Layer[] = []
/** a menu or dialog is open: the app's single-key shortcuts wait */
export const hasLayer = () => layers.length > 0
let seq = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

function close(id: number) {
  const l = layers.find((x) => x.id === id)
  if (!l) return
  layers = layers.filter((x) => x.id !== id)
  l.anchor?.removeAttribute('aria-expanded')
  l.onClose?.()
  emit()
}

/** close whatever is on top; false when nothing was open */
export function closeTop(): boolean {
  const top = layers[layers.length - 1]
  if (!top) return false
  close(top.id)
  return true
}

export function closeAll() {
  for (const l of [...layers]) close(l.id)
}

export const anyOpen = () => layers.length > 0

/** what is open now, bottom first (for tests) */
export const layersNow = (): readonly Layer[] => layers

/** Open a menu at its button. Its rows, or anything drawn (`render`); `cap`: a quiet line on top; `top`: above the rows. */
export function openMenu(anchor: Element | null, rows: MenuRow[] | ((close: () => void) => ReactNode), opts: { cap?: string; top?: (close: () => void) => ReactNode; label?: string; float?: boolean; within?: Element | null } = {}) {
  // the same button again closes it
  const was = anchor && layers.find((l) => l.kind === 'menu' && l.anchor === anchor)
  if (was) return close(was.id)
  for (const l of layers.filter((x) => x.kind === 'menu')) close(l.id)
  const id = seq++
  // the space's name and the filter show they are open; a row's ⋯ stays as it is
  if (anchor?.matches('.tbtn, .hpath, [data-marks]')) anchor.setAttribute('aria-expanded', 'true')
  layers = [...layers, { id, kind: 'menu', anchor, label: opts.label, float: opts.float, within: opts.within, render: (done) => (typeof rows === 'function' ? rows(done) : <MenuRows rows={rows} close={done} cap={opts.cap} top={opts.top?.(done)} />) }]
  emit()
}

/** Open a dialog: 400 px on a desktop (560 px `wide`), a sheet on a phone. Returns its close. */
export function openDialog(render: (close: () => void) => ReactNode, opts: { wide?: boolean; bare?: boolean; view?: boolean; label?: string; onClose?: () => void } = {}): () => void {
  for (const l of layers.filter((x) => x.kind === 'menu')) close(l.id)
  const id = seq++
  layers = [...layers, { id, kind: 'dialog', render, ...opts }]
  emit()
  return () => close(id)
}

/** Open a dialog whose body keeps its own state (fields, a choice): `Form` is one component for the dialog's whole life.
 *  Defined inside a dialog's render, it would be a new component each time the app redraws, and React would put new
 *  fields in place of the old: the field being typed in loses its focus. On a phone the keyboard coming up redraws the
 *  app, so the keyboard closed at once and nothing could be typed (SHEP-308). */
export function openForm(Form: (p: { close: () => void }) => ReactNode, opts: { wide?: boolean; bare?: boolean; label?: string; onClose?: () => void } = {}): () => void {
  return openDialog((close) => <Form close={close} />, opts)
}

/** "Are you sure?", asked only before what can't be undone */
export function confirm(o: { title: string; body: ReactNode; ok: string; danger?: boolean; run: () => void | Promise<unknown> }) {
  openDialog(
    (done) => (
      <>
        <h2>{o.title}</h2>
        <p>{o.body}</p>
        <div className="acts">
          <Btn onClick={done}>Cancel</Btn>
          <Btn
            kind={o.danger ? 'danger' : 'pri'}
            onClick={() => {
              done()
              void o.run()
            }}
          >
            {o.ok}
          </Btn>
        </div>
      </>
    ),
    { label: o.title },
  )
}

/** a menu's rows: a row with `sub` folds open in place (Move to group) */
export function MenuRows({ rows, close: done, cap, top }: { rows: MenuRow[]; close: () => void; cap?: string; top?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      {top}
      {top && rows.length > 0 && <hr />}
      {cap && <div className="cap">{cap}</div>}
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'contents' }}>
          {r.line && <hr />}
          {r.sub ? (
            <>
              <Row icon={r.icon} label={r.label} expanded={open === r.label} end={<I n={open === r.label ? 'down' : 'right'} c="s16" />} role="menuitem" onClick={() => setOpen(open === r.label ? null : r.label)} />
              {open === r.label &&
                r.sub.map((s) => (
                  <Row
                    key={s.label}
                    label={s.label}
                    style={{ paddingLeft: 36 }}
                    role="menuitem"
                    onClick={() => {
                      done()
                      s.run?.()
                    }}
                  />
                ))}
            </>
          ) : (
            <Row
              icon={r.icon}
              label={r.label}
              value={r.value}
              danger={r.danger}
              // a view it opens: a check at its end while that view is open
              end={(r.on || r.cmd) && <>{r.cmd && <KeysOf id={r.cmd} />}{r.on && <I n="check" c="s16" />}</>}
              {...(r.on === undefined ? { role: 'menuitem' } : { role: 'menuitemcheckbox', 'aria-checked': r.on })}
              onClick={() => {
                done()
                r.run?.()
              }}
            />
          )}
        </div>
      ))}
    </>
  )
}

/** a menu kept inside its panel: no wider than the panel less 8 px each side, its end lined up with its button's,
 *  under the button and only as tall as the room left (above it instead when there is much more room there) */
export function inside(pop: HTMLElement, t: DOMRect, box: DOMRect): { left: number; top: number } {
  const room = { left: Math.max(8, box.left + 8), right: Math.min(innerWidth - 8, box.right - 8) }
  pop.style.maxWidth = ''
  pop.style.maxHeight = ''
  const css = getComputedStyle(pop)
  const own = { w: parseFloat(css.maxWidth) || Infinity, h: parseFloat(css.maxHeight) || Infinity }
  pop.style.maxWidth = `${Math.max(0, Math.min(own.w, room.right - room.left))}px`
  const w = pop.offsetWidth
  const h = pop.offsetHeight
  const below = innerHeight - 8 - (t.bottom + 4)
  const above = t.top - 4 - 8
  const up = h > below && above > below * 1.5
  const max = Math.min(own.h, Math.max(120, up ? above : below))
  pop.style.maxHeight = `${max}px`
  const left = Math.min(Math.max(room.left, t.right - w), room.right - w)
  return { left, top: up ? t.top - 4 - Math.min(h, max) : t.bottom + 4 }
}

/** a popover placed at its button: under it, flipped above when it would leave the screen, kept on screen sideways */
function Popover({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const pop = ref.current
      if (!pop) return
      const t = layer.anchor?.getBoundingClientRect()
      if (!t) return setAt({ left: 16, top: 16 })
      if (layer.within) return setAt(inside(pop, t, layer.within.getBoundingClientRect()))
      const w = pop.offsetWidth
      const h = pop.offsetHeight
      const left = Math.min(Math.max(8, layer.float ? t.left + t.width / 2 - w / 2 : t.left), innerWidth - w - 8)
      let top = t.bottom + 4
      if (layer.float && t.top - h - 4 >= 8) top = t.top - h - 4
      else if (top + h > innerHeight - 8) top = Math.max(8, t.top - h - 4)
      setAt({ left, top })
    }
    place()
    addEventListener('resize', place)
    // a menu in a panel follows its own size too (a search narrowing its rows)
    const ro = layer.within && ref.current && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null
    if (ro && ref.current) ro.observe(ref.current.firstElementChild ?? ref.current)
    return () => {
      removeEventListener('resize', place)
      ro?.disconnect()
    }
  }, [layer])
  return (
    <div ref={ref} className="pop in" role="menu" aria-label={layer.label} style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}>
      {layer.render(() => close(layer.id))}
    </div>
  )
}

/** Escape's first takers, before the top layer closes: a dictation recording in a box (SHEP-314: Escape cancels it,
 *  not the Feedback dialog it's in). Each returns true when it took the key. */
export const escapeFirst = new Set<() => boolean>()

/** the stack, drawn once by the shell */
export function Layers() {
  const all = useSyncExternalStore(subscribe, () => layers)
  const phone = useUI((u) => u.phone)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      if ([...escapeFirst].some((f) => f()) || closeTop()) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [])
  return (
    <>
      {all.map((l) => {
        const done = () => close(l.id)
        if (l.kind === 'menu')
          return (
            <div key={l.id} style={{ display: 'contents' }}>
              <div className={cx('scrim', (!phone || l.float) && 'clear')} onClick={done} />
              {phone && !l.float ? (
                <div className="pop sheet in" role="menu" aria-label={l.label}>
                  {l.render(done)}
                </div>
              ) : (
                <Popover layer={l} />
              )}
            </div>
          )
        return (
          <div key={l.id} style={{ display: 'contents' }}>
            <div className="scrim" onClick={done} />
            <Dialog layer={l} phone={phone}>
              {l.render(done)}
            </Dialog>
          </div>
        )
      })}
    </>
  )
}

function Dialog({ layer, phone, children }: { layer: Layer; phone: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // the keyboard starts inside it: its first field, else the dialog itself
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const first = el.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea')
    ;(first ?? el).focus({ preventScroll: true })
  }, [])
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={layer.label} className={layer.view ? 'lbox in' : cx(phone ? 'pop sheet' : 'dlg', !phone && layer.wide && 'wide', phone && !layer.bare && 'form', 'in')}>
      {children}
    </div>
  )
}
