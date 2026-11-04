# Shepherdr web (proof of concept, SHEP-6)

The same mods as the Herdr window, running in a browser over Tailscale: phone, tablet and desktop. No second app:
a small runtime draws the mods' `gpui-kit` elements as DOM and answers the `herdr` module from a small server.

```bash
bun web/server.ts                                   # 127.0.0.1:7591, mods read from ~/.config/herdr-app
tailscale serve --bg --set-path /shepherdr-web 7591 # private to the tailnet, never funnel
bun test web/                                       # what the web may run by itself
```

## How it fits together

```text
web/server.ts        serves the mods read-only (each copy its own module graph: /c/<copy>/mods/<mod>/main.js,
                     bare imports "herdr", "gpui-kit", "gpui-base", "fs/promises" rewritten to the runtime),
                     pushes live state over one WebSocket, runs the mods' calls
web/core.ts          two `hc connect` links: calls (terminal.list, doc.get "herdr-app" per machine, machine.exec,
                     file.read) and events.subscribe (a subscribed link only streams events)
web/safety.ts        what the browser may run: reads always; writes only the person's own few actions after a tap
web/client/rt/       the runtime: el.js (the GPUI style surface, ~150 methods, unknown ones are no-ops),
                     dom.js (keyed diff, GPUI-style event delivery, long-press = right click),
                     views.js (View, cx, entities, tasks, timers), gpui-base.js (inputs, textarea, virtual list,
                     Markdown), model.js (spaces/tabs/panes/agents/terminals from herdr-core), herdr.js (per copy)
web/client/shell/    the page: the window's layout on desktop (>= 1100 px), sidebar + work on tablet, one panel at a
                     time with a bottom bar and Back on phone (< 700 px)
```

Live: herdr-core events and a 3 s / 4 s poll for terminals and layout documents; shared.json, view.json,
settings.json and the layout file are watched. The page keeps its own view (space, tab, open task, panels) and
its own `setShared` keys, so a phone never moves the window and the window never moves the phone.

## Safety

The window already runs every mod's background work (news delivery, request queues, the tasks scheduler and tick,
cleanups, secrets). The browser runs the same `init()`s, so the server refuses anything that changes something
unless it is a read, or one of the person's actions made within 4 s of a tap: `hc send`, `hc keys`, `hc label
herdr.chat.read=`, `herdr-task accept`. Refused commands answer like a failed command (exit 126), quietly. File
writes, `run()` commands for the window and notifications/sounds never run from the web. Every refusal is logged.

Access: only the hostnames the server goes by (no DNS rebinding), the socket only from the page's own origin, and
through `tailscale serve` only the tailnet owner's login (Tailscale's identity header). Local file reads stay in
the home folder. Markdown from agents is sanitized (DOMPurify).

## What works (PoC scope)

- Spaces sidebar: every machine and section, unread, badges, meters, live; tap a space to open its Assistant.
- Assistant chat: history live from the agent's own log, news lines, hover actions, Markdown, send a message
  (proven end to end into a live agent).
- Tasks panel: the list grouped by status across machines, filters, open a task's chat (drill in, Back).
- Tab bar, pane header, status bar and the sidebar footer draw as in the window.

## Not yet

- Accept: the button and the Accept card are the real mods and `herdr-task accept` passes the safety list, but
  it wasn't pressed for real (no Ready task to try it on).
- Terminals are read-only text (`hc read`); 2.1's streaming terminal (xterm over `terminal.attach`) would follow.
- Menus/dialogs that write (New space, rename, settings, pins, drafts, reactions, answering cards that write files)
  are refused: each needs adding to the action list, or a server endpoint that does what the window does.
- Hover on touch is CSS hover after a tap; drag and drop, file drops, paste of images, dictation, calls.
- Paths, gradients (Win98 layout), the Popup component, `on_drop`, key bindings (`bind_keys`).

## The hard parts

1. **Background work vs. the person's actions.** Mods mix both in one `init()`. The PoC tells them apart by
   command (a read or not) plus "right after a tap". Full parity wants mods to say it: e.g. a `herdr.isPrimary()`
   (or `window().web`) that background loops check, so only the window runs them.
2. **Writes that only the window makes.** `setShared` (shared.json) and `run()` commands belong to the window.
   Parity wants a small write API in Herdr (or herdr-core docs) the page can call, instead of the page writing.
3. **Rendering differences.** GPUI is not CSS: the chat measures its own rows, the virtual list sizes rows, text
   metrics differ slightly. It held up well (one fix: list rows never shrink), but every new mod trick can need a
   runtime fix.
4. **Derived data.** `spaces()` names, statuses, branches, `agents()` "done → idle once seen" are computed inside
   Herdr; the page recomputes them from herdr-core and can drift. Herdr exposing its own model (one JSON stream)
   would make this exact.
5. **Mobile fit.** The mods are sized for a 13 px desktop UI; touch targets are small. A phone wants mods to read a
   `compact`/`touch` flag (or the layout to pass one).

## Honest call

Option 1 holds up. Spaces, the Assistant chat and Tasks run unchanged on about 2,000 lines of server, runtime and page, and they look
like the window because they are the window's code. Parity stays cheap as long as mods keep to the gpui-kit surface
they use today (about 150 style methods, `cx.notify/spawn/timer`, a dozen herdr calls). The two things to fix
before it can be the real 3.1 are both small changes on the Herdr side: a "this copy is a viewer" flag for
background work, and a write API for shared state and commands.
