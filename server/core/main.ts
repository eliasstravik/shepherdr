import { existsSync, renameSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CoreSource } from './source.ts'
import { CorePluginUpdates } from './plugin-updates.ts'
import { coreConfig, type CoreConfig } from './config.ts'
import type { RunRecord } from './launcher.ts'
import { startOperator } from './operator.ts'

export async function runCoreServer(config: CoreConfig, boot: string = randomUUID()) {
  // Reused presentation and push code resolves its private state only after these values are set.
  process.env.SHEPHERDR_HOME = config.home
  process.env.SHEPHERDR_PORT = String(config.port)
  const source = new CoreSource(config)
  const cleanup: (() => void)[] = [() => source.stop()]
  try {
  await source.start()
  const { default: base, catalog, user } = await import('../../generated/server-plugins.ts')
  await source.plugins.start(catalog, [...base.map(plugin => [plugin.name, async () => plugin] as [string, () => Promise<typeof plugin>]), ...user.map(([name, load]) => [name, async () => (await load()).default] as [string, () => Promise<import('../plugin-api.ts').ServerPlugin>])])
  const { startApp } = await import('../app.ts')
  const { Push, deviceName } = await import('../push.ts')
  if (config.plugins !== false) source.pluginUpdates = new CorePluginUpdates(source, join(import.meta.dir, '../..'))
  const push = new Push()
  source.devices = () => push.devices.map(deviceName)
  source.pushWarnings = () => push.warnings(deviceName)
  const server = startApp({ source, port: config.port, host: '127.0.0.1', dist: join(import.meta.dir, '../../dist'), push,
    assets: source.pluginUpdates?.assets,
    health: () => ({ product: 'shepherdr-core', boot, pid: process.pid, core: source.connected() }) })
  cleanup.push(() => server.stop(true))
  const operator = await startOperator(source, boot)
  cleanup.push(() => operator.close())
  const record: RunRecord = { pid: process.pid, boot, home: config.home, port: server.port!, root: join(import.meta.dir, '../..'), operator: operator.path }
  const temporary = join(config.home, `run.${boot}.tmp`)
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, join(config.home, 'run.json'))
  source.pluginUpdates?.start()
  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await source.drain()
    operator.close(); source.stop(); server.stop(true)
    // Agents and core are intentionally independent of this process.
    const path = join(config.home, 'run.json')
    try { if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).boot === boot) rmSync(path) } catch { /* preserve another start's record */ }
    process.exit(0)
  })
  return { server, source }
  } catch (error) {
    for (const close of cleanup.reverse()) { try { close() } catch { /* preserve the startup error */ } }
    source.mailbox.close(); source.store.close()
    throw error
  }
}

if (import.meta.main) {
  try { await runCoreServer(coreConfig(process.argv.slice(2)), process.env.SHEPHERDR_BOOT_ID || randomUUID()) }
  catch (error) { console.error((error as Error).message); process.exitCode = 1 }
}
