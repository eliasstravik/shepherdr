// A long reply folds to its first lines with Show more, like Slack: the chat stays easy to scan on a phone. Show less
// folds it again. Search and a reply's quote open a folded reply when they jump into it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DownIcon } from '@client/ui.tsx'

/** taller than this (px) it folds, to 300px (max-h-75) */
const FOLD_AT = 640

/** the replies opened (by their message id), kept while the screen is: a chat drawn again keeps them open */
const opened = new Set<string>()

/** open a folded reply, as a jump into it does */
export function unfold(id: string) {
  if (opened.has(id)) return
  opened.add(id)
  dispatchEvent(new CustomEvent('shepherdr:unfold', { detail: id }))
}

export function Fold({ id, children }: { id: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const [open, setOpen] = useState(() => opened.has(id))
  useLayoutEffect(() => {
    const el = inner.current!
    const measure = () => setTall(el.offsetHeight > FOLD_AT)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === id && setOpen(true)
    addEventListener('shepherdr:unfold', on)
    return () => removeEventListener('shepherdr:unfold', on)
  }, [id])
  const folded = tall && !open
  const toggle = () => {
    if (open) {
      opened.delete(id)
      setOpen(false)
      // folding a reply read from far down brings its start back into view
      requestAnimationFrame(() => {
        const top = box.current?.getBoundingClientRect().top ?? 0
        if (top < 80) box.current?.scrollIntoView({ block: 'start' })
      })
    } else {
      opened.add(id)
      setOpen(true)
    }
  }
  return (
    <>
      <div
        ref={box}
        data-folded={folded ? '' : undefined}
        className={folded ? 'max-h-75 overflow-hidden [mask-image:linear-gradient(#000_calc(100%-64px),transparent)]' : undefined}
      >
        <div ref={inner}>{children}</div>
      </div>
      {tall ? (
        <button
          type="button"
          aria-expanded={!folded}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          className="relative mt-1 flex items-center gap-1 text-[0.8125rem] font-medium text-fg2 after:absolute after:-inset-x-2 after:-inset-y-2.5 hover:text-fg phone:text-[0.9375rem]"
        >
          {folded ? 'Show more' : 'Show less'}
          <DownIcon className={folded ? 'size-4' : 'size-4 rotate-180'} />
        </button>
      ) : null}
    </>
  )
}
