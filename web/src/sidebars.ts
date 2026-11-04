// The wide screen's sidebars: places on the left, tasks on the right, and an open task's side panel right of its chat.
// Dragging an inner edge resizes one; places and the panel also hide (their toggles, a key, or dragged narrow
// enough). Focus gives an open task the whole window, the coordinator chat (and places) hidden, and the panel can widen
// to most of it. Widths, whether each shows, focus and the panel's item are this device's own.

export interface Sidebars {
  /** places' width while it shows */
  left: number
  right: number
  /** places shows (desktop; a tablet or phone has it in a drawer) */
  open: boolean
  /** an open task's side panel: its width while it shows, whether it shows (desktop), and the item it shows */
  panel: number
  panelOpen: boolean
  item: string
  /** focus: an open task takes the whole window, its coordinator chat and places hidden (desktop and tablet) */
  focus: boolean
  /** focus came on by itself, as the panel opened on a narrow window: it goes again as the panel closes */
  focusAuto: boolean
  /** the panel takes most of the window, the task's chat at its least beside it (and focus on while it does) */
  wide: boolean
}

export interface Span {
  min: number
  max: number
  base: number
}

export const LEFT: Span = { min: 200, max: 400, base: 260 }
// tasks and the panel have no fixed most: they widen as far as the window leaves the chat its room
export const RIGHT: Span = { min: 320, max: Infinity, base: 400 }
export const PANEL: Span = { min: 360, max: Infinity, base: 560 }
/** places dragged narrower than this snaps closed */
export const SNAP = 150
/** the chat in the middle keeps at least this much */
export const CHAT_MIN = 360
/** ordinary conversations keep this much room beside lists; compact task + tool views use CHAT_MIN */
export const CHAT_READ = 480

/** Dock places only when the requested columns leave a readable conversation. Stored widths survive a drawer. */
export function canDock(sb: Sidebars, width: number, panel = false) {
  return width >= clamp(sb.left, LEFT) + CHAT_READ + rightOf(sb, width) + (panel && sb.panelOpen ? clamp(sb.panel, PANEL) : 0)
}
/** opening the panel on a window narrower than this turns focus on, until it closes again */
export const FOCUS_BELOW = 1600

const KEY = 'shepherdr.sidebars'
export const BASE: Sidebars = { left: LEFT.base, right: RIGHT.base, open: true, panel: PANEL.base, panelOpen: false, item: 'diff', focus: false, focusAuto: false, wide: false }

/** a width within its span and the room the window leaves; the span's min wins over a window too narrow */
export function clamp(w: number, s: Span, room = Infinity) {
  return Math.round(Math.max(s.min, Math.min(s.max, room, w)))
}

/** focus is on for an open task: turned on, or the panel widened */
export const focused = (sb: Sidebars, panel: boolean) => sb.focus || (panel && sb.panelOpen && sb.wide)

/**
 * The widths drawn on a window this wide: places (0 while hidden), an open task's side panel (0 without one), then
 * tasks, the chat keeping its room. With the panel open on a window too narrow for all four, places is drawn shut.
 * With a task open in focus (`task`), places and the chat take nothing: the task's chat has the rest beside its panel.
 */
export function fit(sb: Sidebars, width: number, places: boolean, panel = false, task = false) {
  const p = panel && sb.panelOpen
  if (task && (focused(sb, panel) || (p && width < CHAT_READ + RIGHT.min + PANEL.min))) {
    const pw = !p ? 0 : sb.wide ? Math.max(PANEL.min, width - CHAT_MIN) : clamp(sb.panel, PANEL, width - RIGHT.min)
    return { left: 0, right: Math.max(RIGHT.min, width - pw), panel: pw }
  }
  const left = places && sb.open && canDock(sb, width, panel) ? clamp(sb.left, LEFT) : 0
  const pw = p ? clamp(sb.panel, PANEL, width - left - RIGHT.min - CHAT_READ) : 0
  const right = clamp(rightOf(sb, width), RIGHT, width - left - pw - CHAT_READ)
  return { left, right, panel: pw }
}

/** the tasks' width: left at its default, it grows a little on a very wide window (to 480 at 2560), so the lists on
 *  the right keep in proportion beside the middle */
function rightOf(sb: Sidebars, width: number) {
  return sb.right === RIGHT.base ? clamp(width * 0.1875, { ...RIGHT, min: RIGHT.base, max: 480 }) : sb.right
}

/** Places dragged to a width: below SNAP it closes and keeps the width it had to open again at. */
export function dragLeft(sb: Sidebars, w: number, width: number, panel = false): Sidebars {
  if (w < SNAP) return { ...sb, open: false }
  const f = fit(sb, width, true, panel)
  return { ...sb, open: true, left: clamp(w, LEFT, width - f.right - f.panel - CHAT_READ) }
}

export function dragRight(sb: Sidebars, w: number, width: number, places: boolean, panel = false): Sidebars {
  const f = fit(sb, width, places, panel)
  return { ...sb, right: clamp(w, RIGHT, width - f.left - f.panel - CHAT_READ) }
}

/** The side panel dragged to a width: narrower than PANEL_SNAP it closes, keeping the width it had to open again at.
 *  Dragged wide, tasks give way down to their minimum. */
export const PANEL_SNAP = 200

export function dragPanel(sb: Sidebars, w: number, width: number, places: boolean, task = false): Sidebars {
  if (w < PANEL_SNAP) return showPanel(sb, false, width)
  // dragged, a widened panel keeps the width it is let go at, still in focus
  const at = { ...sb, panelOpen: true, wide: false, focus: sb.focus || (task && focused(sb, true)) }
  if (task && at.focus) return { ...at, panel: clamp(w, PANEL, width - RIGHT.min) }
  const f = fit(at, width, places, true)
  return { ...at, panel: clamp(w, PANEL, width - f.left - RIGHT.min - CHAT_READ) }
}

/** The panel shown or hidden. Shown on a window narrower than FOCUS_BELOW, focus comes on with it; hidden, focus that
 *  came that way goes, and a widened panel opens at its own width next time. */
export function showPanel(sb: Sidebars, open: boolean, width: number): Sidebars {
  if (open) return sb.panelOpen ? sb : !sb.focus && width < FOCUS_BELOW ? { ...sb, panelOpen: true, focus: true, focusAuto: true } : { ...sb, panelOpen: true }
  return { ...sb, panelOpen: false, wide: false, ...(sb.focusAuto ? { focus: false, focusAuto: false } : {}) }
}

/** Focus on or off; off, a widened panel narrows again too, so the coordinator chat shows */
export function toggleFocus(sb: Sidebars, panel: boolean): Sidebars {
  return focused(sb, panel) ? { ...sb, focus: false, focusAuto: false, wide: false } : { ...sb, focus: true, focusAuto: false }
}

export function loadSidebars(): Sidebars {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sidebars> | null
    if (!v) return BASE
    return {
      left: typeof v.left === 'number' ? clamp(v.left, LEFT) : LEFT.base,
      right: typeof v.right === 'number' ? clamp(v.right, RIGHT) : RIGHT.base,
      open: v.open !== false,
      panel: typeof v.panel === 'number' ? clamp(v.panel, PANEL) : PANEL.base,
      panelOpen: v.panelOpen === true,
      item: typeof v.item === 'string' && v.item ? v.item : BASE.item,
      focus: v.focus === true,
      focusAuto: v.focusAuto === true,
      wide: v.wide === true,
    }
  } catch {
    return BASE
  }
}

export function saveSidebars(sb: Sidebars) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sb))
  } catch {
    /* private window: they reset next time */
  }
}
