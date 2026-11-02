// Fictional UI review only. Production starts through the standalone core launcher.
import { join } from 'node:path'
import { startApp } from './app.ts'
import { DemoWorld } from './demo/world.ts'

if (process.env.SHEPHERDR_SOURCE !== 'demo') throw new Error('Use shepherdr start for the standalone core application. Legacy workers are not supported.')
const source = new DemoWorld()
const server = startApp({ source, host: '127.0.0.1', port: Number(process.env.SHEPHERDR_PORT ?? 7787), dist: join(import.meta.dir, '../dist') })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(true); process.exit(0) })
console.log(`shepherdr demo on 127.0.0.1:${server.port}`)
