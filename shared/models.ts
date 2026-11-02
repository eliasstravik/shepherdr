// Pure CLI model catalogs and parsers; no process launches or state paths.
export interface Model {
  /** what the CLI takes: claude-opus-5-5, gpt-6-sol, exe-dev-openai/gpt-4.1@llm */
  id: string
  /** what the screen says: Opus 5.5 */
  label: string
  /** the effort levels it takes, lowest first; none: it has no effort to set */
  efforts: string[]
  /** its own default level */
  effort?: string
}

export interface CliModels {
  /** what the menus offer, in the CLI's own order */
  models: Model[]
  /** older ones it still takes by id (--model claude-opus-4-8), offered only once one is in use */
  others?: Model[]
  /** every level the CLI takes, for its own default model */
  efforts: string[]
  /** the model it starts on by itself, by id: what the + menu shows until one is picked */
  default?: string
  /** what it was read from (a version, a binary), and when */
  from?: string
  at?: number
}

/** the speeds a chat can be restarted on; each CLI's own word for them is in server/core/agents.ts */
export const SPEEDS = ['normal', 'fast']

/** a speed as a CLI logs it, in plain words: Claude Code's usage.speed and Codex's service_tier (priority is what its
 *  config calls fast); one Shepherdr doesn't know stays as logged */
export function speedWord(value: unknown): string | undefined {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!v) return undefined
  return v === 'standard' || v === 'default' ? 'normal' : v === 'priority' ? 'fast' : v
}

/** every level any CLI takes, lowest first; off and none are the same, lowest is the old name for the lowest level */
const RANK: Record<string, number> = { off: 0, none: 0, lowest: 1, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, ultra: 7 }
export const LEVELS = Object.keys(RANK)

const CLAUDE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const PI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const claude = (id: string, label: string, effort: string): Model => ({ id, label, efforts: CLAUDE_LEVELS, effort })
const codex = (id: string, label: string, effort: string, ultra = true): Model => ({ id, label, efforts: [...CLAUDE_LEVELS, ...(ultra ? ['ultra'] : [])], effort })

/** what each CLI takes when it can't be asked (kept up to date by hand; the CLI's own answer wins) */
export const TABLE: Record<string, CliModels> = {
  claude: {
    models: [claude('claude-fable-5-1', 'Fable 5.1', 'high'), claude('claude-opus-5-5', 'Opus 5.5', 'medium'), claude('claude-sonnet-5-5', 'Sonnet 5.5', 'medium'), claude('claude-haiku-5-5', 'Haiku 5.5', 'medium')],
    efforts: CLAUDE_LEVELS,
    default: 'claude-opus-5-5',
  },
  codex: {
    models: [codex('gpt-6.1-sol', 'GPT-6.1-Sol', 'low'), codex('gpt-6-astra', 'GPT-6-Astra', 'medium'), codex('gpt-6-sol', 'GPT-6-Sol', 'medium'), codex('gpt-6-luna', 'GPT-6-Luna', 'medium', false), codex('gpt-5.6-sol', 'GPT-5.6-Sol', 'low'), codex('gpt-5.6-terra', 'GPT-5.6-Terra', 'medium'), codex('gpt-5.6-luna', 'GPT-5.6-Luna', 'medium', false)],
    efforts: [...CLAUDE_LEVELS, 'ultra'],
  },
  // pi reaches many providers' models: only pi itself can list them
  pi: { models: [], efforts: PI_LEVELS },
}

/** Claude Code's families as its /model menu offers them, newest of each; its aliases (opus, haiku) name these too */
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku']
/** the level nearest to this one among these, a tie going to the lower; nothing for the CLI's own or an unknown word */
export function nearest(levels: string[], effort?: string): string | undefined {
  const e = effort?.trim().toLowerCase()
  if (!e || e === 'default' || !levels.length) return undefined
  if (levels.includes(e)) return e
  const r = RANK[e]
  if (r === undefined) return undefined
  return levels.reduce((best, l) => (Math.abs(RANK[l] - r) < Math.abs(RANK[best] - r) ? l : best))
}

/** the levels a --help lists for this flag: "--effort <level> … (low, medium, high, xhigh, max)" */
export function helpLevels(help: string, flag: string): string[] {
  const m = help.replace(/\s+/g, ' ').match(new RegExp(`${flag} <\\w+>[^-]*?[(:] ?((?:[a-z]+, )+[a-z]+)`))
  return m ? m[1].split(', ').filter((l) => l in RANK) : []
}

