// Tap check (SHEP-317): every tappable thing on a touch screen is comfortable to hit. Opens the built demo in a
// headless Chrome that says its pointer is a finger, at a phone's and a tablet's width, walks the screens (the list,
// a chat, the panes, menus, sheets, settings) and fails when something you can tap gives a finger less than MIN px
// either way, or when the list's machine headings lose their even rhythm. A button's hit area counts its ::before
// (the invisible pad a light-looking icon gets on a touch screen).
//
//   bun run build && bun web/demo/tap-check.ts [--report <file.json>] [--before]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (GitHub's runners have one).
// --before: report only, never fail (for measuring an older build).
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright-core'

export const MIN = 44

/** Allowed under MIN, each for a reason. Matched with Element.matches. */
export const ALLOW: { sel: string; why: string }[] = [
  { sel: '.md a, .md code, .b .lk, .card .lk, .status .lk, .status .wtag, .card .s .wtag, .donerow .lk', why: 'a link inside running text: its line is the target, like any web page' },
  { sel: '.xterm *, .termbox *', why: 'the terminal itself (xterm), typed into, not tapped' },
  { sel: '.page, .scr *, .veil', why: 'a live page or screen: its own content decides' },
  { sel: '.b', why: 'a message: as big as its words, tapped anywhere for its menu' },
  { sel: '.vh, .vh *', why: 'visually hidden: for screen readers only' },
]

const root = fileURLToPath(new URL('../../', import.meta.url))

export function chrome(): string {
  if (process.env.CHROME) return process.env.CHROME
  const ab = join(homedir(), '.agent-browser', 'browsers')
  if (existsSync(ab)) {
    const v = readdirSync(ab).filter((d) => d.startsWith('chrome-')).sort().pop()
    if (v && existsSync(join(ab, v, 'chrome'))) return join(ab, v, 'chrome')
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (existsSync(p)) return p
  throw new Error('no Chrome found: set CHROME')
}

type Hit = { scene: string; width: number; what: string; w: number; h: number }

/** every visible, tappable element on the page now, with its hit area */
async function measure(page: Page, allow: string[]) {
  return page.evaluate(({ allow, MIN }) => {
    const SEL = 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], summary, input:not([type="hidden"]), textarea, select, label[for]'
    const out: { what: string; w: number; h: number; ok: boolean }[] = []
    const seen = new Set<Element>()
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(SEL))) {
      if (seen.has(el)) continue
      seen.add(el)
      if (el.closest('[aria-hidden="true"], [inert]')) continue
      if ((el as HTMLButtonElement).disabled) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 && !el.matches('.tcap, input[type="file"]')) continue
      if (el.matches('input[type="file"]')) continue
      // on screen and on top somewhere (not under a sheet or scrolled away)
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
      const top = document.elementFromPoint(cx, cy)
      if (!top || !(el === top || el.contains(top) || top.contains(el))) continue
      // cut off by the edge of what scrolls it: a scroll away from whole, not measured
      let sc = el.parentElement
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      if (sc) { const v = sc.getBoundingClientRect(); if (r.top < v.top - 0.5 || r.bottom > v.bottom + 0.5) continue }
      // partly under a surface (scrolled behind the message box or a header): a scroll away from whole, not measured
      const target = (t: Element | null) => !!t && !!t.closest(SEL)
      const qx = r.width / 4, qy = r.height / 4 // a quarter in: inside a round button's circle too
      const corners = [[r.left + qx, r.top + qy], [r.right - qx, r.top + qy], [r.left + qx, r.bottom - qy], [r.right - qx, r.bottom - qy]]
      if (corners.some(([x, y]) => {
        if (x! < 0 || y! < 0 || x! >= innerWidth || y! >= innerHeight) return true
        const t = document.elementFromPoint(x!, y!)
        if (!t || t === el || el.contains(t)) return false
        if (!target(t)) return true
        // another target over this one's own box (not only over its pad): this one is scrolled under it
        const o = t.closest(SEL)!.getBoundingClientRect()
        return Math.min(o.right, r.right) - Math.max(o.left, r.left) > 2 && Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top) > 2
      })) continue
      // what a finger really hits: from the middle, how far each way the page still answers with this element (its
      // ::before pad included, a neighbour's pad or a clipping parent taken off); the screen's edge counts as open
      const mine = (x: number, y: number) => {
        const t = document.elementFromPoint(x, y)
        return !!t && (t === el || el.contains(t))
      }
      const span = (dx: number, dy: number) => {
        let n = 0
        for (; n < 40; n++) {
          const x = cx + dx * (n + 1), y = cy + dy * (n + 1)
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 40
          if (!mine(x, y)) break
        }
        return n
      }
      const w = 1 + span(-1, 0) + span(1, 0)
      const h = 1 + span(0, -1) + span(0, 1)
      const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.getAttribute('placeholder') || ''
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
      const what = `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${label}"`
      const allowed = allow.some((s) => el.matches(s))
      out.push({ what, w: Math.round(w), h: Math.round(h), ok: allowed || Math.min(w, h) >= MIN - 1 })
    }
    return out
  }, { allow, MIN })
}

