import { Refusal } from './client.ts'
import { clip } from '../../shared/alerts.ts'
import type { Action, Choice, Question } from '../../shared/types.ts'
import { baseName, toolWords } from '../common/readers/steps.ts'

/** What a PermissionRequest hook hands back to its CLI. Extra fields go into the hook's decision as they are. */
export interface PermissionAnswer { allow: boolean; message?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
/** Claude's own question and plan tools arrive as a PermissionRequest but are the human's to answer, not to allow.
 *  Each question of a tool call is its own card; head is the first card, which holds the call. */
export interface NativeAsk { head: string; tool: string; input: Record<string, unknown>; stop?: string; answer?: string; reply?: PermissionAnswer }

const text = (value: unknown) => typeof value === 'string' ? value : ''
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** The mode "stop asking" returns to: what the agent ran on before planning, or edits without asking. */
const stopMode = (mode?: string) => mode === 'auto' || mode === 'bypassPermissions' ? mode : 'acceptEdits'
const STOP: Record<string, { label: string; description: string }> = {
  auto: { label: 'Approve, stop asking', description: 'Claude goes on in auto mode' },
  bypassPermissions: { label: 'Approve, stop asking', description: 'Claude goes on without any prompts' },
  acceptEdits: { label: 'Approve, stop asking about edits', description: 'Claude edits files without asking' },
}

/** The cards of a tool call, or undefined for any other tool: an ordinary permission. An unreadable question gives none. */
export function nativeCards(tool: string | undefined, input: unknown, id: string, mode?: string): { questions: Question[]; native: Omit<NativeAsk, 'head'> } | undefined {
  const value = record(input) ?? {}
  if (tool === 'ExitPlanMode') {
    const stop = stopMode(mode)
    return { native: { tool, input: value, stop }, questions: [{ id, title: 'Plan to approve', kind: 'Plan', plan: text(value.plan), to: 'Claude', noteRequiredFor: 2,
      choices: [STOP[stop], { label: 'Approve, keep asking', description: 'Claude asks before each edit' }, { label: 'Change the plan', description: 'Claude plans again from your note' }] }] }
  }
  if (tool !== 'AskUserQuestion') return
  const asked = Array.isArray(value.questions) ? value.questions.map(record) : []
  const questions = asked.flatMap((item, index): Question[] => {
    const options = Array.isArray(item?.options) ? item.options.map(record).filter(option => text(option?.label)) : []
    if (!item || !text(item.question)) return []
    return [{ id: index ? `${id}-${index}` : id, title: text(item.question), kind: 'Question', multi: item.multiSelect === true || undefined, other: true, to: 'Claude',
      choices: options.map(option => ({ label: text(option!.label), description: [text(option!.description), text(option!.preview)].filter(Boolean).join('\n') || undefined })) }]
  })
  return { native: { tool, input: value }, questions: questions.length === asked.length ? questions : [] }
}

/** Checks a card's answer. Throws for one the card did not offer. */
export function nativeAnswer(question: Question, action: Extract<Action, { type: 'answer' }>): { allow: boolean; sent: number; said: string } {
  const other = action.other?.trim(), selected = action.choices ?? [action.choice]
  if (other && question.other) return { allow: true, sent: -1, said: other }
  if (!selected.length || selected.some(index => !Number.isInteger(index) || index < 0 || index >= question.choices.length) || !question.multi && selected.length !== 1) throw new Refusal('Choose one of the card’s answers')
  const note = action.note?.trim()
  if (question.noteRequiredFor !== undefined && selected.includes(question.noteRequiredFor)) {
    if (!note) throw new Refusal('Add the note this choice asks for')
    return { allow: false, sent: selected[0], said: note }
  }
  return { allow: true, sent: selected[0], said: selected.map(index => question.choices[index].label).join(', ') }
}

/** The hook's reply once every card of a call is answered. Claude keeps its own prompt up unless an allow carries the input. */
export function nativeReply(native: NativeAsk, cards: { question: Question; native?: NativeAsk }[], sent: number, note = ''): PermissionAnswer {
  if (native.tool === 'AskUserQuestion') {
    return { allow: true, updatedInput: { ...native.input, answers: Object.fromEntries(cards.map(card => [card.question.title, card.native?.answer ?? ''])) } }
  }
  if (sent === 2) return { allow: false, message: `The human read your plan and wants it changed. Stay in plan mode, change the plan as they say, then present it again. Their words:\n\n${note}` }
  // Claude takes no words with a yes, so a note on an approved plan goes back as part of the plan.
  const input = note ? { ...native.input, plan: `${text(native.input.plan)}\n\n## The human's note on this plan\n\n${note}` } : native.input
  return { allow: true, updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: sent === 0 ? native.stop : 'default', destination: 'session' }] }
}

