// An attachment's square tile: a picture or video shows itself; anything else a file tile with its kind ("PDF",
// "ZIP") and a short name that keeps the end of the name and its extension.
import { extOf, isImage, isVideo } from '@shared/files.ts'

export type TileKind = 'image' | 'video' | 'file'

const WORDS: Record<string, string> = { jpeg: 'JPG', markdown: 'MD', yml: 'YAML', tgz: 'TGZ', gz: 'GZ' }

/** what its tile shows: the picture, the video's first frame, or a file tile with its kind in a few letters */
export function tileOf(name: string): { kind: TileKind; label: string } {
  if (isImage(name)) return { kind: 'image', label: 'Picture' }
  if (isVideo(name)) return { kind: 'video', label: 'Video' }
  const ext = extOf(name)
  return { kind: 'file', label: ext ? (WORDS[ext] ?? ext.slice(0, 4).toUpperCase()) : 'File' }
}

/** a name that fits a small tile: its start, an ellipsis, then its last few letters and extension */
export function shortName(name: string, max = 14): string {
  if (name.length <= max) return name
  const ext = extOf(name)
  const tail = Math.min(name.length - 1, Math.max(ext.length + 1 + 3, Math.floor(max / 2) - 1))
  const head = Math.max(1, max - tail - 1)
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`
}

/** a file's size in plain words: 820 bytes, 14 KB, 2.4 MB */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  const mb = bytes / 1_000_000
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`
}
