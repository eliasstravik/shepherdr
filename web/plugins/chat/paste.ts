// Files pasted or dropped into a chat: which of them to attach, and a name for a screenshot that came without one.

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
}

/** a clipboard picture has no name of its own: browsers call it "image.png" (or nothing at all) */
const NAMELESS = /^(image|blob|untitled)?(\.[a-z0-9]+)?$/i

/** "2026-10-25-184651", in local time */
export function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** the file as it is, or renamed "screenshot-<time>.png" when it came without a real name; several at once count up */
export function named(f: File, now: Date, i = 0, of = 1): File {
  if (!NAMELESS.test(f.name)) return f
  const image = f.type.startsWith('image/')
  const ext = EXT[f.type] ?? (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? (image ? 'png' : 'bin')).toLowerCase()
  const name = `${image ? 'screenshot' : 'pasted'}-${stamp(now)}${of > 1 ? `-${i + 1}` : ''}.${ext}`
  return new File([f], name, { type: f.type, lastModified: f.lastModified })
}

/** what a paste attaches; none when it is text. A rich copy (a document, a spreadsheet) brings a picture of itself
 *  along with its text: the text wins there, so pasting cells or a paragraph stays a paste of text. A picture copied
 *  in the browser comes with an <img> of itself but no plain text: that is still a picture. */
export function pasted(dt: Pick<DataTransfer, 'files' | 'types' | 'getData'> | null, now = new Date()): File[] {
  if (!dt?.files?.length) return []
  if (dt.types.includes('text/html') && dt.getData('text/plain').trim()) return []
  const files = Array.from(dt.files)
  const nameless = files.filter((f) => NAMELESS.test(f.name)).length
  let n = 0
  return files.map((f) => (NAMELESS.test(f.name) ? named(f, now, n++, nameless) : f))
}

/** what a drop attaches: every file, by its own name (a file dragged from a folder always has one) */
export function dropped(dt: Pick<DataTransfer, 'files'> | null, now = new Date()): File[] {
  const files = Array.from(dt?.files ?? [])
  return files.map((f, i) => (f.name ? f : named(f, now, i, files.length)))
}

/** a drag carries files (not text or a link being dragged around the page) */
export const draggingFiles = (dt: Pick<DataTransfer, 'types'> | null) => !!dt && Array.from(dt.types).includes('Files')
