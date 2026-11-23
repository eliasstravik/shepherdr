// The links on a terminal's screen, over xterm: found again after each write or scroll (links.ts), each drawn as an
// underline in a layer of its own over the text, and found under a finger or the mouse. xterm never sees a pointer
// here (the box over it takes them all), so its own link handling never runs: this is it.
import type { IBufferCell, Terminal } from '@xterm/xterm'
import { findLinks, linkAt, withMarked, type Line, type Link } from './links.ts'

type Core = {
  _core?: {
    _oscLinkService?: { getLinkData(id: number): { uri: string } | undefined }
    _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } }
  }
}
type Marked = IBufferCell & { hasExtendedAttrs?(): number | boolean; extended?: { urlId?: number } }

/** rows above and below the screen's own read too, so an address that starts just out of sight is whole */
const MARGIN = 8

export interface LinkLayer {
  /** the link under this point of the page, if any */
  at(x: number, y: number): Link | null
  /** the link the mouse is over: underlined */
  hover(link: Link | null): void
  /** a link's place on the page (its first cell), for a menu to open at */
  rect(link: Link): DOMRect | null
  redraw(): void
  dispose(): void
}

/** `quiet`: underline every link (a touch screen), not only the one under the mouse */
export function linkLayer(term: Terminal, quiet: () => boolean): LinkLayer {
  const core = (term as unknown as Core)._core
  const root = term.element!
  const screen = root.querySelector<HTMLElement>('.xterm-screen')!
  const layer = document.createElement('div')
  layer.className = 'tlinks'
  layer.setAttribute('aria-hidden', 'true')
  root.appendChild(layer)
  let links: Link[] = []
  let hovered: Link | null = null
  let dirty = true
  let frame = 0

  const cell = () => {
    const c = core?._renderService?.dimensions?.css?.cell
    return c && c.width > 0 && c.height > 0 ? c : { width: screen.clientWidth / term.cols || 8, height: screen.clientHeight / term.rows || 17 }
  }

  const scan = () => {
    dirty = false
    const b = term.buffer.active
    const top = Math.max(0, b.viewportY - MARGIN)
    const end = Math.min(b.length, b.viewportY + term.rows + MARGIN)
    const lines: Line[] = []
    const marked = new Map<number, Link>()
    let c: Marked | undefined
    for (let y = top; y < end; y++) {
      const l = b.getLine(y)
      let text = ''
      const at: number[] = []
      for (let x = 0; l && x < term.cols; x++) {
        c = l.getCell(x, c) as Marked | undefined
        if (!c) break
        if (c.getWidth() === 0) continue
        const ch = c.getChars() || ' '
        text += ch
        for (let k = 0; k < ch.length; k++) at.push(x)
        // a reused cell keeps the last one's extras: only a cell that has its own carries a link
        const id = c.hasExtendedAttrs?.() ? c.extended?.urlId : 0
        if (!id) continue
        const uri = core?._oscLinkService?.getLinkData(id)?.uri
        if (!uri) continue
        const link = marked.get(id) ?? { url: uri, parts: [] }
        marked.set(id, link)
        const p = link.parts.at(-1)
        if (p && p.row === y && p.to === x) p.to = x + c.getWidth()
        else link.parts.push({ row: y, from: x, to: x + c.getWidth() })
      }
      lines.push({ text, at, wrapped: !!l?.isWrapped })
    }
    links = withMarked(findLinks(lines, term.cols, top), [...marked.values()])
    if (hovered) hovered = links.find((x) => x.url === hovered!.url) ?? null
  }

  const draw = () => {
    if (dirty) scan()
    const { width, height } = cell()
    const vy = term.buffer.active.viewportY
    const shown = quiet() ? links : hovered ? [hovered] : []
    const marks: HTMLElement[] = []
    for (const l of shown)
      for (const p of l.parts) {
        if (p.row < vy || p.row >= vy + term.rows) continue
        const m = document.createElement('i')
        m.className = l === hovered ? 'on' : ''
        m.style.cssText = `left:${screen.offsetLeft + p.from * width}px;top:${screen.offsetTop + (p.row - vy) * height}px;width:${(p.to - p.from) * width}px;height:${height}px`
        marks.push(m)
      }
    layer.replaceChildren(...marks)
  }
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw() })
  }
  const changed = () => {
    dirty = true
    soon()
  }
  const subs = [term.onWriteParsed(changed), term.onScroll(changed), term.onResize(changed), term.onRender(soon)]
  soon()

  return {
    at(x, y) {
      if (dirty) scan()
      const r = screen.getBoundingClientRect()
      const { width, height } = cell()
      if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null
      return linkAt(links, Math.floor((y - r.top) / height) + term.buffer.active.viewportY, Math.floor((x - r.left) / width))
    },
    hover(l) {
      if (l?.url === hovered?.url) return
      hovered = l
      soon()
    },
    rect(l) {
      const p = l.parts[0]
      if (!p) return null
      const r = screen.getBoundingClientRect()
      const { width, height } = cell()
      return new DOMRect(r.left + p.from * width, r.top + (p.row - term.buffer.active.viewportY) * height, (p.to - p.from) * width, height)
    },
    redraw: soon,
    dispose() {
      cancelAnimationFrame(frame)
      subs.forEach((s) => s.dispose())
      layer.remove()
    },
  }
}
