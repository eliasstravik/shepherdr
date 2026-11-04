// Search only the view model already shared with the screen. No files, tool output, artifact HTML or secret store.
import type { Chat, Snapshot } from '../../shared/types.ts'
import { findIn, messageText } from '../chat/days.ts'

export type SearchScope = { kind: 'all' } | { kind: 'machine' | 'space' | 'chat'; id: string }
export type SearchKind = 'Spaces' | 'Tasks' | 'Messages' | 'Artifacts'
export interface SearchHit {
  key: string
  kind: SearchKind
  label: string
  context: string
  place: string
  task?: string
  chat?: string
  message?: string
  artifact?: string
  at: number
}

export function searchChats(snap: Snapshot, scope: SearchScope) {
  const places = snap.places.filter(p => scope.kind === 'all' || scope.kind === 'chat' || (scope.kind === 'space' ? p.id === scope.id : p.machine === scope.id))
  const chats = places.map(p => ({ key: p.chat, place: p.id, label: p.name }))
  for (const t of snap.tasks) {
    if (!places.some(p => p.id === t.place)) continue
    // Completed agents still have a readable chat even when their running agent record is gone.
    chats.push({ key: t.agent?.chat ?? `${t.id}/Agent`, place: t.place, label: `${t.id} · ${t.name}` })
  }
  return [...new Map(chats.filter(c => scope.kind !== 'chat' || c.key === scope.id).map(c => [c.key, c])).values()]
}

const words = (q: string, ...s: (string | undefined)[]) => q.toLowerCase().trim().split(/\s+/).every(w => s.some(v => v?.toLowerCase().includes(w)))

export function searchResults(snap: Snapshot, scope: SearchScope, q: string, chats: Record<string, Chat>): SearchHit[] {
  const sources = searchChats(snap, scope)
  const inPlace = (id: string) => scope.kind === 'all' || (scope.kind === 'space' && id === scope.id) || (scope.kind === 'machine' && snap.places.some(p => p.id === id && p.machine === scope.id))
  const context = (id: string) => {
    const p = snap.places.find(p => p.id === id)
    return `${p?.name ?? id} · ${snap.machines.find(m => m.machine === p?.machine)?.name ?? p?.machine ?? ''}`
  }
  const hits: SearchHit[] = []
  for (const p of snap.places) if (inPlace(p.id) && words(q, p.name, context(p.id))) hits.push({ key: `p:${p.id}`, kind: 'Spaces', label: p.name, context: context(p.id), place: p.id, at: 0 })
  for (const t of snap.tasks) if ((inPlace(t.place) || (scope.kind === 'chat' && sources.some(c => c.key === (t.agent?.chat ?? `${t.id}/Agent`)))) && (q.trim() || !t.archived) && words(q, t.id, t.name, t.sub, t.desc, context(t.place), t.report?.msg)) hits.push({ key: `t:${t.id}`, kind: 'Tasks', label: `${t.id} · ${t.name}`, context: `${t.archived ? 'Archived · ' : ''}${context(t.place)}`, place: t.place, task: t.id, at: Math.max(t.doneAt ?? 0, chats[t.agent?.chat ?? `${t.id}/Agent`]?.messages.reduce((at, m) => Math.max(at, m.at ?? 0), 0) ?? 0) })
  for (const a of snap.artifacts ?? []) if ((inPlace(a.place) || (scope.kind === 'chat' && (a.chats?.includes(scope.id) || chats[scope.id]?.messages.some(m => m.artifact?.id === a.id)))) && words(q, a.title, a.id, a.by)) hits.push({ key: `a:${a.id}`, kind: 'Artifacts', label: a.title, context: `${context(a.place)} · ${a.by} · v${a.v}`, place: a.place, artifact: a.id, at: a.at })
  for (const c of sources) {
    const msgs = chats[c.key]?.messages ?? []
    const found = q.trim() ? new Set(findIn(msgs, q)) : null
    for (const m of msgs) {
      if (m.waiting || (found ? !found.has(m.id) : !(m.text || m.file || m.question))) continue
      hits.push({ key: `m:${c.key}:${m.id}`, kind: 'Messages', label: searchExcerpt(messageText(m), q), context: `${c.label} · ${context(c.place)}`, place: c.place, chat: c.key, message: m.id, at: m.at ?? 0 })
    }
  }
  return hits.sort((a, b) => b.at - a.at)
}

/** Put the actual matching words in view, even in a long folded reply. */
export function searchExcerpt(text: string, q: string) {
  const match = q.trim() ? text.toLowerCase().indexOf(q.trim().toLowerCase()) : 0
  const start = Math.max(0, match - 70)
  return `${start ? '…' : ''}${text.slice(start, start + 240)}${text.length > start + 240 ? '…' : ''}`
}
