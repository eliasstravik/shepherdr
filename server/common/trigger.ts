// One trigger for Autopilot's heartbeat and for automations: a time rule, event rules, or both. The time rule is an
// iCalendar recurrence rule (RFC 5545: DTSTART, RRULE, EXDATE), read by the rrule package, or "once <date> <time>"; its
// times are wall-clock times in the time zone Settings sets (time.zone, Everywhere). Event rules name the news that
// sets it off (a task added, ready, gone wrong…), each with optional filters (space, branch, title). Humans never write
// either: the coordinator writes them from plain words, and everywhere they are shown in words with the next runs.
import { RRule, rrulestr, type Frequency, type Weekday } from 'rrule'

export type TriggerEvent = 'added' | 'ready' | 'failed' | 'needs-you' | 'merged' | 'stalled' | 'main-red' | 'health'
export const EVENTS: TriggerEvent[] = ['added', 'ready', 'failed', 'needs-you', 'merged', 'stalled', 'main-red', 'health']

/** one kind of news, or every kind ('news'), with filters: a space by name, a task's branch (* any run of
 *  characters), words in a task's title (any case) */
export interface EventRule {
  event: TriggerEvent | 'news'
  space?: string
  branch?: string
  title?: string
}

export interface Trigger {
  /** a time rule as kept (timeRule); none: no time rule */
  time?: string
  on?: EventRule[]
}

/** what happened, to match against event rules */
export interface Happened {
  event: TriggerEvent
  detail?: string
  space?: string
  branch?: string
  title?: string
}

/** the time zone this machine runs in: time.zone's default */
export const OWN_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/* ---------- time rules ---------- */

/** where a rule without its own DTSTART starts counting from (every other week, every 90 minutes) */
const ANCHOR = 'DTSTART:20260101T000000'
const ONCE = /^once\s+(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+|T)(\d{1,2})[:.](\d{2})$/i
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A time rule as it is kept, from what the coordinator wrote: an RRULE (with or without "RRULE:", alone or with
 * DTSTART and EXDATE lines, on one line or several), "once 2026-11-02 9:00", or "off". Plain words are the
 * coordinator's to turn into a rule: rrule's own reader of words drops what it doesn't know without a word ("every 30
 * minutes from 8 to 18" would run all day), so they are refused, saying how to write one.
 * Kept on one line: "DTSTART:20260101T000000 RRULE:FREQ=MINUTELY;INTERVAL=30 EXDATE:20261224T000000", or
 * "once 2026-11-02 09:00"; "off" for none.
 */
export function timeRule(text: string): string {
  const t = text.trim().replace(/^["']|["']$/g, '')
  if (!t || /^(off|none|never)$/i.test(t)) return 'off'
  const once = t.match(ONCE)
  if (once) {
    const [, y, mo, d, h, mi] = once.map(Number)
    const at = new Date(Date.UTC(y, mo - 1, d, h, mi))
    if (at.getUTCMonth() !== mo - 1 || h > 23 || mi > 59) throw new Error(`No such time: ${t}`)
    return `once ${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`
  }
  if (!/(^|\s)(RRULE:|FREQ=|DTSTART|EXDATE)/i.test(t)) throw new Error(howTo(t))
  let lines = t
    .split(/\s+/)
    .filter(Boolean)
    .map((l) => (/^FREQ=/i.test(l) ? `RRULE:${l}` : l).toUpperCase())
  if (!lines.some((l) => l.startsWith('RRULE:'))) throw new Error(howTo(t))
  if (lines.filter((l) => l.startsWith('RRULE:')).length > 1) throw new Error('One RRULE line only: write the rest as BY… parts of it, or as two automations.')
  if (lines.some((l) => !/^(DTSTART|RRULE|EXDATE|RDATE)[:;]/.test(l))) throw new Error(`Only DTSTART, RRULE, EXDATE and RDATE lines: ${lines.find((l) => !/^(DTSTART|RRULE|EXDATE|RDATE)[:;]/.test(l))}`)
  // wall-clock times, in time.zone: no Z, no TZID
  lines = lines.map((l) => l.replace(/;TZID=[^:]+/, '').replace(/(\d{8}T\d{6})Z/g, '$1'))
  if (!lines.some((l) => l.startsWith('DTSTART'))) lines.unshift(ANCHOR)
  const kept = lines.join(' ')
  try {
    const set = parse(kept)
    const o = set.rrules()[0].options
    if (o.freq === RRule.SECONDLY) throw new Error('Once a minute at most')
    if (o.count && subDaily(o)) throw new Error('COUNT with days to keep in a rule every so many minutes or hours: write UNTIL instead')
  } catch (e) {
    throw new Error(`Can't read the time rule "${t}": ${(e as Error).message}. ${howTo()}`)
  }
  return kept
}

const howTo = (t?: string) =>
  `${t ? `Can't read the time rule "${t}": turn the human's words into an RRULE yourself. ` : ''}Write an iCalendar RRULE such as FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,10,11,12,13,14,15,16,17;BYDAY=MO,TU,WE,TH,FR (with DTSTART:… and EXDATE:… where needed), or once 2026-11-02 9:00, or off.`

const cache = new Map<string, ReturnType<typeof rrulestr>>()
function parse(kept: string) {
  let set = cache.get(kept)
  if (!set) {
    set = rrulestr(kept.split(' ').join('\n'), { forceset: true })
    if (cache.size > 200) cache.clear()
    cache.set(kept, set)
  }
  return set as import('rrule').RRuleSet
}

/** an instant as the wall clock in a zone shows it, as a Date whose UTC fields are that wall clock */
function wall(at: number, zone: string): Date {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]))
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second))
}

