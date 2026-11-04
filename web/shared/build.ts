// Which build of the screen this is: the hashed files its index.html loads. A new build that changes the screen
// changes them; one that changes only the server or the docs doesn't, so screens reload only when there is news.
export function buildId(html: string): string {
  return [...new Set(html.match(/assets\/[\w.-]+\.(?:js|css)/g) ?? [])].sort().join(' ')
}
