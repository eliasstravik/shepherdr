// A space's icon: # until you give it an emoji or a picture (Everything's: its layers until you do). It shows wherever a
// space's # did (the list, the chat header, search, pickers), the same size as the glyph. Its own small square button
// sits left of the Name field in New space, Rename and a space's Settings: Emoji (every emoji, with search), Photo (pick
// or take one), Paste, Reset. A picture is cut to a square and shrunk to ICON_PX on a canvas here (so only pixels go
// on, never the file as sent), then checked again by the service (core/space-icon.js).
import { useRef, type ReactNode } from 'react'
import type { Snapshot } from '@shared/types.ts'
import { isEverything } from '@shared/view.ts'
import { ICON_MAX, isPicture } from '@core/space-icon.js'
import { All } from '@plugins/reactions/all.tsx'
import { notice, type MenuRow } from './kernel.ts'
import { openDialog, openMenu } from './overlay.tsx'
import { cx, I } from './ui.tsx'

/** a picture's side, in pixels: crisp at the glyph's 20 px on a 3x screen and in the 40 px button */
export const ICON_PX = 96

/** the types a picture may come in (a GIF keeps its first frame); anything else is refused before it is read */
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']

/** an icon as it shows: a picture, an emoji, or the glyph (`root`: Everything's layers). `c`: s16 for the header. */
export function Glyph({ icon, root, c }: { icon?: string | null; root?: boolean; c?: string }) {
  if (icon && isPicture(icon)) return <img className={cx('sic', 'pic', c)} src={icon} alt="" aria-hidden="true" draggable={false} />
  if (icon) return <span className={cx('sic', c)} aria-hidden="true">{icon}</span>
  return <I n={root ? 'layers' : 'hash'} c={c} />
}

/** a space's icon by its id */
export function SpaceIcon({ snap, id, c }: { snap: Snapshot; id: string; c?: string }) {
  const p = snap.places.find((x) => x.id === id)
  return <Glyph icon={p?.emoji} root={isEverything(snap, id)} c={c} />
}

/** a picture made square (its middle), ICON_PX a side, as a data: URL: WebP where the browser writes it, else PNG,
 *  else JPEG when that is still too big */
export async function squareIcon(file: Blob): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error('Pick a photo or a picture (PNG, JPEG or WebP).')
  if (file.size > 20_000_000) throw new Error('That picture is too big.')
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error("That picture couldn't be read.")
  const side = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = ICON_PX
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, ICON_PX, ICON_PX)
  bmp.close?.()
  let url = c.toDataURL('image/webp', 0.86)
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png')
  if (url.length > ICON_MAX) url = c.toDataURL('image/jpeg', 0.85)
  if (url.length > ICON_MAX) throw new Error('That picture is too big for an icon.')
  return url
}

/** a picture from the clipboard, made into an icon (null: none there, or the browser won't say) */
async function pasted(): Promise<string | null> {
  const items = await navigator.clipboard?.read?.().catch(() => null)
  for (const it of items ?? []) {
    const t = it.types.find((x) => TYPES.includes(x))
    if (t) return squareIcon(await it.getType(t))
  }
  return null
}

/** The icon's own button, left of a Name field, the field's height. `root`: Everything's (its layers is its default). */
export function IconButton({ icon, root, onChange }: { icon: string | null; root?: boolean; onChange: (icon: string | null) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const take = (f: Promise<string | null>) => void f.then((v) => v && onChange(v)).catch((e) => notice(e instanceof Error ? e.message : "That picture couldn't be used.", { tone: 'error' }))
  const rows: MenuRow[] = [
    { icon: 'smile', label: 'Emoji', run: () => openDialog((done) => <All onPick={(e) => { done(); onChange(e) }} />, { wide: true, bare: true, label: 'Emoji' }) },
    { icon: 'image', label: 'Photo', run: () => file.current?.click() },
    ...(typeof navigator.clipboard?.read === 'function' ? [{ icon: 'paste' as const, label: 'Paste picture', run: () => take(pasted().then((v) => v ?? (notice('No picture to paste.'), null))) }] : []),
    ...(icon ? [{ icon: 'reload' as const, label: root ? 'Reset' : 'Reset to #', line: true, run: () => onChange(null) }] : []),
  ]
  return (
    <>
      <button
        type="button"
        className="sicb"
        aria-label="Space icon"
        aria-haspopup="menu"
        onClick={(e) => openMenu(e.currentTarget, rows, { label: 'Space icon' })}
        // a picture pasted while the button has focus
        onPaste={(e) => {
          const f = [...e.clipboardData.files].find((x) => TYPES.includes(x.type))
          if (f) { e.preventDefault(); take(squareIcon(f)) }
        }}
      >
        <Glyph icon={icon} root={root} c="s20" />
      </button>
      <input
        ref={file}
        type="file"
        name="icon"
        accept={TYPES.join(',')}
        aria-label="Space icon picture"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (f) take(squareIcon(f))
        }}
      />
    </>
  )
}

/** a Name field with the icon's button at its left */
export function NameWithIcon({ icon, root, onIcon, children }: { icon: string | null; root?: boolean; onIcon: (icon: string | null) => void; children: ReactNode }) {
  return (
    <div className="fld">
      <span>Name</span>
      <div className="nwi">
        <IconButton icon={icon} root={root} onChange={onIcon} />
        {children}
      </div>
    </div>
  )
}
