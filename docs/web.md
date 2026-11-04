# The web app

Shepherdr 3.1 is also a web app: the same spaces, Assistants, tasks, cards, artifacts and settings as the Herdr window,
on a phone, a tablet or another computer's browser, on the same data. Its look is 2.1's web app; what it does is
3.0's.

## Where it is

`https://<this machine's tailnet name>/shepherdr/`, shared only on your tailnet with `tailscale serve` (never funnel,
never the open internet). Shepherdr settings → Web shows the link and a QR code for your phone. It needs Tailscale
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
  (the same ElevenLabs voice agent, `core/voice.js`; whisper.cpp for dictation).
- Keys: 3.0's keys work in the web app too (Settings → Keyboard shortcuts on a desktop).

## Install

`./install.sh` installs the window's layout and the web app. `./install.sh --web` installs the web app alone (no
Herdr window): its spaces are the service's own. Shepherdr settings → Window → Add-ons → Web turns the web app off
and on; the service keeps its background work either way.
