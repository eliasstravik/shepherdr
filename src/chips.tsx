// The Tasks and Artifacts lists' chips, under their filter box: each a space (# gtm) or a whole machine (its emoji, or
// a server), and the lists show what is in any of them; none, everything. × takes one off; + Filter adds one from the
// sidebar's tree, or goes back to everything. They follow the place picked until the header's pin keeps them; one set
// for both lists. A phone's scroll sideways, + Filter staying at the end; there × and + Filter reach a finger's 44px
// past their 36px pills.
import clsx from 'clsx'
import { useState } from 'react'
import { machineName, type Snapshot } from '@shared/types.ts'
import { chipName, listView, setChips, useSnap, useStore, useUI } from './kernel.ts'
import { CheckIcon, HashIcon, ic, LayersIcon, Menu, MenuItem, MenuSeparator, PlusIcon, ServerIcon, XIcon } from './ui.tsx'

/** the machines in the sidebar's order, each with its spaces */
function tree(snap: Snapshot) {
  const keys = [...new Set([...(snap.machines ?? []).map((m) => m.machine), ...snap.places.map((p) => p.machine)])]
  return keys.map((k) => ({ chip: `m:${k}`, name: machineName(snap.machines, k), emoji: snap.machines?.find((m) => m.machine === k)?.emoji, spaces: snap.places.filter((p) => p.machine === k) }))
}

/** a chip's mark: a space's #, a machine's emoji or server */
function Mark({ snap, chip }: { snap: Snapshot; chip: string }) {
  if (!chip.startsWith('m:')) return <HashIcon className={clsx(ic, 'text-fg3')} />
  const e = snap.machines?.find((m) => m.id === chip)?.emoji
  return e ? <span aria-hidden className="grid size-4 shrink-0 place-items-center text-[0.875rem] leading-none">{e}</span> : <ServerIcon className={clsx(ic, 'text-fg3')} />
}

/** The lists' chips and + Filter: alone (a list with nothing to filter) it brings the filter box's room with it */
export function ListChips({ alone }: { alone?: boolean }) {
  const snap = useSnap()!
  const chips = useStore((s) => listView(s.ui, snap).chips)
  const phone = useUI((u) => u.device === 'phone')
  const row = (
    <div className="flex items-start gap-1.5 pt-1.5 phone:gap-2 phone:pt-2">
      <div
        role="group"
        aria-label="Showing"
        className={clsx('flex min-w-0 flex-1 gap-1.5 phone:gap-2', phone ? '-my-1 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap')}
      >
        {chips.length ? (
          chips.map((c) => {
            const name = chipName(snap, c)
            return (
              <div key={c} data-chip={c} className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-bubble py-1 pr-0.5 pl-1.5 text-[0.8125rem] text-fg phone:h-9 phone:pr-0 phone:pl-2.5 phone:text-[0.9375rem]">
                <Mark snap={snap} chip={c} />
                <span className="max-w-48 truncate whitespace-nowrap">{name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => setChips(chips.filter((x) => x !== c))}
                  className="press relative grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none phone:size-9 phone:after:absolute phone:after:-inset-y-1 phone:after:inset-x-0 phone:after:content-['']"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            )
          })
        ) : (
          <div className="flex h-7 shrink-0 items-center gap-1.5 pl-1.5 text-[0.8125rem] text-fg3 phone:h-9 phone:pl-2 phone:text-[0.9375rem]">
            <LayersIcon className={ic} />
            Everything
          </div>
        )}
      </div>
      <AddChip snap={snap} chips={chips} />
    </div>
  )
  return alone ? <div className="sticky top-0 z-2 bg-bg px-1.5 pt-0.5 pb-0.5 phone:px-2 phone:pt-1">{row}</div> : row
}

/** + Filter: the sidebar's tree, a space or a whole machine a tap adds (one already a chip, a tap takes off), and
 *  Everything at the top, which leaves none */
function AddChip({ snap, chips }: { snap: Snapshot; chips: string[] }) {
  const [open, setOpen] = useState(false)
  const pick = (c: string | null) => {
    setOpen(false)
    setChips(c === null ? [] : chips.includes(c) ? chips.filter((x) => x !== c) : [...chips, c])
  }
  const check = (on: boolean) => (on ? <CheckIcon className={ic} /> : null)
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="press flex h-7 items-center gap-1 rounded-full py-1 pr-2.5 pl-1.5 text-[0.8125rem] whitespace-nowrap text-fg2 shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover hover:text-fg keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none aria-expanded:bg-hover phone:relative phone:h-9 phone:pr-3 phone:pl-2 phone:text-[0.9375rem] phone:after:absolute phone:after:-inset-y-1 phone:after:inset-x-0 phone:after:content-['']"
      >
        <PlusIcon className={ic} />
        Filter
      </button>
      {open ? (
        <Menu label="Filter by place" onClose={() => setOpen(false)} className="absolute top-full right-0 z-21 mt-1.5 max-w-[calc(100vw-24px)] origin-top-right">
          <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
            <MenuItem role="menuitemcheckbox" aria-checked={!chips.length} icon={check(!chips.length)} onClick={() => pick(null)}>
              <span className="flex items-center gap-2">
                <LayersIcon className={clsx(ic, 'text-fg3')} />
                Everything
              </span>
            </MenuItem>
            <MenuSeparator />
            {tree(snap).map((m) => (
              <div key={m.chip} role="group" aria-label={m.name}>
                <MenuItem role="menuitemcheckbox" aria-checked={chips.includes(m.chip)} icon={check(chips.includes(m.chip))} onClick={() => pick(m.chip)}>
                  <span className="flex items-center gap-2 font-medium">
                    {m.emoji ? <span aria-hidden className="grid size-4 place-items-center leading-none">{m.emoji}</span> : <ServerIcon className={clsx(ic, 'text-fg3')} />}
                    {m.name}
                  </span>
                </MenuItem>
                {/* its spaces step in under it, as the sidebar's */}
                {m.spaces.map((p) => (
                  <MenuItem key={p.id} role="menuitemcheckbox" aria-checked={chips.includes(p.id)} aria-label={chipName(snap, p.id)} icon={check(chips.includes(p.id))} onClick={() => pick(p.id)}>
                    <span className="flex items-center gap-2 pl-4">
                      <HashIcon className={clsx(ic, 'text-fg3')} />
                      {p.name}
                    </span>
                  </MenuItem>
                ))}
              </div>
            ))}
          </div>
        </Menu>
      ) : null}
    </div>
  )
}
