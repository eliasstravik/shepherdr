// Writes web/generated/client-plugins.ts from web/plugins.json: the web app's plugins (each a client.tsx under
// web/plugins/<name>/), in the list's order. As 2.1's scripts/build-plugins.ts, for the screen only: the service
// holds what 2.1's server parts did.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./', import.meta.url))

export function writeRegistry(dir = root) {
  const { plugins } = JSON.parse(readFileSync(join(dir, 'plugins.json'), 'utf8')) as { plugins: string[] }
  const client = plugins.filter((n) => existsSync(join(dir, 'plugins', n, 'client.tsx')))
  const ident = (n: string) => n.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  const text = `// Written by web/build-plugins.ts from web/plugins.json. Do not edit.
import type { ClientPlugin } from '../src/kernel.ts'
${client.map((n) => `import ${ident(n)} from '../plugins/${n}/client.tsx'`).join('\n')}

export const enabled = ${JSON.stringify(plugins)}
export const user: string[] = []
export default [${client.map(ident).join(', ')}] as (ClientPlugin | { name: string; load: () => Promise<{ default: ClientPlugin }> })[]
`
  mkdirSync(join(dir, 'generated'), { recursive: true })
  const file = join(dir, 'generated', 'client-plugins.ts')
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text)
  return plugins
}

if (import.meta.main) console.log(`plugins: ${writeRegistry().join(', ')}`)
