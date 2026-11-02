import type { MergeEvidence, Message, Question } from '../../shared/types.ts'
import type { CoreSource } from './source.ts'

/** Resolve original and forwarded card displays from private records, never from stale chat copies. */
export class CoreCards {
  constructor(private source: CoreSource) {}
  private question(chat: string, question: Question): Question {
    const permission = this.source.store.get<{ chat: string; grant: string; settled?: boolean; allow?: boolean; expires: number; question: Question }>('permission', question.id)
    if (permission?.chat === chat) {
      if (permission.settled) {
        const sent = permission.question.sent ?? (permission.allow ? 0 : -1)
        return { ...question, ...permission.question, sent, ...(sent < 0 && !permission.allow ? { closed: permission.question.closed || permission.question.said || 'This request is no longer waiting' } : {}) }
      }
      const reason = permission.expires <= Date.now() ? 'Permission request expired' : this.source.agents.get(chat)?.grant !== permission.grant ? 'Session replaced; ask the agent for a fresh card' : undefined
      if (reason) return { ...question, sent: -1, said: reason, closed: reason }
    }
    const merge = this.source.store.get<{ task: string; head: string }>('merge-question', question.id)
    if (merge && chat === `${merge.task}/Agent`) {
      const task = this.source.tasks.get(merge.task)
      if (!task || task.chat !== chat || task.workflow !== 'ready' || task.mergeQuestion !== question.id || task.readyHead !== merge.head) {
        const reason = task?.workflow === 'merged' ? 'This task is already merged' : 'This merge request is no longer current'
        return { ...question, sent: -1, said: reason, closed: reason }
      }
      // What moved after the ready report: checks finish and a proof may come last.
      const watch = this.source.store.get<{ head?: string; checks?: MergeEvidence['checks'] }>('github-pr', task.id), proof = this.source.artifacts.proof(chat)
      if (question.evidence) return { ...question, evidence: { ...question.evidence, ...(watch?.checks && watch.head === merge.head ? { checks: watch.checks } : {}), ...(proof ? { proof } : {}) } }
    }
    const request = this.source.store.get<{ chat: string; grant: string; answered: boolean; question: Question }>('question', question.id)
    if (request?.chat === chat) {
      if (request.answered) return { ...question, ...request.question, sent: request.question.sent ?? -1 }
      if (this.source.agents.get(chat)?.grant !== request.grant) return { ...question, sent: -1, said: 'Session replaced; ask the agent for a fresh card', closed: 'Session replaced; ask the agent for a fresh card' }
    }
    return question
  }
  messages(chat: string, messages: Message[]): Message[] {
    const healthMachines = messages.some(message => message.card?.health) ? this.source.snapshot().machines : undefined
    return messages.map(message => {
      const health = message.card?.health, machine = health && healthMachines?.find(machine => machine.machine === health.machine)
      if (machine) message = { ...message, card: { ...message.card!, health: { ...health!, machine: machine.name } } }
      const question = message.question && this.question(chat, message.question)
      const ask = message.card?.ask
      if (!ask?.questions) return question ? { ...message, question } : message
      const questions = ask.questions.map(question => this.question(ask.chat, question))
      return { ...message, ...(question ? { question } : {}), card: { ...message.card!, ask: { ...ask, questions, open: questions.some(question => question.sent === undefined) } } }
    })
  }
}