const SHOWN = 16_000
const TITLE = 120
/** the fields each tool's card words already show: any other goes below them, so nothing it would do goes unread */
const WORDED: Record<string, string[]> = { Bash: ['command', 'description'], Write: ['file_path', 'content'], Edit: ['file_path', 'old_string', 'new_string', 'replace_all'], NotebookEdit: ['notebook_path', 'new_source'],
  Read: ['file_path'], Glob: ['pattern', 'path'], Grep: ['pattern', 'path'], WebFetch: ['url', 'prompt'], WebSearch: ['query'] }
const shownLine = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)

/** What a tool asks to do, as a human reads it: the title at a glance, and below it all it would touch, never code. */
export function permissionWords(tool: string | undefined, input: unknown): Pick<Question, 'title' | 'screen'> {
  const value = record(input) ?? {}, path = text(value.file_path) || text(value.notebook_path)
  const fields = (worded: string[] = []) => Object.entries(value).filter(([key, item]) => !worded.includes(key) && item !== undefined && item !== null && item !== '').map(([key, item]) => `${key}: ${shownLine(item)}`).join('\n')
  // A title cut short leaves its whole words below: two targets must never look the same.
  const card = (verb: string, what: string, ...more: unknown[]) => {
    const title = clip(what, TITLE)
    return { title: `${verb}: ${title}`, screen: [...more, title !== what && what, fields(WORDED[tool!])].filter(Boolean).map(shownLine).join('\n\n').slice(0, SHOWN) || undefined }
  }
  switch (tool) {
    case 'Bash': return card('Run', text(value.command), value.description)
    case 'Write': return card('Write', baseName(path), path, value.content)
    case 'Edit': return card('Edit', baseName(path), path, value.replace_all === true && 'Every match in the file:', [`- ${text(value.old_string)}`, `+ ${text(value.new_string)}`].join('\n'))
    case 'NotebookEdit': return card('Edit', baseName(path), path, value.new_source)
    case 'Read': return card('Read', path)
    case 'Glob': case 'Grep': return card('Search', text(value.pattern), text(value.path))
    case 'WebFetch': return card('Open', text(value.url), value.prompt)
    case 'WebSearch': return card('Search the web', text(value.query))
  }
  return { title: `Use ${clip(toolWords(tool || 'a tool'), TITLE)}`, screen: fields().slice(0, SHOWN) || undefined }
}

const WHERE: Record<string, string> = { session: 'this session', localSettings: 'in this project', projectSettings: 'in this project', userSettings: 'on this device' }
const LONGEST_GRANT = 1000
const ruleWords = (rule: Record<string, unknown>) => {
  const tool = text(rule.toolName), content = text(rule.ruleContent), folder = /^\/(\/.*?)(?:\/\*\*)?$/.exec(content)?.[1]
  if (!tool) return undefined
  if (!content) return `all of ${tool}`
  if (tool === 'Bash') return `Run ${content}`
  return content.startsWith('domain:') ? content.slice(7) : `${tool} ${folder ?? content}`
}
/** What a grant allows, in words, or none for a grant the card couldn't say: nothing is allowed unread. */
function grantWords(grant: Record<string, unknown>) {
  const where = WHERE[text(grant.destination)]
  if (!where || JSON.stringify(grant).length > LONGEST_GRANT) return undefined
  if (grant.type === 'setMode') return grant.mode === 'acceptEdits' ? `All edits ${where}` : undefined
  if (grant.type === 'addDirectories' && Array.isArray(grant.directories) && grant.directories.length) return `Files in ${grant.directories.map(text).join(', ')} ${where}`
  if (grant.type !== 'addRules' || grant.behavior !== 'allow' || !Array.isArray(grant.rules) || !grant.rules.length) return undefined
  const rules = grant.rules.map(rule => ruleWords(record(rule) ?? {}))
  return rules.every(Boolean) ? `${rules.join(', ')} ${where}` : undefined
}

/** A card's choices: the CLI's own "don't ask again" grants, all in one, between Allow once and Deny. Codex gives none. */
export function permissionChoices(suggestions: unknown): { choices: Choice[]; always?: number; grants?: unknown[] } {
  const offered = (Array.isArray(suggestions) ? suggestions.slice(0, 8) : []).flatMap(item => { const grant = record(item), said = grant && grantWords(grant); return said ? [{ grant, said }] : [] })
  if (!offered.length) return { choices: [{ label: 'Allow once' }, { label: 'Deny' }] }
  return { always: 1, grants: offered.map(item => item.grant), choices: [{ label: 'Allow once' }, { label: 'Don’t ask again', description: offered.map(item => item.said).join(' · ') }, { label: 'Deny' }] }
}

export const nativeClosed = (reason: string): PermissionAnswer => ({ allow: false, message: `Shepherdr closed this without an answer: ${reason}. Nothing was approved or chosen. Ask again if you still need it.` })
export const NATIVE_UNREADABLE: PermissionAnswer = { allow: false, message: 'Shepherdr could not read this question. Ask it with shepherdr ask instead.' }
