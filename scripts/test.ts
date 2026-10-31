// The tests, fast: test files run in parallel (one bun process per core), slowest first.
//
//   bun run test                  everything; skipped when it already passed on this very commit with nothing changed
//   bun run test --force          everything, even then
//   bun run test changed          only the tests that reach what changed from main (committed or not)
//   bun run test engine layout    only the test files whose path has these words
//   bun run test changed --since=HEAD   only what changed since that commit (here: not committed yet)
//   bun run test changed --list   which test files would run, without running them
//   bun run test --map            and note which lines of the screen each browser test runs (screen-map.ts)
//
// A change to the screen runs only the browser tests that run the lines it changed, by the map GitHub makes on main
// (screen-map.ts); every one where there is no map yet, or for a change to the whole screen (styles.css). All the
// browser tests of a run share one browser (test/chromium.ts).
//
// Any other flag goes to bun test as it is (-t <pattern>, --bail, --rerun-each=3, --shard=2/6 as GitHub runs it). SHEPHERDR_TEST_JOBS sets how many
// processes run at once.
//
// The tests run below everything else on this machine, on every core: they take only the CPU and disk no one else
// wants, so herdr, Shepherdr's server and the agents stay quick while several tasks test at once.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { gather, mapFile, pick, readMap, screenMap } from '../test/screen-map.ts'
import { INPUTS } from '../test/web.ts'
import { writeRegistries } from './build-plugins.ts'

const root = join(import.meta.dir, '..')
const cache = join(root, 'node_modules', '.cache', 'shepherdr-test')
const timings = join(cache, 'timings.json')
const passed = join(cache, 'passed.json')

const git = (...args: string[]) => {
  const r = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  return r.success ? r.stdout.toString().trim() : ''
}
const lines = (s: string) => s.split('\n').filter(Boolean)

/* ---------- which test files reach which files ---------- */

const testFiles = () =>
  readdirSync(join(root, 'test'))
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => `test/${f}`)
    .sort()

const transpiler = new Bun.Transpiler({ loader: 'tsx' })
const ALIASES: Record<string, string> = { '@shared/': 'shared/', '@client/': 'src/' }

/** a local import as a repo path, or null for a package */
function resolveImport(from: string, spec: string): string | null {
  const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a))
  const path = alias ? ALIASES[alias] + spec.slice(alias.length) : spec.startsWith('.') ? relative(root, resolve(root, dirname(from), spec)) : null
  if (!path) return null
  for (const p of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) if (existsSync(join(root, p)) && !p.endsWith('/')) return p
  return null
}

/** every file a test file reaches: what it imports (all the way down), what it reads by name, and the whole screen
 *  when it opens it in a browser (test/web.ts builds it), unless `screen` is false */
