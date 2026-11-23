// bun test/chrome_page.ts <chrome> <page url> <scratch profile dir>
// Opens a page in a real headless Chrome over its debugging port and prints what the page puts in window.done (as
// JSON). Unlike --dump-dom, the page draws frames: requestAnimationFrame and ResizeObserver run as they do for people.
// Used by test/test_reply_row.py; the port is Chrome's own pick on 127.0.0.1, and Chrome ends with the run.
const [chrome, page, profile] = Bun.argv.slice(2)
const proc = Bun.spawn([chrome, '--headless=new', '--no-sandbox', '--disable-gpu', '--use-mock-keychain', '--password-store=basic',
  `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--window-size=1400,900', 'about:blank'],
  { stderr: 'pipe', stdout: 'ignore' })
const quit = async (code: number, text: string) => {
  proc.kill()
  await proc.exited  // its profile folder is the caller's to remove: Chrome is done writing it
  console.log(text)
  process.exit(code)
}
setTimeout(() => void quit(1, 'timed out'), 40_000)
let ws = ''
const reader = proc.stderr.getReader()
let said = ''
while (!ws) {
  const { value, done } = await reader.read()
  if (done) await quit(1, `Chrome ended: ${said.slice(-400)}`)
  said += new TextDecoder().decode(value)
  ws = said.match(/ws:\/\/\S+/)?.[0] ?? ''
}
const tabs = await (await fetch(`http://127.0.0.1:${new URL(ws).port}/json`)).json() as { type: string; webSocketDebuggerUrl: string }[]
const tab = tabs.find((t) => t.type === 'page')
if (!tab) await quit(1, 'no page')
const sock = new WebSocket(tab!.webSocketDebuggerUrl)
await new Promise((r) => sock.addEventListener('open', r))
let n = 0
const waits = new Map<number, (v: { result?: { result?: { value?: string } } }) => void>()
sock.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  waits.get(m.id)?.(m)
})
const call = (method: string, params: object = {}) => new Promise<{ result?: { result?: { value?: string } } }>((r) => {
  waits.set(++n, r)
  sock.send(JSON.stringify({ id: n, method, params }))
})
await call('Page.enable')
await call('Page.navigate', { url: page })
const got = await call('Runtime.evaluate', {
  expression: 'new Promise((r) => { const t = () => (window.done ? r(JSON.stringify(window.done)) : setTimeout(t, 50)); t() })',
  awaitPromise: true,
})
await quit(0, got.result?.result?.value ?? JSON.stringify(got))
