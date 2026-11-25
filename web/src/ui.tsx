// The design system's parts (ds.css), one build each: icon, buttons, rows, segments, switch, meter, header, empty
// state. Every screen is made of these.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react'
import { IC, type IconName } from './icons.ts'
import { fitBox } from './grow.ts'
import { onPresses, press, pressOf, pressVersion, waiting, type Press as CardPress } from './pending.ts'

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

/** A card whose buttons ask the server (pending.ts): `card` names it (the same card wherever it shows), `at` its state
 *  now, from the server's data (a new state settles a press). Its buttons are ActBtn with this. */
export interface CardActs {
  card: string
  at: string
  now: CardPress | undefined
}
export function useCardActs(card: string, at: string): CardActs {
  useSyncExternalStore(onPresses, pressVersion)
  return { card, at, now: pressOf(card, at) }
}

/** A card's button that asks the server: pressed at once, then (past a moment) a spinner and `busy` words in its place,
 *  the card's other buttons waiting meanwhile; a no comes back as ActError under them. `run`: null for yes, else the
 *  error words (kernel attempt()). `hold` false: a yes lets go at once (nothing on the card changes from it).
 *  `chip`: a quick answer's round chip instead of a button. */
export function ActBtn({ acts, id, run, busy, hold, chip, kind, small, className, children, disabled, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'id'> & {
  acts: CardActs
  id: string
  run: () => Promise<string | null>
  busy: string
  hold?: boolean
  chip?: boolean
  kind?: 'pri' | 'str' | 'danger'
  small?: boolean
}) {
  const p = acts.now
  const mine = waiting(p) && p!.which === id
  const shown = mine && p!.shown
  return (
    <button
      type="button"
      className={cx(chip ? 'chip' : 'btn', !chip && kind, !chip && small && 's', mine && 'going', shown && 'busy', className)}
      disabled={disabled || (waiting(p) && !mine)}
      aria-disabled={mine || undefined}
      aria-busy={shown || undefined}
      onClick={() => {
        if (!waiting(p)) void press(acts.card, acts.at, id, run, hold)
      }}
      {...rest}
    >
      {shown ? (
        <>
          <I n="working" c="s16" />
          <span>{busy}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

/** a card's last press the server said no to: its words, short, in red under its buttons */
export function ActError({ acts }: { acts: CardActs }) {
  const e = acts.now?.error
  return e ? <span className="s c-red acterr" role="alert">{e}</span> : null
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

/** one group of a menu's choices, under its quiet name: the one rhythm of the filter menus (the Tasks panel's and each
 *  machine's in the list). A group after another gets a hairline above it. */
export function MenuGroup({ cap, children }: { cap?: string; children: ReactNode }) {
  return (
    <div className="mg" role="group" aria-label={cap}>
      {cap && <div className="cap">{cap}</div>}
      {children}
    </div>
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
  // a logo that can't load leaves nothing, never an empty square's gap (the message box's + then the model)
  const [lost, setLost] = useState<string | null>(null)
  if (src && lost === src) return null
  if (src) return <span className={cx('logo img', agent === 'pi' && 'pi')} aria-hidden="true"><img src={src} alt="" onError={() => setLost(src)} /></span>
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

/** a header draws its bottom line only once what is under it has scrolled; the element knows its scroll bar's width (--sbw) */
export function useScrolled(ref: RefObject<HTMLElement | null>): boolean {
  const [sc, setSc] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => setSc(el.scrollTop > 4)
    on()
    el.addEventListener('scroll', on, { passive: true })
    // the scroll bar's width (0 where it overlays): the fade above the message box leaves its strip out (#1499)
    const bar = () => el.style.setProperty('--sbw', `${el.offsetWidth - el.clientWidth}px`)
    bar()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bar)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', on)
      ro?.disconnect()
    }
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
  // before the frame is drawn, so a new line never shows first at the old height
  useLayoutEffect(() => {
    if (ref.current) fitBox(ref.current)
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
