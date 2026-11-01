// Needs you: everything waiting on the human, from every space on every machine, on one list beside the chat. Each card
// is the agent's own, answered here as in its chat (src/needs.ts keeps the list still under the thumb). The chats keep
// their cards; a coordinator's only says a task needs you and leads here.
import { useLayoutEffect, useRef, useState } from 'react'
import { definePlugin, goChat, openTask, useSnap } from '@client/kernel.ts'
import { holdNeeds, needKey, type HeldNeed } from '@client/needs.ts'
import { Empty, LinkButton } from '@client/ui.tsx'
import { CardShell, QuestionCard, ReplyOnCard, SecretCard } from '@plugins/chat/client.tsx'
import { machineName, type Chat, type Need, type Snapshot } from '@shared/types.ts'

function NeedCard({ need, snap }: { need: Need; snap: Snapshot }) {
  const task = snap.tasks.find((t) => t.id === need.task)
  const place = snap.places.find((p) => p.id === need.place)
  const who = need.task ?? place?.name ?? need.chat
  const source = { id: who, title: task?.name }
  const chat: Chat = { key: need.chat, cli: '', messages: [] }
  if (need.question) return <QuestionCard q={need.question} chat={chat} msg={need.question.id} from={who} source={source} oneTap={need.tap} />
  if (need.secret) return <SecretCard ask={need.secret} chat={chat} source={source} />
  return <ReplyOnCard ask={{ chat: need.chat, open: true }} reply={{ id: need.reply, text: need.text || 'Waits for your reply' }} task={who} source={source} />
}

/** one place on the list: where the need is from, and its card. Gone, it holds the height it had */
function Slot({ held, snap }: { held: HeldNeed; snap: Snapshot }) {
  const { need, gone } = held
  const box = useRef<HTMLDivElement>(null)
  const height = useRef(0)
  // from a tap on, it doesn't shrink: an answer clears its note before the server says it went
  const [floor, setFloor] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (gone || !el) return
    // it grows with a note typed in its card, right up to the moment it goes
    height.current = el.offsetHeight
    const sized = new ResizeObserver(() => { height.current = el.offsetHeight })
    sized.observe(el)
    return () => sized.disconnect()
  }, [gone])
  const place = snap.places.find((p) => p.id === need.place)
  const machine = place ? machineName(snap.machines, place.machine) : ''
  const off = place?.status === 'off'
  return (
    <div ref={box} data-need={need.id} data-need-gone={gone ? '' : undefined} onClickCapture={() => setFloor(box.current?.offsetHeight ?? 0)} style={{ minHeight: gone ? height.current : floor }} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 px-1 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">
        <span data-need-where className="min-w-0 truncate">{[machine, place?.name].filter(Boolean).join(' · ')}{off ? " · can't reach it now" : ''}</span>
        <LinkButton onClick={() => (need.task ? openTask(need.task) : goChat(need.chat))}>Open chat</LinkButton>
      </div>
      {gone ? <CardShell title={need.question?.title ?? (need.secret ? `Secret: ${need.secret.name}` : `${need.task ?? 'Agent'} waited for a reply`)}><span className="text-fg2">No longer waiting</span></CardShell> : <NeedCard need={need} snap={snap} />}
    </div>
  )
}

function NeedsList() {
  const snap = useSnap()!
  // kept while the view is open: leaving it and coming back starts oldest first again, without what no longer waits
  const held = useRef<HeldNeed[]>([])
  const [, redraw] = useState(0)
  held.current = holdNeeds(held.current, snap.needs)
  if (!held.current.length) return <Empty>Nothing needs you.</Empty>
  const clear = () => {
    held.current = []
    redraw((n) => n + 1)
  }
  return (
    <div data-needs className="flex flex-col gap-3 p-3 phone:px-4">
      {/* only with nothing open, so it moves nothing; its room is always there, so its coming and going moves nothing either */}
      <div className="-mb-2 flex min-h-6 justify-end px-1">{held.current.every((h) => h.gone) ? <LinkButton onClick={clear}>Clear</LinkButton> : null}</div>
      {held.current.map((h) => <Slot key={needKey(h.need)} held={h} snap={snap} />)}
    </div>
  )
}

export default definePlugin({
  name: 'needs',
  setup(reg) {
    reg.views.needs = NeedsList
  },
})
