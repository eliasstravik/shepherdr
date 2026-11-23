// Where a chat is, in its header beside its name (SHEP-360): plain dim text, no pill, border or fill, the size of the
// header's secondary words. The folder as it is (~ and / too; a long path gives way from its start, so
// its end shows) and its machine when that adds something. Everything says it too. A tap shows the whole path with Copy.
import type { Snapshot } from '@shared/types.ts'
import { headerWhere, type Space } from '@shared/view.ts'
import { folderMenu } from './list.tsx'
import { cx } from './ui.tsx'

export function HeaderPath({ snap, place }: { snap: Snapshot; place: Space }) {
  const w = headerWhere(snap, place)
  if (!w) return null
  return (
    <button type="button" className="hpath" aria-haspopup="menu" aria-label={`Folder: ${w.full}${w.machine ? ` on ${w.machine}` : ''}`} onClick={(e) => folderMenu(e.currentTarget, place.id)}>
      <span className={cx('hp', w.cut && 'cut')}><bdi>{w.path}</bdi></span>
      {w.machine && <span className="hm">{w.machine}</span>}
    </button>
  )
}
