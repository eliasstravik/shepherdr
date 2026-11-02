// Reads the plugin lists and writes the registries the server and the screen import. Base plugins are the repo's
// (plugins/<name>/, listed in plugins.json); the human's own live in ~/.shepherdr/plugins/<name>/, outside the repo, so
// updates never touch them. A build reads the copies staged in it (user-plugins/, user-plugins.json): a release stages
// them when it is made (scripts/update.ts), `--user` stages them here first. One with a base plugin's name replaces it;
// the human's list (~/.shepherdr/plugins.json, { "off": [...] }) turns any of them off.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Also imported by Vite's Node config loader, where Bun's import.meta.dir is absent.
const root = fileURLToPath(new URL('../', import.meta.url))
const NAME = /^[a-z][a-z0-9-]*$/

export function readPluginList(dir = root): string[] {
  const list = JSON.parse(readFileSync(join(dir, 'plugins.json'), 'utf8')) as { plugins: string[] }
  if (!Array.isArray(list.plugins)) throw new Error('plugins.json: "plugins" must be a list of names')
  for (const name of list.plugins) {
    if (!NAME.test(name)) throw new Error(`plugins.json: "${name}" is not a plugin name`)
    if (!existsSync(join(dir, 'plugins', name))) throw new Error(`plugins.json names "${name}", but plugins/${name} does not exist`)
  }
  return list.plugins
}

/** Shepherdr's data folder, where the human's own plugins and their list live */
export const userHome = () => process.env.SHEPHERDR_HOME || join(homedir(), '.shepherdr')

