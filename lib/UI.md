# UI building blocks (lib/ui.js)

One source for sizes, status colors and the controls every mod repeats. `lib/ui.js` is copied
into each of our mods by `bin/sync-shared` (listed in `lib/COPIES`), so a mod imports it as
`import { button, TEXT } from "./ui.js";`. Edit `lib/ui.js`, never a copy, then run
`bin/sync-shared`; `bin/sync-shared --check` must pass. A new mod of ours: add it to the
`ui.js:` line in `lib/COPIES` and sync. Shipped Herdr mods (confirm, prompt, toast, menu,
picker, peek, help, ...) are read-only: clone them first.

## Sizes

| What | Value |
|---|---|
| `H.sm` / `H.lg` | buttons 24 in panels, rows and headers; 32 in dialogs and cards |
| `H.xs` | 20: a button inside a row's 16 tall second line (a Ready row's Review), so the row keeps its height |
| `TEXT.id` 11 | IDs, times, badges |
| `TEXT.label` 12 | second lines, labels, small headings, button words (24) |
| `TEXT.body` 13 | body, row titles, menu rows, button words (32) |
| `TEXT.title` 15 | page and dialog titles |
| `RADIUS.control` 6 | buttons, fields, segmented, menu rows |
| `RADIUS.card` 8 | cards, popovers, every hover background |
| `RADIUS.bubble` 12 | chat bubbles |

No other sizes. Use the names, not the numbers, so a change here reaches everyone.

## Colors

`red()` needs you and alerts, `green()` ready, `amber()` working: Shepherdr's own, light and
dark, the same as the task dots (`dot.js` uses them). `onStatus()` is text on one of them
(white in light, black in dark). Everything else comes from `theme()`; never write hex in a mod.

## Parts

- `button(id, label, { kind, size, icon, disabled, onClick })`: `primary` (solid, one per panel
  or dialog), `secondary` (bordered), `plain` (words only). `size` `"xs"` 20 (a row's second
  line only) / `"sm"` 24 / `"lg"` 32. Always
  as wide as its words; never truncated. Disabled: half opacity, no pointer, no hover.
- `link(id, label, onClick)`: a quiet text link (card headers, "Show all").
- `toggleSwitch(id, on, onToggle(next), { disabled })`: the on/off switch, accent when on.
- `segmented(id, [[value, label]...], value, onPick, { size, disabled, fill })`: segments sized to
  their words, never cut; `fill` stretches them over the row.
- `menuRow(id, label, { icon, hint, check, danger, disabled, onClick })`: a popup menu's 32 row:
  16 icon slot, label, dim hint, a check at the right when `check` is true (`false` keeps the slot
  so a choice list lines up).
- `heading(text, right?)`: small dim heading, 12 medium, sentence case. Never uppercase.
- `cardHeader(title, [actions])`: title left (13 medium), links or small buttons right.
- `dialogFooter({ onCancel, primary: { id, label, onClick, disabled }, note, error })`: 32 tall,
  optional dim note left (red when `error`), plain Cancel, then the solid primary. No "Esc" hint.
- `clickable(el, onClick, { radius })`: pointer + rounded 8 hover + click for a whole row (`el`
  needs an id).
- `countBadge(need, ready, line)`: the red / green / split count badge (Tasks, tabs, spaces).
- `openSettings({ space?, section? })`: Shepherdr's settings window (mods/shepherdr-settings, the foot's Shepherdr); with
  `space`, that space's own settings. Never open it with your own size.

## Rules

- Pointer and hover only where a click does something; nothing else gets either.
- Hover is a background (`theme().hover`), rounded 8 on rows, 6 on controls. Nothing moves or
  resizes on hover.
- One solid primary per panel or dialog. A dangerous action is secondary, except as the primary
  of its own confirm dialog, where its label is the verb ("Delete section"), never "Confirm".
- Labels are capitalized and sentence case; short labels have no period, full sentences do.
- No emojis in chrome. Icons are line SVGs.
- Size controls to their words: never truncate a short label.
- No tooltips: nothing pops up on hover (SHEP-25; `test/test_repo.py` checks). What people need shows as words; an
  icon-only control on the web keeps an `aria-label`.

Already on these parts: the count badges (`tabs-tasks`, `spaces-chat`), the task dots
(`dot.js`), the New space dialog's footer (`newspace`). Everything else moves area by area.
