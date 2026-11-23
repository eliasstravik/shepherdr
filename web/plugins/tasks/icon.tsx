// A task's status icon (SHEP-321): one component for every place a task's status stands (the Tasks list, search, a
// chat's line naming a task, a review card). Its own file so the chat can use it without the whole Tasks plugin.
import { I, cx } from '@client/ui.tsx'
import type { Task } from '@shared/types.ts'
import { etaOf, leftShort, leftWords, ringOf, type Ring } from '@shared/view.ts'

/** the wedge inside the ring, from twelve o'clock clockwise, as far as the share done (radius 4 of 20) */
function wedge(pct: number): string {
  if (pct <= 0) return ''
  if (pct >= 100) return '<circle cx="10" cy="10" r="4" fill="currentColor" stroke="none"/>'
  const a = (pct / 100) * 2 * Math.PI
  const x = (10 + 4 * Math.sin(a)).toFixed(2), y = (10 - 4 * Math.cos(a)).toFixed(2)
  return `<path d="M10 10V6A4 4 0 ${pct > 50 ? 1 : 0} 1 ${x} ${y}Z" fill="currentColor" stroke="none"/>`
}

/** the small sign that tells two states apart without colour, at the ring's top right: needs you a dot, stopped a square */
const MARK = {
  dot: '<circle class="mk" cx="16" cy="4" r="2.75"/>',
  stop: '<rect class="mk" x="13.25" y="1.25" width="5.5" height="5.5" rx="1"/>',
  queued: '',
}

function ringSvg(r: Ring): string {
  if (r.kind === 'check') return '<circle cx="10" cy="10" r="7.25" fill="currentColor" stroke="none"/><path class="tk" d="m7 10.2 2 2 4-4.4"/>'
  const ring = r.mark === 'queued' ? '<circle cx="10" cy="10" r="6.5" stroke-dasharray="1.5 3"/>' : '<circle cx="10" cy="10" r="6.5"/>'
  return ring + wedge(r.pct ?? 0) + (r.mark ? MARK[r.mark] : '')
}

/**
 * A task's status icon, the one for every place it stands (SHEP-321; before 3.2.0 lib/dot.js and ui.tsx TaskDot): a
 * ring filled by the share done its agent reports, in every state that is not finished (blue working, amber needs
 * you, red stopped, grey and dashed up next), with the time left short under it ("13m", "2h"); Ready, merging and Done
 * the green (Done: grey) check. Working with no % yet: the turning ring (a calm pulse with reduced motion). `time`:
 * under the icon (a row with a second line) or beside it (a one-line row); `dim`: its machine can't be reached.
 */
export function StatusIcon({ t, dim, time = 'under' }: { t: Task; dim?: boolean; time?: 'under' | 'side' | 'none' }) {
  const r = ringOf(t)
  const left = time === 'none' ? '' : leftShort(etaOf(t))
  const spoken = `${r.label}${left ? `, ${leftWords(etaOf(t))}` : ''}`
  const alive = r.kind === 'ring' && r.tone === 'working' && r.pct === null && !dim
  return (
    <span className={cx('tring', `t-${dim ? 'mute' : r.tone}`, time === 'side' && 'tside')} role="img" aria-label={spoken} data-pct={r.pct ?? undefined}>
      {/* c-own: its colour is the ring's own, never a row's grey icon colour (ds.css .row .i) */}
      {alive ? <I n="working" c="c-own" /> : <svg className="i c-own" viewBox="0 0 20 20" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ringSvg(r) }} />}
      {left && <span className="tl" aria-hidden="true">{left}</span>}
    </span>
  )
}

