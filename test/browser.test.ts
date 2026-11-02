// The shared browser: the server's relay between a task's agent-browser session and the Browser panel (on a stand-in
// for agent-browser, its stream and its DevTools), the notes Annotate mode sends, and the panel's arithmetic.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'shep-browser-'))
process.env.SHEPHERDR_HOME = home
const { Browsers, browserEnv, profileOf, usedMark, chromesIn, elapsed } = await import('../server/demo/browser.ts')
const { describe: describeEl } = await import('../server/browser-pick.ts')
const { line, parseBrowserNotes } = await import('../server/common/chatlines.ts')
const { toUrl, shortUrl } = await import('../shared/browser.ts')
const { fit, keyEvent, pinAt, shotRect, toPage } = await import('../plugins/browser/input.ts')
import { launch } from './chromium.ts'
import { fakeAgentBrowser } from './fake-agent-browser.ts'
import type { BrowserDown, BrowserPick } from '../shared/browser.ts'

const fake = fakeAgentBrowser()
const { streamSocks, fromPanel, toPanels, cdpCalls, state, calls, dir } = fake
const FAKE = fake.bin
afterAll(() => fake.stop())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(f: () => boolean, ms = 5000) {
  const t = Date.now()
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await wait(20)
  }
}

function setup(o: { working?: boolean; bin?: string; idleClose?: (task: string) => number | null } = {}) {
  const told: string[] = []
  const b = new Browsers({ bin: o.bin ?? FAKE, env: (t) => ({ ...browserEnv(t), ...fake.env }), host: 'vm-test', user: () => 'Elias', working: () => !!o.working, tell: (_, t) => told.push(t), idleClose: o.idleClose })
  const got: BrowserDown[] = []
  const raw: string[] = []
  let closed = false
  const panel = (task = 'SHE-9') =>
    b.attach(task, {
      send: (s) => {
        raw.push(s)
        got.push(JSON.parse(s))
      },
      close: () => (closed = true),
    })
  const last = <T extends BrowserDown['type']>(t: T) => got.filter((m) => m.type === t).pop() as Extract<BrowserDown, { type: T }> | undefined
  return { b, told, got, raw, panel, last, closed: () => closed }
}

beforeEach(async () => {
  // the last test's stream link is gone first
  await until(() => streamSocks.size === 0)
  fake.reset()
})

