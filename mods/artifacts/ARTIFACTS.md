# Artifacts: show the person something

An artifact is a tiny Herdr panel you write: a report, a chart, a board, a checklist, a form
that asks the person to choose. It is a Herdr mod (a folder with `main.js`, maybe more `.js`
and `.svg` files). The person finds it in the Artifacts tab of the right sidebar and in your
chat, and opens it beside their work.

```sh
herdr-artifact new ./my-report          # writes a starting main.js
herdr-artifact publish ./my-report --title "Coverage by package"     # prints its id
herdr-artifact update <id> ./my-report --note "adds the API package" # a new version, same artifact
herdr-artifact list                     # this folder's artifacts
herdr-artifact rm <id>
```

- Publish checks the mod with `herdr-app check` first, in light and in dark; a broken one is
  refused with the error. It also reads the built UI at 320 px wide and in both looks, and lists
  what to fix (too wide, text hard to read): fix those and `update`. (It reads the element tree;
  it doesn't take a picture.)
- Change an artifact with `update` (a new version, the same card and panel), not a second
  `publish`. The last 20 versions are kept; the person can step back through them. An open copy
  reloads by itself.
- The person can mark it up: point at a spot or drag over an area and write what should change.
  It reaches you (or, once you've ended, your task's agent) as
  `<hc from="artifact" id=… version=… title=… on="the 180×80 px area at x 120–300, …">note</hc>`,
  with a path to a picture of the panel, the spot outlined. Change it and `update`.
- It belongs to the folder you run in (the repo root), like tasks; `--folder` picks another.
  A task's agent gets its task in front of the title ("HAT-2: Coverage by package").
- Don't open it on the person's screen yourself; tell them it's there.

## Writing one

Read `~/.config/herdr-app/AGENTS.md` (Mods, UI, the `herdr` module) and the type files
`gpui-kit.d.ts` and `herdr.d.ts` there: they are the truth. The short version:

```js
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, readTextFile } from "herdr";
import { reply, asset } from "./artifact.js";

export default class Report extends View {
  init(_props, cx) {
    this.rows = [];
    cx.spawn(async (cx) => {
      const text = await readTextFile("/abs/path/to/data.json");   // or exec("git", [...])
      this.rows = JSON.parse(text ?? "[]");
      cx.notify();
    });
  }
  render() {
    const t = theme();
    return v_flex().size_full().p(16).gap(8).bg(t.background).text_color(t.foreground).text_size(13)
      .children(this.rows.map((r, i) => h_flex().id(`r${i}`).justify_between()
        .child(div().child(r.name)).child(div().text_color(t.muted).child(String(r.value)))))
      .child(div().id("ok").px(12).py(6).rounded(6).bg(t.solid).text_color(t.solid_foreground)
        .on_click((_e, cx) => cx.spawn(async () => { await reply("Approved the plan."); })).child("Approve"));
  }
}
```

Rules:
- `./artifact.js` is written for you on publish (don't ship your own): `title`, `version`,
  `id`, `asset("chart.svg")` (the path for `svg()` / `image()`), and `reply(text)`, which
  sends text to you, the agent that made it, wrapped as
  `<hc from="artifact" id=… version=… title=…>text</hc>`. Use it for forms and buttons, only
  from a click. It resolves false when you're gone.
- Don't repeat the title inside it: the viewer and the sidebar already show it right above your
  panel. Start with the content (a one-line summary, the numbers, the chart).
- Colors from `theme()` only (`background`, `surface`, `foreground`, `muted`, `dim`, `accent`,
  `border`, `solid`/`solid_foreground` for a primary button, `working`/`blocked`/`done`), so it
  follows light and dark. Text sizes in px (12-15). No emojis.
- Fill the panel (`size_full()`), scroll long content (`.id(..).overflow_y_scrollbar()`), and
  work from about 320 px wide.
- Data: bake it into the files, or read it live with `readTextFile(path)` / `exec(cmd, args,
  { cwd })` inside `cx.spawn`. Absolute paths. `fetch` works but prefer local data.
- No `setTimeout`/`setInterval` (`cx.timer.every` for data, rarely); animate natively
  (`.frames`, `.spin`, `.loop`, `.transition`), never with a timer.
- Never keep a `cx`; every callback gets its own. No top-level `await`.
- Only `.js .json .svg .png .jpg .gif .webp .md .txt .csv .ttf .otf`, at most 4 MB.
