import { expect, test } from 'bun:test'
import { appLink, catchLink, outsideLink, type LinkClick } from './applink.ts'

// SHEP-339: a link to this same app in a message (an artifact's, a task's, a space's) opened as a new page and
// reloaded the whole app. It opens in the app now; only other sites go to a new tab.

const HERE = 'https://box.example.ts.net/shepherdr/?place=p1'

test("this app's own links, under its base path, are the app's", () => {
  expect(appLink('https://box.example.ts.net/shepherdr/?artifact=research-tree-viewer-of-51fb', HERE)?.searchParams.get('artifact')).toBe('research-tree-viewer-of-51fb')
  expect(appLink('https://box.example.ts.net/shepherdr?task=t1', HERE)?.searchParams.get('task')).toBe('t1')
  expect(appLink('https://box.example.ts.net/shepherdr/index.html?place=p2', HERE)).not.toBeNull()
  expect(appLink('?artifact=a1', HERE)).not.toBeNull()
  // served at the root
  expect(appLink('https://box.example.ts.net/?artifact=a1', 'https://box.example.ts.net/')).not.toBeNull()
})

test('another site, another path on the same host, or the app’s files are not', () => {
  expect(appLink('https://example.com/shepherdr/?artifact=a1', HERE)).toBeNull()
  expect(appLink('https://box.example.ts.net/other/?artifact=a1', HERE)).toBeNull()
  expect(appLink('https://box.example.ts.net/?artifact=a1', HERE)).toBeNull()
  expect(appLink('https://box.example.ts.net/shepherdr/api/artifacts/a1/page/', HERE)).toBeNull()
  expect(appLink('http://box.example.ts.net/shepherdr/?artifact=a1', HERE)).toBeNull()
  expect(outsideLink('https://example.com/x', HERE)).toBe(true)
  expect(outsideLink('mailto:a@example.com', HERE)).toBe(false)
  expect(outsideLink('?task=t1', HERE)).toBe(false)
})

function click(href: string | null, more: Partial<Omit<LinkClick, 'target'>> & { target?: string; download?: boolean } = {}) {
  const a = {
    target: more.target ?? '',
    getAttribute: (k: string) => (k === 'href' ? href : null),
    hasAttribute: (k: string) => k === 'download' && !!more.download,
  }
  const e = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    prevented: false,
    ...more,
    target: { closest: (sel: string) => (sel === 'a[href]' && href !== null ? a : null) } as unknown as EventTarget,
    preventDefault() {
      e.prevented = true
    },
  }
  const opened: string[] = []
  const tabs: string[] = []
  const caught = catchLink(e, HERE, (u) => opened.push(u.href), (h) => tabs.push(h))
  return { caught, prevented: e.prevented, opened, tabs }
}

test('a tap on an artifact, task or space link opens it in the app, with no page load', () => {
  for (const q of ['?artifact=a1', '?task=t1', '?place=p2'])
    expect(click(`https://box.example.ts.net/shepherdr/${q}`, { target: '_blank' })).toEqual({ caught: true, prevented: true, opened: [`https://box.example.ts.net/shepherdr/${q}`], tabs: [] })
})

test('another site opens in a new tab; one already marked for a new tab is left to the browser', () => {
  expect(click('https://example.com/x')).toEqual({ caught: true, prevented: true, opened: [], tabs: ['https://example.com/x'] })
  expect(click('https://example.com/x', { target: '_blank' })).toEqual({ caught: false, prevented: false, opened: [], tabs: [] })
})

test('a ctrl or cmd click, a download, a file of the app and a handled click stay the browser’s', () => {
  const art = 'https://box.example.ts.net/shepherdr/?artifact=a1'
  expect(click(art, { metaKey: true }).caught).toBe(false)
  expect(click(art, { ctrlKey: true }).caught).toBe(false)
  expect(click(art, { button: 1 }).caught).toBe(false)
  expect(click(art, { defaultPrevented: true }).caught).toBe(false)
  expect(click(art, { download: true }).caught).toBe(false)
  expect(click('api/files/x.png', { target: '_blank' }).caught).toBe(false)
  expect(click('#task=t1').caught).toBe(false)
  expect(click(null).caught).toBe(false)
})