/** the plugins the human turned off (~/.shepherdr/plugins.json) */
export function readOff(home = userHome()): string[] {
  try {
    const off = (JSON.parse(readFileSync(join(home, 'plugins.json'), 'utf8')) as { off?: unknown }).off
    return Array.isArray(off) ? off.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** what a build was given of the human's own plugins: their off list, and the ones that didn't build (kept: its last
 *  good version runs instead) */
export interface Staged {
  off: string[]
  broken: Record<string, { error: string; kept?: boolean }>
}

export function readStaged(dir = root): Staged {
  try {
    return JSON.parse(readFileSync(join(dir, 'user-plugins.json'), 'utf8')) as Staged
  } catch {
    return { off: [], broken: {} }
  }
}

export const writeStaged = (dir: string, s: Staged) => writeFileSync(join(dir, 'user-plugins.json'), JSON.stringify(s, null, 2))

/** a plugin folder: a client.tsx or a server.ts in it */
const isPlugin = (d: string) => existsSync(join(d, 'client.tsx')) || existsSync(join(d, 'server.ts'))

/** Copy the human's own plugins and their off list into a build, as they are now: a release keeps them as they were. */
export function stageUserPlugins(dir: string, home = userHome()) {
  const into = join(dir, 'user-plugins')
  rmSync(into, { recursive: true, force: true })
  mkdirSync(into, { recursive: true })
  const from = join(home, 'plugins')
  for (const n of existsSync(from) ? readdirSync(from) : []) {
    const d = join(from, n)
    if (NAME.test(n) && statSync(d).isDirectory() && isPlugin(d)) cpSync(d, join(into, n), { recursive: true, filter: (f) => !f.endsWith('/.git') && !f.endsWith('/node_modules') })
  }
  writeStaged(dir, { off: readOff(home), broken: {} })
}

/** the human's own plugins staged in a build */
export function stagedPlugins(dir = root): string[] {
  const into = join(dir, 'user-plugins')
  return existsSync(into) ? readdirSync(into).filter((n) => NAME.test(n) && isPlugin(join(into, n))).sort() : []
}

export interface PluginEntry {
  name: string
  /** base: the repo's; user: the human's own */
  from: 'base' | 'user'
  /** the human's own, in place of the base plugin of its name */
  overrides?: boolean
  /** in this build */
  on: boolean
  /** why the human's own didn't build; kept: its last good version runs */
  broken?: string
  kept?: boolean
}

/** Every plugin a build knows: the base ones in their list's order (one the human's own replaces, in its place), then
 *  the human's own, A to Z. */
export function pluginCatalog(dir = root): PluginEntry[] {
  const base = readPluginList(dir)
  const { off, broken: stagedBroken } = readStaged(dir)
  const broken = { ...stagedBroken }
  const user = stagedPlugins(dir).filter(name => {
    try { if (JSON.parse(readFileSync(join(dir, 'user-plugins', name, 'shepherdr.json'), 'utf8')).api === 2) return true } catch { /* incompatible, never import either part */ }
    broken[name] = { error: 'Needs a shepherdr.json manifest with { "api": 2 }. Migrate this 2.0 plugin using docs/plugins.md.' }
    return false
  })
  const names = [...base, ...[...user, ...Object.keys(broken)].filter((n) => !base.includes(n)).sort()].filter((n, i, all) => all.indexOf(n) === i)
  return names.map((name) => {
    const mine = user.includes(name)
    const b = broken[name]
    return {
      name,
      from: mine || !base.includes(name) ? 'user' : 'base',
      ...(mine && base.includes(name) ? { overrides: true } : {}),
      on: (mine || base.includes(name)) && !off.includes(name),
      ...(b ? { broken: b.error, ...(b.kept ? { kept: true } : {}) } : {}),
    }
  })
}

/** write a file only when it changes, in one step: test files running in parallel all write the same registries, and
 *  one must never read another's half-written file */
function put(file: string, text: string) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  const tmp = `${file}.${process.pid}`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export function writeRegistries(dir = root) {
  const catalog = pluginCatalog(dir)
  const on = catalog.filter((p) => p.on)
  const names = on.map((p) => p.name)
  const ident = (n: string) => n.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  const folder = (p: PluginEntry) => `../${p.from === 'user' ? 'user-plugins' : 'plugins'}/${p.name}`
  const has = (p: PluginEntry, file: string) => existsSync(join(dir, folder(p).slice(3), file))
  const client = on.filter((p) => has(p, 'client.tsx'))
  const server = on.filter((p) => has(p, 'server.ts'))
  const head = '// Written by scripts/build-plugins.ts from plugins.json and the human\'s own plugins. Do not edit.\n'
  mkdirSync(join(dir, 'generated'), { recursive: true })
  put(
    join(dir, 'generated', 'client-plugins.ts'),
    `${head}import type { ClientPlugin } from '../src/kernel.ts'
${client
  .filter((p) => p.from === 'base')
  .map((p) => `import ${ident(p.name)} from '${folder(p)}/client.tsx'`)
  .join('\n')}

export const enabled = ${JSON.stringify(names)}
/** the human's own: each loads on its own (one that throws as it loads is skipped), and whatever they add to the
 *  slots is guarded, so one that throws stops only itself */
export const user = ${JSON.stringify(client.filter((p) => p.from === 'user').map((p) => p.name))}
export default [${client
      .map((p) => (p.from === 'base' ? ident(p.name) : `{ name: ${JSON.stringify(p.name)}, load: () => import('${folder(p)}/client.tsx') }`))
      .join(', ')}] as (ClientPlugin | { name: string; load: () => Promise<{ default: ClientPlugin }> })[]
`,
  )
  // the human's own server parts load one by one, so one that throws as it loads is only skipped (server/plugins.ts)
  put(
    join(dir, 'generated', 'server-plugins.ts'),
    `${head}import type { ServerPlugin } from '../server/plugin-api.ts'
import type { PluginEntry } from '../scripts/build-plugins.ts'
${server
  .filter((p) => p.from === 'base')
  .map((p) => `import ${ident(p.name)} from '${folder(p)}/server.ts'`)
  .join('\n')}

export const enabled = ${JSON.stringify(names)}
export const catalog: PluginEntry[] = ${JSON.stringify(catalog)}
export const user: [string, () => Promise<{ default: ServerPlugin }>][] = [${server
      .filter((p) => p.from === 'user')
      .map((p) => `[${JSON.stringify(p.name)}, () => import('${folder(p)}/server.ts')]`)
      .join(', ')}]
export default [${server
      .filter((p) => p.from === 'base')
      .map((p) => ident(p.name))
      .join(', ')}]
`,
  )
  return names
}

if (import.meta.main) {
  if (process.argv.includes('--user')) stageUserPlugins(root)
  const names = writeRegistries()
  console.log(`plugins: ${names.join(', ')}`)
}
