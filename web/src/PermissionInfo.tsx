import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { permissionHelp, NAMES } from '@core/agents.js'
import { Dialog } from './rowmenu.tsx'

const shapes: Record<string, ReactNode> = {
  ask: <><path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="M10 9a2 2 0 1 1 3 1.7c-1 .6-1 1-1 2.3M12 16h.01"/></>,
  approve: <><path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
  full: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M9 10V6a4 4 0 0 1 8 0M12 14v3"/></>,
  read: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
}
export function PermissionIcon({ kind = 'ask', className = 'size-4 shrink-0' }: { kind?: string; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>{shapes[kind] ?? shapes.ask}</svg>
}
export function PermissionInfo({ agent, perm }: { agent: string; perm?: string | null }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" aria-label="About permissions" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="press-dim inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg2 hover:bg-hover">ⓘ</button>
    {open ? createPortal(<div className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}><Dialog title={`Permissions · ${(NAMES as Record<string, string>)[agent] ?? 'Agent'}`} cancel="Done" buttons={null} onCancel={() => setOpen(false)}>
      <div className="flex flex-col gap-4">
        {permissionHelp(agent, perm).map((p) => <div key={p.label}>
          <div className="mb-1 flex items-center gap-2 font-medium"><PermissionIcon kind={p.icon} />{p.label}</div>
          <p className="text-sm text-fg2">{p.about}</p>
        </div>)}
        <p className="text-xs text-fg3">Settings apply to new launches. Chat changes restart only that agent. Task permissions are set separately.</p>
      </div>
    </Dialog></div>, document.body) : null}
  </>
}