describe('a task’s browser', () => {
  test('every agent-browser command in the task’s terminal reaches its own session, in Shepherdr’s namespace, with a profile that keeps sign-ins', () => {
    expect(browserEnv('SHE-9')).toEqual({ AGENT_BROWSER_NAMESPACE: 'shepherdr', AGENT_BROWSER_SESSION: 'SHE-9', AGENT_BROWSER_PROFILE: profileOf('SHE-9') })
    expect(profileOf('SHE-9')).toEndWith('/browser/SHE-9')
  })

  test('opening the panel starts the browser on demand and relays its stream; the port itself never reaches the screen', async () => {
    const { panel, got, raw, last, b } = setup()
    panel()
    await until(() => streamSocks.size === 1)
    const run = calls().map((c) => c.args.join(' '))
    expect(run).toEqual(['stream status', 'open about:blank', 'stream status'])
    expect(calls().every((c) => c.session === 'SHE-9' && c.namespace === 'shepherdr')).toBe(true)
    toPanels({ type: 'frame', seq: 1, data: 'AAAA', metadata: { deviceWidth: 1280, deviceHeight: 720, scrollOffsetY: 0 } })
    await until(() => got.some((m) => m.type === 'frame'))
    await until(() => last('state')?.url === 'http://localhost:5173/settings')
    expect(last('state')).toMatchObject({ driver: 'agent', connected: true, title: 'Settings', viewport: { w: 1280, h: 720 } })
    expect(raw.join('\n')).not.toContain(String(fake.stream.port))
    await b.close('SHE-9')
  })

  test('a browser already running is joined, not started again', async () => {
    state({ connected: true, sessions: ['SHE-9'] })
    const { panel, b } = setup()
    panel()
    await until(() => streamSocks.size === 1)
    expect(calls().map((c) => c.args.join(' '))).toEqual(['stream status'])
    await b.close('SHE-9')
  })

  test('your input goes in only while you drive; taking over tells a working agent to hold off, handing back tells it to go on', async () => {
    const { panel, told, last, b } = setup({ working: true })
    const p = panel()
    await until(() => streamSocks.size === 1)
    p.message(JSON.stringify({ type: 'input_mouse', eventType: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 }))
    await wait(50)
    expect(fromPanel).toEqual([])
    p.message(JSON.stringify({ type: 'take' }))
    await until(() => last('state')?.driver === 'you')
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('Elias took over the shared browser')
    expect(told[0]).not.toContain('[')
    p.message(JSON.stringify({ type: 'input_mouse', eventType: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 }))
    await until(() => fromPanel.length === 1)
    expect(fromPanel[0]).toMatchObject({ type: 'input_mouse', eventType: 'mousePressed', x: 5 })
    p.message(JSON.stringify({ type: 'handback' }))
    await until(() => last('state')?.driver === 'agent')
    expect(told[1]).toContain('handed the shared browser back')
    await b.close('SHE-9')
  })

  test('an idle agent hears of a take-over only when it drives the browser meanwhile, and once', async () => {
    const { panel, told, last, b } = setup({ working: false })
    const p = panel()
    await until(() => streamSocks.size === 1)
    p.message(JSON.stringify({ type: 'take' }))
    await until(() => last('state')?.driver === 'you')
    expect(told).toEqual([])
    await wait(350)
    toPanels({ type: 'command', action: 'click' })
    toPanels({ type: 'command', action: 'fill' })
    await until(() => told.length > 0)
    await wait(50)
    expect(told).toHaveLength(1)
    // its command shows as it driving
    await until(() => last('state')?.agentAgo !== undefined)
    await b.close('SHE-9')
  })

  test('the address bar, back, forward and reload move the page over DevTools, only while you drive', async () => {
    const { panel, last, b } = setup()
    const p = panel()
    await until(() => streamSocks.size === 1)
    p.message(JSON.stringify({ type: 'go', url: 'example.com' }))
    await wait(100)
    expect(cdpCalls).toEqual([])
    p.message(JSON.stringify({ type: 'take' }))
    await until(() => last('state')?.driver === 'you')
    p.message(JSON.stringify({ type: 'go', url: 'example.com' }))
    await until(() => cdpCalls.some((c) => c.method === 'Page.navigate'))
    expect(cdpCalls.find((c) => c.method === 'Page.navigate')).toMatchObject({ params: { url: 'https://example.com' }, sessionId: 'S1' })
    expect(cdpCalls.find((c) => c.method === 'Target.attachToTarget')?.params).toEqual({ targetId: 'T1', flatten: true })
    p.message(JSON.stringify({ type: 'back' }))
    await until(() => cdpCalls.some((c) => c.method === 'Page.navigateToHistoryEntry'))
    expect(cdpCalls.find((c) => c.method === 'Page.navigateToHistoryEntry')?.params).toEqual({ entryId: 11 })
    p.message(JSON.stringify({ type: 'go', url: 'javascript:alert(1)' }))
    await until(() => last('error') !== undefined)
    expect(cdpCalls.filter((c) => c.method === 'Page.navigate')).toHaveLength(1)
    // our own commands (the viewport) are not the agent driving
    p.message(JSON.stringify({ type: 'viewport', w: 390, h: 700 }))
    await until(() => calls().some((c) => c.args[0] === 'set'))
    expect(calls().find((c) => c.args[0] === 'set')?.args).toEqual(['set', 'viewport', '390', '700'])
    await b.close('SHE-9')
  })

  test('Annotate: a tap is resolved at its page point, and nothing on the live page is resized for a screenshot', async () => {
    const { panel, last, b } = setup()
    const p = panel()
    await until(() => streamSocks.size === 1)
    p.message(JSON.stringify({ type: 'pick', id: 3, x: 50, y: 35 }))
    await until(() => last('picked') !== undefined)
    const r = last('picked')!
    expect(r.error).toBeUndefined()
    // the page is scrolled 400px: DevTools hit-tests in page coordinates
    expect(cdpCalls.find((c) => c.method === 'DOM.getNodeForLocation')?.params).toMatchObject({ x: 50, y: 435 })
    expect(r.pick).toMatchObject({ element: 'button "Save"', selector: 'form > button.primary', url: 'http://localhost:5173/settings' })
    // the shot is cropped on the screen from the frame you saw: a DevTools clip would resize the live page
    expect(cdpCalls.some((c) => c.method === 'Page.captureScreenshot')).toBe(false)
    expect(cdpCalls.some((c) => c.method === 'Runtime.releaseObject')).toBe(true)
    await b.close('SHE-9')
  })

  test('a browser that won’t start says why, with what to do', async () => {
    state({ fail: 'Chrome not found: run agent-browser install' })
    const { panel, last, b } = setup()
    panel()
    await until(() => last('error') !== undefined)
    expect(last('error')!.message).toContain('Chrome is missing on vm-test')
    await b.close('SHE-9')
  })

  test('a daemon another agent-browser started meanwhile is tried once more; a clash that stays says what to do', async () => {
    state({ clash: 1 })
    const { panel, last, b } = setup()
    panel()
    await until(() => !!last('state')?.connected)
    expect(last('error')).toBeUndefined()
    await b.close('SHE-9')

    state({ clash: 99 })
    const s = setup()
    s.panel()
    await until(() => s.last('error') !== undefined)
    expect(s.last('error')!.message).toBe(`Another agent-browser (another version, or other settings) is using this browser, so it keeps restarting. The agent should run ${FAKE}, the version Shepherdr pins, without --session or --profile.`)
    await s.b.close('SHE-9')
  })

  test('agent-browser missing: the item says so and nothing runs', async () => {
    const { b, panel, last } = setup({ bin: join(dir, 'nope') })
    await until(() => !!b.status().hint && !b.status().hint!.startsWith('Checking'))
    expect(b.status()).toMatchObject({ ready: false })
    expect(b.status().hint).toContain('agent-browser is missing on vm-test')
    panel()
    await until(() => last('error') !== undefined)
  })

  test('a task stopped closes its browser and keeps its sign-ins; merged, the profile goes too; the panel is told', async () => {
    state({ connected: true, sessions: ['SHE-9'] })
    mkdirSync(profileOf('SHE-9'), { recursive: true })
    const { b, panel, last, closed } = setup()
    panel()
    await until(() => streamSocks.size === 1)
    await b.close('SHE-9')
    expect(closed()).toBe(true)
    expect(last('error')?.message).toContain('closed with the task')
    expect(calls().some((c) => c.args[0] === 'close' && c.session === 'SHE-9')).toBe(true)
    expect(existsSync(profileOf('SHE-9'))).toBe(true)
    await b.close('SHE-9', true)
    expect(existsSync(profileOf('SHE-9'))).toBe(false)
  })

  test('the sweep closes sessions left from before a restart whose task stopped, merged or is gone', async () => {
    state({ sessions: ['SHE-1', 'SHE-2', 'SHE-3'] })
    const { b } = setup()
    await b.sweep(
      (t) => t === 'SHE-1',
      (t) => t === 'SHE-3',
    )
    const closedFor = calls()
      .filter((c) => c.args[0] === 'close')
      .map((c) => c.session)
    expect(closedFor).toEqual(['SHE-2', 'SHE-3'])
  })

  test('closed, no Chrome is left in its profile: a close agent-browser could not do is ended by its --user-data-dir', async () => {
    // a Chrome whose daemon is gone (agent-browser lists no session), another task's that only shares the prefix
    const chrome = (task: string) => Bun.spawn(['perl', '-e', 'sleep 60', '--', `--user-data-dir=${profileOf(task)}`, '--use-angle=swiftshader-webgl'], { stdout: 'ignore', stderr: 'ignore' })
    const gpu = chrome('SHE-9')
    const other = chrome('SHE-90')
    try {
      await wait(200)
      const { b } = setup()
      await b.close('SHE-9', true)
      expect(await Promise.race([gpu.exited, wait(3000).then(() => 'running')])).not.toBe('running')
      expect(other.exitCode).toBeNull()
      // the sweep finds it by its process too, and says which tasks it closed
      expect(await b.sweep((t) => t !== 'SHE-90', () => true)).toEqual(['SHE-90'])
      expect(await Promise.race([other.exited, wait(3000).then(() => 'running')])).not.toBe('running')
    } finally {
      gpu.kill(9)
      other.kill(9)
    }
  })

  test('a browser left idle closes with its whole Chrome after its setting: an agent command, a screen watching or off keeps it', async () => {
    const chrome = (task: string) => Bun.spawn(['perl', '-e', 'sleep 60', '--', `--user-data-dir=${profileOf(task)}`, '--type=renderer'], { stdout: 'ignore', stderr: 'ignore' })
    const idle = chrome('SHE-91')
    const used = chrome('SHE-92')
    const off = chrome('SHE-93')
    const watched = chrome('SHE-94')
    const MIN = 60_000
    try {
      await wait(200)
      state({ sessions: ['SHE-91'] })
      mkdirSync(profileOf('SHE-91'), { recursive: true })
      const { b } = setup({ idleClose: (t) => (t === 'SHE-93' ? null : 10 * MIN) })
      const now = Date.now()
      // the agent ran a command 8 minutes from now
      writeFileSync(usedMark(profileOf('SHE-92')), '')
      utimesSync(usedMark(profileOf('SHE-92')), (now + 8 * MIN) / 1000, (now + 8 * MIN) / 1000)
      const panel = b.attach('SHE-94', { send: () => undefined, close: () => undefined })
      expect(await b.closeIdle(now + 5 * MIN)).toEqual([])
      expect(await b.closeIdle(now + 11 * MIN)).toEqual(['SHE-91'])
      expect(await Promise.race([idle.exited, wait(3000).then(() => 'running')])).not.toBe('running')
      for (const p of [used, off, watched]) expect(p.exitCode).toBeNull()
      // agent-browser was asked to close it first; sign-ins stay
      expect(calls().filter((c) => c.args[0] === 'close').map((c) => c.session)).toEqual(['SHE-91'])
      expect(existsSync(profileOf('SHE-91'))).toBe(true)
      // the agent's last command 10 minutes back, the screen gone 10 minutes back: those close too (once the screen's
      // start is over: a browser still starting is kept)
      await until(() => streamSocks.size === 1)
      panel.end()
      expect((await b.closeIdle(now + 19 * MIN)).sort()).toEqual(['SHE-92', 'SHE-94'])
      // Wait for killed fixture processes to disappear before asking ps for another sweep.
      for (const p of [used, watched]) expect(await Promise.race([p.exited, wait(3000).then(() => 'running')])).not.toBe('running')
      // off: never
      expect(await b.closeIdle(now + 24 * 60 * MIN)).toEqual([])
      expect(off.exitCode).toBeNull()
    } finally {
      for (const p of [idle, used, off, watched]) p.kill(9)
    }
  })

  test('each agent command marks when its browser was used; Shepherdr’s own commands and other sessions don’t', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'shep-mark-'))
    // The same pinned package wrapper is provisioned through core on every machine.
    mkdirSync(join(tmp, 'bin'))
    cpSync(join(import.meta.dir, '..', 'bin', 'agent-browser'), join(tmp, 'bin', 'agent-browser'))
    const packageBin = join(tmp, 'node_modules', 'agent-browser', 'bin')
    mkdirSync(packageBin, { recursive: true })
    for (const suffix of ['', '-musl']) writeFileSync(join(packageBin, `agent-browser-${process.platform}${suffix}-${process.arch}`), '#!/bin/sh\necho "ran $* with $AGENT_BROWSER_ARGS"\n', { mode: 0o755 })
    for (const bin of [join(tmp, 'bin', 'agent-browser'), join(import.meta.dir, '..', 'bin', 'agent-browser')]) {
      const profile = join(tmp, String(Math.random()), 'browser', 'SHE-5')
      const run = (env: Record<string, string>) => Bun.spawnSync(['sh', bin, '--version'], { env: { ...process.env, ...env }, stdout: 'pipe' })
      run({})
      run({ AGENT_BROWSER_PROFILE: profile, SHEPHERDR_OWN: '1' })
      expect(existsSync(usedMark(profile))).toBe(false)
      const r = run({ AGENT_BROWSER_PROFILE: profile })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString()).toMatch(/ran --version|agent-browser/)
      // a task's browser shows pages with reduced motion, whoever runs the command (an agent started before too)
      if (bin.includes('shep-mark-')) expect(r.stdout.toString()).toContain('with --force-prefers-reduced-motion')
      expect(Date.now() - statSync(usedMark(profile)).mtimeMs).toBeLessThan(10_000)
    }
  })

  test('ps’s lines: each Chrome in a task’s profile, with how long it has run', () => {
    const flag = '--user-data-dir=/h/.shepherdr/browser/'
    const ps = ['  11 01:02:03 chrome --user-data-dir=/h/.shepherdr/browser/SHE-1 --x', '12 2-00:00:05 chrome --user-data-dir=/h/.shepherdr/browser/SHE-2', '13 00:07 bash', ' 14 09:59 chrome --user-data-dir=/h/.shepherdr/browser/../x'].join('\n')
    expect(chromesIn(ps, flag)).toEqual([
      { pid: 11, task: 'SHE-1', age: 3723_000 },
      { pid: 12, task: 'SHE-2', age: (48 * 3600 + 5) * 1000 },
    ])
    expect(elapsed('09:59')).toBe(599_000)
  })

  test('agent-browser slow to answer at start-up: closing a task still closes its browser once it answers', async () => {
    state({ connected: true, sessions: ['SHE-9'] })
    const later = join(dir, 'later')
    const { b } = setup({ bin: later })
    await until(() => !!b.status().hint && !b.status().hint!.startsWith('Checking'))
    symlinkSync(FAKE, later)
    await b.close('SHE-9')
    expect(calls().some((c) => c.args[0] === 'close' && c.session === 'SHE-9')).toBe(true)
  })

  test('the clean-up touches only sessions named like a task: a made-up "..", ".", or a name of your own stays, and so does every folder', async () => {
    mkdirSync(profileOf('SHE-4'), { recursive: true })
    writeFileSync(join(home, 'tasks.json'), '[]')
    state({ sessions: ['..', '.', 'mine', '../x-1', 'SHE-4', '3V-1'] })
    const { b } = setup()
    await b.sweep(
      () => false,
      () => true,
    )
    expect(calls().filter((c) => c.args[0] === 'close').map((c) => c.session)).toEqual(['SHE-4', '3V-1'])
    expect(existsSync(join(home, 'tasks.json'))).toBe(true)
    expect(existsSync(profileOf('SHE-4'))).toBe(false)
    await b.close('..', true)
    expect(existsSync(home)).toBe(true)
  })
})

