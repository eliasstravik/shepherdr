// An artifact's recipe drawn as the web's own HTML (core/recipe.js says what each block is; the window draws the same
// file in GPUI). In 2.1's look: its tokens, type and corners; charts as SVG; Markdown through the chat's renderer.
// A choice, a form or a button sends its words to the agent that made it (reply), once: then it says "Sent", as the
// window's (mods/artifacts/recipe-view.js). Mark up lays its own layer over the whole recipe (plugins/artifacts).
import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowUpRightIcon } from '@heroicons/react/16/solid'
import { Markdown } from '@plugins/chat/markdown.tsx'
import { Primary } from '../ui.tsx'
import * as R from '@core/recipe.js'

type Block = any
type Props = { recipe: { blocks: Block[] }; asset: (src: string) => string; reply?: (text: string) => Promise<unknown> }

/** the window's words when a recipe can't be read */
export const UNREADABLE = "This artifact's recipe can't be read."

const { chartShapes, choiceReply, formReply, isLink } = R as any
const PALETTE = ['var(--accent)', 'var(--focus)', 'var(--ready)', 'var(--work)', 'var(--merged)', 'var(--need)']
const TONE: Record<string, string> = { info: 'bg-well shadow-soft', good: 'bg-ready/10', warn: 'bg-work/12', bad: 'bg-need/10' }

function Chart({ b }: { b: Block }) {
  const s = chartShapes(b)
  const W = 320, H = 160
  if (b.kind === 'pie') {
    const arc = (a0: number, a1: number) => {
      const r = 70, cx = 80, cy = 80, p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)]
      const [x0, y0] = p(a0), [x1, y1] = p(a1)
      return a1 - a0 >= Math.PI * 2 - 1e-6 ? `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}Z` : `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}Z`
    }
    return (
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 160 160" className="size-36 shrink-0" role="img" aria-label={b.title ?? 'Pie chart'}>
          {s.slices.map((x: any, i: number) => <path key={i} d={arc(x.a0, x.a1)} fill={PALETTE[i % PALETTE.length]} />)}
        </svg>
        <ul role="list" className="flex flex-col gap-1">
          {s.slices.map((x: any, i: number) => (
            <li key={i} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{x.label}<span className="text-fg3 tabular-nums">{Math.round(x.share * 100)}%</span></li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full max-w-[560px]" role="img" aria-label={b.title ?? `${b.kind} chart`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line2)" />
        {b.kind === 'line'
          ? s.lines.map((l: any, i: number) => <polyline key={i} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="2" points={l.points.map((p: any) => `${p.x * (W - 8) + 4},${H - p.y * (H - 8)}`).join(' ')} />)
          : s.bars.map((x: any, i: number) => <rect key={i} x={x.x * W} y={H - x.h * (H - 4)} width={x.w * W} height={x.h * (H - 4)} rx="2" fill={PALETTE[x.series % PALETTE.length]} />)}
        {(b.labels ?? []).map((l: string, i: number, all: string[]) => (
          <text key={i} x={((i + 0.5) / all.length) * W} y={H + 14} textAnchor="middle" fontSize="10" fill="var(--fg3)">{l}</text>
        ))}
      </svg>
      {(b.series ?? []).length > 1 ? (
        <figcaption className="flex flex-wrap gap-3 text-fg2">{b.series.map((x: any, i: number) => <span key={i} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{x.name}</span>)}</figcaption>
      ) : null}
    </figure>
  )
}

function Choice({ b, reply }: { b: Block; reply?: Props['reply'] }) {
  const [sent, setSent] = useState<string | null>(null)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">{b.question}</legend>
      {b.options.map((o: any) => (
        <button key={o.label} type="button" disabled={!!sent || !reply} onClick={async () => { await reply?.(choiceReply(b, o.label)); setSent(o.label) }}
          className={clsx('press-dim flex flex-col items-start rounded-box px-3.5 py-2.5 text-left shadow-box enabled:hover:bg-hover disabled:cursor-default', sent === o.label && 'bg-sel')}>
          <span className="font-medium">{o.label}{sent === o.label ? ' · Sent' : ''}</span>
          {o.description ? <span className="text-fg2">{o.description}</span> : null}
        </button>
      ))}
    </fieldset>
  )
}

function Form({ b, reply }: { b: Block; reply?: Props['reply'] }) {
  const [v, setV] = useState<Record<string, unknown>>({})
  const [sent, setSent] = useState(false)
  const field = 'w-full rounded-[var(--row-radius)] bg-bg px-3 py-2 shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-[inset_0_0_0_1px_var(--fg3)]'
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); await reply?.(formReply(b, v)); setSent(true) }}>
      {b.fields.map((f: any) => (
        <label key={f.name} className={clsx('flex gap-2', f.kind === 'checkbox' ? 'items-center' : 'flex-col')}>
          {f.kind === 'checkbox' ? <input type="checkbox" checked={!!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} className="size-4" /> : null}
          <span className="text-fg2">{f.label ?? f.name}</span>
          {f.kind === 'textarea' ? <textarea rows={3} className={field} placeholder={f.label ?? f.name} value={String(v[f.name] ?? '')} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            : f.kind === 'select' ? <select className={field} value={String(v[f.name] ?? '')} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}><option value="" />{(f.options ?? []).map((o: string) => <option key={o}>{o}</option>)}</select>
            : f.kind === 'checkbox' ? null : <input className={field} placeholder={f.label ?? f.name} value={String(v[f.name] ?? '')} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />}
        </label>
      ))}
      <Primary type="submit" disabled={sent || !reply} className="self-start">{sent ? 'Sent' : b.submit ?? 'Send'}</Primary>
    </form>
  )
}

