import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Manifest fetches omit cookies by default, even for a same-origin URL.
// An authenticated reverse proxy must receive the browser's login cookie.
test('the app manifest requests credentials for authenticated reverse proxies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  const manifest = links.find((link) => /\brel=["']manifest["']/i.test(link))
  expect(manifest).toBeDefined()
  expect(manifest).toMatch(/\bhref=["']manifest\.webmanifest["']/i)
  expect(manifest).toMatch(/\bcrossorigin=["']use-credentials["']/i)
})
