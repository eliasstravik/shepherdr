// Only a file reference enters agent launch settings. The bearer itself never does.
import { randomUUID } from 'node:crypto'
const files = new Map<string, string>()
export function secretFileId(chat: string) {
  let id = files.get(chat)
  if (!id) { id = randomUUID(); files.set(chat, id) }
  return id
}