/** a press sends its reply, once: "<label> · Sent". With an href (https only) it opens that page in a new tab each
 *  press, as a plain link: the person acts there themselves. quiet: the softer look, beside the one to press. */
function Button({ b, reply, className }: { b: Block; reply?: Props['reply']; className?: string }) {
  const [sent, setSent] = useState(false)
  const link = isLink(b.href) ? (b.href as string) : null
  const answers = typeof b.reply === 'string'
  return (
    <Primary soft={!!b.quiet} disabled={!link && (sent || !reply)} className={clsx(link && 'pr-3', className)}
      onClick={async () => {
        if (link) window.open(link, '_blank', 'noopener,noreferrer')
        if (answers && !sent && reply) { await reply(b.reply); setSent(true) }
      }}>
      {sent && !link ? `${b.label} · Sent` : b.label}
      {link ? <ArrowUpRightIcon aria-hidden className="size-4 shrink-0 opacity-70" /> : null}
    </Primary>
  )
}

/** a clip (mp4, webm or mov) in place: its controls, its poster, or muted and looping for a short one that plays itself.
 *  A browser that can't play it says so and offers the file (SHEP-209). videoRef and events let a pair play two together. */
function Clip({ src, poster, caption, loop, muted, autoplay, asset, videoRef, events, label }: { src: string; poster?: string; caption?: string; loop?: boolean; muted?: boolean; autoplay?: boolean; asset: (src: string) => string; videoRef?: RefObject<HTMLVideoElement | null>; events?: Record<string, () => void>; label?: string }) {
  const [broken, setBroken] = useState(false)
  const own = useRef<HTMLVideoElement>(null)
  const ref = videoRef ?? own
  const silent = !!muted || !!autoplay
  // React doesn't write the muted attribute, so a silent clip is muted on the element (autoplay needs it)
  useEffect(() => { if (ref.current && silent) ref.current.muted = true }, [silent, ref])
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      {broken ? (
        <p className="rounded-box bg-well p-3 text-fg2">This browser can't play this clip. <a className="underline" href={asset(src)} target="_blank" rel="noopener noreferrer" download>Open the file</a></p>
      ) : (
        <video ref={ref} src={asset(src)} poster={poster ? asset(poster) : undefined} controls autoPlay={!!autoplay} loop={!!loop} muted={silent} playsInline preload="metadata"
          aria-label={label ?? caption ?? 'Clip'} onError={() => setBroken(true)} {...events}
          className="block h-auto max-h-[70vh] w-full rounded-box bg-black shadow-box" />
      )}
      {caption ? <figcaption className="text-fg2">{caption}</figcaption> : null}
    </figure>
  )
}

