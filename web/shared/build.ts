// Which build of the screen this is: the hashed files its index.html loads. A new build that changes the screen
// changes them; one that changes only the server or the docs doesn't, so screens reload only when there is news.
export function buildId(html: string): string {
  return [...new Set(html.match(/assets\/[\w.-]+\.(?:js|css)/g) ?? [])].sort().join(' ')
}

/** The version a build's index.html says it is (SHEP-337): '' for one from before it said. */
export function buildVersion(html: string): string {
  return /<meta name="shepherdr-version" content="([^"]*)"/.exec(html)?.[1] ?? ''
}
