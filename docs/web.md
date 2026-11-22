# The app

Shepherdr is one web app, the same on a phone, a tablet and a desktop. This page says where it is, who gets in and
how it runs.

## Where it is

`https://<this machine's tailnet name>/shepherdr/`, shared only on your tailnet with `tailscale serve`. Never Funnel,
never the open internet. `shepherdr web status` and `shepherdr doctor` print the link. Where the Herdr app is
installed, its "Open Shepherdr" button (Ctrl+Shift+O) opens it.

It needs Tailscale running on the serving machine. Without it the service still runs, with no link.

Another HTTPS port: when something else on the machine holds the tailnet's 443, `shepherdr web https-port 8443` moves
the app to `https://<name>:8443/shepherdr/` within seconds. `./install.sh --https-port 8443` sets it at install.
Updates keep it. `shepherdr web https-port 443` goes back. When sharing fails, `shepherdr doctor` says tailscale's
own reason.

## Who gets in

There are no accounts and no sign-in screen. Only the tailnet login that owns the serving machine gets in: Tailscale's
own identity header, checked against the connection it came on (`service/auth.ts`). A page from anywhere else can't
change anything: writes need the app's own origin. A caller on the machine itself uses the token in
`~/.local/state/shepherdr/service/token`, on 127.0.0.1.

An artifact's page runs in a frame that cannot reach the app.

## How it runs

- One always-on service per machine, `~/.local/share/shepherdr/service/main.ts` on Bun, kept running by
  `systemctl --user` (`shepherdr.service`) or launchd (`dev.shepherdr.service`). It listens on `127.0.0.1:7788` only
  (`./install.sh --port <n>` for another).
- It reads and acts through herdr-core (`hc`) and `herdr-task`. It serves the built app from `web/dist` and sends
  the page one snapshot over a socket, again whenever something changes.
- Shepherdr's chats, tasks and terminals run in a herdr-core session of their own, named `shepherdr`. They don't show
  in the Herdr app, and the Herdr app's terminals don't show in Shepherdr.
- Everything is one agent in the home folder of the serving machine. Each space has its own agent in its folder.
- A status is worked out by plain rules from the agent's own report and facts Shepherdr knows
  (`web/shared/view.ts`). No model sits in that path.
- Every feature of the page is a plugin ([Plugins](plugins.md)).
- Voice and dictation use ElevenLabs with your key, the secret `ELEVENLABS_API_KEY`.

## Serve from an always-on machine

A laptop sleeps, and its app with it. Serve it from a machine that stays on instead: a Mac mini, a cloud VM, any
machine linked over herdr-core.

```bash
shepherdr web serve-from <machine>     # move it there
shepherdr web serve-from here          # move it back
shepherdr web status                   # which machine serves it, and its link
```

A move installs Shepherdr on that machine over the link or brings it up to date, copies the shared data, the settings
and the agents' instructions over, then tells every machine. The new one shares `https://<its name>/shepherdr/` and
the old one stops. `--take-link` sets aside a `/shepherdr` that machine already shares to something else; moving away
puts it back. The machine needs Python 3.8+, herdr-core and Tailscale.

- The serving machine holds the shared data: the list of spaces and groups, the settings file and the agents'
  instructions. Every other machine's service reads and writes it there, through herdr-core's link.
- Each machine with a service runs its own schedules and task checks. Push alerts and the glance feed
  ([glance.md](glance.md)) come from the serving machine only.
- Secrets live in one vault, on the serving machine unless you moved them (`shepherdr secrets move-to <machine>`,
  `shepherdr secrets where`).
- Phones subscribed to the old link's alerts subscribe again on the new one.

## The demo

```bash
bun install && bun run build
bun web/demo/serve.ts [port]      # 127.0.0.1:7799 unless you name another
```

It serves the built app with a fictional day instead of the service. Nothing is wired to a real agent. `?case=empty`
in the address shows a first day with nothing yet, and `?case=down` a machine that can't be reached.