/** the instant a wall-clock time (UTC fields) is in a zone; a time the clocks skip is the one an hour later */
function instant(w: Date, zone: string): number {
  const guess = w.getTime()
  const off = wall(guess, zone).getTime() - guess
  let at = guess - off
  const off2 = wall(at, zone).getTime() - at
  if (off2 !== off) at = guess - off2
  return at
}

/** the next runs of a time rule after an instant, in a zone (at most n); none once it is over or off */
export function nextRuns(kept: string | undefined, zone: string, after = Date.now(), n = 1): number[] {
  if (!kept || kept === 'off') return []
  const once = kept.match(ONCE)
  if (once) {
    const [, y, mo, d, h, mi] = once.map(Number)
    const at = instant(new Date(Date.UTC(y, mo - 1, d, h, mi)), zone)
    return at > after ? [at] : []
  }
  const o = parse(kept).rrules()[0].options
  const days = subDaily(o)
  const times = days ? timesOnly(kept) : kept
  let set = fast(times, after, zone)
  const out: number[] = []
  let from = wall(after, zone)
  for (let tries = 0; out.length < n && tries < 2000; tries++) {
    const w = set.after(from, false)
    if (!w) break
    if (days && !dayKept(w, o)) {
      // a day it leaves out: on from the end of it, counting from there
      from = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), 23, 59, 59))
      set = fast(times, instant(from, zone), zone)
      continue
    }
    const at = instant(w, zone)
    // an hour the clocks repeat runs once
    if (at > after && !out.includes(at)) out.push(at)
    from = w
  }
  return out
}

/** the first run after an instant (the next one due), or nothing */
export const nextRun = (kept: string | undefined, zone: string, after = Date.now()) => nextRuns(kept, zone, after, 1)[0]

/** a rule every so many minutes or hours that fits a day evenly starts counting at the start of yesterday instead of
 *  its own DTSTART: the same times, without walking every one since */
function fast(kept: string, after: number, zone: string) {
  const set = parse(kept)
  const o = set.rrules()[0]?.options
  if (!o || set.rrules().length !== 1 || o.count || set.rdates().length) return set
  const mins = o.freq === RRule.MINUTELY ? o.interval : o.freq === RRule.HOURLY ? o.interval * 60 : 0
  const start = o.dtstart
  if (!mins || 1440 % mins || !start) return set
  const day = wall(after, zone)
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - 1, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()))
  if (from <= start) return set
  return parse(kept.replace(/DTSTART:\d{8}T\d{6}/, `DTSTART:${stamp(from)}`))
}

