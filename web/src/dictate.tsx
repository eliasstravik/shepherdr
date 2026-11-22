// The mic in a message box (and in Feedback): dictation only. Tap to talk, tap again when done: the words land in the
// box. A voice call is the other thing (the wave button).
import { useEffect, useRef, useState } from 'react'
import { canDictate, dictate, type Dictation } from './dictation.ts'
import { has, notice } from './kernel.ts'
import { IB } from './ui.tsx'

export function DictateButton({ write }: { write: (text: string) => void }) {
  const [on, setOn] = useState(false)
  const live = useRef<Dictation | null>(null)
  useEffect(() => () => live.current?.cancel(), [])
  if (!has('voice')) return null
  const toggle = () => {
    if (live.current) {
      live.current.finish()
      return
    }
    if (!canDictate()) return notice('This browser has no microphone to dictate with.')
    setOn(true)
    live.current = dictate(
      (text) => {
        live.current = null
        setOn(false)
        if (text) write(text)
      },
      (why) => {
        live.current = null
        setOn(false)
        notice(why)
      },
    )
  }
  return <IB icon="mic" label={on ? 'Done dictating' : 'Dictate'} pressed={on} onClick={toggle} />
}