/** Claude Code's model catalog as grep finds it in its install: each model's id, family and name, then its
 *  capabilities (effort, xhigh_effort, max_effort) and default level */
export function parseClaude(catalog: string, help: string): CliModels | undefined {
  const levels = helpLevels(help, '--effort')
  const all: (Model & { family: string })[] = []
  for (const line of catalog.split('\n')) {
    const id = line.match(/^\{id:"([^"]+)",family:"([^"]+)",display_name:"([^"]+)"/)
    const last = all.at(-1) as (Model & { family: string; caps?: boolean; dflt?: boolean }) | undefined
    if (id) all.push({ id: id[1], family: id[2], label: id[3], efforts: [] })
    else if (last && !last.caps && line.startsWith('capabilities:')) {
      last.caps = true
      const caps = line.match(/"([a-z_]+)"/g)?.map((x) => x.slice(1, -1)) ?? []
      const has = caps.includes('effort') ? ['low', 'medium', 'high', ...(caps.includes('xhigh_effort') ? ['xhigh'] : []), ...(caps.includes('max_effort') ? ['max'] : [])] : []
      last.efforts = levels.length ? has.filter((l) => levels.includes(l)) : has
    } else if (last && !last.dflt && last.caps && line.startsWith('default_effort:')) {
      last.dflt = true
      last.effort = line.match(/"([a-z]+)"/)?.[1]
    }
  }
  const tidy = ({ id, label, efforts, effort }: Model): Model => ({ id, label, efforts, ...(effort && efforts.includes(effort) ? { effort } : {}) })
  const models = FAMILIES.map((f) => all.findLast((m) => m.family === f)).filter((m): m is Model & { family: string } => !!m)
  if (!models.length) return undefined
  return {
    models: models.map(tidy),
    others: all.filter((m) => !models.includes(m)).map(tidy),
    efforts: levels.length ? levels : CLAUDE_LEVELS,
    default: models.find((m) => m.family === 'opus')?.id ?? models[0].id,
  }
}

/** `codex debug models`: the ones it lists in its own picker, and the hidden ones it still takes */
export function parseCodex(json: string): CliModels | undefined {
  type Raw = { slug?: string; display_name?: string; visibility?: string; default_reasoning_level?: string; supported_reasoning_levels?: { effort?: string }[] }
  let raw: Raw[]
  try {
    const d = JSON.parse(json.slice(json.indexOf('{')))
    raw = Array.isArray(d) ? d : d.models
  } catch {
    return undefined
  }
  if (!Array.isArray(raw)) return undefined
  const model = (m: Raw): Model => {
    const efforts = (m.supported_reasoning_levels ?? []).map((l) => l.effort ?? '').filter((l) => l in RANK).sort((a, b) => RANK[a] - RANK[b])
    return { id: m.slug!, label: m.display_name || m.slug!, efforts, ...(m.default_reasoning_level && efforts.includes(m.default_reasoning_level) ? { effort: m.default_reasoning_level } : {}) }
  }
  const ok = raw.filter((m) => m.slug)
  const models = ok.filter((m) => m.visibility !== 'hide').map(model)
  if (!models.length) return undefined
  const efforts = [...new Set(models.flatMap((m) => m.efforts))].sort((a, b) => RANK[a] - RANK[b])
  return { models, others: ok.filter((m) => m.visibility === 'hide').map(model), efforts }
}

/** `pi --list-models`: a table of provider, model, …, thinking (yes or no); the levels from its --help */
export function parsePi(list: string, help: string): CliModels | undefined {
  const levels = helpLevels(help, '--thinking')
  const efforts = levels.length ? levels : PI_LEVELS
  const rows = list.split('\n').map((l) => l.trim().split(/\s+/))
  const head = rows.findIndex((r) => r[0] === 'provider' && r[1] === 'model')
  if (head < 0) return undefined
  const think = rows[head].indexOf('thinking')
  const found = rows.slice(head + 1).filter((r) => r.length >= 2 && r[0])
  const names = found.map((r) => r[1])
  const models = found.map((r) => ({
    id: `${r[0]}/${r[1]}`,
    // a model's own name, unless another provider has one so named too
    label: names.indexOf(r[1]) === names.lastIndexOf(r[1]) ? r[1] : `${r[0]}/${r[1]}`,
    efforts: think < 0 || r[think] === 'yes' ? efforts : [],
  }))
  return models.length ? { models, efforts } : undefined
}

