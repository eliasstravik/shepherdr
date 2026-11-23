// Attachments as square thumbnails (SHEP-309): in the message box (a remove on the corner, its upload and a failed
// one shown on it) and in what you sent; a tap opens the preview, the picture full size or the file's name, kind and
// size, over the whole screen (the app's one overlay stack: Escape, the close button or a tap outside close it).
import { openDialog } from '@client/overlay.tsx'
import { localOf } from '@client/send.ts'
import { cx, I, IB } from '@client/ui.tsx'
import { fileType } from '@shared/files.ts'
import { shortName, sizeWords, tileOf } from './tiles.ts'

/** a file a chat names, served by Shepherdr */
export const fileUrl = (chat: string, path: string, small = false) => `api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}${small ? '&thumb=1' : ''}`

/** where an attachment's picture and file are: this screen's own copy first, else Shepherdr's */
export function sourcesOf(chat: string, f: { name: string; path?: string; id?: string }) {
  const l = localOf(f.id, f.path)
  return {
    small: l?.url || (f.path ? fileUrl(chat, f.path, true) : ''),
    full: l?.url || (f.path ? fileUrl(chat, f.path) : ''),
    size: l?.file.size,
    box: l?.w && l.h ? picBox(l.w, l.h) : undefined,
  }
}

/** a sent picture's box from its size: at most PIC px each way (as .pic img's max sizes), never wider than its row */
export const PIC = 320
export function picBox(w: number, h: number) {
  const k = Math.min(1, PIC / w, PIC / h)
  return { width: Math.round(w * k), maxWidth: '100%', height: 'auto', aspectRatio: `${w} / ${h}` }
}

/** the preview of one attachment */
export function openPreview(chat: string, f: { name: string; path?: string; id?: string; alt?: string }) {
  const { kind, label } = tileOf(f.name)
  const { full, size } = sourcesOf(chat, f)
  const inline = fileType(f.name).inline
  // a file Shepherdr has: one it can show opens in a new tab, anything else downloads
  const href = full && f.path && !localOf(f.id, f.path)?.url ? (inline ? full : `${full}&download=1`) : full
  openDialog(
    (close) => (
      <>
        <div className="lbar">
          <span className="lname">{f.name}</span>
          {href && kind !== 'file' && (
            <a className="ib" href={href} target="_blank" rel="noreferrer" aria-label="Open in a new tab">
              <I n="ext" />
            </a>
          )}
          <IB icon="x" label="Close" onClick={close} data-autofocus="" />
        </div>
        <div className="lbody">
          {kind === 'image' && full ? (
            <img src={full} alt={f.alt || f.name} />
          ) : kind === 'video' && full ? (
            <video src={full} controls playsInline preload="metadata" />
          ) : (
            <div className="lfile">
              <span className="ftl big" aria-hidden="true">
                <I n="doc" c="s22" />
                <b>{label}</b>
              </span>
              <b className="lfn">{f.name}</b>
              <span className="lsub">{[kind === 'file' ? `${label} file` : label, size !== undefined ? sizeWords(size) : ''].filter(Boolean).join(' · ')}</span>
              {href && (
                <a className="btn" href={href} target="_blank" rel="noreferrer" {...(!inline ? { download: f.name } : {})}>
                  {inline ? 'Open' : 'Download'}
                </a>
              )}
            </div>
          )}
        </div>
      </>
    ),
    { view: true, label: f.name },
  )
}

/** what a square tile shows: the picture, a video's first frame, or the file's kind and a short name */
function Face({ name, src }: { name: string; src: string }) {
  const { kind, label } = tileOf(name)
  if (kind === 'image' && src) return <img src={src} alt="" draggable={false} />
  if (kind === 'video' && src) return <video src={src} muted playsInline preload="metadata" />
  return (
    <span className="ftl">
      <b>{label}</b>
      <span>{shortName(name, 10)}</span>
    </span>
  )
}

/** a file in the message box: its thumbnail opens the preview (or, when its upload failed, tries again) */
export function BoxThumb({ chat, f, onRetry, onRemove }: { chat: string; f: { name: string; path?: string; id?: string; failed?: string }; onRetry: () => void; onRemove: () => void }) {
  const { small } = sourcesOf(chat, f)
  const up = !f.path && !f.failed
  const state = f.failed ? `. Not added: ${f.failed}. Try again` : up ? '. Adding' : ''
  return (
    <div className={cx('ath', f.failed && 'bad')}>
      <button type="button" className="atb" aria-label={`${f.name}${state || '. Preview'}`} onClick={f.failed ? onRetry : () => openPreview(chat, f)}>
        <Face name={f.name} src={small} />
        {up && (
          <span className="ast">
            <I n="working" c="s20" />
          </span>
        )}
        {f.failed && (
          <span className="ast bad">
            <I n="reload" c="s16" />
            <span>Failed</span>
          </span>
        )}
      </button>
      <button type="button" className="arm" aria-label={`Remove ${f.name}`} onClick={onRemove}>
        <span>
          <I n="x" c="s16" />
        </span>
      </button>
    </div>
  )
}

/** a file in a message, as a square tile; a tap opens its preview */
export function SentThumb({ chat, f }: { chat: string; f: { name: string; path: string; id?: string; alt?: string } }) {
  const { small } = sourcesOf(chat, f)
  return (
    <button type="button" className="ath atb" aria-label={`${f.alt || f.name}${f.path ? '' : '. Adding'}. Preview`} onClick={() => openPreview(chat, f)}>
      <Face name={f.name} src={small} />
      {!f.path && (
        <span className="ast">
          <I n="working" c="s20" />
        </span>
      )}
    </button>
  )
}
