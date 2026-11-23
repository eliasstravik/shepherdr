# The glance feed (phone and watch app)

A small live feed for a phone app that keeps a link to Shepherdr all day (Shepherdr Wake on a Pixel and its watch:
widgets, the lock screen card, the watch tile, notifications with buttons). The page socket (`/api/ws`) sends the whole
snapshot (~720 KB) on every change, about 12.7 MB a minute: far too much for a phone. The glance doc is ~15 KB and goes
out only when what the person sees changes, and calmly. Added in SHEP-246; the code is `service/glance.ts`.

All three endpoints go through the app's gate like the page's own writes: from the tailnet, the machine owner's
login, on the machine's tailnet name, with `Origin: https://<name>[:port]` and `x-shepherdr: 1`. Only the machine that
serves the app answers (another one redirects there).

## `GET /api/glance`

The doc as JSON (503 until the service built its first snapshot).

## `GET /api/glance?stream=1[&native=1]`

`text/event-stream`. On connect `retry: 5000`, then the doc now as

```text
event: glance
data: <the doc, one line of JSON>
```

and again each time it changes, calmly:

- a change of `urgent` (an alert came or went or changed its words, a count moved) goes at once;
- any other (a status line, progress, time left) at most once a minute, the latest then;
- a doc whose `v` didn't change is never sent.

A comment line `: ping` comes every 240 s. The stream has no idle cut on the service's side.

`native=1`: this device shows Shepherdr's alerts itself. While such a stream from a device is open, and for 2 minutes
after it closes (a reconnect), Shepherdr sends no web push to that device's browser subscriptions, so one alert never
buzzes twice. If the native link stays down longer, web push takes over again. The device is the tailnet node the
request comes from (the same id the wake word uses).

The app on screen (SHEP-338): while a Shepherdr page is visible on a device (focused or not, or dropped less than 15 s
ago), that device shows no system notification for a new alert. Its web push skips all its subscriptions, and its
native stream (and `GET /api/glance?native=1`) carries each alert that came then with `"alert": false` (and an
`urgent` to match) for as long as it lasts, so the phone app lists it but never notifies, then or after it leaves the
app. Alerts that came before, and new ones after it leaves, notify as before; other devices are unaffected.

## `POST /api/open {"url": "…"}`

Opens an item in the Shepherdr page already open on the asking device, in place, as a tap on that alert would, without
the browser rebuilding the page. `url` is an item's `url`: `./?place=…[&task=…][&focus=…]` or `./#accept=<task>`;
anything else is 400. The device's page on screen used last goes there; with none on screen yet, the first page of that
device that shows up within 15 s does. Answer: `{"ok": true, "shown": true|false}` (false: held for that page). The
phone then brings the browser forward with no new activity.

## Acting on an item

Unchanged from the web push buttons (SHEP-243): `POST /api/action` with

- `{"type": "accept", "task": "<accept.task>"}`
- `{"type": "answer", "chat": "<answer.chat>", "question": "<answer.question>", "choice": <i>, "fromAlert": true}`; free
  words on a card with `answer.other`: `"other": "<words>"`
- `{"type": "send", "chat": "<reply.chat>", "text": "<words>", "cid": "<a fresh id>", "human": true}` (and
  `"reply": "<reply.to>"` when given)

## The doc

