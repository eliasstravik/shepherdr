// The Settings block Shepherdr ends every new task's brief with: its heading, the words that say who changed a line,
// and a reader for inspecting its settings. The chat displays the full original text verbatim.

/** the block's first line */
export const SETTINGS_HEAD = 'Settings: (from shepherdr show; where the brief above says otherwise, it wins)'
/** what that line said in briefs written before */
export const OLD_HEADS = ['How tasks work (from Settings; where the brief above says otherwise, it wins):', "How to work (Shepherdr's defaults; where the brief above says otherwise, it wins):"]

/** who set a line of the block, where it differs from Shepherdr's own default: the coordinator for this one task
 *  (task add --set and its other flags), or the level of Settings it comes from */
export type SetBy = 'task' | 'space' | 'machine' | 'all'
export const SET_BY: Record<SetBy, string> = { task: 'set by coordinator for this task', space: "this space's setting", machine: "this machine's setting", all: 'your setting for every machine' }

/** one line of the block: its label ("Review"), the rest, and who changed it (none: Shepherdr's own default) */
export interface SettingLine {
  label: string
  text: string
  by?: string
}

/** a brief (or a first message holding one) around its Settings block, the block's lines read out; null without one */
export function readBrief(text: string): { before: string; lines: SettingLine[]; after: string } | null {
  const at = [SETTINGS_HEAD, ...OLD_HEADS].map((h) => [text.lastIndexOf(h), h.length] as const).find(([i]) => i >= 0)
  if (!at) return null
  const rest = text.slice(at[0] + at[1]).replace(/^\n/, '').split('\n')
  const n = rest.findIndex((l) => !l.startsWith('- '))
  const block = n < 0 ? rest : rest.slice(0, n)
  const marks = Object.values(SET_BY)
  const lines = block.map((l): SettingLine => {
    const line = l.slice(2)
    const by = marks.find((m) => line.endsWith(` (${m})`))
    const body = by ? line.slice(0, -(by.length + 3)) : line
    const colon = body.indexOf(': ')
    return { label: colon > 0 ? body.slice(0, colon) : '', text: colon > 0 ? body.slice(colon + 2) : body, ...(by ? { by } : {}) }
  })
  return { before: text.slice(0, at[0]).trimEnd(), lines, after: (n < 0 ? [] : rest.slice(n)).join('\n').trim() }
}
