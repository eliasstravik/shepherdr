import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startApp } from '../server/app.ts'
import { CoreSource } from '../server/core/source.ts'

const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw Error('Presentation did not update'); await Bun.sleep(10) }
}
test('a published plugin build serves new assets and tells existing and reconnected browsers to reload', async () => {
  const home = mkdtempSync(join(tmpdir(), 'core-plugin-assets-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const first = join(home, 'first'), second = join(home, 'second')
  for (const [dir, name] of [[first, 'first'], [second, 'second']]) {
    mkdirSync(dir); writeFileSync(join(dir, 'index.html'), `<script src="assets/${name}-123.js"></script>`)
  }
  const assets = { dist: first }, server = startApp({ source, dist: first, assets, port: 0 })
  const events: { type: string; id?: string }[] = []
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
  socket.onmessage = event => events.push(JSON.parse(String(event.data)))
  try {
    await until(() => events.some(event => event.type === 'build' && event.id?.includes('first-123')))
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toContain('first-123')
    assets.dist = second; source.emit('snapshot')
    await until(() => events.some(event => event.type === 'build' && event.id?.includes('second-123')))
    expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toContain('second-123')
    const reconnected = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`), next: string[] = []
    reconnected.onmessage = event => { const value = JSON.parse(String(event.data)); if (value.type === 'build') next.push(value.id) }
    try { await until(() => next.some(value => value.includes('second-123'))) } finally { reconnected.close() }
  } finally { socket.close(); server.stop(true); source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})
