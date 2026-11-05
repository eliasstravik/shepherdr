# The web app

Shepherdr 3.1 is also a web app: the same spaces, Assistants, tasks, cards, artifacts and settings as the Herdr window,
on a phone, a tablet or another computer's browser, on the same data. Its look is 2.1's web app; what it does is
3.0's.

## Where it is

`https://<this machine's tailnet name>/shepherdr/`, shared only on your tailnet with `tailscale serve` (never funnel,
never the open internet); or the always-on machine you serve it from (below). Shepherdr settings → Web shows the link and a QR code for your phone. It needs Tailscale
running here; without it the service still runs, with no web app.

Who gets in: only the tailnet login that owns this machine (Tailscale's own identity header, checked against the
connection it came on). A page from anywhere else can't change anything: writes need the app's own origin.

## How it runs

- One always-on service, `~/.local/share/shepherdr/service/main.ts` on Bun, kept running by `systemctl --user`
  (`shepherdr.service`) or launchd (`dev.shepherdr.service`). It listens on `127.0.0.1:7788` only.
- It reads what the window reads, through herdr-core (`hc`): the spaces, Assistants, chats and task lists of every
  connected machine, and herdr-task's files. Shared choices (pins, sidebar sections, Notify, the Window switches)
  live in its shared document, which the window keeps in step (`lib/bridge.js`).
- Background work runs once: the scheduler's tick, serving secrets to other machines and the ask flags go to the
  service when the window's layout is 3.1 (the window sees it in `/api/health` and leaves them to it). An older
  window keeps doing them itself.
- The logic both sides share is in `core/` (plain JavaScript): the mods get copies (`bin/sync-shared`), the service
  imports it. `lib/features.json` lists every feature with its Herdr side, its web side and its shared logic; CI
  checks both sides are there.

## Native on both sides

- Artifacts: a recipe (`core/recipe.js`) is drawn natively by the window and as HTML on the web.
  `herdr-artifact convert` turns an older drawn artifact into a recipe.
- The task browser: Kitty in the window, a live view of the same browser on the web.
- Voice calls and dictation: the machine's microphone in the window, the phone's on the web, through the service
  (the same ElevenLabs voice agent, `core/voice.js`; ElevenLabs speech to text, Scribe, for dictation, with the
  same key). The voice agent has four tools (`core/voice.js` TOOLS), answered by the service with the web app's
  reach (`service/voice-tools.ts`): `look` reads anything (the call's context, any chat or a search in it, spaces,
  machines, tasks, a task's summary and checks, Needs you, news, Autopilot, automations, settings, secret names,
  artifacts), `open` shows something in the app the call runs in: the very page or window that started it (the page gets
  a `nav` message on its call socket and answers `navved` with what it shows; the window's chat mod gets `nav/*.json`
  in the call folder and answers `navved/*.json`). The agent hears it's on screen only after that answer, else why
  not (`navWords`). Spaces are found with their machine's names, the serving one's key too ("Mac mini Home" while it
  calls itself This computer); several that fit make it ask which. `send` writes as the person to any chat, and `act` runs one of the web app's
  actions only after the person said yes out loud (`confirmed`). The window's call asks its own machine's service
  (`POST /api/voice/tool`, local token); without it only its own chat works. Both sides tell the call what the app shows
  (the page's `where` message, the window's `where.json`). The agent's spec carries a fingerprint (`SPEC`): an agent
  made from an older one is PATCHed on the next call (`ensureAgent`).
- Keys: 3.0's keys work in the web app too (Settings → Keyboard shortcuts on a desktop).

## Install

`./install.sh` installs the window's layout and the web app. `./install.sh --web` installs the web app alone (no
Herdr window): its spaces are the service's own. Either builds the web app from a fresh clone (with Bun, installed
from bun.sh if it's missing), and `shepherdr update` updates the same kind. Shepherdr settings → Window → Add-ons → Web turns the web app off
and on; the service keeps its background work either way.

## Serve from an always-on machine

A laptop sleeps, and its web app with it. Serve it from a machine that stays on instead: a Mac mini, a cloud VM, any
machine linked over herdr-core (`hc machine add`, or Add machine in the sidebar). The Herdr window stays where it is.

- **Shepherdr settings → Web → Serve from**, in the window or the web app: this computer and every linked machine, with
  its system and Offline when it is. Pick one and confirm; to move it back, pick This computer.
- Or from a terminal: `shepherdr web serve-from <machine>` (`here` moves it back), `shepherdr web status`. Its
  `/shepherdr` already shared to something else there: `--take-link` sets that aside, and moving away puts it back.

What a move does, in order: installs Shepherdr's web service on that machine over the link, or brings it up to date
(`~/.local/share/shepherdr`, under launchd on macOS or a systemd user unit on Linux; Bun from bun.sh when it has
none; what it replaces is backed up and `shepherdr uninstall` there puts it back), copies the pins, sidebar, Notify,
settings and role instructions over, then tells every machine. The new one shares
`https://<its tailnet name>/shepherdr/` (127.0.0.1 only, never Funnel), the old one stops sharing its link, and
Settings → Web shows the new link and its QR code everywhere. It needs Python 3.8+, herdr-core and Tailscale there.

### One truth, wherever it is served

- **The host** (the machine serving the web app) holds the shared data: the `shepherdr` document (pins, the sidebar's
  sections and icons, Notify, the Window switches), `~/.herdr/shepherdr.json` and the role instructions. Chosen
  because it is the one that stays on: a pin made on the phone lands there with the window's machine asleep.
- **Every other machine's service** reads and writes the shared document there, through herdr-core's link, and keeps
  its own settings file and role instructions merged with the host's every 5 s (each side's own changes go to the
  other, the host's when both changed one thing). Its window works as before on its own copy. While the host can't
  be reached, the window keeps its copy and catches up when it's back.
- **Names** are each machine's own (the laptop calls the mini `mac-mini`, the mini calls the laptop `m3`): the shared
  data is moved between them through herdr-core's machine ids (`core/host.js`).
- **Which machine serves** is a herdr-core document on each machine, `shepherdr.host`: the newest record wins. A
  machine believes only its own record and the host's (a box it merely links, like a VM running agents, can't make
  itself the host). The host hands a move on to the machines it links, so one asleep at the move learns it on waking.
  No record (before any move): each machine serves its own, as before.
- **The host's spaces list**: its own and every machine it links. Link the host back to the window's machine
  (`hc machine add` there) so the window's spaces show on the web; asleep, they read Offline and the rest goes on.

### Nothing runs twice

| Work | Runs on |
| --- | --- |
| The task tick, the automations scheduler's check (herdr-task) | each machine with a Shepherdr service ticks its own; the host ticks the machines with none (VMs) that any service ran tasks on; another service ticks those only while the host can't be reached (herdr-task's lock keeps two ticks of one machine apart) |
| Autopilot wakes and automations | each machine's own scheduler (one per machine: herdr-task's lock); the tick above only checks it runs. A space's switch flipped from another machine is handed to herdr-task on the space's own machine, which keeps it and wakes it |
| News, the memory guard, retries of cut turns | inside each machine's tick, so with it |
| Push alerts to phones | the host only (the pages subscribe there) |
| A web page's question cards (the ask flag; the cards read and answered there) | the host, on the agent's machine through the link |
| Serving secrets to another machine's agents | the machine holding the vault (herdr-secret refuses elsewhere) |
| Sharing `/shepherdr` on the tailnet | the host only |

Phones subscribed to the old link's alerts subscribe again on the new one (a push subscription belongs to its
address). The window's machine shows the host's link; the service there answers its own window only.
