// A header button's count badge stays inside the header (SHEP-387): on touch the button is nearly the header's height,
// and a badge seated on the button's edge crossed the header's top line.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./ds.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = (sel: string) => css.split('}').filter((r) => r.split('{')[0]!.split(',').map((s) => s.trim()).includes(sel)).map((r) => r.split('{').pop()!)
// the last value a selector's rules give a property (later rules win)
const prop = (sel: string, p: string) => rules(sel).flatMap((r) => r.split(';')).filter((d) => d.trim().startsWith(p + ':')).map((d) => d.split(':').slice(1).join(':').trim()).pop()!
const px = (v: string) => Number(v.replace('px', ''))
const vars = (sel: string) => Object.fromEntries(rules(sel).join(';').split(';').filter((d) => d.trim().startsWith('--')).map((d) => [d.split(':')[0]!.trim(), d.split(':')[1]!.trim()]))

// px from a length or a calc() over 50% (of the button), --vars and px
const resolve = (v: string, ib: number, env: Record<string, string>): number => {
  const e = v.replace(/^calc\((.*)\)$/, '$1').replace(/var\((--[\w-]+)\)/g, (_, n) => String(px(env[n]!))).replace(/50%/g, String(ib / 2)).replace(/px/g, '')
  return Function(`return (${e})`)() as number
}

for (const layout of [['.app'], ['.app', '.app.tap'], ['.app', '.app.tap', '.app.phone'], ['.app', '.app.phone']]) {
  test(`the header's count badge lies within the header (${layout.at(-1)})`, () => {
    const env = Object.assign({}, ...layout.map(vars))
    const hd = px(env['--hd']), ib = px(env['--ib'])
    const h = px(prop('.ib .cnt', 'height')), ring = 2
    const top = (hd - ib) / 2 + resolve(prop('.ib .cnt', 'top'), ib, env)
    expect(top - ring).toBeGreaterThanOrEqual(0)
    expect(top + h + ring).toBeLessThanOrEqual(hd)
    // its right edge stays on the button, so a two-digit count grows over the icon, never past the next button
    expect(resolve(prop('.ib .cnt', 'right'), ib, env)).toBeGreaterThanOrEqual(-8)
  })
}
