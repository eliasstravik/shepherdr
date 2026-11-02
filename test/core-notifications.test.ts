import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import { startApp } from '../server/app.ts'
import { Push, deviceName } from '../server/push.ts'
import { writeJson } from '../server/store.ts'

test('fresh core app exposes device enrollment, updates its real push names and reports safe failures', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-core-push-'))
  const source = new CoreSource({ home, socket: '/unused', session: 'test', binary: 'hc', port: 0 })
  writeJson('push.json', []) // test preload owns the presentation store's separate temporary home.
  const push = new Push(undefined, async () => { throw { statusCode: 403, body: 'PRIVATE_PROVIDER_DETAIL' } })
  source.devices = () => push.devices.map(deviceName)
  source.pushWarnings = () => push.warnings(deviceName)
  const server = startApp({ source, host: '127.0.0.1', port: 0, dist: home, push })
  const url = `http://127.0.0.1:${server.port}`
  const delivery = async () => (await (await fetch(url + '/api/snapshot')).json()).settings.find((page: { name: string }) => page.name === 'Alerts and voice')
  try {
    expect((await delivery()).rows.find((row: { key: string }) => row.key === 'alerts')).toMatchObject({ value: 'No device yet', options: ['Add this device'] })
    const response = await fetch(url + '/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ device: 'PRIVATE_USER_AGENT iPhone', sub: { endpoint: 'https://push.example/private', keys: { auth: 'private', p256dh: 'private' } } }) })
    expect(response.status).toBe(200)
    expect((await delivery()).rows.find((row: { key: string }) => row.key === 'alerts').value).toBe('a phone')
    await push.send({ id: 'test', title: 'Isolated test', body: 'No network request', from: 'test', go: { place: 'home' } })
    const section = await delivery()
    expect(section.rows.find((row: { key: string }) => row.key === 'alerts').warn).toContain('Device 1 (a phone): Push service rejected the alert (HTTP 403).')
    expect(JSON.stringify(section)).not.toMatch(/PRIVATE_|https:\/\/push/)
  } finally { server.stop(true); source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})
