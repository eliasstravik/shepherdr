import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message, TurnActivity } from '@shared/types.ts'

// the formatted words need a browser (DOMPurify): here they are drawn as they are; every other export stays the real one
const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { WorkingSign } = await import('./client.tsx')

// SHEP-343: the working sign is three dots in an agent-side speech bubble, the step quiet beside it, never inside.

const msgs = (...m: Partial<Message>[]) => m.map((x, i) => ({ id: `m${i}`, who: 'agent', ...x })) as Message[]
const chat = (c: Partial<Chat>, messages: Message[] = msgs({ who: 'you', text: 'do it' })) => ({ key: 'p:sp1', cli: 'claude', messages, ...c }) as Chat
const turn = (t: Partial<TurnActivity> = {}) => ({ id: 't1', at: 1, rows: [], steps: 0, ...t }) as TurnActivity
let k = 0
// each draw its own chat key, so a step one test held never shows in the next
const draw = (c: Chat) => renderToStaticMarkup(<WorkingSign chat={{ ...c, key: c.key === 'p:sp1' ? `p:w${k++}` : c.key }} />)
const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')

test('working with nothing new: three dots inside an agent bubble', () => {
  const html = draw(chat({ working: true }))
  expect(html).toContain('class="wsign"')
  expect(html).toMatch(/<span class="b wbub"[^>]*><span class="wdots"><i><\/i><i><\/i><i><\/i><\/span><\/span>/)
  expect(html).toContain('aria-label="Thinking"')
  expect(html).toContain('<span class="wstep">Thinking</span>')
})

test('the step stays quiet text beside the bubble, not inside it', () => {
  const html = draw(chat({ working: true, doing: '1 shell still running', live: turn() }))
  expect(html).toMatch(/<\/span><\/span><span class="wstep">1 shell still running<\/span><\/div>$/)
  expect(html.slice(html.indexOf('wbub'), html.indexOf('wstep'))).not.toContain('shell')
})

