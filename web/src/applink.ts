// A link that points at this same app (an artifact's, a task's or a space's own address, what `herdr-artifact link`
// prints) opens inside the app: no reload, the chat stays where it was, and Back returns (SHEP-339). Only links to
// other sites open a new tab.

/** the app's own folder: `/shepherdr/` for `/shepherdr/`, `/shepherdr/index.html` or `/shepherdr` */
const base = (path: string) => path.replace(/\/index\.html$/, '/').replace(/\/?$/, '/')

/** `href` as a URL when it is this app's own address (same origin and base path), else null */
export function appLink(href: string, here: string): URL | null {
  let u: URL, h: URL
  try {
    h = new URL(here)
    u = new URL(href, h)
  } catch {
    return null
  }
  if (u.origin !== h.origin || base(u.pathname) !== base(h.pathname)) return null
  return u
}

/** a link to another site (http or https), which opens in a new tab */
export function outsideLink(href: string, here: string): boolean {
  try {
    const u = new URL(href, here)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== new URL(here).origin
  } catch {
    return false
  }
}

export interface LinkClick {
  defaultPrevented: boolean
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
  preventDefault(): void
}

/** a plain click (no modifier: a ctrl or cmd click still opens a new tab) on a link, caught: `open` gets this app's
    links, and another site's link without a target opens in a new tab rather than in place of the app */
export function catchLink(e: LinkClick, here: string, open: (u: URL) => void, newTab: (href: string) => void): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || a.hasAttribute('download')) return false
  const href = a.getAttribute('href')!
  if (href.startsWith('#')) return false
  const u = appLink(href, here)
  if (u) {
    e.preventDefault()
    open(u)
    return true
  }
  if (outsideLink(href, here) && !a.target) {
    e.preventDefault()
    newTab(new URL(href, here).href)
    return true
  }
  return false
}
