// A task's page is never blank (SHEP-330): its brief is the first message, and until its agent is at work the page
// says in words what it waits for.
import type { Chat, Task, TaskBrief } from '@shared/types.ts'
import { signOf } from './typing.ts'

/** whether its agent has the brief, under it as a sent message's mark */
export function deliveryWord(state: TaskBrief['state']): string {
  return state === 'read' ? 'Read' : state === 'sent' ? 'Sent' : 'Not sent yet'
}

/** a brief longer than its few shown lines (six, about 40 characters each on a phone): it starts folded, with Show all.
 *  The page measures it once drawn and corrects this first guess. */
export function looksLong(text: string): boolean {
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0)
  return lines > 6
}

/** who wrote the brief, over it: the space's Assistant */
export function briefFrom(space: string | undefined): string {
  return space ? `From the Assistant in #${space}` : 'From the Assistant'
}

/** what the agent has done in its chat so far: its words, steps or a question */
const agentSaid = (chat: Chat | undefined) => !!chat?.messages.some((m) => m.who === 'agent' && !m.news && (m.text || m.activity || m.question || m.file || m.artifact))

/** Under the brief, while its agent isn't at work yet: queued, scheduled, not started, or starting. '' once its agent
 *  says or does anything, or while its working sign shows. */
export function startWords(t: Task, chat: Chat | undefined): string {
  if (t.status === 'queued') return t.afterTitle ? `Queued. It starts when “${t.afterTitle}”${t.afterMore ? ` and ${t.afterMore} more are` : ' is'} done.` : 'Queued. It starts when the tasks before it are done.'
  if (t.status === 'scheduled') return t.left ? `Scheduled. It starts in ${t.left}.` : 'Scheduled. It starts by itself.'
  if (t.status === 'todo' && !t.agent && !t.started) return 'Not started yet. It starts when you say go.'
  if (t.status !== 'todo' && t.status !== 'work') return ''
  // (its chat not here yet: nothing known to say)
  if (!chat || agentSaid(chat) || signOf(chat)) return ''
  return 'Its agent is starting.'
}
