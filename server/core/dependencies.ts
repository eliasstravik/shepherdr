import { Refusal } from './client.ts'

interface DependencyTask { id: string; localId?: string; place: string; machine: string; workflow: string; after?: string[] }
/** Resolve once to permanent combined-app IDs. No remote alias is kept in a mutable queue edge. */
export function taskDependencies(tasks: DependencyTask[], owner: { id?: string; place: string; machine: string }, input: string[], machineName: (machine: string) => string | undefined = machine => machine) {
  if (!Array.isArray(input) || input.length > 128 || input.some(value => typeof value !== 'string' || value.length > 1024)) throw new Refusal('Choose at most 128 task dependencies')
  const refs = input.flatMap(value => value.split(/[\s,]+/)).filter(Boolean)
  if (refs.length > 128) throw new Refusal('Choose at most 128 task dependencies')
  const after: string[] = []
  for (const raw of refs) {
    const key = raw.toLowerCase()
    // Full combined IDs may name another machine. Bare IDs stay on the owner's machine;
    // a bare number stays in its space, where the human is reading that number.
    // Main-machine canonical IDs are bare: accept an exact ID if there is no local match.
    const exact = tasks.filter(task => task.id.toLowerCase() === key)
    const local = tasks.filter(task => task.machine === owner.machine &&
      (/^\d+$/.test(raw) ? task.place === owner.place && task.id.endsWith(`-${Number(raw)}`) : (task.localId ?? task.id.split('/').at(-1))!.toLowerCase() === key))
    const colon = key.lastIndexOf(':')
    const qualified = colon < 0 ? undefined : tasks.filter(task => (task.machine.toLowerCase() === key.slice(0, colon) || (machineName(task.machine) || task.machine).toLowerCase() === key.slice(0, colon)) &&
      (task.localId ?? task.id.split('/').at(-1))!.toLowerCase() === key.slice(colon + 1))
    const found = qualified ?? (raw.includes('/') ? exact : local.length ? local : exact)
    if (!found.length) throw new Refusal(`No such dependency: ${raw}`)
    if (found.length > 1) throw new Refusal(`Use the full task ID for ${raw}; it matches more than one task`)
    const id = found[0].id
    if (id === owner.id) throw new Refusal(`${id} cannot wait for itself`)
    if (!after.includes(id)) after.push(id)
  }
  const byId = new Map(tasks.map(task => [task.id, task]))
  // Iterative depth-first traversal also rejects already-corrupt downstream circles,
  // without recursive stack growth on a long queue.
  const done = new Set<string>()
  for (const ref of after) {
    const path: string[] = owner.id ? [owner.id] : []
    const active = new Set(path)
    const stack: { id: string; leave?: boolean }[] = [{ id: ref }]
    while (stack.length) {
      const { id, leave } = stack.pop()!
      if (leave) { active.delete(id); path.pop(); done.add(id); continue }
      if (active.has(id)) throw new Refusal(`That would wait in a circle: ${[...path, id].join(' → ')}`)
      if (done.has(id)) continue
      active.add(id); path.push(id); stack.push({ id, leave: true })
      const task = byId.get(id)
      if (task?.workflow === 'queued') for (const next of [...task.after ?? []].reverse()) stack.push({ id: next })
    }
  }
  return after
}
