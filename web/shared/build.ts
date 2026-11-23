// Which build of the screen this is: the hashed files its index.html loads, and the version it says it is (SHEP-337).
// A new build that changes the screen changes them; one that changes only the server or the docs doesn't, so screens
// reload only when there is news. A release changes the version, so it is news even when the screen's code is the same.
export function buildId(html: string): string {
  const files = [...new Set(html.match(/assets\/[\w.-]+\.(?:js|css)/g) ?? [])].sort().join(' ')
  const v = buildVersion(html)
  return v ? `${files} v${v}` : files
}

/** The version a build's index.html says it is: '' for one from before it said. */
export function buildVersion(html: string): string {
  return /<meta name="shepherdr-version" content="([^"]*)"/.exec(html)?.[1] ?? ''
}
