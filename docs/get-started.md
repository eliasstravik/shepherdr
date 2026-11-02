# Get started

Shepherdr 2.1 is a standalone web application beside herdr-core, not a terminal-herdr
plugin. Follow [installation, startup and private sharing](core/start.md).
The [acceptance record](core/implementation.md) identifies remaining gaps.

After installation, run `shepherdr start`. Open its private Tailscale HTTPS URL from
your phone, tablet or desktop. Add it to the home screen if wanted, and enable alerts
in Settings. Choose a space and write to its coordinator. A coordinator can start a
task in its own worktree; answer its cards, inspect its proof, and approve merges when
asked. Claude Code and Codex must already be installed and signed in on their machine.

`shepherdr stop` stops the application, leaving core agents running.
`shepherdr status` reports the running application and existing private URL.
[Background service instructions](core/start.md#background-service-and-crash-recovery)
cover autostart and crash recovery; installation/enabling is a separate human action.

Voice uses ElevenLabs. Give its API key only through Settings → Secrets, never chat.
Keep recordings disabled unless you choose otherwise. A browser microphone and its
permission are needed. Actual provider/device acceptance is recorded separately.

Existing 2.0 installations remain on the `v2.0` branch and their installed helpers.
Do not run 2.1 against their state. [Cutover](core/cutover.md) is an explicit later step.