function reach(test: string, seen = new Set<string>(), screen = true): Set<string> {
  if (seen.has(test)) return seen
  seen.add(test)
  let text = ''
  try {
    text = readFileSync(join(root, test), 'utf8')
  } catch {
    return seen
  }
  if (!/\.[jt]sx?$/.test(test)) return seen
  let imports: { path: string }[] = []
  try {
    imports = transpiler.scanImports(text.replace(/^#!.*/, ''))
  } catch {}
  for (const i of imports) {
    const p = resolveImport(test, i.path)
    if (p) reach(p, seen, screen)
  }
  // files and folders it reads: join(root, 'src'), join(import.meta.dir, 'samples')
  for (const m of text.matchAll(/join\((root|import\.meta\.dir), '([^']+)'/g)) seen.add(m[1] === 'root' ? m[2] : relative(root, join(root, dirname(test), m[2])))
  if (test === 'test/web.ts' && screen) for (const p of INPUTS) seen.add(p)
  return seen
}

/** a file reached is this one, or a folder holding it */
const reaches = (set: Set<string>, file: string) => set.has(file) || [...set].some((p) => file.startsWith(`${p}/`))

/** what changed from main: commits on this branch, and what is not committed yet */
function changedFiles(since?: string) {
  const fail = (why: string) => {
    console.error(why)
    process.exit(1)
  }
  if (since && !git('rev-parse', '--verify', '--quiet', `${since}^{commit}`)) fail(`No commit ${since} to compare with.`)
  const main = ['main', 'origin/main'].find((b) => git('rev-parse', '--verify', '--quiet', `${b}^{commit}`))
  const base = since ?? (main ? git('merge-base', 'HEAD', main) : '')
  if (!base) fail("Can't find main (or origin/main) to compare with: name a commit with --since=<ref>.")
  return [...new Set([...lines(git('diff', '--name-only', base)), ...lines(git('ls-files', '--others', '--exclude-standard'))])]
}

/** what the screen is built from */
const screenInput = (f: string) => INPUTS.some((p) => f === p || f.startsWith(`${p}/`))

/** changing one of these can break any test */
const EVERYTHING = ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'test/preload.ts', 'test/once.ts', 'scripts/test.ts']

/* ---------- the run ---------- */

const args = process.argv.slice(2)
const force = args.includes('--force')
const list = args.includes('--list')
// --map[=file]: note which lines of the screen each browser test runs, into that file (the one kept for every worktree)
const mapArg = args.find((a) => a === '--map' || a.startsWith('--map='))
const mapOut = mapArg ? (mapArg.includes('=') ? resolve(mapArg.slice('--map='.length)) : mapFile()) : null
const since = args.find((a) => a.startsWith('--since='))?.slice('--since='.length)
// --since says what to compare with, so it means changed too
const changed = args.includes('changed') || args.includes('--changed') || since !== undefined
const flags: string[] = []
const words: string[] = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (['--force', 'changed', '--changed', '--list'].includes(a) || a.startsWith('--since=') || a === mapArg) continue
  if (a.startsWith('-')) {
    flags.push(a)
    // flags that take the next word
    if (['-t', '--test-name-pattern', '--timeout', '--rerun-each', '--seed'].includes(a) && args[i + 1]) flags.push(args[++i])
  } else words.push(relative(root, resolve(a)).startsWith('..') ? a : relative(root, resolve(a)))
}

let files: string[] | null = null
// the plugin registries first: the server's plugins are reached through them
if (changed) writeRegistries()
if (changed) {
  const touched = changedFiles(since)
  if (touched.some((f) => EVERYTHING.includes(f))) files = null
  else {
    // the browser tests that run the screen's changed lines, or null: all of them
    const screen = touched.filter(screenInput)
    let picked: Set<string> | null = null
    let mapped: string[] = []
    if (screen.length) {
      const map = screenMap()
      const r = map ? await pick(map, screen) : { all: 'no map yet of which lines of the screen each one runs' }
      if ('all' in r) console.log(`Every browser test: ${r.all}.`)
      else [picked, mapped] = [r.tests, Object.keys(map!.tests)]
    }
    const opens = testFiles().filter((t) => reach(t).has('test/web.ts'))
    files = testFiles().filter((t) => {
      // a browser test the map knows: by the map, or by what it reaches besides the screen (the server, itself)
      if (picked && opens.includes(t) && mapped.includes(t)) return picked.has(t) || touched.some((f) => reaches(reach(t, new Set(), false), f))
      const set = reach(t)
      return touched.some((f) => reaches(set, f))
    })
    if (picked) {
      const run = opens.filter((t) => files!.includes(t))
      console.log(`Screen changed: ${run.length} of ${opens.length} browser test files run what changed.`)
    }
    const covered = new Set(testFiles().flatMap((t) => [...reach(t)]))
    const none = touched.filter((f) => !reaches(covered, f) && /\.(tsx?|css|html)$/.test(f))
    if (none.length) console.log(`No test reaches: ${none.join(', ')}`)
    if (!files.length) {
      console.log(touched.length ? 'No test reaches what changed.' : 'Nothing changed from main.')
      process.exit(0)
    }
  }
}
if (words.length) {
  const all = files ?? testFiles()
  files = all.filter((t) => words.some((w) => t.includes(w)))
  if (!files.length) {
    console.error(`No ${changed ? 'changed ' : ''}test file matches: ${words.join(' ')}`)
    process.exit(1)
  }
}

if (list) {
  console.log((files ?? testFiles()).join('\n'))
  process.exit(0)
}

// the whole suite, once per commit: a clean tree on the commit that already passed has nothing new to test
const whole = files === null && flags.every((f) => f === '--bail' || /^--bail=/.test(f))
const commit = git('rev-parse', 'HEAD')
const clean = git('status', '--porcelain') === ''
if (whole && !force && !mapOut && commit && clean && existsSync(passed)) {
  const last = JSON.parse(readFileSync(passed, 'utf8')) as { commit: string; at: number; summary: string }
  if (last.commit === commit) {
    const ago = Math.round((Date.now() - last.at) / 60_000)
    console.log(`All tests passed on this commit (${commit.slice(0, 7)}) ${ago} min ago, and nothing changed since: ${last.summary}`)
    console.log('Not running them again. bun run test --force runs them anyway.')
    process.exit(0)
  }
}

/** what runs the tests last in line for CPU and disk: nice 19 and idle I/O, and, where systemd runs this user's
 *  services, a scope of their own with the least CPU and I/O weight (herdr's service holds the agents and the server) */
function lowPriority(): string[] {
  if (process.platform !== 'linux') return Bun.which('nice') ? ['nice', '-n', '19'] : []
  const scope = ['systemd-run', '--user', '--scope', '--quiet', '--collect', '-p', 'CPUWeight=1', '-p', 'IOWeight=1']
  const has = (c: string[]) => Bun.spawnSync(c, { stdout: 'ignore', stderr: 'ignore' }).success
  return [
    ...(Bun.which('systemd-run') && has([...scope, 'true']) ? scope : []),
    ...(Bun.which('nice') ? ['nice', '-n', '19'] : []),
    ...(Bun.which('ionice') && has(['ionice', '-c', '3', 'true']) ? ['ionice', '-c', '3'] : []),
  ]
}

mkdirSync(cache, { recursive: true })
const jobs = process.env.SHEPHERDR_TEST_JOBS ? `--parallel=${process.env.SHEPHERDR_TEST_JOBS}` : '--parallel'
// a test may take longer while every core is busy (several tasks test at once): 5 s, bun's default, is too tight
const decoder = new TextDecoder()
const timeout = flags.some((f) => f.startsWith('--timeout')) ? [] : ['--timeout=20000']
const cmd = [...lowPriority(), process.execPath, 'test', jobs, ...timeout, `--timings=${timings}`, '--update-timings', ...flags, ...(files ?? []).map((f) => `./${f}`)]
if (files) console.log(`${files.length} test file${files.length === 1 ? '' : 's'}: ${files.map((f) => f.replace(/^test\//, '')).join(' ')}`)
const t0 = Date.now()
const env: Record<string, string | undefined> = { ...process.env, SHEPHERDR_TEST_RUNNER: '1' }
// A Mac's TMPDIR goes through the /var symlink, and Autopilot's private folders must be real paths.
if (process.platform === 'darwin') env.TMPDIR = realpathSync(tmpdir())

// one browser for every browser test of the run, as low in line as the tests; it closes when this process is gone
let browser: ReturnType<typeof Bun.spawn> | null = null
if ((files ?? testFiles()).some((t) => reach(t).has('test/chromium.ts'))) {
  const b = Bun.spawn([...lowPriority(), process.execPath, join(root, 'test', 'chromium.ts')], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  browser = b
  // where to connect: its first line (none when it can't start one: each file then starts its own, or skips)
  const firstLine = async () => {
    let s = ''
    const r = (b.stdout as ReadableStream<Uint8Array>).getReader()
    while (!s.includes('\n')) {
      const x = await r.read()
      if (x.done) break
      s += decoder.decode(x.value)
    }
    return s
  }
  const line = await Promise.race([firstLine(), Bun.sleep(30_000).then(() => '')])
  if (line.startsWith('ws://')) env.SHEPHERDR_TEST_BROWSER = line.trim()
}
const mapParts = join(cache, `map-${process.pid}`)
if (mapOut) {
  rmSync(mapParts, { recursive: true, force: true })
  env.SHEPHERDR_TEST_MAP = mapParts
}
const p = Bun.spawn(cmd, { cwd: root, stdout: 'inherit', stderr: 'pipe', stdin: 'inherit', env })
// bun test reports on stderr: pass it on, and keep its closing lines
let tail = ''
const reader = p.stderr.getReader()
for (let r = await reader.read(); !r.done; r = await reader.read()) {
  const s = decoder.decode(r.value, { stream: true })
  process.stderr.write(s)
  tail = (tail + s).slice(-2000)
}
const code = await p.exited
if (browser) {
  ;(browser.stdin as import('bun').FileSink).end()
  await Promise.race([browser.exited, Bun.sleep(5000)])
  browser.kill()
}
if (mapOut) {
  mkdirSync(dirname(mapOut), { recursive: true })
  const map = gather(mapParts, commit, readMap(mapOut))
  writeFileSync(mapOut, JSON.stringify(map))
  rmSync(mapParts, { recursive: true, force: true })
  console.log(`Screen map of ${commit.slice(0, 7)}${clean ? '' : ' (and what is not committed)'}: ${Object.keys(map.tests).length} browser test files, in ${mapOut}`)
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (code === 0 && whole && commit && clean && git('rev-parse', 'HEAD') === commit && git('status', '--porcelain') === '') {
  const ran = tail.match(/Ran \d+ tests across \d+ files?/)?.[0] ?? 'passed'
  writeFileSync(passed, JSON.stringify({ commit, at: Date.now(), summary: `${ran} in ${secs}s` }))
}
const shard = flags.find((f) => f.startsWith('--shard='))?.slice('--shard='.length)
console.log(`${code === 0 ? 'Passed' : 'Failed'} in ${secs}s${whole ? '' : shard ? ` (shard ${shard} of the suite)` : ' (part of the suite: GitHub runs it all on main)'}`)
process.exit(code)
