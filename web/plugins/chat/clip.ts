// A picture on the clipboard, attached with one tap (SHEP-345): a phone's screenshot preview has Copy, and pasting on
// a phone is a long-press away. The plus menu's "Paste image" reads the clipboard when tapped (the browser may ask once
// then); once the browser has been allowed to, a quiet chip offers a copied picture when the app comes back on screen.
// Nothing ever asks for the clipboard by itself.
import { useEffect, useState } from 'react'
import { named } from './paste.ts'

type Item = Pick<ClipboardItem, 'types' | 'getType'>
type Clip = { read?: () => Promise<Item[]> }

/** the pictures among what the clipboard holds, each named like a pasted screenshot */
export async function imagesOf(items: Item[], now = new Date()): Promise<File[]> {
  const blobs: Blob[] = []
  for (const it of items) {
    const t = it.types.find((x) => x.startsWith('image/'))
    if (t) blobs.push(await it.getType(t))
  }
  return blobs.map((b, i) => named(new File([b], '', { type: b.type }), now, i, blobs.length))
}

/** what "Paste image" found: the pictures, or why there are none, in words for the person */
export async function pasteImages(clip: Clip | undefined = typeof navigator === 'undefined' ? undefined : (navigator.clipboard as Clip)): Promise<{ files: File[] } | { why: string }> {
  if (!clip?.read) return { why: "This browser can't read pictures from the clipboard. Long-press the box and Paste." }
  try {
    const files = await imagesOf(await clip.read())
    return files.length ? { files } : { why: 'No picture copied.' }
  } catch (e) {
    return { why: (e as Error)?.name === 'NotAllowedError' ? "Shepherdr isn't allowed to read the clipboard." : "The clipboard couldn't be read." }
  }
}

/** a picture's mark, so one already pasted or put away isn't offered again: its type, size and first bytes */
export async function markOf(f: Blob): Promise<string> {
  const head = new Uint8Array(await f.slice(0, 64).arrayBuffer())
  let h = 0
  for (const b of head) h = (h * 31 + b) | 0
  return `${f.type}:${f.size}:${h}`
}

const SEEN = 'shepherdr.clip'
const seen = () => {
  try {
    return localStorage.getItem(SEEN) ?? ''
  } catch {
    return ''
  }
}
/** this picture isn't offered again (pasted, or put away) */
export function seenClip(mark: string) {
  try {
    localStorage.setItem(SEEN, mark)
  } catch {
    /* a private window */
  }
}

/** the browser lets this page read the clipboard without asking: allowed before, by a tap on Paste image */
async function allowed(): Promise<boolean> {
  try {
    const p = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName })
    return p?.state === 'granted'
  } catch {
    return false
  }
}

/** a copied picture not offered before, looked for when the app comes on screen, only where reading needs no prompt */
export function useCopiedPicture(on: boolean): [{ file: File; mark: string } | null, () => void] {
  const [got, setGot] = useState<{ file: File; mark: string } | null>(null)
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !navigator.clipboard?.read) return
    let live = true
    const look = async () => {
      if (document.visibilityState !== 'visible' || !(await allowed())) return
      const r = await pasteImages()
      if (!live) return
      if (!('files' in r)) return setGot(null)
      const mark = await markOf(r.files[0])
      setGot(mark === seen() ? null : { file: r.files[0], mark })
    }
    const soon = () => void look().catch(() => undefined)
    soon()
    addEventListener('focus', soon)
    document.addEventListener('visibilitychange', soon)
    return () => {
      live = false
      removeEventListener('focus', soon)
      document.removeEventListener('visibilitychange', soon)
    }
  }, [on])
  // pasted or put away: not offered again
  const done = () => {
    if (got) seenClip(got.mark)
    setGot(null)
  }
  return [got, done]
}

/** a pointer that is a finger: a phone or a tablet, where the photo button and the plus menu are */
export const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
