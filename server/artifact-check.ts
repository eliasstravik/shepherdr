// Explicit-home artifact validation; importing this module never reads installation state.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CheckResult {
  /** what broke: script errors, and anything it tried to load from the network */
  errors: string[]
  /** console.error lines: said, not refused */
  warnings: string[]
  /** pictures, videos and the like wider than the page or taller than the screen at phone width: said, not refused */
  media?: string[]
  /** pictures at phone width, light and dark; none when there is no browser here */
  shots?: { light: string; dark: string }
  /** why it could not be checked */
  skipped?: string
}

export type Checker = (html: string, data?: unknown) => Promise<CheckResult>

/** a word that is lowercase on purpose stays so: code, commands, files, names like iOS or eBay */
const KEEP_CASE = /^[^\s]*([A-Z]|[./_@#`$<>=(){}\[\]~\\])/

/** a title starts with a capital, and so does what follows a task id ("SHE-90: proof" → "SHE-90: Proof") */
export function titleCase(title: string) {
  const up = (s: string) => (KEEP_CASE.test(s) ? s : s.replace(/^\p{Ll}/u, (c) => c.toUpperCase()))
  const t = title.trim()
  const m = /^((?:[\w.-]+[/:])?[A-Za-z][\w-]*-\d+:\s*)(.*)$/s.exec(t)
  return m ? m[1] + up(m[2]) : up(t)
}

const pattern = (text: string) => text.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('\\s+')
/** what sets a title's parts apart; a tight hyphen is inside a word */
const APART = String.raw`(?:\s*[:·•|,–—]\s*|\s+-\s+)`

/** a task's artifact says which task it is for, whatever its agent wrote: "SHE-2: Stop Goes in note · Proof". The task's
 *  name stays exactly as it is, once, before what the artifact is, so a cut-off title still says what it was for; used
 *  as a word inside a sentence ("Migration from v1 to v2" in task v1) it is left there, and that sentence stays whole */
export function taskArtifactTitle(title: string, task: { id: string; localId?: string; name: string }) {
  const id = task.localId || task.id, ids = [...new Set([task.id, task.id.replace('/', ':'), id])].map(pattern).join('|')
  const name = String.raw`(?<![\p{L}\p{N}-])${pattern(task.name)}(?![\p{L}\p{N}-])`
  const apart = new RegExp(String.raw`(?:${APART}|(?:^|\s+)(?:for|of|on|about)\s+|^)${name}(?:${APART})?`, 'iu'), inside = new RegExp(name, 'iu')
  const rest = title.trim().replace(new RegExp(String.raw`^(?:${ids})(?![\w-])${APART}?\s*`, 'i'), '')
  if (!apart.test(rest) && inside.test(rest)) return `${id}: ${titleCase(rest.replace(inside, () => task.name))}`
  const what = rest.replace(apart, ' ').replace(/\s{2,}/g, ' ').trim()
  return what ? `${id}: ${task.name} · ${titleCase(what)}` : `${id}: ${task.name}`
}

/** opens the page the way the app frames it, at phone width, light then dark: script errors and anything it tried to
 *  load are what breaks it */
export function artifactChecker(home: string, run: (args: string[]) => Promise<{ ok: boolean; out: string; err: string }>, wrap: (html: string, data?: unknown) => string, session = 'shep-artifacts'): Checker {
  // one browser, one check at a time: two at once would mix up their pages, pictures and errors
  let queue: Promise<unknown> = Promise.resolve()
  return (html, data) => {
    const turn = queue.then(() => checkOne(home, session, run, wrap, html, data))
    queue = turn.catch(() => undefined)
    return turn
  }
}

async function checkOne(home: string, session: string, run: (args: string[]) => Promise<{ ok: boolean; out: string; err: string }>, wrap: (html: string, data?: unknown) => string, html: string, data: unknown): Promise<CheckResult> {
  const dir = join(home, 'checks')
  mkdirSync(dir, { recursive: true })
  // the pictures are for the agent to look at now: a day later they go
  for (const f of readdirSync(dir))
    try {
      if (statSync(join(dir, f)).mtimeMs < Date.now() - 86_400_000) rmSync(join(dir, f), { force: true })
    } catch {
      /* gone already */
    }
  const stem = join(dir, `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`)
  const page = `${stem}.html`
  writeFileSync(page, wrap(html, data))
  const light = `${stem}.png`
  const dark = `${stem}-dark.png`
  const r = await run([
    '--session',
    session,
    'batch',
    'set viewport 390 844',
    'set media light',
    `open file://${page}`,
    'wait 400',
    `screenshot ${light}`,
    'set media dark',
    'wait 150',
    `screenshot ${dark}`,
    'eval JSON.stringify((window.__shepherdrMedia&&__shepherdrMedia(),window.__shepherdrCheck||[]))',
  ])
  rmSync(page, { force: true })
  if (!r.ok && !existsSync(light)) return { errors: [], warnings: [], skipped: `could not open a browser here (${(r.err || r.out).trim().split('\n')[0] || 'agent-browser failed'})` }
  // the last line is the list the page kept, printed as a JSON string
  let said: string[] = []
  let received = false
  for (const l of r.out.trim().split('\n').reverse()) {
    try {
      const v = JSON.parse(JSON.parse(l.trim()))
      if (Array.isArray(v)) {
        received = true
        said = v.map(String)
        break
      }
    } catch {
      /* not that line */
    }
  }
  const of = (k: string) => said.filter((s) => s.startsWith(k)).map((s) => s.slice(k.length))
  const errors = !received ? ['The browser did not return its validation result'] : said.filter((s) => !s.startsWith('console: ') && !s.startsWith('media: ')).slice(0, 12)
  if (!r.ok) errors.push('The browser check did not complete successfully')
  const warnings = of('console: ').slice(0, 8)
  const media = of('media: ').slice(0, 8)
  return { errors, warnings, media, shots: existsSync(light) && existsSync(dark) ? { light, dark } : undefined }
}

/** for the check: what the page itself reports, written into it before anything else runs */
export const CHECK_PROBE = `<script>(function(){var k=window.__shepherdrCheck=[];addEventListener('error',function(e){if(e.message)k.push('script error: '+e.message+(e.lineno?' (line '+e.lineno+')':''))});addEventListener('unhandledrejection',function(e){k.push('script error: '+(e.reason&&e.reason.message||e.reason))});addEventListener('securitypolicyviolation',function(e){k.push('blocked: '+(e.blockedURI||e.violatedDirective)+' (artifacts load nothing: put it inline)')});window.__shepherdrMedia=function(){var de=document.documentElement,W=de.clientWidth,H=innerHeight,n={};[].forEach.call(document.querySelectorAll('img,video,canvas,svg,iframe,embed,object'),function(el){var t=el.tagName.toLowerCase();n[t]=(n[t]||0)+1;if(el.ownerSVGElement)return;var r=el.getBoundingClientRect(),why=[];if(!r.width||!r.height)return;if(r.right>W+1||r.left<-1)why.push('wider than the page ('+W+' px)');if(r.height>H+1)why.push('taller than the screen ('+H+' px)');if(why.length)k.push('media: '+t+' '+n[t]+' ('+Math.round(r.width)+'×'+Math.round(r.height)+' px) is '+why.join(' and '))})};var ce=console.error;console.error=function(){k.push('console: '+[].map.call(arguments,String).join(' '));return ce.apply(console,arguments)}})()</script>`