const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`

type Options = ReturnType<typeof parse>['rrules'] extends () => (infer R extends RRule)[] ? R['options'] : never

/** a rule every so many minutes or hours that keeps only some days (BYDAY, BYMONTHDAY, BYMONTH): rrule gets these
 *  wrong (a weekend-only one never runs, a month goes missing, a DTSTART on a day left out loops for ever), so its days
 *  are kept here and rrule only finds the times */
const subDaily = (o: Options) => (o.freq === RRule.MINUTELY || o.freq === RRule.HOURLY) && !!(o.byweekday?.length || o.bynweekday?.length || o.bymonthday?.length || o.bynmonthday?.length || o.bymonth?.length)

/** a rule without its day parts */
const timesOnly = (kept: string) => kept.split(' ').map((l) => (l.startsWith('RRULE:') ? `RRULE:${l.slice(6).split(';').filter((p) => !/^(BYDAY|BYMONTHDAY|BYMONTH)=/.test(p)).join(';')}` : l)).join(' ')

/** does a rule's day parts (BYMONTH, BYDAY, BYMONTHDAY) keep this day */
function dayKept(d: Date, o: Options) {
  if (o.bymonth?.length && !o.bymonth.includes(d.getUTCMonth() + 1)) return false
  const wd = (d.getUTCDay() + 6) % 7
  const date = d.getUTCDate()
  const inMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  const nth = (n: number) => (n > 0 ? Math.ceil(date / 7) === n : Math.ceil((inMonth - date + 1) / 7) === -n)
  if ((o.byweekday?.length || o.bynweekday?.length) && !(o.byweekday ?? []).includes(wd) && !(o.bynweekday ?? []).some(([w, n]) => w === wd && nth(n))) return false
  const monthdays = [...(o.bymonthday ?? []), ...(o.bynmonthday ?? []).map((n) => inMonth + n + 1)]
  return !monthdays.length || monthdays.includes(date)
}

/* ---------- in words ---------- */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ORD = (n: number) => (n === -1 ? 'last' : n === -2 ? 'second to last' : `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/** a zone as people say it: its city ("Stockholm"), or UTC */
export const zoneName = (zone: string) => (/^(Etc\/)?(UTC|GMT|Universal|Zulu)$/i.test(zone) ? 'UTC' : (zone.split('/').at(-1) ?? zone).replace(/_/g, ' '))

/** days of the week, by number (0 Monday): runs of three or more as "Monday to Friday" */
function daysWords(days: number[]) {
  const d = [...new Set(days)].sort((a, b) => a - b)
  if (d.length === 7) return ''
  if (d.join() === '5,6') return 'Saturday and Sunday'
  const runs: number[][] = []
  for (const x of d) {
    const last = runs.at(-1)
    if (last && last.at(-1) === x - 1) last.push(x)
    else runs.push([x])
  }
  return and(runs.flatMap((r) => (r.length >= 3 ? [`${DAY_NAMES[r[0]]} to ${DAY_NAMES[r.at(-1)!]}`] : r.map((x) => DAY_NAMES[x]))))
}

/** hours of the day a rule runs in: runs of them as "8:00-22:00" */
function hoursWords(hours: number[]) {
  const h = [...new Set(hours)].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const x of h) {
    const last = runs.at(-1)
    if (last && last.at(-1) === x - 1) last.push(x)
    else runs.push([x])
  }
  return runs.map((r) => `${r[0]}:00-${r.at(-1)! + 1}:00`).join(', ')
}

/** a BY… part's numbers, or nothing where it has none */
const list = (x: number | number[] | null | undefined) => (x == null ? undefined : ([] as number[]).concat(x))

const date = (w: Date, year = true) => `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}${year ? ` ${w.getUTCFullYear()}` : ''}`
const time = (h: number, m: number) => `${h}:${pad(m)}`

