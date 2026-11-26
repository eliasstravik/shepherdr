# Artifacts

An artifact is a web page you write to show the person something: a report, a comparison, a
board, a plan, a form, a task's proof. It is a folder with an `index.html` and the files beside
it (css, js, pictures, clips, data). The person opens it in Shepherdr, on a phone as often as on
a desktop, and your chat shows its tile: a small picture of the page, taken when you publish.

Make one when a page says it better than a chat message. A sentence or one picture goes in the
chat.

## Make one

```sh
herdr-artifact new ./report                                   # a starting index.html with the starter style
herdr-artifact publish ./report --title "Coverage by package" # prints its id
herdr-artifact preview <id>                                   # its link on this machine: look at it
herdr-artifact update <id> ./report --note "what changed"     # a new version; the last 20 are kept
```

- Name files from the folder (`<img src="after.png">`, `<script src="app.js">`): no paths from
  the root (`/after.png`), none that leave the folder (`../`), none from your disk. Publish tells
  you which won't load.
- At most 50 MB and 500 files. No links (copy the file in). Files that start with a dot are
  left out.
- The page runs on its own: its scripts work, but it can't reach Shepherdr, your files or its
  own earlier state. Put the data in the page; what the person types is not remembered.
- Check it before you say it's done: open `herdr-artifact preview <id>`'s link in your task's
  browser at a phone's width (`herdr-browser set viewport 390 844`) and a desktop's (`1280 800`),
  and fix what is cut off, tiny or unreadable.
- The page's title is shown above it: start with the content. No emojis.

## The starter style

Start from this, so the page looks at home in light and dark, on a phone and on a desktop.
Black and white; colour only says a status (`good`, `warn`, `bad`) or a link (`--link`, the app's link blue). Wrap a wide table in
`<div class="scroll">`.

```css
:root { color-scheme: light dark; --fg: #111; --bg: #fff; --muted: #666; --line: #ddd; --good: #1a7f37; --warn: #9a6700; --bad: #cf222e; --link: #1d4ed8; }
@media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #111; --muted: #999; --line: #333; --good: #3fb950; --warn: #d29922; --bad: #f85149; --link: #8ab4f8; } }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 16px; max-width: 720px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); overflow-wrap: anywhere; }
h1 { font-size: 22px; line-height: 1.25; margin: 0 0 12px; }
h2 { font-size: 18px; margin: 28px 0 8px; }
h3 { font-size: 16px; margin: 20px 0 6px; }
p, ul, ol, figure, pre, table { margin: 0 0 14px; }
img, video { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; }
figcaption, .muted { color: var(--muted); font-size: 14px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th, td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
pre { overflow-x: auto; padding: 12px; border: 1px solid var(--line); border-radius: 6px; }
pre, code { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
a { color: var(--link); text-underline-offset: 3px; }
button { font: inherit; padding: 8px 14px; border: 1px solid var(--fg); border-radius: 6px; background: var(--fg); color: var(--bg); }
.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
```

Put `<meta name="viewport" content="width=device-width, initial-scale=1">` in the head
(`herdr-artifact new` does). Pictures: take only what matters (`herdr-browser screenshot
'<css selector>' /abs/shot.png`), or cut one with `herdr-artifact crop in.png out.png --rect
x,y,w,h`. A short clip (`<video controls src="flow.mp4">`) beats a GIF.

## Answers and notes

The page can send the person's answer back to you: a button, a choice, a form.

```html
<button onclick="parent.postMessage({ shepherdr: 'answer', text: 'Ship it' }, '*')">Ship it</button>
```

`text` is what reaches you, so make it say the whole answer ("Ship it?: Wait, the price is
wrong"). It arrives as:

```
<hc from="artifact" id="…" version="2" title="…" answer>
Ship it
</hc>
```

The person can also tap the page to drop a pin and write what should change. That arrives as
`<hc from="artifact" id=… version=… title=… spot="0.42,0.31">the note</hc>`: the pin as
fractions of the page's width and height, with the same in words. Change the page and `update`
it. When you have ended, answers and notes go to the space's chat instead.

## A task's proof

A proof is a page like any other, published as its task's proof:

```sh
herdr-artifact publish ./proof --task SHOP-4 --proof --title "<the task's full title> · Proof"
```

It stays on its task (its card and thread), not in Artifacts, until the person keeps it. On the
page, in this order:

1. A heading "For you" first, before any detail: a few short lines, not a second report.
   - Check or decide: what the person should look at or choose, or "Nothing".
   - Not proven: what you could not show, in a few words, or "Nothing".
   - Decided on my own: choices you made that the brief did not settle, or "None".
2. What changed, in one to three plain lines.
3. Each proof (a picture, a before and after, a short clip, a command's output), each with a
   one-line caption saying what it shows.
4. A heading "Not proven" and a list of what you could not show and why, or "Nothing".

For example:

```html
<h2>For you</h2>
<ul>
  <li><b>Check or decide:</b> the new button colour on a phone.</li>
  <li><b>Not proven:</b> the Mac app, which this machine can't run.</li>
  <li><b>Decided on my own:</b> kept the old link working so saved bookmarks still open.</li>
</ul>
```

## Other commands

`herdr-artifact list` (this folder's; `--all` every folder's), `show <id>` (its versions and
where its files are), `rename <id> "New title"`, `pin <id>` / `unpin <id>`, `restore <id>
--version 3` (a copy of v3 becomes the newest), `keep <id>` (a proof kept in Artifacts),
`rm <id>`, `open <id>` (shows it on the person's screen) and `link <id>`. Another machine's
folder: `herdr-artifact --on <machine> <command> …`.
