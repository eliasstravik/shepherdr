// The screen stays one design: the same icons, weights and colours everywhere, buttons that say what they are.
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const files = [
  ...readdirSync(join(root, 'src'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join('src', f)),
  ...readdirSync(join(root, 'plugins'))
    .map((p) => join('plugins', p, 'client.tsx'))
    .filter((f) => readdirSync(join(root, f, '..')).includes('client.tsx')),
]
const source = Object.fromEntries(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]))
const offenders = (re: RegExp, except: string[] = []) => files.filter((f) => !except.includes(f) && re.test(source[f]))

describe('one design across the screen', () => {
  test('icons come from one set, through ui.tsx', () => {
    // The verified legacy composer uses the same established 20px pick chevron.
    expect(offenders(/@heroicons/, ['src/ui.tsx', 'src/restart.tsx'])).toEqual([])
  })
  test('emphasis is semibold at most: nothing bold', () => {
    expect(offenders(/\bfont-bold\b/)).toEqual([])
  })
  test('colours come from the theme tokens, which have a dark twin, not from fixed greys', () => {
    expect(offenders(/\b(?:bg|text|border|ring|fill|stroke)-(?:gray|slate|zinc|neutral)-\d/)).toEqual([])
  })
  test('every button says whether it submits', () => {
    const bare = files.flatMap((f) =>
      [...source[f].matchAll(/<button\b([^>]*)>/g)].filter((m) => !/\btype=/.test(m[1])).map(() => f),
    )
    expect(bare).toEqual([])
  })
  test('a task id is text, not a counter: no fixed-width digits that space out its dash', () => {
    expect(source['plugins/tasks/client.tsx']).not.toMatch(/tabular-nums">\{t\.id\}/)
  })
  test('the picked segment of a toggle is lighter than its track in dark mode too', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    expect(css.match(/--seg-on:/g)?.length).toBe(2)
    expect(offenders(/aria-pressed:bg-bg\b/)).toEqual([])
  })
  test('the chat box is a pill and its buttons are circles, like the header buttons and the Chat/Tasks bar', () => {
    const chat = source['plugins/chat/client.tsx']
    const box = chat.match(/["'](round-box[^"']*shadow-box[^"']*)["']/)?.[1] ?? ''
    // corners of half the one-line height: its 6px padding around a 34px (phone 44px) round button
    expect(box).toContain('p-1.5')
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    expect(css).toMatch(/@utility round-box \{\s+--round-pad: --spacing\(1\.5\);\s+--round-btn: 34px;\s+border-radius: calc\(var\(--round-pad\) \+ var\(--round-btn\) \/ 2\);\s+\[data-device="phone"\] & \{\s+--round-btn: 44px;/)
    // typing in it darkens its edge a little, never a bright ring
    expect(box).toContain('has-[textarea:focus]:shadow-box-focus')
    expect(box).not.toContain('--focus')
    expect(css.match(/--box-focus-shadow:/g)?.length).toBe(2)
    expect(chat).toMatch(/aria-label="Send"[\s\S]*?className="[^"]*\brounded-full\b/)
    expect(source['src/ui.tsx']).toMatch(/export const roundBtn = '[^']*rounded-full!/)
    // +, the mic, and Cancel while talking to type; Mute on a call
    expect(chat.match(/className=\{(?:roundBtn|clsx\(roundBtn,[^}]*)\}/g)?.length).toBe(3)
    const voice = source['plugins/voice/client.tsx']
    expect(voice).toMatch(/className=\{clsx\(roundBtn,/)
    expect(voice).toMatch(/aria-label="Voice call"[\s\S]*?className="[^"]*\brounded-full\b/)
    expect(voice).toMatch(/aria-label="End call"[\s\S]*?className="[^"]*\brounded-full\b/)
    expect(chat).toMatch(/aria-label="Done: put it in the box"[\s\S]*?className="[^"]*\brounded-full\b/)
    // no square corners left on the composer's controls
    const composer = chat.slice(chat.indexOf('function Composer('), chat.indexOf('function Attachments('))
    expect(composer).not.toMatch(/rounded-(?:\[\d+px\]|md|lg|xl)\b(?!.*shadow-box)/)
    expect(source['plugins/voice/client.tsx']).not.toMatch(/rounded-\[(?:9|14)px\]/)
  })
  test("the agent's messages sit in their own bubbles too: left, grey while yours are blue, mirrored corners", () => {
    const chat = source['plugins/chat/client.tsx']
    const bubble = chat.slice(chat.indexOf('function Bubble('), chat.indexOf('function SessionLine('))
    expect(bubble).toContain("you ? 'rounded-bubble rounded-br-[6px] bg-reply' : 'rounded-bubble rounded-bl-[6px] bg-bubble'")
    expect(bubble).toMatch(/items-start self-start/)
    // long replies stay wide enough to read on a phone
    expect(bubble).toMatch(/phone:max-w-\[9\d%\]/)
    // your bubbles' reply shade has a dark twin
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    expect(css.match(/--reply:/g)?.length).toBe(2)
    // inline code shows on either bubble's shade
    expect(css).toMatch(/& code \{[^}]*background: var\(--sel\)/)
  })
  test('a hold, the keyboard or a smiley beside it reacts, and reactions sit on the bubble\'s right corner', () => {
    const chat = source['plugins/chat/client.tsx']
    // a finger holds the bubble; a mouse gets the smiley; the keyboard presses Enter on it
    expect(chat).toMatch(/data-anchor\s+\{\.\.\.keys\}\s+\{\.\.\.hold\}/)
    expect(chat).toContain('pointer-fine:grid')
    expect(chat).toContain("'aria-label': 'Message: press Enter to react'")
    // on a touch screen a hold reacts instead of selecting, until Select text
    expect(chat).toContain('pointer-coarse:select-none')
    // one row of pills on the bottom right, yours and the agent's alike
    expect(chat).toContain('<div className="relative -mt-2 flex max-w-full flex-wrap justify-end gap-1 self-end pr-2.5 pl-1 phone:-mt-2.5">{edge}</div>')
    const rx = source['plugins/reactions/client.tsx']
    expect(rx).toMatch(/reg\.messageEdge\.push\(\{ order: \d+, View: Pills \}\)/)
    // a pill is a button that toggles yours
    expect(rx).toMatch(/aria-pressed=\{yours\}\s+onClick=\{\(\) => react\(chat\.key, msg\.id, r\.emoji\)\}/)
  })
  test('scrollbars are slim and calm: a round thumb on a clear track, no arrows, shown on hover or while scrolling', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    const bars = css.slice(css.indexOf('@media (pointer: fine) {'))
    // only with a mouse: touch screens keep their own overlay bars
    expect(bars).toMatch(/^@media \(pointer: fine\) \{\s+::-webkit-scrollbar \{\s+width: 10px;\s+height: 10px;\s+background: transparent;/)
    expect(bars).toMatch(/::-webkit-scrollbar-button \{\s+display: none;/)
    expect(bars).toMatch(/::-webkit-scrollbar-track,\s+::-webkit-scrollbar-corner \{\s+background: transparent;/)
    expect(bars).toMatch(/::-webkit-scrollbar-thumb \{\s+border: 2px solid transparent;\s+border-radius: 999px;/)
    // hidden at rest, shown while the pointer is over the list or it moves; darker while held
    expect(bars).toMatch(/:hover::-webkit-scrollbar-thumb,\s+\[data-scrolling\]::-webkit-scrollbar-thumb \{\s+background-color: var\(--thumb\);/)
    expect(bars).toMatch(/::-webkit-scrollbar-thumb:active \{\s+background-color: var\(--thumb-held\);/)
    expect(source['src/main.tsx']).toMatch(/^watchScrolling\(\)$/m)
    // Firefox: the standard properties, the same thumb
    expect(bars).toMatch(/@supports not selector\(::-webkit-scrollbar\) \{\s+\* \{\s+scrollbar-width: thin;/)
    expect(bars).toMatch(/\[data-scrolling\] \{\s+scrollbar-color: var\(--thumb\) transparent;/)
    // the thumb has a dark twin, and a light one on the always-dark terminal
    expect(css.match(/--thumb:/g)?.length).toBe(3)
    expect(css.match(/--thumb-held:/g)?.length).toBe(3)
    expect(css).toMatch(/@utility term-screen \{[^}]*--thumb: rgb\(255 255 255/)
    // no screen draws scrollbars of its own: it may only hide one
    expect(offenders(/scrollbar-(?:color|gutter)|::-webkit-scrollbar(?!\]:hidden)/)).toEqual([])
  })
  test('corners follow one rule: pills for one-line controls, two corners for containers, nested ones worked out', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    // a box and a bubble; a row's corner is the box's less a menu's padding, so it is the same in a menu or not
    expect(css).toMatch(/--box-radius: 14px;\s+--bubble-radius: 20px;\s+--row-radius: calc\(var\(--box-radius\) - 6px\);/)
    // every screen file, plugins' extra ones too
    const tsx = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []))
    // no corner of its own: a pill, a token, its parent's (inherit) or one worked out from its parent's (calc), the
    // point of a bubble; the only others are the loading screen's logo, a checkbox, a key and the pick box drawn over a web page
    const own = [...tsx('src'), ...tsx('plugins')].flatMap((f) =>
      [...readFileSync(join(root, f), 'utf8').matchAll(/\brounded(?:-[trbl]{1,2})?-(?:xs|sm|md|lg|xl|2xl|3xl|pop|\[[^\]]+\])(?=[\s'"`])/g)]
        .map((m) => m[0])
        .filter((r) => !/^rounded-\[(?:inherit|calc\(.*)\]$|^rounded-b[lr]-\[6px\]$/.test(r))
        .map((r) => `${f} ${r}`),
    )
    expect(own.sort()).toEqual(['plugins/browser/client.tsx rounded-[3px]', 'plugins/chat/client.tsx rounded-[4px]', 'plugins/keyboard/search.tsx rounded-lg', 'src/App.tsx rounded-[11px]', 'src/ui.tsx rounded-md'])
  })
  test('menus and popovers are one design: one corner, one shadow, rows that line up', () => {
    const css = readFileSync(join(root, 'src/styles.css'), 'utf8')
    // one popover corner and padding; rows inside take the concentric corner
    expect(css).toMatch(/@utility popover \{[^}]*border-radius: var\(--box-radius\)[^}]*box-shadow: var\(--menu-shadow\)/)
    expect(css).toMatch(/@utility row-pop \{[^}]*calc\(var\(--box-radius\) - var\(--pop-pad/)
    // one shadow for everything that floats over the screen
    expect(css).not.toContain('--pop-shadow')
    expect(offenders(/\bshadow-pop\b/)).toEqual([])
    // no popover makes up its own corner: a menu shadow goes with the shared one (or a pill, like the reaction bar)
    const own = files.flatMap((f) => [...source[f].matchAll(/className=[^>]*\bshadow-menu\b[^>]*/g)].filter((m) => !/\brounded-(?:box|full)\b/.test(m[0])).map(() => f))
    expect(own).toEqual([])
    expect(offenders(/role="(?:menu|listbox)"[^>]*rounded-\[/)).toEqual([])
    // every menu row keeps an icon or check slot and puts its hint on the right, so no row brings its own icon or second line
    expect(offenders(/<MenuItem\b[^>]*>\s*<\w+Icon\b/)).toEqual([])
    const ui = source['src/ui.tsx']
    expect(ui).toMatch(/export function MenuItem\([^)]*icon, hint/)
    expect(ui).toContain('<span className="grid size-4 shrink-0 place-items-center">{icon}</span>')
    // the ⋯ menu answers the arrows and Escape, and the button's ring is round and only for the keyboard
    expect(ui).toMatch(/export function Menu\([\s\S]*?'ArrowDown'[\s\S]*?'Escape'/)
    expect(source['src/App.tsx']).toMatch(/aria-haspopup="menu"[\s\S]*?'rounded-full!'/)
    expect(css).toMatch(/:focus-visible \{\s*outline: none;\s*\}\s*:where\(\[data-keys="focus"\]\) :focus-visible \{\s*outline: 2px solid var\(--focus\)/)
    expect(css).not.toMatch(/:focus \{/)
    // a mode's meaning is a few words beside it, not a second line
    const modes = [...readFileSync(join(root, 'shared/types.ts'), 'utf8').matchAll(/\['\w+', '\w+', '([^']+)'\]/g)].map((m) => m[1])
    expect(modes.length).toBe(2)
    for (const m of modes) expect(m.length).toBeLessThanOrEqual(22)
  })
  test('every focus ring of a row or button is the keyboard\'s: it carries keys:, or a click would show it after any key', () => {
    const all = [...new Set([...files, ...readdirSync(join(root, 'plugins'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx')).map((f) => join('plugins', f))])]
    const bare = all.filter((f) => /(?<![\w:-])(?:has-|group-)?focus-visible:(?:after:)?shadow-\[[^\]]*--(?:color-)?focus/.test(readFileSync(join(root, f), 'utf8')))
    expect(bare).toEqual([])
    expect(source['src/ui.tsx']).toContain("kb && 'cursor:shadow-[inset_0_0_0_1.5px_var(--focus)]'")
    expect(source['plugins/terminal/client.tsx']).not.toContain('outline-focus')
  })
  test("the agent's name shows only when someone else asks", () => {
    const chat = source['plugins/chat/client.tsx']
    expect(chat).toMatch(/!you && msg\.question\?\.asks \? <From>/)
  })
})