describe('notes from the browser', () => {
  const pick = (o: Partial<BrowserPick> = {}): BrowserPick => ({
    element: 'button "Save"',
    selector: 'form > button.primary',
    text: 'Save',
    react: 'SettingsForm > SaveButton',
    classes: 'btn primary',
    styles: 'color rgb(255, 255, 255); background rgb(37, 99, 235)',
    box: { x: 912, y: 604, w: 120, h: 36 },
    at: { x: 950, y: 620 },
    url: 'http://localhost:5173/settings',
    shot: '/home/x/.shepherdr/inbox/SHE-9_Agent/abc-note-button.png',
    ...o,
  })

  test('go in as one structured block the agent reads, numbered as the pins, and read back short for the chat', () => {
    const text = line.browserNotes('Elias', { url: 'http://localhost:5173/settings', title: 'Settings', viewport: { w: 1280, h: 720 } }, [
      { comment: 'Make it say "Save changes".', pick: pick() },
      { comment: 'Too faint\non dark', pick: pick({ element: 'p', selector: '#intro', text: undefined, react: undefined, url: 'http://localhost:5173/', shot: undefined }) },
    ])
    expect(text).toBe(
      [
        '<browser-notes from="Elias" url="http://localhost:5173/settings" title="Settings" viewport="1280×720">',
        '1. button "Save"',
        '   Note: Make it say "Save changes".',
        '   Selector: form > button.primary',
        '   Text: "Save" · React: SettingsForm > SaveButton',
        '   Box: x 912, y 604, 120×36 · Classes: btn primary',
        '   Styles: color rgb(255, 255, 255); background rgb(37, 99, 235)',
        '   Shot: abc-note-button.png',
        '2. p',
        '   Note: Too faint',
        '         on dark',
        '   Selector: #intro',
        '   Box: x 912, y 604, 120×36 · Classes: btn primary',
        '   Styles: color rgb(255, 255, 255); background rgb(37, 99, 235)',
        '   Page: http://localhost:5173/',
        '</browser-notes>',
      ].join('\n'),
    )
    const back = parseBrowserNotes(`${text}\n${line.attach('Elias', 'abc-note-button.png', pick().shot!)}`)
    expect(back).toEqual({
      url: 'http://localhost:5173/settings',
      notes: [
        { element: 'button "Save"', note: 'Make it say "Save changes".' },
        { element: 'p', note: 'Too faint\non dark' },
      ],
      rest: [line.attach('Elias', 'abc-note-button.png', pick().shot!)],
    })
    expect(parseBrowserNotes('[Elias noted on "Page": fix it]')).toBeNull()
    // notes from before tags still read back
    expect(parseBrowserNotes('[Elias noted in the browser on http://x/ ("X"), viewport 1×1:\n1. p\n   Note: Bigger]')).toEqual({ url: 'http://x/', notes: [{ element: 'p', note: 'Bigger' }], rest: [] })
  })
})