```jsonc
{
  "format": 1,                     // bumps only if an app can't read it as before (new fields don't)
  "v": "70o5igq2ogp5",             // changes when anything below changes
  "urgent": "1xpxeyin8gdj7",       // changes only with what notifies (alerts, their words, the counts)
  "at": 1794937795469,             // when it was built (ms)
  "counts": { "needs": 3, "working": 4, "ready": 0, "done": 24 },   // what each section lists, even past the 40 items
  "order": ["needs", "ready", "working", "done"],   // the sections, in the feed's own order: show them so
  "groups": [                      // the same sections in that order, with their names and the counts
    { "kind": "needs", "label": "Needs you", "count": 3 },
    { "kind": "ready", "label": "Ready", "count": 0 },
    { "kind": "working", "label": "Working", "count": 4 },
    { "kind": "done", "label": "Done", "count": 24 }
  ],
  "items": [                       // in the groups' order (needs, ready, working, done today); 40 at most
    {
      "key": "need:ELIA-53/worker:q1",   // one thing, stable while it lasts: a new key is a new alert
      "kind": "needs",                   // needs | working | ready | done
      "type": "need",                    // need | alert (herdr-task alert) | task
      "tag": "ELIA-53",                  // one notification per tag: a newer one takes its place
      "task": "ELIA-53",
      "title": "ELIA-53 · Needs you",    // <= 30 characters (a watch line)
      "body": "Rerun CI on main?",       // <= 80 (two watch lines)
      "name": "Watch voice: fix lag", "space": "Home", "machine": "Mac mini",
      "line": "Designing the per-hop timing logs", "progress": 8, "left": "5h",
      "at": 1794937163410,               // its own time; absent when it has none
      "alert": true,                     // notify about it (needs, ready); a working or done row only lists
      "url": "./?place=sp42&task=ELIA-53&focus=q1",   // relative to the web app's address; for POST /api/open
      "accept": { "task": "ELIA-53" },                // a Ready task
      "answer": { "chat": "ELIA-53/worker", "question": "q1",
                  "choices": [{ "i": 0, "label": "Yes" }, { "i": 1, "label": "No" }],
                  "other": true },        // the card takes free words: Reply answers it as "Other"
      "reply":  { "chat": "ELIA-53/worker" }          // also on an agent's own alert that has a chat
    }
  ],
  "unread": 2                      // chats with a new message not yet read: a Chat badge, not Needs you
}
```

## What it lists: what the app shows

The feed never says more than Shepherdr's own screens, so phone, watch and app agree. Needs you is one rule
(SHEP-250, `web/shared/needs-you.ts` `needsYou`). One difference from the app: the feed keeps Ready as a section of
its own, where the app lists "Ready for review" under Needs you.

- Needs you lists only tasks (SHEP-255), oldest first, each once (its oldest card stands for it): a task's agent's
  card or wait (`type: "need"`), a task whose status says Needs you with no card (`type: "task"`), and a task's
  agent's own `herdr-task alert` while it stands (`type: "alert"`; a helper labelled `herdr.task` counts as its task's).
- What is no task's is not in it: a chat's own card, a helper's alert of no task (the VM sign-in helper's), a
  machine's memory alert, a schedule that failed to start. Their web pushes still go as before.
- A chat's new message is not a task, so it is not in Needs you (SHEP-253): it belongs to Chat. `unread` counts the
  chats with a new message not yet read (no card of their own waiting), for a Chat badge; its web push still goes as
  before.
- A task in Needs you is in no other section: a working task with a standing alert is under needs (its alert item) and
  back under working once the alert goes. An agent's alert is a moment: it stands only
  for 15 minutes, only while its terminal still runs and its task isn't done, and a machine's memory alert only while
  that machine's memory is still over 75%.
- Each leaves everywhere at the same moment: answered, or its alert over.
- `counts` are what each section lists, item for item (all of them, even past the 40 items): a header's number never
  differs from its list, nor from its app icon's count.
- `order` lists the sections' kinds (Needs you, Ready, Working, Done last): an app shows its sections in that order,
  not a fixed one. `groups` are the same sections in the same order, with their names and each count. Both come
  from one list (`web/shared/types.ts` `GROUPS`; Merging is listed under Working). Every section is always there, an empty one with
  count 0.

Titles and bodies are the web push's own words (`service/push.ts` `alertsOf`), so a native notification says exactly
what a web push would. `answer.choices` follows Shepherdr's button rules: never on a plan, a form, a merge, a pick of
several or a terminal menu, never a choice that needs a note or grants for good; three at most (labels <= 24).