type Scene = { name: string; path?: string; steps?: string[]; wide?: boolean }

/** a step: `label:<aria-label>`, `text:<visible words>` or a CSS selector; `phone-list` opens a phone's list of spaces
 *  (a no-op where the list is already out); `attach` puts a file in the message box; `dictate` starts the recorder with
 *  a stand-in microphone */
export async function step(p: Page, st: string) {
  const phone = (p.viewportSize()?.width ?? 1000) < 768
  if (st === 'phone-list') return phone ? p.locator('[aria-label="Spaces"]').first().click({ timeout: 3000 }) : undefined
  if (st === 'attach') return p.locator('.chat input[type="file"], input[type="file"]').first().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('demo') })
  const loc = st.startsWith('label:') ? p.locator(`[aria-label="${st.slice(6)}"]`) : st.startsWith('text:') ? p.getByText(st.slice(5), { exact: true }) : p.locator(st)
  const vis = loc.locator('visible=true').first()
  await vis.click({ timeout: 3000 })
}

/** the screens walked at every width; each starts from a fresh load */
export const SCENES: Scene[] = [
  { name: 'Everything' },
  { name: 'warnings', path: '/?case=more' },
  { name: 'list', steps: ['phone-list'] },
  { name: 'list filter', steps: ['phone-list', '[aria-label^="Show which spaces"]'] },
  { name: 'space menu', steps: ['phone-list', 'label:More for blog'] },
  { name: 'new space', steps: ['phone-list', '[aria-label^="New space on"]'] },
  { name: 'a space', steps: ['phone-list', '[data-project] .row:has-text("blog")'] },
  { name: 'search', steps: ['phone-list', 'label:Search'] },
  { name: 'header title', steps: ['.tbtn'] },
  { name: 'tasks', steps: ['[aria-label="Tasks"], .pt:has-text("Tasks")'] },
  { name: 'tasks filter', steps: ['[aria-label="Tasks"], .pt:has-text("Tasks")', '[aria-label^="Filter tasks"]'] },
  { name: 'a task', steps: ['[aria-label="Tasks"], .pt:has-text("Tasks")', '.pane .row.tk >> nth=0'] },
  { name: 'artifacts', steps: ['[aria-label="Artifacts"], .pt:has-text("Artifacts")'] },
  { name: 'an artifact', steps: ['[aria-label="Artifacts"], .pt:has-text("Artifacts")', '.pane .tile >> nth=0'] },
  { name: 'terminal', steps: ['label:Terminal'] },
  { name: 'screen', steps: ['label:Screen'] },
  { name: 'agent menu', steps: ['.agent'] },
  { name: 'message menu', steps: ['.b.mine'] },
  { name: 'attachment', steps: ['attach'] },
  { name: 'preview', steps: ['.atb'] },
  { name: 'dictation', steps: ['label:Dictate'] },
  { name: 'settings', steps: ['phone-list', 'text:Settings'] },
  { name: 'settings: spaces', steps: ['phone-list', 'text:Settings', '.win .nav .row >> nth=1'] },
  { name: 'settings: agents', steps: ['phone-list', 'text:Settings', '.win .nav .row >> nth=2'] },
  { name: 'settings: machines', steps: ['phone-list', 'text:Settings', '.win .nav .row >> nth=3'] },
  { name: 'settings: more', steps: ['phone-list', 'text:Settings', '.win .nav .row >> nth=4'] },
  { name: 'feedback', steps: ['phone-list', 'text:Feedback'] },
]

/** a microphone that hums, so the recorder opens without a real one */
export const MIC = `(() => {
  const md = navigator.mediaDevices
  if (!md) return
  md.getUserMedia = async () => {
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination()
    o.connect(d); o.start(); return d.stream
  }
})()`

/** the list's machine headings keep one rhythm (SHEP-317): the same height, the same room above whatever came before
 *  (another heading, a space, a group), and less room below, so a machine's spaces sit with it. Returns what's off. */
