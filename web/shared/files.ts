// What an attached file is, by its name: the chat shows a picture as a thumbnail and anything else as a file tile;
// the server serves each with the type it is, and only a few kinds open in the browser at all.

const IMAGE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/** opened in the browser as text: never as a page */
const TEXT = new Set(['txt', 'md', 'log', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'go', 'rs', 'diff', 'patch'])

export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()

export const isImage = (name: string) => extOf(name) in IMAGE

/** the type an attachment is served with; anything not listed downloads instead of opening */
export function fileType(name: string): { type: string; inline: boolean } {
  const ext = extOf(name)
  if (IMAGE[ext]) return { type: IMAGE[ext], inline: true }
  if (ext === 'pdf') return { type: 'application/pdf', inline: true }
  if (TEXT.has(ext)) return { type: 'text/plain; charset=utf-8', inline: true }
  return { type: 'application/octet-stream', inline: false }
}
