// What each CLI's models and effort levels really are, so the + menu, Settings and task add offer only what it takes.
// Each CLI is asked itself where it can tell: Claude Code's own model catalog in its install (which models it knows
// and which take xhigh and max) and its --help, `codex debug models`, `pi --list-models` and pi's --help. What they
// said is kept in cli-models.json and asked again by version (claude) or every few hours; until then, or where a CLI
// can't tell, the table below holds. A level a model lacks becomes the nearest it has (nearest), never an error at start.
import { realpathSync, statSync } from 'node:fs'
import { readJson, writeJson } from '../store.ts'

import { TABLE, LEVELS, nearest, parseClaude, parseCodex, parsePi, type Model, type CliModels } from '../../shared/models.ts'
export { TABLE, LEVELS, nearest, parseClaude, parseCodex, parsePi, helpLevels, type Model, type CliModels } from '../../shared/models.ts'

const STALE = 6 * 3_600_000
const TEST = process.env.NODE_ENV === 'test'

let cache: Record<string, CliModels> = TEST ? {} : readJson('cli-models.json', {})
const asking = new Set<string>()
const looked = new Map<string, number>()

/** what this CLI takes; nothing for a CLI Shepherdr passes no model or effort to */
export function modelsOf(kind: string): CliModels | undefined {
  if (!TABLE[kind]) return undefined
  if (!TEST) ask(kind)
  const c = cache[kind]
  return c?.models.length || (c && !TABLE[kind].models.length) ? c : TABLE[kind]
}

/** a model by its id, its name on screen or an alias (opus, sonnet:high's sonnet), any case; nothing when this CLI
 *  doesn't have it, or can't tell (pi before it was asked) */
export function findModel(kind: string, value?: string): Model | undefined {
  const v = value?.trim().toLowerCase()
  const c = modelsOf(kind)
  if (!v || v === 'default' || !c) return undefined
  const all = [...c.models, ...(c.others ?? [])]
  return (
    all.find((m) => m.id.toLowerCase() === v || m.label.toLowerCase() === v) ??
    (kind === 'claude' ? c.models.find((m) => m.id.startsWith(`claude-${v}-`) || m.id === `claude-${v}`) : undefined) ??
    // pi: a model without its provider
    (kind === 'pi' ? all.find((m) => m.id.toLowerCase().endsWith(`/${v}`)) : undefined)
  )
}

/** whether this CLI can say which models it has: else any model id goes */
export const knowsModels = (kind: string) => !!modelsOf(kind)?.models.length

/** the model as the CLI takes it: its id, or what was written when the CLI can't tell */
export function modelArg(kind: string, value?: string): string | undefined {
  if (!value || value === 'default') return undefined
  return findModel(kind, value)?.id ?? value
}

/** the levels this model takes (the CLI's own, for its default model or one it can't tell about) */
export function effortsOf(kind: string, model?: string): string[] {
  const c = modelsOf(kind)
  if (!c) return []
  return findModel(kind, model ?? c.default)?.efforts ?? c.efforts
}

/** an effort as this CLI and model take it: the nearest level it has, or nothing for its own default */
export const effortFor = (kind: string, effort?: string, model?: string) => nearest(effortsOf(kind, model), effort)

/* ---------- asking the CLIs ---------- */

function ask(kind: string) {
  // looked at most once a minute: the + menu asks on every chat it draws
  if (Date.now() - (looked.get(kind) ?? 0) < 60_000) return
  looked.set(kind, Date.now())
  const c = cache[kind]
  const from = kind === 'claude' ? claudeBinary() : undefined
  if (c && (kind === 'claude' ? c.from === from : Date.now() - (c.at ?? 0) < STALE)) return
  if (asking.has(kind)) return
  asking.add(kind)
  read(kind, from)
    .then((got) => {
      if (!got?.models.length) return
      cache = { ...cache, [kind]: { ...got, from, at: Date.now() } }
      writeJson('cli-models.json', cache)
    })
    .catch(() => {})
    .finally(() => asking.delete(kind))
}

/** the Claude Code install that runs, by its path and when it changed: a new version is read again */
function claudeBinary() {
  try {
    const p = realpathSync(Bun.which('claude') ?? '')
    return `${p}@${statSync(p).mtimeMs}`
  } catch {
    return undefined
  }
}

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const t = setTimeout(() => p.kill(), 20_000)
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  clearTimeout(t)
  return `${out}${err}`
}

async function read(kind: string, from?: string): Promise<CliModels | undefined> {
  if (kind === 'claude' && from) {
    const bin = from.slice(0, from.lastIndexOf('@'))
    const [catalog, help] = await Promise.all([run(['grep', '-aoE', '\\{id:"claude-[a-z0-9-]+",family:"[a-z]+",display_name:"[^"]+"|capabilities:\\[[^]]*\\]|default_effort:"[a-z]+"', bin]), run([bin, '--help'])])
    return parseClaude(catalog, help)
  }
  if (kind === 'codex') return parseCodex(await run(['codex', 'debug', 'models']))
  if (kind === 'pi') {
    const [list, help] = await Promise.all([run(['pi', '--list-models']), run(['pi', '--help'])])
    return parsePi(list, help)
  }
  return undefined
}

/** for tests: what the CLIs said */
export function setModels(kind: string, c: CliModels | undefined) {
  cache = { ...cache }
  if (c) cache[kind] = c
  else delete cache[kind]
}
