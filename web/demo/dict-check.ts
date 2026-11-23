// Dictation and call check (3.2.3's broken dictation): the built demo in a headless Chrome with a fake microphone (a
// voice-like wav), at a phone's and an open Fold's size, the Tasks panel closed, open, opened while recording, and on the
// other side. It fails when, while dictating or in a call:
// - the row (the wave, the time) leaves the message box, or a canvas's pixel count can widen it (3.2.3: it ran out
//   across the Tasks panel);
// - the microphone's level doesn't reach the wave (3.2.3: a flat row of dots);
// - Done / Cancel (or Mute / End call) aren't exactly the idle mic's and round button's size and place, or aren't the
//   app's own green and red;
// - the call's wave doesn't fill the row from the box's left up to the mic (3.2.3: a short strip at the left).
// Then the whole flow: Cancel drops it; Done puts the words at the box's cursor, the attachment kept.
//
//   bun run build && bun web/demo/dict-check.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** a mono 16 kHz wav: a tone that swells and fades like syllables, so the level comes and goes */
function voiceWav(secs = 20): Buffer {
  const rate = 16000
  const n = rate * secs
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const env = Math.max(0, Math.sin(t * 9)) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 2.3)))
    b.writeInt16LE(Math.round(20000 * env * Math.sin(2 * Math.PI * 220 * t)), 44 + i * 2)
  }
  return b
}

type R = { l: number; r: number; t: number; b: number; w: number; h: number }
type Look = { cbox: R; mic: R; main: R; parts: Record<string, R | null>; peak: number; colors: { mic: string; main: string; green: string; red: string } }

/** the box, its two buttons, the row's parts, how tall the wave's tallest bar is now, and the colours in use */
const look = (page: Page) =>
  page.evaluate((): Look => {
    const box = document.querySelector('.chat .cbox, .cbox')!
    const rect = (e: Element | null): R | null => {
      if (!e) return null
      const x = e.getBoundingClientRect()
      return { l: x.left, r: x.right, t: x.top, b: x.bottom, w: x.width, h: x.height }
    }
    const parts: Record<string, R | null> = {}
    for (const s of ['.dsurf', '.dwave', '.dtime', '.vin', '.vmark']) parts[s] = rect(box.querySelector(s))
    let peak = 0
    const cv = box.querySelector<HTMLCanvasElement>('.dwave canvas, .vmark canvas')
    if (cv?.width && cv.height) {
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
      let top = cv.height, bot = -1
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3]! > 0) { top = Math.min(top, y); bot = Math.max(bot, y) }
      peak = bot < 0 ? 0 : (bot - top + 1) / cv.height
    }
    const tok = (v: string) => {
      const s = document.createElement('i')
      s.style.color = `var(${v})`
      box.appendChild(s)
      const c = getComputedStyle(s).color
      s.remove()
      return c
    }
    const mic = box.querySelector('[data-slot=mic]')!, main = box.querySelector('[data-slot=main]')!
    return { cbox: rect(box)!, mic: rect(mic)!, main: rect(main)!, parts, peak, colors: { mic: getComputedStyle(mic).color, main: getComputedStyle(main).color, green: tok('--green'), red: tok('--red') } }
  })

/** a canvas's pixel count made huge: the row's layout must not move (the size must come from the box, not the canvas) */
const widened = (page: Page) =>
  page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('.cbox .dwave canvas, .cbox .vmark canvas')
    if (!cv) return null
    cv.width = 8000
    const x = (cv.parentElement as HTMLElement).getBoundingClientRect()
    return { w: x.width, boxR: document.querySelector('.cbox')!.getBoundingClientRect().right, r: x.right }
  })

const near = (a: number, b: number, d = 0.75) => Math.abs(a - b) <= d
const same = (a: R, b: R) => near(a.l, b.l) && near(a.t, b.t) && near(a.w, b.w) && near(a.h, b.h)
const inside = (p: R, box: R) => p.l >= box.l - 0.5 && p.r <= box.r + 0.5 && p.t >= box.t - 0.5 && p.b <= box.b + 0.5
const fmt = (r: R) => `${Math.round(r.l)}..${Math.round(r.r)} x ${Math.round(r.t)}..${Math.round(r.b)}`

