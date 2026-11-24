// A shortcut as it shows beside a menu row, a palette row or in the sheet: one cap per key (⌘ ⇧ K on a Mac, Ctrl Shift K
// elsewhere), "then" between a sequence's keys. Hidden where a finger is the pointer: no keyboard to press it with.
import { Fragment } from 'react'
import { useKeys } from './commands.ts'
import { caps, say } from './keys.ts'

export function Kbd({ chord }: { chord: string }) {
  return (
    <span className="kcap" aria-label={say(chord)}>
      {caps(chord).map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="then">then</span>}
          {step.map((c, j) => <kbd key={j}>{c}</kbd>)}
        </Fragment>
      ))}
    </span>
  )
}

/** a command's first shortcut, if it has one */
export function KeysOf({ id }: { id: string }) {
  const k = useKeys(id)
  return k[0] ? <Kbd chord={k[0]} /> : null
}
