// The design system's parts (ds.css), one build each: icon, buttons, rows, segments, switch, meter, header, empty
// state. Every screen is made of these.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'
import { IC, type IconName } from './icons.ts'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

/** an icon of the one set; `c`: its size and colour classes (s16, s20, s22, c-ask, c-ready, c-working, c-mute, bolt) */
export function I({ n, c }: { n: IconName; c?: string }) {
  // a Working ring turns wherever it shows (ds.css .i.turn; a slow pulse with reduced motion)
  return <svg className={cx('i', n === 'working' && 'turn', c)} viewBox="0 0 20 20" aria-hidden="true" dangerouslySetInnerHTML={{ __html: IC[n] }} />
}

type Press = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'aria-expanded'> & { pressed?: boolean; expanded?: boolean }

/** an icon button: its label is its name (no hover tips) */
export function IB({ icon, label, pressed, expanded, className, children, ...rest }: Press & { icon: IconName; label: string }) {
  return (
    <button type="button" className={cx('ib', className)} aria-label={label} aria-pressed={pressed} aria-expanded={expanded} {...rest}>
      <I n={icon} />
      {children}
    </button>
  )
}

/** a button: one primary per view (`pri`), the rest in the control tone; `danger` only for Remove and Delete */
export function Btn({ kind, small, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'pri' | 'str' | 'danger'; small?: boolean }) {
  return (
    <button type="button" className={cx('btn', kind, small && 's', className)} {...rest}>
      {children}
    </button>
  )
}

/** a row: of the list, of a menu, of a picker */
export function Row({
  icon,
  lead,
  label,
  sub,
  value,
  end,
  danger,
  current,
  expanded,
  two,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-current'> & {
  icon?: IconName
  /** in the icon's place (a logo) */
  lead?: ReactNode
  label: ReactNode
  /** a second line */
  sub?: ReactNode
  value?: ReactNode
  end?: ReactNode
  danger?: boolean
  current?: boolean
  expanded?: boolean
  two?: boolean
}) {
  return (
    <button type="button" className={cx('row', (two || !!sub) && 'row2', danger && 'danger', className)} aria-current={current} aria-expanded={expanded} {...rest}>
      {lead ?? (icon && <I n={icon} />)}
      <span className="n">{sub ? <><span className="l1">{label}</span><span className="l2">{sub}</span></> : label}</span>
      {value != null && value !== '' && <span className="v">{value}</span>}
      {end}
    </button>
  )
}

/** a count on a row, or over a button */
export const Cnt = ({ n }: { n: number }) => (n ? <span className="cnt">{n}</span> : null)

/** a few choices side by side; the picked one in the control tone */
export function Seg<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {values.map((v) => (
        <button type="button" key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {v}
        </button>
      ))}
    </div>
  )
}

/** a switch */
export function Tgl({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="tg" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  )
}

/** a thin bar: how full; amber when over 85% */
export const Meter = ({ pct }: { pct: number }) => (
  <div className={cx('meter', pct > 85 && 'hot')}>
    <i style={{ ['--w' as string]: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
)

/** an agent's logo: its own where the app has one, else its first letters */
const LOGOS: Record<string, string> = Object.fromEntries(Object.entries({ claude: 'claude', codex: 'codex', opencode: 'opencode', pi: 'pi', droid: 'droid', amp: 'amp', cline: 'cline', 'copilot-cli': 'copilot', 'cursor-agent': 'cursor', 'gemini-cli': 'gemini', goose: 'goose', 'grok-build': 'grok', 'kilo-code': 'kilocode', kiro: 'kiro', 'qwen-code': 'qwen' }).map(([id, icon]) => [id, `agents/${icon}.svg`]))
export function Logo({ agent, name }: { agent: string; name?: string }) {
  const src = LOGOS[agent]
  if (src) return <span className={cx('logo img', agent === 'pi' && 'pi')} aria-hidden="true"><img src={src} alt="" /></span>
  const n = (name ?? agent).trim()
  const mark = n.includes(' ') ? n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2) : n.slice(0, 2)
  return <span className="logo" aria-hidden="true">{mark.charAt(0).toUpperCase() + mark.slice(1)}</span>
}

/** the one empty state: a line of text, centred, muted; a chat's first-run state adds a short title */
export function Empty({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {title && <b>{title}</b>}
      <span>{children}</span>
    </div>
  )
}

/** a header draws its bottom line only once what is under it has scrolled */
export function useScrolled(ref: RefObject<HTMLElement | null>): boolean {
  const [sc, setSc] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => setSc(el.scrollTop > 4)
    on()
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [ref])
  return sc
}

/** the one header build: optional back, title (one line, cut with …) with an optional second line, actions right */
export function Hd({ back, title, sub, pad, scrolled, children, lead }: { back?: { label: string; run: () => void }; title?: ReactNode; sub?: ReactNode; pad?: number; scrolled?: boolean; children?: ReactNode; lead?: ReactNode }) {
  return (
    <header className={cx('hd', scrolled && 'sc')}>
      {back && <IB icon="back" label={back.label} onClick={back.run} />}
      {lead}
      {title != null && (
        <div className="ttl" style={pad != null ? { paddingLeft: pad } : undefined}>
          <span className="t1">{title}</span>
          {sub != null && sub !== '' && <span className="t2">{sub}</span>}
        </div>
      )}
      {children}
    </header>
  )
}

/** a text box that grows with its text up to six lines, then scrolls inside itself */
export function useGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = '44px'
    t.style.height = `${Math.min(164, t.scrollHeight)}px`
  }, [ref, value])
}

/** a ref whose element takes the keyboard focus when it shows */
export function useFocusOnShow<T extends HTMLElement>(on = true) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (on) ref.current?.focus({ preventScroll: true })
  }, [on])
  return ref
}