/** a sound (mp3, m4a, wav or ogg) in a small player */
function Sound({ src, caption, asset }: { src: string; caption?: string; asset: (src: string) => string }) {
  const [broken, setBroken] = useState(false)
  return (
    <figure className="flex min-w-0 flex-col gap-1.5 rounded-box bg-well p-3 shadow-soft">
      {broken ? <p className="text-fg2">This browser can't play this sound. <a className="underline" href={asset(src)} target="_blank" rel="noopener noreferrer" download>Open the file</a></p>
        : <audio controls preload="metadata" src={asset(src)} aria-label={caption ?? 'Sound'} onError={() => setBroken(true)} className="w-full" />}
      {caption ? <figcaption className="text-fg2">{caption}</figcaption> : null}
    </figure>
  )
}

/** a PDF inline: its own pages in a frame, with a link to open it whole (phones often can't show one in a frame) */
function Pdf({ src, caption, asset }: { src: string; caption?: string; asset: (src: string) => string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <iframe src={asset(src)} title={caption ?? 'PDF'} className="h-[70vh] min-h-[320px] w-full rounded-box bg-well shadow-box" />
      <figcaption className="flex flex-wrap items-center gap-x-3 text-fg2">
        {caption ? <span>{caption}</span> : null}
        <a className="underline" href={asset(src)} target="_blank" rel="noopener noreferrer">Open the PDF</a>
      </figcaption>
    </figure>
  )
}

/** before and after side by side: a picture or a clip each; two clips play together (one's play, pause and seek are the other's) */
function Pair({ b, asset }: { b: Block; asset: (src: string) => string }) {
  const left = useRef<HTMLVideoElement>(null), right = useRef<HTMLVideoElement>(null)
  const sides = [['Before', b.before, left, right], ['After', b.after, right, left]] as const
  const clips = R.mediaKind(b.before?.src) === 'video' && R.mediaKind(b.after?.src) === 'video'
  // the other clip: follows this one's play, pause and seek (a seek only when it has drifted, so the two don't fight)
  const follow = (me: RefObject<HTMLVideoElement | null>, other: RefObject<HTMLVideoElement | null>) => ({
    onPlay: () => { other.current?.play().catch(() => undefined) },
    onPause: () => { other.current?.pause() },
    onSeeked: () => { const o = other.current, m = me.current; if (o && m && Math.abs(o.currentTime - m.currentTime) > 0.05) o.currentTime = m.currentTime },
  })
  return (
    <div className="grid gap-3 @lg:grid-cols-2">
      {sides.map(([w, x, mine, theirs]) => {
        const kind = R.mediaKind(x?.src)
        return kind === 'video' ? (
          <Clip key={w} src={x.src} poster={x.poster} caption={x.caption ?? w} asset={asset} videoRef={mine} label={`${w}: ${x.caption ?? w}`}
            events={clips ? follow(mine, theirs) : undefined} />
        ) : (
          <figure key={w} className="flex min-w-0 flex-col gap-1.5"><img src={asset(x.src)} alt={x.caption ?? w} className="h-auto max-w-full rounded-box shadow-box" loading="lazy" /><figcaption className="text-fg2">{x.caption ?? w}</figcaption></figure>
        )
      })}
    </div>
  )
}

function Tabs({ b, render }: { b: Block; render: (bs: Block[]) => ReactNode }) {
  const [on, setOn] = useState(0)
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="scroll-x inline-flex max-w-full gap-0.5 self-start rounded-full bg-hover p-0.5">
        {b.tabs.map((t: any, i: number) => (
          <button key={i} role="tab" aria-selected={on === i} type="button" onClick={() => setOn(i)} className={clsx('h-7 shrink-0 rounded-full px-3 phone:h-9', on === i ? 'bg-seg-on shadow-seg' : 'text-fg2')}>{t.label}</button>
        ))}
      </div>
      {render(b.tabs[on]?.blocks ?? [])}
    </div>
  )
}