/** a time rule in plain words, with its zone: "Every 30 minutes, 8:00-22:00, Monday to Friday (Stockholm)" */
export function timeWords(kept: string | undefined, zone: string, now = Date.now()): string {
  if (!kept || kept === 'off') return 'Off'
  const z = ` (${zoneName(zone)})`
  const once = kept.match(ONCE)
  if (once) {
    const [, y, mo, d, h, mi] = once.map(Number)
    const w = new Date(Date.UTC(y, mo - 1, d))
    return `Once, ${DAY_NAMES[(w.getUTCDay() + 6) % 7]} ${date(w)} at ${time(h, mi)}${z}`
  }
  const set = parse(kept)
  const r = set.rrules()[0]
  const o = r.options
  const orig = r.origOptions
  const days = (orig.byweekday ? ([] as (Weekday | number | string)[]).concat(orig.byweekday as Weekday) : []).map((x) => (typeof x === 'number' ? { weekday: x, n: undefined } : typeof x === 'string' ? { weekday: RRule[x as 'MO'].weekday, n: undefined } : { weekday: x.weekday, n: x.n }))
  const plain = days.filter((d) => !d.n).map((d) => d.weekday)
  const nth = days.filter((d) => d.n)
  const hours = list(orig.byhour)
  const minutes = list(orig.byminute)
  const startH = o.dtstart.getUTCHours()
  const startM = o.dtstart.getUTCMinutes()
  // the times of day a daily or longer rule runs at
  const times = () => and((hours ?? [startH]).flatMap((h) => (minutes ?? [startM]).map((m) => time(h, m))))
  const n = o.interval
  const every = (one: string, many: string) => (n === 1 ? `Every ${one}` : n === 2 && one !== 'minute' && one !== 'hour' ? `Every other ${one}` : `Every ${n} ${many}`)
  const setpos = list(orig.bysetpos) ?? []
  const monthdays = list(orig.bymonthday) ?? []
  let words: string | undefined
  const freq: Frequency = o.freq
  const odd = orig.bymonth || orig.byyearday || orig.byweekno || orig.bysecond
  if (!odd && (freq === RRule.MINUTELY || freq === RRule.HOURLY) && !nth.length && !setpos.length && !monthdays.length) {
    const mins = freq === RRule.MINUTELY ? n : n * 60
    const head = freq === RRule.MINUTELY && mins % 60 ? (mins === 1 ? 'Every minute' : `Every ${mins} minutes`) : mins === 60 ? 'Every hour' : `Every ${mins / 60} hours`
    const past = freq === RRule.HOURLY && minutes && !(minutes.length === 1 && minutes[0] === 0) ? ` at ${and(minutes.map((m) => `:${pad(m)}`))}` : ''
    if (freq === RRule.MINUTELY && minutes) words = undefined
    else words = [`${head}${past}`, hours ? hoursWords(hours) : '', daysWords(plain)].filter(Boolean).join(', ')
  } else if (!odd && freq === RRule.DAILY && !nth.length && !setpos.length && !monthdays.length) {
    words = plain.length && n === 1 ? `${daysWords(plain)} at ${times()}` : [`${every('day', 'days')} at ${times()}`, daysWords(plain)].filter(Boolean).join(', ')
  } else if (!odd && freq === RRule.WEEKLY && !nth.length && !setpos.length && !monthdays.length) {
    const on = daysWords(plain.length ? plain : [(o.dtstart.getUTCDay() + 6) % 7]) || 'day'
    words = n === 1 ? `Every ${on} at ${times()}` : n === 2 ? `Every other week, ${on} at ${times()}` : `Every ${n} weeks, ${on} at ${times()}`
    if (n === 1 && plain.length > 1 && /( to | and |, )/.test(on)) words = `${on} at ${times()}`
  } else if (!odd && freq === RRule.MONTHLY) {
    const of = n === 1 ? 'of the month' : n === 2 ? 'of every other month' : `of every ${n} months`
    if (nth.length && !setpos.length && !monthdays.length) words = `The ${and(nth.map((d) => `${ORD(d.n!)} ${DAY_NAMES[d.weekday]}`))} ${of} at ${times()}`
    else if (setpos.length === 1 && plain.length && !monthdays.length) words = `The ${ORD(setpos[0])} ${plain.length === 5 && daysWords(plain) === 'Monday to Friday' ? 'weekday' : plain.length === 1 ? DAY_NAMES[plain[0]] : `of ${daysWords(plain)}`} ${of} at ${times()}`
    else if (monthdays.length && !plain.length && !nth.length && !setpos.length) words = `The ${and(monthdays.map((d) => (d < 0 ? (d === -1 ? 'last day' : `${ORD(-d)} last day`) : ORD(d))))} ${of} at ${times()}`
  }
  if (!words) {
    // rrule's own words, with what they leave out: the minutes, and which of each period's matches
    const text = r.toText()
    const more = [
      minutes && !/:\d\d|minute/.test(text) ? `at minute ${and(minutes.map(String))}` : '',
      setpos.length ? `only the ${and(setpos.map(ORD))} of each ${['year', 'month', 'week', 'day', 'hour', 'minute'][freq] ?? 'period'}'s times` : '',
    ].filter(Boolean)
    words = [text[0].toUpperCase() + text.slice(1), ...more].join(', ')
  }
  const tail: string[] = []
  if (o.dtstart.getTime() > wall(now, zone).getTime()) tail.push(`from ${date(o.dtstart)}`)
  if (o.until) tail.push(`until ${date(o.until)}`)
  if (o.count) tail.push(`${o.count} ${o.count === 1 ? 'time' : 'times'}`)
  const ex = set.exdates()
  if (ex.length) tail.push(`except ${and(ex.slice(0, 3).map((d) => date(d, false)))}${ex.length > 3 ? ` and ${ex.length - 3} more` : ''}`)
  return `${[words, ...tail].join(', ')}${z}`
}

