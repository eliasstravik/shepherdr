// One look of the preview viewer (viewer.tsx) at its artifact: the record, then the recipe of the version to show when
// it isn't the one shown. The recipe is made ready to draw (normalize) before it counts as shown (#1108): one that
// can't be counted as shown before it failed, and the page stayed on Loading, never trying it again nor saying why.
export type Meta = { id: string; title: string; version: number; versions: { v: number; at: number; note?: string }[] }

export async function lookOnce<R>(
  get: (url: string) => Promise<any>, api: string, pinned: number | null, shown: number,
  onMeta: (m: Meta) => void, normalize: (r: any) => R,
): Promise<(R & { v: number }) | null> {
  const m: Meta = await get(api)
  onMeta(m)
  const v = pinned || m.version
  if (v === shown) return null
  const r = await get(`${api}/recipe?v=${v}`)
  return { ...normalize(r), v }
}