type Scene = { name: string; w: number; h: number; dpr: number; panel: 'closed' | 'open' | 'later' | 'swapped' }
const SCENES: Scene[] = [
  { name: 'phone', w: 390, h: 844, dpr: 3, panel: 'closed' },
  { name: 'fold', w: 790, h: 820, dpr: 2.625, panel: 'closed' },
  { name: 'fold, Tasks open', w: 790, h: 820, dpr: 2.625, panel: 'open' },
  { name: 'fold, Tasks opened while recording', w: 790, h: 820, dpr: 2.625, panel: 'later' },
  { name: 'fold, chat on the right', w: 790, h: 820, dpr: 2.625, panel: 'swapped' },
]

async function scene(browser: Awaited<ReturnType<typeof chromium.launch>>, base: string, s: Scene, img: string, bad: string[]) {
  const no = (what: string) => bad.push(`${s.name}: ${what}`)
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr, hasTouch: true, isMobile: true, permissions: ['microphone'] })
  await ctx.addInitScript((swapped: boolean) => {
    try {
      localStorage.clear()
      if (swapped) localStorage.setItem('shepherdr.sides', JSON.stringify({ tablet: 'right', desktop: 'right' }))
    } catch { /* none */ }
  }, s.panel === 'swapped')
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  let sent = 0
  await page.route('**/api/dictate**', async (r) => {
    sent = r.request().postDataBuffer()?.length ?? 0
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'hello there' }) })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const tasks = () => page.locator('button[aria-label*="Tasks" i]').first().click()
  if (s.panel === 'open' || s.panel === 'swapped') { await tasks(); await page.waitForTimeout(300) }
  await page.locator('.cbox input[type=file]').first().setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  await page.waitForTimeout(300)
  const files = () => page.locator('.cbox .ath').count()
  const nFiles = await files()

  // idle, then dictating: the row inside the box, the buttons where they were, the level on the wave
  const idle = await look(page)
  await page.locator('.cbox [data-slot=mic]').first().click()
  if (s.panel === 'later') { await page.waitForTimeout(400); await tasks() }
  await page.waitForTimeout(2200)
  let now = await look(page)
  const idleNow = s.panel === 'later' ? null : idle
  for (const p of ['.dsurf', '.dwave', '.dtime']) {
    const r = now.parts[p]
    if (!r) no(`dictating: no ${p}`)
    else if (!inside(r, now.cbox)) no(`dictating: ${p} (${fmt(r)}) leaves the message box (${fmt(now.cbox)})`)
  }
  if (idleNow && !same(now.mic, idleNow.mic)) no(`Done isn't the idle mic's size and place: ${fmt(now.mic)} vs ${fmt(idleNow.mic)}`)
  if (idleNow && !same(now.main, idleNow.main)) no(`Cancel isn't the idle round button's size and place: ${fmt(now.main)} vs ${fmt(idleNow.main)}`)
  if (now.colors.mic !== now.colors.green) no(`Done's colour ${now.colors.mic} isn't the app's green ${now.colors.green}`)
  if (now.colors.main !== now.colors.red) no(`Cancel's colour ${now.colors.main} isn't the app's red ${now.colors.red}`)
  if (now.peak < 0.4) no(`the microphone's level doesn't reach the wave (tallest bar ${Math.round(now.peak * 100)}% of its height)`)
  const wide = await widened(page)
  if (!wide || !near(wide.w, now.parts['.dwave']!.w)) no(`the wave's canvas sizes its row (${now.parts['.dwave']?.w} became ${wide?.w})`)
  await page.screenshot({ path: join(img, `${s.name}-dictating.png`) })

  // Cancel drops it
  await page.locator('.cbox [data-slot=main]').first().click()
  await page.waitForTimeout(500)
  if ((await page.locator('.cbox textarea').first().inputValue()) !== '') no('Cancel wrote something')
  if (sent) no('Cancel sent the recording')

  // Done: the words land at the cursor; what was typed and the attachment stay
  await page.evaluate(() => {
    const t = document.querySelector<HTMLTextAreaElement>('.cbox textarea')!
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(t, 'first  last')
    t.dispatchEvent(new Event('input', { bubbles: true }))
    t.focus()
    t.setSelectionRange(6, 6)
  })
  await page.locator('.cbox [data-slot=mic]').first().click()
  await page.waitForTimeout(1500)
  if ((await page.locator('.cbox textarea').first().inputValue()) !== 'first  last') no('the words showed in the box while speaking')
  await page.locator('.cbox [data-slot=mic]').first().click()
  await page.waitForTimeout(2000)
  const text = await page.locator('.cbox textarea').first().inputValue()
  if (!/^first Hello there\.? last$/i.test(text)) no(`Done wrote "${text}", not the words at the cursor`)
  if ((await files()) !== nFiles) no('Done dropped the attachment')

  // the call, from a fresh load (an empty box: its round button is the call): its wave fills the row from the box's
  // left to the mic; Mute / End call where the idle buttons are
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  if (s.panel !== 'closed' && !(await page.locator('.has-pane').count())) { await tasks(); await page.waitForTimeout(300) }
  const before = await look(page)
  await page.locator('.cbox [data-slot=main]').first().click()
  await page.waitForTimeout(1800)
  now = await look(page)
  const m = now.parts['.vmark']
  if (!m) no('in a call: no wave')
  else {
    if (!inside(m, now.cbox)) no(`in a call: the wave (${fmt(m)}) leaves the box (${fmt(now.cbox)})`)
    if (m.l > now.cbox.l + 24) no(`in a call: the wave starts ${Math.round(m.l - now.cbox.l)} px in from the box's left`)
    if (now.mic.l - m.r > 16) no(`in a call: a ${Math.round(now.mic.l - m.r)} px gap between the wave and the mic`)
    const w2 = await widened(page)
    if (!w2 || !near(w2.w, m.w)) no(`the call wave's canvas sizes its row (${m.w} became ${w2?.w})`)
  }
  if (!same(now.mic, before.mic)) no(`Mute isn't the idle mic's size and place: ${fmt(now.mic)} vs ${fmt(before.mic)}`)
  if (!same(now.main, before.main)) no(`End call isn't the idle round button's size and place: ${fmt(now.main)} vs ${fmt(before.main)}`)
  if (now.colors.main !== now.colors.red) no(`End call's colour ${now.colors.main} isn't the app's red ${now.colors.red}`)
  if (now.peak < 0.2) no(`in a call: the wave doesn't move (tallest bar ${Math.round(now.peak * 100)}%)`)
  await page.screenshot({ path: join(img, `${s.name}-call.png`) })
  await ctx.close()
}

async function main() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', join(root, 'web/demo/serve.ts'), String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const base = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* not yet */ }
    await Bun.sleep(100)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'dict-check-'))
  const wav = join(tmp, 'voice.wav')
  writeFileSync(wav, voiceWav())
  const img = process.env.DICT_CHECK_SHOTS ?? tmp
  const browser = await chromium.launch({ executablePath: chrome(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] })
  const bad: string[] = []
  try {
    for (const s of SCENES) if (!process.env.DICT_CHECK_ONLY || s.name === process.env.DICT_CHECK_ONLY) await scene(browser, base, s, img, bad)
  } finally {
    await browser.close()
    server.kill()
    if (!process.env.DICT_CHECK_SHOTS) rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`dictation check: ${SCENES.length} scenes, ${bad.length ? `${bad.length} wrong` : 'all right'}`)
  for (const b of bad) console.log(`  ${b}`)
  if (bad.length) process.exit(1)
}

if (import.meta.main) await main()