/** when a run is, as people say it in that zone: "Today 14:30", "Tomorrow 8:00", "Thu 30 Oct 8:00" */
export function runWords(at: number, zone: string, now = Date.now()) {
  const w = wall(at, zone)
  const today = wall(now, zone)
  const dayOf = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000)
  const diff = dayOf(w) - dayOf(today)
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `${DAY_NAMES[(w.getUTCDay() + 6) % 7].slice(0, 3)} ${date(w, w.getUTCFullYear() !== today.getUTCFullYear())}`
  return `${day} ${time(w.getUTCHours(), w.getUTCMinutes())}`
}

/** the next three runs in words, or why there are none */
export function nextWords(kept: string | undefined, zone: string, now = Date.now(), n = 3): string[] {
  return nextRuns(kept, zone, now, n).map((at) => runWords(at, zone, now))
}

/* ---------- event rules ---------- */

const ALIASES: Record<string, TriggerEvent | 'news'> = {
  news: 'news',
  all: 'news',
  'all news': 'news',
  any: 'news',
  added: 'added',
  add: 'added',
  ready: 'ready',
  failed: 'failed',
  'went wrong': 'failed',
  wrong: 'failed',
  'needs-you': 'needs-you',
  'needs you': 'needs-you',
  need: 'needs-you',
  needs: 'needs-you',
  merged: 'merged',
  stalled: 'stalled',
  stalls: 'stalled',
  'main-red': 'main-red',
  'main red': 'main-red',
  red: 'main-red',
  health: 'health',
}

/** event rules as they are kept, from what the coordinator wrote: "all news", "none", or rules split by commas, each
 *  an event and its filters: "merged branch=release/*, failed title=deploy space=gtm" */
export function eventRules(text: string): EventRule[] {
  const t = text.trim()
  if (!t || /^(none|off|no news|nothing)$/i.test(t)) return []
  // quoted filter values first, so a comma or "and" in a title stays in it
  const quoted: string[] = []
  const bare = t.replace(/"([^"]*)"|“([^”]*)”/g, (_, a, b) => `\u0000${quoted.push(a ?? b) - 1}\u0000`)
  const back = (x: string) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => quoted[+i])
  return bare.split(/\s*[,;]\s*|\s+or\s+|\s+and\s+/).filter(Boolean).map((part) => {
    const filters: Record<string, string> = {}
    const words: string[] = []
    for (const m of part.matchAll(/(\w+)=(\S+)|(\S+)/g)) {
      if (m[1]) filters[m[1].toLowerCase()] = back(m[2])
      else words.push(back(m[3]))
    }
    const name = words.join(' ').toLowerCase()
    const event = ALIASES[name]
    if (!event) throw new Error(`No event "${name || part}": pick from all news, ${EVENTS.join(', ')}; each may have space=, branch= and title= filters`)
    const odd = Object.keys(filters).find((k) => !['space', 'branch', 'title'].includes(k))
    if (odd) throw new Error(`No filter ${odd}=: only space=, branch= and title=`)
    return { event, ...filters } as EventRule
  })
}

/** event rules on one line, as eventRules reads them back */
export const eventsText = (rules: EventRule[] | undefined) =>
  !rules?.length ? 'none' : rules.map((r) => [r.event === 'news' ? 'all news' : r.event, ...(['space', 'branch', 'title'] as const).filter((k) => r[k]).map((k) => `${k}=${/[\s,;]/.test(r[k]!) ? `"${r[k]}"` : r[k]}`)].join(' ')).join(', ')

const EVENT_WORDS: Record<TriggerEvent | 'news', string> = {
  news: 'any news',
  added: 'a task is added',
  ready: 'a task is ready',
  failed: 'a task went wrong',
  'needs-you': 'a task needs you',
  merged: 'a task is merged',
  stalled: 'a task stalls',
  'main-red': 'main goes red',
  health: 'the machine struggles',
}

