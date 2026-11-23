// Every emoji, with search: behind + in a message's menu, and a space's icon (web/src/space-icon.tsx)
import { useEffect, useState } from 'react'
import { loadEmoji, search, tone, withTone, type Group } from './emoji.ts'

/** every emoji, with search */
export function All({ onPick }: { onPick: (e: string) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => void loadEmoji().then(setGroups), [])
  const skin = tone()
  const found = groups && q.trim() ? search(groups, q) : null
  return (
    <div className="pk">
      <input className="inp" name="eq" aria-label="Search emoji" placeholder="Search emoji" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="emolist" role="listbox" aria-label="Emoji">
        {(found ?? groups?.flatMap((g) => g.list) ?? []).slice(0, found ? 120 : 400).map((e) => {
          const ch = e.tone ? withTone(e.e, skin) : e.e
          return <button type="button" key={e.e} role="option" aria-selected={false} aria-label={e.name} onClick={() => onPick(ch)}>{ch}</button>
        })}
      </div>
      {found && !found.length && <p className="hint" style={{ padding: 8 }}>No emoji matches.</p>}
    </div>
  )
}
