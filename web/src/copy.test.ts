import { describe, expect, test } from 'bun:test'
import { copyText, manualHint, type CopyEnv } from './copy.ts'

/** a fake browser: what each way does, and what was tried in what order */
function env(o: { clip?: 'ok' | 'no' | 'throws' | 'none'; exec?: boolean }) {
  const log: string[] = []
  const e: CopyEnv = {
    clipboard:
      o.clip === 'none' || !o.clip
        ? undefined
        : {
            writeText(t) {
              log.push(`clipboard:${t}`)
              if (o.clip === 'throws') throw new Error('not allowed')
              return o.clip === 'ok' ? Promise.resolve() : Promise.reject(new Error('denied'))
            },
          },
    exec(t) {
      log.push(`exec:${t}`)
      return !!o.exec
    },
    manual(t) {
      log.push(`manual:${t}`)
    },
  }
  return { e, log }
}

describe('copyText (SHEP-152)', () => {
  test('the clipboard API, started in the tap itself, before anything awaits', async () => {
    const { e, log } = env({ clip: 'ok' })
    const p = copyText('npm i', null, e)
    // synchronously: Safari forgets the tap after an await
    expect(log).toEqual(['clipboard:npm i'])
    expect(await p).toBe(true)
    expect(log).toEqual(['clipboard:npm i'])
  })

  test('no clipboard API (a plain http link): the old way, at once, in the tap', async () => {
    const { e, log } = env({ clip: 'none', exec: true })
    const p = copyText('x', null, e)
    expect(log).toEqual(['exec:x'])
    expect(await p).toBe(true)
  })

  test('the clipboard says no: the old way next', async () => {
    const { e, log } = env({ clip: 'no', exec: true })
    expect(await copyText('x', null, e)).toBe(true)
    expect(log).toEqual(['clipboard:x', 'exec:x'])
  })

  test('the clipboard throws at once: the old way, still in the tap', async () => {
    const { e, log } = env({ clip: 'throws', exec: true })
    const p = copyText('x', null, e)
    expect(log).toEqual(['clipboard:x', 'exec:x'])
    expect(await p).toBe(true)
  })

  test('every way fails: honest false, and the words show for the person to copy', async () => {
    const { e, log } = env({ clip: 'no', exec: false })
    expect(await copyText('secret-free words', null, e)).toBe(false)
    expect(log).toEqual(['clipboard:secret-free words', 'exec:secret-free words', 'manual:secret-free words'])
  })

  test('no clipboard and the old way fails: the box, never a false Copied', async () => {
    const { e, log } = env({ clip: 'none', exec: false })
    expect(await copyText('x', null, e)).toBe(false)
    expect(log).toEqual(['exec:x', 'manual:x'])
  })

  test('the box says what to press on this device', () => {
    expect(manualHint(true, true)).toBe('Press and hold to copy')
    expect(manualHint(true, false)).toBe('Press and hold to copy')
    expect(manualHint(false, true)).toBe('Press ⌘C to copy')
    expect(manualHint(false, false)).toBe('Press Ctrl+C to copy')
  })
})

test('every copy in the web app goes through copy.ts: no other navigator.clipboard or execCommand copy', async () => {
  const { Glob } = await import('bun')
  const root = new URL('../', import.meta.url).pathname
  const stray: string[] = []
  for (const f of new Glob('{src,plugins,viewer}/**/*.{ts,tsx}').scanSync(root)) {
    if (f.endsWith('src/copy.ts') || f.endsWith('.test.ts')) continue
    const s = await Bun.file(root + f).text()
    if (/navigator\.clipboard\s*\??\.\s*write|execCommand\(\s*['"]copy/.test(s)) stray.push(f)
  }
  expect(stray).toEqual([])
})
