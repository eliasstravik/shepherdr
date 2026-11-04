// Phase 0: the page knows who you are and shows your machines live. The real screens replace this in phase 3.
import clsx from 'clsx'
import { useHello, useLink, useView } from './live.ts'

type Machine = { name: string; here: boolean; state: string; version?: string | null }
type Counts = Record<string, { working: number; blocked: number; done: number; idle: number }>

export function App() {
  const hello = useHello()
  const link = useLink()
  const machines = useView<Machine[]>('machines') ?? []
  const agents = useView<Counts>('agents') ?? {}

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-bg px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 sm:px-6">
        <img src="icon.svg?v=2" alt="" className="size-7 rounded-lg" />
        <h1 className="text-lg font-semibold text-fg sm:text-base">Shepherdr</h1>
        <span className={clsx('ml-auto text-sm', link === 'lost' ? 'text-need-fg' : 'text-fg3')}>
          {link === 'open' ? hello?.machine ?? '' : link === 'lost' ? 'Offline' : 'Connecting…'}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="rounded-box bg-bg p-4 shadow-box">
          <p className="text-base text-fg2 sm:text-sm">Signed in as</p>
          <p className="mt-1 truncate text-lg font-medium text-fg sm:text-base">{hello?.login ?? '…'}</p>
          {hello?.link && <p className="mt-1 truncate text-base text-fg3 sm:text-sm">{hello.link}</p>}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-base font-medium text-fg2 sm:text-sm">Machines</h2>
          <ul role="list" className="overflow-hidden rounded-box bg-bg shadow-box">
            {machines.map((m) => {
              const c = agents[m.here ? '' : m.name]
              const on = m.state === 'connected'
              return (
                <li key={m.name} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className={clsx('size-2 shrink-0 rounded-full', on ? 'bg-ready' : 'bg-muted')} />
                  <span className={clsx('min-w-0 flex-1 truncate text-base sm:text-sm', on ? 'text-fg' : 'text-fg3')}>
                    {m.name}
                    {m.here && <span className="text-fg3"> · this machine</span>}
                  </span>
                  {c && (
                    <span className="flex shrink-0 items-center gap-3 text-base tabular-nums sm:text-sm">
                      {c.blocked > 0 && <span className="text-need-fg">{c.blocked} need you</span>}
                      {c.working > 0 && <span className="text-work-fg">{c.working} working</span>}
                      {c.done > 0 && <span className="text-ready-fg">{c.done} done</span>}
                    </span>
                  )}
                  {!on && <span className="shrink-0 text-base text-fg3 sm:text-sm">Offline</span>}
                </li>
              )
            })}
          </ul>
        </section>
      </main>
    </div>
  )
}
