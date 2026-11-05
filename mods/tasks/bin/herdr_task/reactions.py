"""Reactions (Settings › Agents › Reactions, on unless turned off): a space's Assistant reacts to
some of the person's messages with an emoji. It learns how at the start of each session (the chat's
SessionStart hook, mods/chat/session-note.sh, asks `herdr-task _session-note`), and a running one
is told once when the setting changes for its space. Workers are never told."""

import json
import os
import sys

from .base import addon_off, hc_json, now, run, STORE
from .settings import reactions_on, SETTINGS
from .launch import coordinators, is_coordinator

# What an Assistant was last taught, on its terminal: "on" or "off".
LABEL = "herdr.reactions"
STATE = os.path.join(STORE, ".reactions.json")
EVERY_MS = 60000  # looked at again this often, and at once when the settings file changes

GUIDE = ("Reactions (on in Settings): react to some of the person's messages with one emoji, as a person would in a chat: "
         "👀 on a new ask you're picking up, 👍 on a go-ahead, ✅ on their ask once it's done, 😂 at a joke, 🙏 for thanks. "
         "Most messages get none; never more than one per message; never instead of an answer they need. "
         "Write it on a line of its own in the reply that ends your turn: <hc react=\"👀\" to=\"first words of their message\"/>. "
         "When a reaction is all a message needs (a thanks, an ok), reply with only that line and <hc no-reply/>.")
TURNED_ON = "Reactions are now on in Settings. " + GUIDE.split(": ", 1)[1]
OFF = "Reactions are off in Settings: never react to the person's messages (no <hc react> lines)."
TURNED_OFF = "Reactions are now off in Settings: don't react to the person's messages any more (no <hc react> lines)."


def space_of(k):
    labels = (k or {}).get("labels") or {}
    return labels.get("herdr.space") or labels.get("herdr.coordinator.space")


def session_note(terminal):
    """What an Assistant's new session is told of reactions: when and how with Reactions on, never
    with them off ("" for any other agent), noting on its terminal what it was taught."""
    k = hc_json("get", terminal) if terminal else None
    if not k or not is_coordinator(k):
        return ""
    on = reactions_on(space_of(k))
    run(["hc", "label", terminal, f"{LABEL}={'on' if on else 'off'}"])
    return GUIDE if on else OFF


def cmd_session_note(args):
    """`herdr-task _session-note <terminal>`: the hook's extra words, as JSON string content
    (escaped, without the quotes) so the hook can put them in its own JSON as they are."""
    try:
        text = session_note(args.terminal)
    except Exception:  # a hook never fails a session's start
        text = ""
    if text:
        sys.stdout.write(json.dumps(" " + text, ensure_ascii=False)[1:-1])


def told(on):
    """The message a running Assistant gets when Reactions change for its space: hidden in the
    chat (a <herdr-…> tag), and needing no answer."""
    words = TURNED_ON if on else TURNED_OFF
    return (f'<herdr-setting name="reactions" value="{"on" if on else "off"}">{words} '
            "Nothing to answer: reply only <hc no-reply/>.</herdr-setting>")


def reactions_pass(report, quiet):
    """Tells each live Assistant here once when Reactions changed for its space since it was last
    taught (its LABEL). One without the label (started before this, or its hook didn't run) is
    taught when they're on, once it has had a turn; with them off it's only labelled. quiet:
    news_pass's {address: {turn, at}}, so a no-reply to this leaves a read chat read."""
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
    for addr in coordinators():
        k = hc_json("get", addr) or {}
        if k.get("state") != "live" or not is_coordinator(k):
            continue
        labels = k.get("labels") or {}
        want = "on" if reactions_on(space_of(k)) else "off"
        had = labels.get(LABEL)
        if had == want:
            continue
        if had is None and want == "off":
            run(["hc", "label", addr, f"{LABEL}=off"])
            continue
        if had is None and not k.get("turn"):
            continue  # just started: its hook is about to teach it
        if not news_send(addr, told(want == "on")):
            continue  # busy with the person: next time
        run(["hc", "label", addr, f"{LABEL}={want}"])
        report.setdefault("reactions", []).append({"to": addr, "now": want})
        if str(labels.get(READ)) == str(k.get("turn")) and addr not in quiet:
            quiet[addr] = {"turn": k.get("turn"), "at": now()}
