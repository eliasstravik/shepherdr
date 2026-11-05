"""Reactions (Settings › Agents › Reactions, on unless turned off): every agent in Herdr reacts to
some of the person's messages with an emoji: Assistants, task workers, automation runs and plain
agent tabs. Each learns how at the start of each session (the chat's SessionStart hook,
mods/chat/session-note.sh, asks `herdr-task _session-note`): an Assistant with its settings block
(assistant_settings.py), any other agent just these words (agent_note), and its terminal is
labelled with what it was taught. A running one is told once when the setting changes for its
space, as SHEP-49's <herdr-setting> line: an Assistant by assistant_settings' pass, every other
agent its hook taught by reactions_pass here. A headless reviewer (claude -p, codex exec) has no
chat: its hook may run in its worker's terminal, but it never gets the person's messages, so it has
nothing to react to."""

import json
import os

from .base import addon_off, hc_json, now, run, STORE
from .settings import bare, reactions_on, read_settings, SETTINGS
from .launch import is_coordinator

# What an agent was last taught, on its terminal: "on" or "off".
LABEL = "herdr.reactions"
STATE = os.path.join(STORE, ".reactions.json")
EVERY_MS = 60000  # looked at again this often, and at once when the settings file changes

GUIDE = ("Reactions (on in Settings): react to some of the person's messages with one emoji, as a person would in a chat: "
         "pick the most specific, delightful or funny emoji that fits that message, not a generic 👍 or 👀 by default: "
         "🚀 for a launch, 🔥 for a great result, 🐛 for a bug report, 🧹 for a cleanup ask, 🫡 for a direct order, 🤌 for a nice detail, "
         "🍿 for drama, 😂 at a joke, 🙏 for thanks, ✅ on their ask once it's done; 👀 or 👍 only when nothing more fitting does. "
         "Keep it tasteful: most messages get none; never more than one per message; never instead of an answer they need. "
         "Write it on a line of its own in the reply that ends your turn: <hc react=\"👀\" to=\"first words of their message\"/>. In to=, leave out double quotes or make them curly (“ ”). "
         "A message that needs no words back (a thanks, an ok, a joke) gets only the reaction: that line, then <hc no-reply/>, nothing else.")
TURNED_ON = "Reactions are now on in Settings. " + GUIDE.split(": ", 1)[1]
OFF = "Reactions are off in Settings: never react to the person's messages (no <hc react> lines)."
TURNED_OFF = "Reactions are now off in Settings: don't react to the person's messages any more (no <hc react> lines)."
# A notice to an agent that may be at work (a worker mid-task): it carries on.
CARRY_ON = "Nothing to answer: carry on with what you were doing; if nothing, reply only <hc no-reply/>."


def space_of(k, d=None):
    """The space an agent works for: its terminal's label (an Assistant's, a task's), else the
    space whose folder holds its folder (a plain agent tab), else None (Everywhere's)."""
    labels = (k or {}).get("labels") or {}
    for key in ("herdr.space", "herdr.coordinator.space", "herdr.task.space"):
        if labels.get(key):
            return labels[key]
    if not (k or {}).get("cwd"):
        return None
    cwd = os.path.realpath(k["cwd"])
    best = None
    for sid, v in ((d if d is not None else read_settings()).get("spaces") or {}).items():
        folder = os.path.realpath(os.path.expanduser((v or {}).get("folder") or "")) if (v or {}).get("folder") else ""
        if folder and (cwd == folder or cwd.startswith(folder.rstrip("/") + "/")) and (best is None or len(folder) > best[1]):
            best = (bare(sid), len(folder))
    return best[0] if best else None


def scope_of(space, d):
    """"space" when the space sets Reactions itself, else "everywhere"."""
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    sets = isinstance(own, dict) and any(isinstance(own.get(s), dict) and isinstance(own[s].get("reactions"), bool) for s in ("agents", "assistant"))
    return "space" if sets else "everywhere"


def agent_note(terminal, k):
    """What a new session of an agent that isn't an Assistant (a task worker, an automation's run,
    an agent tab) is told: when and how with Reactions on in its space, never with them off."""
    on = reactions_on(space_of(k))
    run(["hc", "label", terminal, f"{LABEL}={'on' if on else 'off'}"])
    return GUIDE if on else OFF


def told(on, scope="everywhere"):
    """The message a running agent gets when Reactions change for its space: SHEP-49's hidden
    <herdr-setting> line, needing no answer: one at work carries on."""
    words = TURNED_ON if on else TURNED_OFF
    return f'<herdr-setting name="reactions" value="{"on" if on else "off"}" scope="{scope}">{words} {CARRY_ON}</herdr-setting>'


def agents():
    """The live agents here its hook taught (labelled), Assistants left out: theirs is the settings pass."""
    found = []
    for v in ("on", "off"):
        found += [k["address"] for k in (hc_json("ls", "--label", f"{LABEL}={v}") or {}).get("terminals", [])
                  if k.get("state") == "live" and "/" not in k["address"]]
    return list(dict.fromkeys(found))


def reactions_pass(report, quiet):
    """Tells each live agent here that isn't an Assistant once when Reactions changed for its space
    since it was last taught (its LABEL). One started before this (no label) isn't told: its next
    start teaches it. quiet: news_pass's {address: {turn, at}}, so a no-reply leaves a read chat read."""
    if addon_off("chat"):
        return
    try:
        mtime = os.path.getmtime(SETTINGS)
    except OSError:
        mtime = 0
    try:
        with open(STATE) as f:
            st = json.load(f)
    except (OSError, ValueError):
        st = {}
    if st.get("mtime") == mtime and now() - (st.get("at") or 0) < EVERY_MS:
        return
    tmp = f"{STATE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump({"mtime": mtime, "at": now()}, f)
    os.replace(tmp, STATE)
    from .news import news_send, READ
    d = read_settings()
    for addr in agents():
        k = hc_json("get", addr) or {}
        if k.get("state") != "live" or is_coordinator(k):
            continue
        labels = k.get("labels") or {}
        space = space_of(k, d)
        want = "on" if reactions_on(space, d) else "off"
        if labels.get(LABEL) == want:
            continue
        if not news_send(addr, told(want == "on", scope_of(space, d))):
            continue  # busy with the person: next time
        run(["hc", "label", addr, f"{LABEL}={want}"])
        report.setdefault("reactions", []).append({"to": addr, "now": want})
        if str(labels.get(READ)) == str(k.get("turn")) and addr not in quiet:
            quiet[addr] = {"turn": k.get("turn"), "at": now()}