test('gone when words arrive and the turn ends', () => {
  expect(draw(chat({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' })))).toBe('')
  expect(renderToStaticMarkup(<WorkingSign chat={undefined} />)).toBe('')
})

test('the bubble has the agent bubble look: .b, sized to the dots like a one-line message, left aligned', () => {
  expect(css).toMatch(/\.b\{[^}]*border-radius:18px;background:var\(--raised\)/)
  expect(css).toMatch(/\.wdots i\{[^}]*animation:rise/)
  expect(css).toMatch(/\.wdots i:nth-child\(2\)\{animation-delay:\.15s\}\.wdots i:nth-child\(3\)\{animation-delay:\.3s\}/)
})

// SHEP-357: styles.css's `.b{display:block}` came after `.wbub{display:inline-flex}` and won, so the dots hung at the
// bubble's top edge and their bounce left it. The sign's own rule outranks it, and the dots sit centred in its padding.
const rule = (sel: string, src = css) => new RegExp(`(^|\\})${sel.replace(/[.*()]/g, '\\$&')}\\{([^}]*)\\}`, 'm').exec(src)?.[2] ?? ''
const px = (decl: string, prop: string) => Number(new RegExp(`(^|;)${prop}:(-?[\\d.]+)px`).exec(decl)?.[2])

test('layout: the bubble centres its dots both ways and outranks the plain bubble block', () => {
  const bub = rule('.wsign .wbub')
  expect(bub).toContain('display:flex')
  expect(bub).toContain('align-items:center')
  expect(bub).toContain('justify-content:center')
  expect(bub).toContain('padding:6px 14px')
  expect(rule('.b')).toMatch(/padding:6px 14px/)
  const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  expect(rule('.b', styles)).toContain('display:block')
  expect(rule('.wbub')).toBe('')
})

test('layout: the dots fill one 24px line, the bubble is a one-line message tall, the rise stays in its padding', () => {
  const dots = rule('.wdots'), dot = rule('.wdots i')
  expect(px(dots, 'height')).toBe(24)
  const size = px(dot, 'width')
  expect(px(dot, 'height')).toBe(size)
  const rise = Number(/@keyframes rise\{[^@]*translateY\((-?[\d.]+)px\)/.exec(css)?.[1])
  // the dot's top at its highest: the bubble's 6px padding, half the line's spare room, less the rise
  expect(6 + (24 - size) / 2 + rise).toBeGreaterThanOrEqual(6)
  expect(rise).toBeLessThan(0)
})

test("a task's chat shows its own status line beside the sign", () => {
  const task = { key: 'SHOP-1', report: { msg: 'Changing the button' } } as any
  const html = renderToStaticMarkup(<WorkingSign chat={chat({ working: true, doing: "Running python3 - <<'EOF' p='web" })} thread={{ chat: 'p:sp1', place: 'p:sp1', where: 'pane', task }} />)
  expect(html).toContain('<span class="wstep">Changing the button</span>')
  expect(html).not.toContain('python3')
  const paused = renderToStaticMarkup(<WorkingSign chat={chat({ working: true, doing: "Running python3 - <<'EOF' p='web" })} thread={{ chat: 'p:sp1', place: 'p:sp1', where: 'pane', task: { ...task, report: { msg: 'Waiting on you', paused: true } } }} />)
  expect(paused).toContain('<span class="wstep">Running a script</span>')
})

test('reduced motion: no bounce, a calm fade in turn, and the bubble fades in without moving', () => {
  const block = css.split('\n').find((l) => l.startsWith('@media(prefers-reduced-motion:reduce)') && l.includes('.wdots')) ?? ''
  expect(block).toContain('.wdots i{animation:calm')
  expect(block).toContain('.wsign{animation-name:fade}')
  expect(css).toMatch(/@keyframes fade\{from\{opacity:0\}\}/)
  // and the app's own Reduce motion switch does the same
  const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  expect(styles).toContain(':root[data-motion="reduced"] .wdots i{animation:calm')
  expect(styles).toContain(':root[data-motion="reduced"] .wsign{animation-name:fade}')
})

test('Stop sits on the working row while it works (the box\'s round button is the voice call when empty, SHEP-363)', async () => {
  const { installPlugins } = await import('@client/kernel.ts')
  installPlugins([], ['voice'])
  const html = draw(chat({ working: true }))
  installPlugins([], [])
  expect(html).toContain('aria-label="Stop"')
  expect(html).toContain('wstop')
  // a true stop sign: a ring around a filled square, on a round button
  const { IC } = await import('@client/icons.ts')
  expect(IC.stop).toContain('<circle')
  expect(IC.stop).toMatch(/<rect[^>]*fill="currentColor"/)
  expect(rule('.wrow>.wstop')).toContain('border-radius:50%')
  expect(draw(chat({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' })))).toBe('')
})

test('layout: Stop sits at the right end of the row, centred over the box\'s round button', () => {
  const row = rule('.wrow'), stop = rule('.wrow>.wstop')
  expect(row).toContain('justify-self:stretch')
  expect(row).toContain('gap:8px')
  expect(stop).toContain('margin-left:auto')
  // the box bar's right padding plus half the size difference: the two buttons share a centre line
  expect(rule('.cbar')).toMatch(/padding:0 6px 6px/)
  expect(stop).toContain('margin-right:calc(6px + (var(--send) - var(--ib))/2)')
  // the chat column and the box share their edges, in the main chat and in a panel
  expect(css).toContain('.chat .scroll,.chat>.foot{padding-inline:')
  expect(css).toMatch(/\.pane \.scroll\{padding:0 8px 16px\}/)
  expect(css).toContain('.pane .msgs{padding-inline:8px}')
  expect(css).toContain('.pane>.foot{padding-inline:var(--gut)}')
  expect(css).toMatch(/--gut:16px/)
})

// SHEP-421: the step wraps onto up to three lines beside the bubble, top-aligned with it, an ellipsis only after that,
// and Stop stays centred on the bubble's line so a longer step never moves it
test('layout: the step wraps, capped at three lines, top-aligned with the bubble; Stop never squeezed or moved', () => {
  const step = rule('.wstep')
  expect(step).not.toContain('nowrap')
  expect(step).toContain('-webkit-line-clamp:3')
  expect(step).toContain('display:-webkit-box')
  expect(step).toContain('min-width:0')
  // the bubble is a one-line message: 6px padding round a 24px line; the step's 20px line sits on its middle
  expect(rule('.wsign')).toContain('align-items:flex-start')
  expect(rule('.wsign')).toContain('line-height:20px')
  expect(px(step, 'padding-top')).toBe((6 + 24 + 6 - 20) / 2)
  expect(rule('.wrow')).toContain('align-items:flex-start')
  const stop = rule('.wrow>.wstop')
  expect(stop).toContain('flex:none')
  expect(stop).toContain('margin-top:calc((36px - var(--ib))/2)')
})

test('the step stays while it works: the last one held until the next, gone with the sign', () => {
  const key = 'p:held'
  const at = (c: Partial<Chat>, m?: Message[]) => renderToStaticMarkup(<WorkingSign chat={chat({ key, ...c }, m)} />)
  expect(at({ working: true, live: turn() })).toContain('<span class="wstep">Thinking</span>')
  expect(at({ working: true, live: turn({ now: { title: 'Reading app.ts' } as TurnActivity['now'] }) })).toContain('<span class="wstep">Reading app.ts</span>')
  // between tools: the last step still shows, not the bare dots
  expect(at({ working: true, live: turn() })).toContain('<span class="wstep">Reading app.ts</span>')
  expect(at({ working: true, doing: 'Running bun test' })).toContain('<span class="wstep">Running tests</span>')
  // the turn ends: the sign goes and forgets it; the next turn starts fresh
  expect(at({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' }))).toBe('')
  expect(at({ working: true, live: turn() })).toContain('<span class="wstep">Thinking</span>')
})

// A finished turn with only background work left running: no dots, no Stop; a quiet note instead.
const { BackgroundNote } = await import('./client.tsx')
test('background work alone: no working sign, a quiet still note with no button', () => {
  const c = chat({ working: false, bgNote: '1 background command running' }, msgs({ who: 'you', text: 'go' }, { text: 'Watching for the watch.' }))
  expect(draw(c)).toBe('')
  const note = renderToStaticMarkup(<BackgroundNote chat={c} />)
  expect(note).toBe('<p class="bgnote" role="status">1 background command running</p>')
  // the work wakes it: the dots are back and the note gives way
  expect(renderToStaticMarkup(<BackgroundNote chat={{ ...c, working: true }} />)).toBe('')
  expect(rule('.bgnote')).not.toContain('animation')
})
