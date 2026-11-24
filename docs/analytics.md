# Personal analytics

Shepherdr keeps a record of how you use it, so you and your agents can see your habits and find better ways to work.

**It stays on your machines. It is never sent to anyone, not to Shepherdr's makers either.** No telemetry, no
phone-home, no third-party library, no network call of any kind. `test/test_analytics.py` fails if its code reaches for
the network, or if feedback reports or GitHub issues read it.

## What is recorded

Events and timings, with ids (task, space, chat, machine) so an agent can look things up. Never what was said: no
message text, prompts, titles, secrets or file contents. Each field is a number, true/false or a short id-like word,
from a fixed list (`core/analytics.js`), so text can't fit.

- The app opened, and on which kind of device (phone, tablet, desktop). A lost connection, and for how long.
- Messages sent, per chat, and how: typed, dictated, a suggested reply's bubble, or Talk. Sends that failed.
- Agents' questions answered, and how: a choice picked, typed, or by voice.
- Tasks added, started, ready, sent back with feedback, done (merged or not), reopened, stopped (by you, an error or
  a limit), deleted. How long each waited: before it started, at Ready for review until done or sent back, at Needs you
  until answered, stopped until it carried on. The agent, model and effort of each, and how long it worked.
- Review rounds, failed merges and checks, schedules run and failed, settings changed (which one, never its value),
  Shepherdr updates.

## Where it is stored

On each machine, in Shepherdr's own data folder: `~/.local/share/shepherdr/analytics/` (only you can read it). One
file per day, one event a line. Each machine keeps its own: the machine that serves the web app keeps the app's
events, and every machine keeps its own tasks'. The main one reads the others over the links Shepherdr already has to
your machines.

It never grows without bound: a day stops at 4 MB, days older than 90 fold into one small summary per month (counts
and summed timings), and those go after 24 months.

## Read it

- **In the app:** Settings › Personal analytics shows the main numbers for the last day, week or month. "See what is
  stored" lists every event as kept.
- **Agents:** `herdr-task analytics` prints a short summary of the last week, across your machines. `--period day`,
  `week` or `month` (or `--days N`), `--json` for every number, `raw --json` for the events themselves, `--here` for this
  machine only. Ask your Assistant "how do I use Shepherdr, and what should I change?": it reads this and answers.
  In a voice call it reads the same summary.

## Export, switch off, delete

- **Export:** Settings › Personal analytics › Export saves everything as one JSON file on your device
  (`herdr-task analytics export`).
- **Off:** the switch in Settings › Personal analytics. Off records nothing at all, on every machine
  (`herdr-task analytics off`). It is on by default: nothing leaves your machines, and it is only useful with history.
  The app says so once, in a quiet note, the first time.
- **Delete all:** Settings › Personal analytics › Delete all deletes the whole record on every machine of yours
  (`herdr-task analytics delete`). A machine that can't be reached right then is named, so you can run it again later.
