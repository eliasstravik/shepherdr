// The status bar, as the window's (mods/workspace-status-chat): the shown space's machine as the sidebar names it,
// its branch, and the red Needs you badge (the Tasks panel's count, everywhere) when something needs you. No agent
// count: the Tasks panel shows the work. Wider than a phone, under everything; a phone has no room for it, and says
// the same elsewhere (the machine over its spaces, the branch on the space's row, Needs you on Tasks).
// The window's last item, its palette key ("Ctrl+Shift+P  Commands"), opens Herdr's own command palette, which the web
// app has none of: Jump ("Search or jump to") is in the sidebar.
import { useStore } from './kernel.ts'
import { attentionCounts } from './attention.ts'
import { MonitorIcon, ServerIcon } from './ui.tsx'
import { machineName } from '@shared/types.ts'

/** a git branch (the window's branch.svg) */
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className={className}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 3-7 4" />
    </svg>
  )
}

export function StatusBar() {
  const snap = useStore((s) => s.snap)
  const placeId = useStore((s) => s.ui.place)
  if (!snap) return null
  const place = snap.places.find((p) => p.id === placeId)
  const m = snap.machines?.find((x) => x.machine === place?.machine)
  const here = !place || !!m?.here || place.machine === snap.host
  const machine = machineName(snap.machines, place?.machine) || 'This computer'
  const needs = attentionCounts(snap, snap.places.map((p) => p.id)).need
  const label = 'flex min-w-0 items-center gap-1.5'
  return (
    <footer aria-label="Status" className="flex h-7 shrink-0 items-center gap-4 border-t border-line px-3.5 text-xs text-fg3">
      <span className={label}>
        {here ? <MonitorIcon className="size-3.5 shrink-0" /> : <ServerIcon className="size-3.5 shrink-0" />}
        <span className="truncate">{machine}</span>
      </span>
      {place?.branch ? (
        <span className={label}>
          <BranchIcon className="size-3.5 shrink-0" />
          <span className="truncate">{place.branch}</span>
        </span>
      ) : null}
      {needs > 0 ? (
        <span className={label}>
          <span className="attention-badge" aria-hidden="true"><span className="attention-badge-need tabular-nums">{needs > 9 ? '9+' : needs}</span></span>
          Needs you
        </span>
      ) : null}
    </footer>
  )
}