export function Recipe({ recipe, asset, reply }: Props) {
  const one = (b: Block): ReactNode => {
    switch (b.type) {
      case 'heading': { const H = (`h${Math.min(3, Math.max(1, b.level ?? 2)) + 1}`) as 'h2'; return <H className={clsx('font-semibold text-balance', (b.level ?? 2) <= 1 ? 'text-xl' : 'text-base')}>{b.text}</H> }
      case 'text': return <Markdown text={b.md} />
      case 'list': { const L = b.ordered ? 'ol' : 'ul'; return <L className={clsx('flex flex-col gap-1 pl-5', b.ordered ? 'list-decimal' : 'list-disc')}>{b.items.map((x: string, i: number) => <li key={i}><Markdown text={x} /></li>)}</L> }
      case 'table': return (
        <div className="overflow-x-auto rounded-box shadow-box">
          <table className="w-full border-collapse">
            <thead><tr>{b.columns.map((c: any, i: number) => <th key={i} className={clsx('border-b border-line px-3 py-2 text-left font-medium text-fg2', (c.align ?? '') === 'right' && 'text-right')}>{c.label ?? c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r: unknown[], i: number) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={clsx('px-3 py-2 align-top', b.columns[j]?.align === 'right' && 'text-right tabular-nums')}>{String(c ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      case 'chart': return <Chart b={b} />
      case 'stats': return <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-4">{b.items.map((x: any, i: number) => <div key={i} className="rounded-box bg-well p-3 shadow-soft"><dt className="text-fg2">{x.label}</dt><dd className="text-xl font-semibold tabular-nums">{String(x.value)}</dd>{x.note ? <dd className="text-fg3">{x.note}</dd> : null}</div>)}</dl>
      case 'image': return <figure className="flex flex-col gap-1.5"><img src={asset(b.src)} alt={b.caption ?? ''} width={b.w} height={b.h} className="h-auto max-w-full rounded-box shadow-box" loading="lazy" />{b.caption ? <figcaption className="text-fg2">{b.caption}</figcaption> : null}</figure>
      case 'video': return <Clip src={b.src} poster={b.poster} caption={b.caption} loop={b.loop} muted={b.muted} autoplay={b.autoplay} asset={asset} />
      case 'audio': return <Sound src={b.src} caption={b.caption} asset={asset} />
      case 'pdf': return <Pdf src={b.src} caption={b.caption} asset={asset} />
      case 'pair': return <Pair b={b} asset={asset} />
      case 'code': return <pre data-selectable className="overflow-x-auto rounded-box bg-well p-3 font-mono text-[0.8125rem] shadow-soft"><code>{b.text}</code></pre>
      case 'callout': return <div className={clsx('rounded-box p-3.5', TONE[b.tone ?? 'info'])}>{b.title ? <p className="font-medium">{b.title}</p> : null}{b.md ? <Markdown text={b.md} /> : null}</div>
      case 'columns': return <div className="grid gap-4 @2xl:grid-flow-col @2xl:auto-cols-fr">{b.columns.map((c: Block[], i: number) => <div key={i} className="flex min-w-0 flex-col gap-4">{c.map(wrap)}</div>)}</div>
      case 'tabs': return <Tabs b={b} render={(bs) => <div className="flex flex-col gap-4">{bs.map(wrap)}</div>} />
      case 'details': return <details className="group rounded-box shadow-box"><summary className="cursor-pointer px-3.5 py-2.5 font-medium">{b.summary}</summary><div className="flex flex-col gap-4 px-3.5 pb-3.5">{b.blocks.map(wrap)}</div></details>
      case 'divider': return <hr className="border-line" />
      case 'choice': return <Choice b={b} reply={reply} />
      case 'form': return <Form b={b} reply={reply} />
      case 'button': return <Button b={b} reply={reply} className="self-start" />
      case 'buttons': return <div className="flex flex-wrap items-center gap-2">{b.items.map((x: Block, i: number) => <Button key={i} b={x} reply={reply} />)}</div>
    }
    return null
  }
  const wrap = (b: Block) => (
    <section key={b.id} data-block={b.id} className="min-w-0">
      {one(b)}
    </section>
  )
  return <div className="@container flex flex-col gap-4 text-base/7 text-fg sm:text-sm/6">{recipe.blocks.map(wrap)}</div>
}