/** event rules in plain words: "All news", "When a task is ready or merged in gtm" */
export function eventWords(rules: EventRule[] | undefined): string {
  if (!rules?.length) return 'No news'
  if (rules.length === 1 && rules[0].event === 'news' && !rules[0].space && !rules[0].branch && !rules[0].title) return 'All news'
  const one = (r: EventRule) => `${EVENT_WORDS[r.event]}${r.space ? ` in ${r.space}` : ''}${r.branch ? ` on branch ${r.branch}` : ''}${r.title ? ` titled “${r.title}”` : ''}`
  return `When ${rules.map(one).join(' or ')}`
}

const glob = (pat: string, s: string) => new RegExp(`^${pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(s)

/** does something that happened match one of the rules */
export function matches(rules: EventRule[] | undefined, h: Happened): boolean {
  return !!rules?.some(
    (r) =>
      (r.event === 'news' || r.event === h.event) &&
      (!r.space || r.space.toLowerCase() === h.space?.toLowerCase()) &&
      (!r.branch || (!!h.branch && glob(r.branch, h.branch))) &&
      (!r.title || !!h.title?.toLowerCase().includes(r.title.toLowerCase())),
  )
}

/** a trigger in words: its time rule, then its event rules */
export function triggerWords(t: Trigger, zone: string, now = Date.now()) {
  const time = t.time && t.time !== 'off' ? timeWords(t.time, zone, now) : ''
  const on = t.on?.length ? eventWords(t.on) : ''
  return [time, on && (time ? `and ${on[0].toLowerCase()}${on.slice(1)}` : on)].filter(Boolean).join('; ') || 'Never'
}

/* ---------- from before ---------- */

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** an old schedule (every 30m, daily 9:00, weekdays 9:00, mon,fri 16:00, cron "0 9 * * 1", once 2026-11-02 9:00) as a
 *  time rule; nothing where it can't be read */
export function fromSchedule(schedule: string): string | undefined {
  const s = schedule.trim().toLowerCase()
  let m: RegExpMatchArray | null
  try {
    if ((m = s.match(/^every\s+(\d+)\s*(m|min|minutes?|h|hours?)$/))) return timeRule(`FREQ=${m[2].startsWith('h') ? 'HOURLY' : 'MINUTELY'};INTERVAL=${m[1]}`)
    if (s.match(ONCE)) return timeRule(s)
    if ((m = s.match(/^(daily|weekdays|weekends|[a-z,]+)\s+(\d{1,2}):(\d{2})$/))) {
      const [, d, hh, mm] = m
      const days = d === 'daily' ? '' : d === 'weekdays' ? 'MO,TU,WE,TH,FR' : d === 'weekends' ? 'SA,SU' : d.split(',').map((x) => DAY_CODES[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(x.slice(0, 3))]).join(',')
      if (days.includes('undefined')) return undefined
      return timeRule(`FREQ=${days ? 'WEEKLY' : 'DAILY'};${days ? `BYDAY=${days};` : ''}BYHOUR=${+hh};BYMINUTE=${+mm}`)
    }
    if ((m = s.match(/^cron\s+"?([^"]+)"?$/))) return fromCron(m[1])
  } catch {
    return undefined
  }
  return undefined
}

/** a cron line's five fields as an RRULE: each field's values as a BY… part */
function fromCron(expr: string) {
  const [mi, h, dom, mon, dow] = expr.trim().split(/\s+/)
  if (dow === undefined) return undefined
  const values = (f: string, lo: number, hi: number) => {
    if (f === '*') return undefined
    const out = new Set<number>()
    for (const part of f.split(',')) {
      const [range, step] = part.split('/')
      const [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number)
      for (let v = a; v <= (b ?? (step ? hi : a)); v += Number(step ?? 1)) out.add(v)
    }
    return [...out].sort((x, y) => x - y)
  }
  const [mins, hours, days, months, wdays] = [values(mi, 0, 59), values(h, 0, 23), values(dom, 1, 31), values(mon, 1, 12), values(dow, 0, 7)]
  const freq = !mins ? 'MINUTELY' : !hours ? 'HOURLY' : 'DAILY'
  const parts = [`FREQ=${freq}`, mins && `BYMINUTE=${mins}`, hours && `BYHOUR=${hours}`, days && `BYMONTHDAY=${days}`, months && `BYMONTH=${months}`, wdays && `BYDAY=${[...new Set(wdays.map((d) => DAY_CODES[d % 7]))].join(',')}`]
  return timeRule(parts.filter(Boolean).join(';'))
}