export async function rhythm(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll<HTMLElement>('.side, .drawer')).find((e) => e.getBoundingClientRect().width > 0)
    if (!list) return ['no list on screen']
    const items: HTMLElement[] = []
    const walk = (el: Element) => { for (const c of Array.from(el.children) as HTMLElement[]) getComputedStyle(c).display === 'contents' ? walk(c) : items.push(c) }
    walk(list)
    const vis = items.filter((e) => e.getBoundingClientRect().height > 0)
    const off: string[] = []
    // a machine's heading: its label, or the button it becomes with a warning mark
    const head = (e: Element) => e.matches('.lab[data-heading^="m:"], button.row.lab')
    const hs = vis.map((e, i) => ({ e, i })).filter(({ e }) => head(e))
    if (hs.length < 2) return ['fewer than two machine headings']
    const r = (e: HTMLElement) => e.getBoundingClientRect()
    const name = (e: HTMLElement) => e.textContent?.trim() || '?'
    // the words of a heading, where the eye reads the gaps from (a heading's box may be taller than its words)
    const words = (e: HTMLElement) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect() }
    const h0 = r(hs[0]!.e).height
    const above = hs.filter(({ i }) => i > 0).map(({ e, i }) => ({ e, gap: Math.round(words(e).top - r(vis[i - 1]!).bottom) }))
    const a0 = above[0]!.gap
    for (const { e } of hs) if (Math.abs(r(e).height - h0) > 1) off.push(`${name(e)}: ${r(e).height}px tall, not ${h0}`)
    for (const { e, gap } of above) if (Math.abs(gap - a0) > 1) off.push(`${name(e)}: ${gap}px above it, not ${a0}`)
    for (const { e, i } of hs) {
      const next = vis[i + 1]
      if (!next || head(next) || next.classList.contains('foot')) continue
      const below = Math.round(r(next).top - words(e).bottom)
      if (below >= a0) off.push(`${name(e)}: ${below}px down to its spaces, not less than the ${a0}px above it`)
    }
    return off
  })
}

async function main() {
  const args = process.argv.slice(2)
  const before = args.includes('--before')
  const ri = args.indexOf('--report')
  const report = ri >= 0 ? args[ri + 1] : null
  // a port nobody uses now (another demo or service may hold a fixed one)
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', join(root, 'web/demo/serve.ts'), String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* not yet */ }
    await Bun.sleep(100)
  }
  const browser = await chromium.launch({ executablePath: chrome(), args: ['--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2'] })
  const bad: Hit[] = []
  const all: Hit[] = []
  const skipped: string[] = []
  const rhythmOff: string[] = []
  try {
    // the three widths at once, each in its own window; every screen starts from a fresh load with nothing remembered
    await Promise.all(([[390, 844], [820, 1180], [1024, 1366]] as const).map(async ([width, height]) => {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true })
      await ctx.addInitScript(MIC)
      await ctx.addInitScript(() => { try { localStorage.clear() } catch { /* none */ } })
      const page = await ctx.newPage()
      for (const s of SCENES) {
        if (s.wide && width < 768) continue // a phone has no such button
        await page.goto(base + (s.path ?? '/'), { waitUntil: 'networkidle' })
        await page.waitForTimeout(200)
        try {
          for (const st of s.steps ?? []) { await step(page, st); await page.waitForTimeout(300) }
        } catch {
          skipped.push(`${width}px · ${s.name}`)
          continue
        }
        if (s.name === 'list') for (const o of await rhythm(page)) rhythmOff.push(`${width}px · ${o}`)
        for (const m of await measure(page, ALLOW.map((a) => a.sel))) {
          const hit = { scene: s.name, width, what: m.what, w: m.w, h: m.h }
          all.push(hit)
          if (!m.ok) bad.push(hit)
        }
      }
      await ctx.close()
    }))
    // the desktop, with a mouse: the same rhythm, denser
    const fine = await chromium.launch({ executablePath: chrome() })
    const page = await (await fine.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    for (const o of await rhythm(page)) rhythmOff.push(`1280px (mouse) · ${o}`)
    await fine.close()
  } finally {
    await browser.close()
    server.kill()
  }
  const key = (h: Hit) => `${h.width} ${h.what} ${h.w}x${h.h}`
  const uniq = [...new Map(bad.map((h) => [key(h), h])).values()]
  if (report) writeFileSync(report, JSON.stringify({ min: MIN, all, bad: uniq }, null, 1))
  console.log(`tap check: ${all.length} targets measured, ${uniq.length} under ${MIN} px`)
  if (skipped.length) console.log(`  couldn't open (not measured): ${skipped.join(', ')}`)
  for (const h of uniq) console.log(`  ${h.width}px · ${h.scene} · ${h.what}: ${h.w}×${h.h}`)
  console.log(`list rhythm: ${rhythmOff.length ? rhythmOff.length + ' off' : 'even'}`)
  for (const o of rhythmOff) console.log(`  ${o}`)
  if ((uniq.length || rhythmOff.length) && !before) process.exit(1)
}

if (import.meta.main) await main()
