// The shared browser: one agent-browser session per task that its agent drives with the agent-browser command and
// you watch (and take over) in the task's Browser panel. These are the messages between the panel and the server,
// which relays the session's own stream (frames, the URL) and keeps who is driving.

/** an element you tapped in Mark up, as the page described it (what helps an agent find it in the code) */
export interface BrowserPick {
  /** what it is, as people say it: button "Save", link "Docs", input[name=email] */
  element: string
  /** a CSS selector that finds it (one only, when the page allows) */
  selector: string
  text?: string
  /** text around it, when it has none of its own */
  nearby?: string
  classes?: string
  /** identifying attributes: data-testid="x" href="/a" */
  attrs?: string
  /** role and aria labels */
  a11y?: string
  /** key computed styles */
  styles?: string
  /** React components around it, outermost first, when the page is a React app */
  react?: string
  /** its box in the viewport when tapped, CSS px */
  box: { x: number; y: number; w: number; h: number }
  /** where you tapped, in page (document) px: where its pin goes as the page scrolls */
  at: { x: number; y: number }
  /** fixed or sticky: its pin stays put as the page scrolls */
  fixed?: boolean
  /** inside a frame: the box is the frame's own */
  frame?: boolean
  url: string
  /** the cropped screenshot, on the task's machine */
  shot?: string
  /** a small copy of it, for the screen only */
  thumb?: string
}

export interface BrowserNote {
  comment: string
  pick: BrowserPick
}

export type Driver = 'agent' | 'you'

/** server → panel; the session's own frames ({type:'frame', data, metadata}) pass through as they are */
export type BrowserDown =
  | { type: 'frame'; seq?: number; data: string; metadata: FrameMeta }
  | {
      type: 'state'
      driver: Driver
      url: string
      title: string
      /** the browser is up (the session runs and has a page) */
      connected: boolean
      viewport: { w: number; h: number }
      /** ms since the agent last ran an agent-browser command, if it has */
      agentAgo?: number
      /** on another machine: its stream, shared on the tailnet straight from there (wss://…); the panel takes frames
       *  and its input that way when it can reach it, else through the server as before */
      direct?: string
    }
  | { type: 'picked'; id: number; pick?: BrowserPick; error?: string }
  | { type: 'hover'; box: BrowserPick['box'] | null }
  /** gone: the browser closed with its task (stopped or merged); the panel doesn't come back for it */
  | { type: 'error'; message: string; gone?: boolean }

export interface FrameMeta {
  deviceWidth: number
  deviceHeight: number
  pageScaleFactor?: number
  offsetTop?: number
  scrollOffsetX?: number
  scrollOffsetY?: number
  timestamp?: number
}

/** panel → server; input goes in only while you drive */
export type BrowserUp =
  | { type: 'input_mouse'; eventType: string; x: number; y: number; button?: string; clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number }
  | { type: 'input_keyboard'; eventType: string; key?: string; code?: string; text?: string; windowsVirtualKeyCode?: number; modifiers?: number }
  | { type: 'input_touch'; eventType: string; touchPoints: { x: number; y: number; id?: number }[]; modifiers?: number }
  | { type: 'text'; text: string }
  | { type: 'go'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'take' }
  | { type: 'handback' }
  | { type: 'pick'; id: number; x: number; y: number }
  | { type: 'hover'; x: number; y: number }
  /** fit the page to the panel, or back to agent-browser's own size */
  | { type: 'viewport'; w: number; h: number }
  | { type: 'start' }
  /** the panel takes frames straight from the task's machine (on), or through the server again (off) */
  | { type: 'direct'; on: boolean }

/** what you type in the URL bar, as an address: a bare host gets https (http for this machine) */
export function toUrl(s: string): string {
  const t = s.trim()
  if (!t) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^(localhost|[\d.]+|\[[\d:a-f]+\]):\d+/i.test(t)) return t
  if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(t)) return `http://${t}`
  if (!/\s/.test(t) && /\.[a-z]{2,}(?:[:/?#]|$)/i.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
}

/** a page address without its scheme and a lone trailing slash, as the URL bar shows it */
export const shortUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/^([^/?#]+)\/$/, '$1')