describe('the panel’s arithmetic', () => {
  test('the page fits whole and centred; a tap maps to the page’s own pixels; outside the picture it is nothing', () => {
    const r = fit({ w: 400, h: 400 }, { w: 1280, h: 720 })
    expect(r).toEqual({ x: 0, y: 87.5, w: 400, h: 225 })
    expect(toPage({ x: 200, y: 200 }, r, { w: 1280, h: 720 })).toEqual({ x: 640, y: 360 })
    expect(toPage({ x: 200, y: 20 }, r, { w: 1280, h: 720 })).toBeNull()
  })

  test('a shot shows the element with a little room, cut to the page; a huge one, the part around the tap', () => {
    const page = { w: 1280, h: 720 }
    expect(shotRect({ box: { x: 10, y: 20, w: 100, h: 30 } }, { x: 50, y: 35 }, page)).toEqual({ x: 2, y: 12, w: 116, h: 46 })
    expect(shotRect({ box: { x: -50, y: 700, w: 100, h: 100 } }, { x: 10, y: 710 }, page)).toEqual({ x: 0, y: 692, w: 58, h: 28 })
    expect(shotRect({ box: { x: 0, y: 0, w: 1280, h: 3000 } }, { x: 640, y: 360 }, page)).toEqual({ x: 332, y: 152, w: 616, h: 416 })
    expect(shotRect({ box: { x: 0, y: 900, w: 10, h: 10 } }, { x: 5, y: 5 }, page)).toBeNull()
  })

  test('a pin moves with the page’s scroll, stays put for a fixed element, and hides on another page or off screen', () => {
    const r = { x: 0, y: 0, w: 640, h: 360 }
    // agent-browser may say 720 high when the page is less: the picture's own size counts
    const meta = { deviceWidth: 1280, deviceHeight: 900, scrollOffsetX: 0, scrollOffsetY: 300 }
    const page = { w: 1280, h: 720 }
    const url = 'http://a/x'
    expect(pinAt({ at: { x: 100, y: 500 }, url }, url, meta, r, page)).toEqual({ x: 50, y: 100 })
    expect(pinAt({ at: { x: 100, y: 500 }, url, fixed: true }, url, meta, r, page)).toEqual({ x: 50, y: 250 })
    expect(pinAt({ at: { x: 100, y: 100 }, url }, url, meta, r, page)).toBeNull()
    expect(pinAt({ at: { x: 100, y: 500 }, url: 'http://a/y' }, `${url}#top`, meta, r, page)).toBeNull()
    expect(pinAt({ at: { x: 100, y: 500 }, url }, `${url}#top`, meta, r, page)).not.toBeNull()
  })

  test('keys: a character types as text with no key code; a shortcut carries its letter’s code; Enter submits', () => {
    const k = (key: string, code: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m })
    expect(keyEvent(k('.', 'Period'), 'keyDown')).toEqual({ type: 'input_keyboard', eventType: 'keyDown', key: '.', code: 'Period', modifiers: 0, text: '.' })
    expect(keyEvent(k('.', 'Period'), 'keyUp')).toEqual({ type: 'input_keyboard', eventType: 'keyUp', key: '.', code: 'Period', modifiers: 0 })
    expect(keyEvent(k('a', 'KeyA', { ctrlKey: true }), 'keyDown')).toEqual({ type: 'input_keyboard', eventType: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    expect(keyEvent(k('Enter', 'Enter'), 'keyDown')).toMatchObject({ windowsVirtualKeyCode: 13, text: '\r' })
    expect(keyEvent(k('Backspace', 'Backspace', { shiftKey: true }), 'keyDown')).toMatchObject({ windowsVirtualKeyCode: 8, modifiers: 8 })
    expect(keyEvent(k('Shift', 'ShiftLeft'), 'keyDown')).toBeNull()
  })

  test('the address bar: a bare host gets https, this machine http, words a search', () => {
    expect(toUrl('example.com/a')).toBe('https://example.com/a')
    expect(toUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(toUrl('127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000/x')
    expect(toUrl('http://x.test')).toBe('http://x.test')
    expect(toUrl('agent browser docs')).toBe('https://duckduckgo.com/?q=agent%20browser%20docs')
    expect(shortUrl('https://example.com/')).toBe('example.com')
    expect(shortUrl('https://example.com/a/')).toBe('example.com/a/')
  })
})

// What Annotate mode learns from a real page: run in a real browser, skipped where none is installed.
const real = await launch()
afterAll(() => real?.close())
describe.if(!!real)('what the page says about a tapped element', () => {
  test('its name, a selector that finds it alone, its text, styles, box and the React components around it', async () => {
    const page = await real!.newPage({ viewport: { width: 800, height: 600 } })
    await page.setContent(`
      <style>.btn { color: rgb(255, 255, 255); background: rgb(37, 99, 235); padding: 8px 12px; border-radius: 6px; font: 600 14px/20px sans-serif }</style>
      <main><form><input name="email" placeholder="Email"><button class="btn primary css-1x2y3z" data-testid="save" type="submit">Save</button><button class="btn">Cancel</button></form>
      <ul><li class="item">One</li><li class="item">Two</li></ul><div style="height:2000px"></div></main>`)
    // React keeps its tree on the element: a stand-in for it
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid=save]') as unknown as Record<string, unknown>
      function SaveButton() {}
      function SettingsForm() {}
      b['__reactFiber$abc'] = { type: 'button', return: { type: SaveButton, return: { type: 'div', return: { type: SettingsForm, return: null } } } }
    })
    await page.evaluate(() => scrollTo(0, 0))
    const run = (sel: string, x: number, y: number) =>
      page.evaluate(([fn, sel, x, y]) => new Function(`return (${fn})`)().call(document.querySelector(sel as string), x, y), [String(describeEl), sel, x, y] as const)
    const save = await run('[data-testid=save]', 300, 20)
    expect(save).toMatchObject({
      element: 'button "Save"',
      selector: 'button[data-testid="save"]',
      attrs: 'data-testid="save" type="submit"',
      react: 'SettingsForm > SaveButton',
      classes: 'btn primary css-1x2y3z',
      fixed: false,
      frame: false,
    })
    expect(save.styles).toContain('color rgb(255, 255, 255); background rgb(37, 99, 235); font 600 14px/20px sans-serif; padding 8px 12px')
    expect(save.styles).toContain('radius 6px')
    const two = await run('li:nth-of-type(2)', 20, 60)
    expect(two.element).toBe('li "Two"')
    expect(two.selector).toBe('li.item:nth-of-type(2)')
    expect(await page.evaluate((s) => document.querySelectorAll(s).length, two.selector)).toBe(1)
    expect((await run('input', 10, 10)).element).toBe('input[type=text] "Email"')
    await page.evaluate(() => scrollTo(0, 500))
    expect((await run('ul', 10, 10)).at).toEqual({ x: 10, y: 510 })
    await page.close()
  })
})
