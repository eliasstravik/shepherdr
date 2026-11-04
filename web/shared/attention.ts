import type { Message } from './types.ts'

/** Coordinator questions survive unrelated task news. Native menus use the current terminal cards. */
export function coordinatorRequestIds(posted: readonly Pick<Message, 'question'>[], answers: Record<string, unknown>, native: string[], blocked: boolean): string[] {
  const ids = [...new Set([
    ...posted.flatMap((m) => m.question?.id.startsWith('ask:') && m.question.sent === undefined && answers[m.question.id] === undefined ? [m.question.id] : []),
    ...native.filter((id) => answers[id] === undefined),
  ])]
  return ids.length ? ids : blocked ? ['blocked'] : []
}
