// GitHub #1261: opened without its trailing slash (/shepherdr), the page's relative files missed and it stayed
// blank. index.html's first script adds the slash before any relative address is read.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]

function run(path: string, search = '', hash = '') {
  let to = null as string | null
  const history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { to = u } }
  new Function('location', 'history', script)({ pathname: path, search, hash }, history)
  return to
}

test('a path without its slash gets one, keeping the query and the #part', () => {
  expect(run('/shepherdr', '?task=t1', '#accept=T-1')).toBe('/shepherdr/?task=t1#accept=T-1')
  expect(run('/shepherdr')).toBe('/shepherdr/')
})

test('a path with its slash, the root, or a file is left alone', () => {
  expect(run('/shepherdr/')).toBeNull()
  expect(run('/')).toBeNull()
  expect(run('/shepherdr/index.html')).toBeNull()
})

test('it runs before anything in the page is loaded by a relative address', () => {
  const at = html.indexOf(script)
  expect(at).toBeGreaterThan(-1)
  expect(html.slice(0, at)).not.toMatch(/\b(href|src)=/)
})
