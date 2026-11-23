"""What a space's Assistant knows of the person's settings (SHEP-49): the ones that shape how it
makes and runs tasks, resolved for its space (Everywhere's, then this machine's from before, then
the space's own), as a short "Your settings" block, like the Settings block a worker's brief ends
with. Its session gets the block at every start, resume, compaction and handoff (the chat's
SessionStart hook, mods/chat/session-note.sh, asks `herdr-task _session-note`); a running one gets
one hidden notice line per setting that changed for its space, several at once in one message,
never for a save that changed nothing there. Other agents (task workers, automation runs, agent
tabs) aren't told the block: their brief is fixed; they get only Reactions (reactions.py)."""

import hashlib
import json
import os
import sys

from .base import hc_json, now, run, STORE
from .settings import DEFAULTS, LOCAL_MACHINE, MUST_WORDS, REPO_SECTIONS, SETTINGS, agent_key, bare, read_settings, repo_own
from .launch import coordinators, is_coordinator
from . import reactions

# What an Assistant was last told, on its terminal: "review:1a2b3c,merge:…", a short hash of each line.
LABEL = "herdr.settings"
STATE = os.path.join(STORE, ".assistant-settings.json")
EVERY_MS = 60000  # looked at again this often, and at once when the settings file changes

HEAD = ("Your settings: (Shepherdr settings, the truth for every task you add. A task gets the settings of the repo or folder "
        "it works in, whichever space adds it; the task lines below are {where}'s, and Repo settings lists the repos that set "
        "their own. A task's own --set wins, and `herdr-task show <id>` says what one task has and where each value comes from)")
MERGE_SHORT = {"ask": "ask the person first (they mark it as done on its card, which merges it)",
               "checks": "after checks (Herdr merges a ready task once all its checks pass)",
               "auto": "on its own (Herdr merges a ready task at once, waiting only on checks its base branch requires)"}
BY = {"space": "set for this space", "repo": "this repo's setting", "machine": "this machine's setting",
      "everywhere": "your setting everywhere"}
NOTICE_END = "Nothing to answer: reply only <hc no-reply/>."
# Settings › Instructions is gone (SHEP-319): an Assistant told some before is told once that they no longer apply.
INSTRUCTIONS_GONE = ("Shepherdr's Instructions setting is gone: the instructions you were told from it no longer apply. "
                     "How to work comes from the repo's or folder's AGENTS.md / CLAUDE.md and your own global file.")
NO_INSTRUCTIONS = hashlib.sha1(b"none").hexdigest()[:6]  # what the old "instructions" line's hash was with none set


def space_of(k):
    labels = (k or {}).get("labels") or {}
    return labels.get("herdr.space") or labels.get("herdr.coordinator.space")


def space_folder(space, d=None):
    """The repo (main checkout) or plain folder a space sits on, as herdr-task keys a folder's tasks: its folder in
    Shepherdr's spaces (core_spaces), else the one its settings recorded; None when unknown."""
    from .launch import core_spaces
    from .store import locate
    from .base import Fail
    folder = next((x["folder"] for x in core_spaces() if x["id"] == bare(space)), None) if space else None
    if not folder and space:
        own = ((d or {}).get("spaces") or {}).get(bare(space))
        folder = own.get("folder") if isinstance(own, dict) else None
    if not folder:
        return None
    try:
        return locate(folder)["folder"]
    except (Fail, OSError):
        return folder


def layers(d, space, folder=None):
    """(name, layer) of the settings file d, least specific first: Everywhere's, this machine's
    (agent and task values set before machine scope went), the space's own (only what is about the
    space: SHEP-335), then the task settings of the repo the space sits on (folder)."""
    def obj(x):
        x = x if isinstance(x, dict) else {}
        # Reactions as SHEP-42 kept them (the Assistant's) where the layer has no agents' (SHEP-48)
        old = x.get("assistant") if isinstance(x.get("assistant"), dict) else {}
        if isinstance(old.get("reactions"), bool):
            x = {**x, "agents": {"reactions": old["reactions"], **(x.get("agents") if isinstance(x.get("agents"), dict) else {})}}
        return x
    machine = obj(obj(d.get("machines")).get(d.get("here") or LOCAL_MACHINE))
    own = obj(obj(d.get("spaces")).get(bare(space))) if space else {}
    own = {k: v for k, v in own.items() if k not in REPO_SECTIONS}
    repo = repo_own(d, folder, space) if folder else {}
    return [("everywhere", obj(d.get("everywhere"))), ("machine", machine), ("space", own), ("repo", repo)]


def short_folder(folder):
    home = os.path.expanduser("~")
    return "~" + folder[len(home):] if folder == home or folder.startswith(home + "/") else folder


def repo_lines(d):
    """Repo settings: each repo or folder on this machine that sets its own task settings, with what it sets."""
    repos = d.get("repos") if isinstance(d.get("repos"), dict) else {}
    out = []
    for folder, layer in sorted(repos.items()):
        if ":" in folder or not isinstance(layer, dict):
            continue  # another machine's: its own Assistants are told there
        t = layer.get("tasks") if isinstance(layer.get("tasks"), dict) else {}
        said = []
        if t.get("merge") in MERGE_SHORT:
            said.append(f"Merge {MERGE_SHORT[t['merge']].split(' (')[0]}")
        if t.get("review_rounds") is not None:
            n = int(t.get("review_rounds") or 0)
            said.append(f"Review on, {n} round{'s' if n > 1 else ''}" if n > 0 else "Review off")
        if t.get("proof") is not None:
            said.append("Proof " + ("off" if t["proof"] is False else "on"))
        if layer.get("worker"):
            said.append(f"Task agent {pick_words(layer['worker'], 'claude')}")
        if layer.get("reviewer"):
            said.append(f"Reviewer {pick_words(layer['reviewer'], 'the other CLI')}")
        if str(t.get("base") or "").strip():
            said.append(f"Base branch {t['base']}")
        rest = [k for k in t if k not in ("merge", "review_rounds", "proof", "base") and t[k] not in (None, "", [])]
        if rest:
            said.append("also " + ", ".join(k.replace("_", " ") for k in rest))
        if said:
            out.append(f"{short_folder(folder)}: {', '.join(said)}")
    return out


def resolve(ls):
    """The values that apply, from DEFAULTS and the layers (most specific wins)."""
    out = {k: dict(v) for k, v in DEFAULTS.items()}
    for _, layer in ls:
        for k, v in layer.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k].update({kk: vv for kk, vv in v.items() if vv is not None})
            elif k in out and v is not None:
                out[k] = v
    return out


def pick_words(p, unset):
    """An agent pick {agent, model, effort} (or its argv) in a few words."""
    if not isinstance(p, dict) or not (p.get("agent") or p.get("argv")):
        return unset
    agent = p.get("agent") or agent_key([str(x) for x in p["argv"]])
    return agent + (f", model {p['model']}" if p.get("model") else "") + (f", effort {p['effort']}" if p.get("effort") else "")


def rows(space, d=None, folder=None):
    """The block's lines for a space: [{key, label, text, value, by, scope}]. by: who set a line
    that differs from Herdr's default (None: the default); scope: "space" when the space sets one of
    its parts itself, "repo" when the repo it sits on does, else "everywhere" (or "machine"). d: the
    settings file (read when None); folder: the repo the space sits on (space_folder when None)."""
    d = read_settings() if d is None else d
    folder = space_folder(space, d) if folder is None else folder
    ls = layers(d, space, folder)

    def lines(cfg):
        t = cfg["tasks"]
        rounds = int(t.get("review_rounds") or 0)
        must = t.get("must_fix") if t.get("must_fix") in MUST_WORDS else "major"
        review = "off" if rounds <= 0 else (f"on, at most {rounds} round{'s' if rounds > 1 else ''}, must fix {MUST_WORDS[must]}, "
                                            f"reviewer {pick_words(cfg.get('reviewer'), 'the other CLI')}")
        merge = t.get("merge") if t.get("merge") in MERGE_SHORT else "ask"
        notes = [w for w, k in (("start", "start_notes"), ("finish", "finish_notes")) if str(t.get(k) or "").strip()]
        setup = " ".join(str(t.get("setup") or "").split())[:200]
        reacting = (cfg.get("agents") or {}).get("reactions") is not False
        offering = (cfg.get("agents") or {}).get("feedback") is not False
        suggesting = (cfg.get("agents") or {}).get("suggestions") is not False
        from .feedback import feedback_repo
        repo = feedback_repo(d)
        return [
            ("review", "Review", review, "on" if rounds > 0 else "off",
             [("tasks", "review_rounds"), ("tasks", "must_fix"), ("reviewer", None)]),
            ("merge", "Merge", MERGE_SHORT[merge], merge, [("tasks", "merge")]),
            ("proof", "Proof", "on" if t.get("proof") is not False else "off (tasks show no proof artifact)",
             "off" if t.get("proof") is False else "on", [("tasks", "proof")]),
            ("agent", "Task agent", pick_words(cfg.get("worker"), "claude, its own default model and effort"),
             pick_words(cfg.get("worker"), "claude").replace(", model ", "/").replace(", effort ", "/"), [("worker", None)]),
            ("base", "Base branch", f"{t['base']} (new tasks branch from it and merge into it)" if str(t.get("base") or "").strip()
             else "the folder's checked-out branch", str(t.get("base") or "").strip(), [("tasks", "base")]),
            ("worktrees", "Worktrees", "on (in a git repo, a worktree and branch per task)" if t.get("worktrees") is not False
             else "off (tasks work in the folder itself)", "off" if t.get("worktrees") is False else "on", [("tasks", "worktrees")]),
            ("notes", "Task notes", (" and ".join(notes) + " notes set (every brief includes them)") if notes else "none",
             ",".join(notes) or "none", [("tasks", "start_notes"), ("tasks", "finish_notes")]),
            ("setup", "Before the agent starts", (f"{setup} (runs in each new worktree first; if it fails the task waits "
             "with why and its agent doesn't start)") if setup else "none", "on" if setup else "off", [("tasks", "setup")]),
            ("reactions", "Reactions", "on (react to some of the person's messages with one emoji)" if reacting
             else "off (never react to the person's messages)", "on" if reacting else "off", [("agents", "reactions")]),
            ("suggestions", "Suggested next message", "on (end each reply with the message you'd likely send next, greyed out in the box)"
             if suggesting else "off (no suggested next message)", "on" if suggesting else "off", [("agents", "suggestions")]),
            ("feedback", "Feedback offers", f"on (offer once to file a Shepherdr problem as an issue on {repo}, only on the person's yes)"
             if offering else "off (never offer feedback for Shepherdr; file nothing)", "on" if offering else "off",
             [("agents", "feedback"), ("agents", "feedback_repo")]),
        ]
    have = lines(resolve(ls))
    default = {x[0]: x[2] for x in lines(resolve([]))}
    out = []
    for key, label, text, value, parts in have:
        def sets(layer):
            return any((f is None and layer.get(sec)) or (f is not None and isinstance(layer.get(sec), dict) and layer[sec].get(f) is not None)
                       for sec, f in parts)
        setters = [name for name, layer in ls if sets(layer)]
        scope = setters[-1] if setters else "everywhere"
        by = setters[-1] if setters and text != default[key] else None
        out.append({"key": key, "label": label, "text": text, "value": value, "by": by, "scope": scope})
    # SHEP-335: the repos that set their own task settings, so a task added in one is known to get them
    own = repo_lines(d)
    out.append({"key": "repos", "label": "Repo settings", "text": "; ".join(own) if own else "none (every repo has the task lines above)",
                "value": str(len(own)), "by": None, "scope": "repo", "where": short_folder(folder) if folder and repo_own(d, folder, space) else "Everywhere"})
    return out


def block(rs):
    """The "Your settings" lines."""
    where = next((r.get("where") for r in rs if r["key"] == "repos"), None) or "Everywhere"
    return "\n".join([HEAD.format(where=where)] + [f"- {r['label']}: {r['text']}" + (f"; {BY[r['by']]}" if r["by"] else "") for r in rs])


def digest(rs):
    """The label's value: each line's key and a short hash of what it says."""
    return ",".join(f"{r['key']}:{hashlib.sha1(r['text'].encode()).hexdigest()[:6]}" for r in rs)


def parse(label):
    return dict(x.split(":", 1) for x in (label or "").split(",") if ":" in x) if label else None


def attr(v):
    return str(v).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def notice(changed):
    """The message a running Assistant gets when some of its settings changed: one hidden
    <herdr-setting> line each (the chat strips Herdr's tags), the last saying nothing needs an answer."""
    out = []
    for i, r in enumerate(changed):
        words = (reactions.TURNED_ON if r["value"] == "on" else reactions.TURNED_OFF) if r["key"] == "reactions" else \
            INSTRUCTIONS_GONE if r["key"] == "instructions" else \
            f"{r['label']} is now {r['text']}" + (f"; {BY[r['by']]}" if r["by"] else "; Herdr's default") + \
            ("." if r["key"] == "feedback" else ". Tasks you add from now on get it; running ones keep their brief.")
        if r["key"] == "repos":
            words = f"Repo settings are now: {r['text']}. Tasks added in those repos from now on get them; running ones keep their brief."
        end = f" {NOTICE_END}" if i == len(changed) - 1 else ""
        out.append(f'<herdr-setting name="{r["key"]}" value="{attr(r["value"])}" scope="{r["scope"]}">{words}{end}</herdr-setting>')
    return "\n".join(out)


def session_note(terminal):
    """What an Assistant's new session is told: its settings block, then the Reactions guide (when
    and how with them on, never with them off); any other agent only the Reactions words
    (reactions.agent_note); "" outside Herdr. Notes on its terminal what it was told."""
    k = hc_json("get", terminal) if terminal else None
    if not k:
        return ""
    if not is_coordinator(k):
        return reactions.agent_note(terminal, k)
    rs = rows(space_of(k))
    on = next(r for r in rs if r["key"] == "reactions")["value"] == "on"
    run(["hc", "label", terminal, f"{LABEL}={digest(rs)}"])
    run(["hc", "label", terminal, f"{reactions.LABEL}={'on' if on else 'off'}"])
    return block(rs) + "\n" + (reactions.GUIDE if on else reactions.OFF)


def cmd_session_note(args):
    """`herdr-task _session-note <terminal>`: the hook's extra words, as JSON string content
    (escaped, without the quotes) so the hook can put them in its own JSON as they are."""
    try:
        text = session_note(args.terminal)
    except Exception:  # a hook never fails a session's start
        text = ""
    if text:
        sys.stdout.write(json.dumps(" " + text, ensure_ascii=False)[1:-1])


def settings_pass(report, quiet):
    """Tells each live Assistant here what changed in its settings since it was last told (its
    LABEL), in one message. One without the label (started before this) gets the whole block once
    it has had a turn. quiet: news_pass's {address: {turn, at}}, so a no-reply to this leaves a read
    chat read."""
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
    for addr in coordinators():
        k = hc_json("get", addr) or {}
        if k.get("state") != "live" or not is_coordinator(k):
            continue
        labels = k.get("labels") or {}
        rs = rows(space_of(k), d)
        had = parse(labels.get(LABEL))
        now_digest = parse(digest(rs))
        if had == now_digest:
            continue
        if had is None:
            if not k.get("turn"):
                continue  # just started: its hook is about to tell it
            # started before Assistants were told their settings: the whole block, once
            on = next(r for r in rs if r["key"] == "reactions")["value"] == "on"
            guide = reactions.GUIDE if on and labels.get(reactions.LABEL) != "on" else ""
            text = (f'<herdr-setting name="all">{block(rs)}' + (f"\n{guide}" if guide else "") + f" {NOTICE_END}</herdr-setting>")
            changed = [{"key": "all"}]
        else:
            changed = [r for r in rs if had.get(r["key"]) != now_digest[r["key"]]]
            if had.get("instructions") not in (None, NO_INSTRUCTIONS):  # it was told some: once, that they're gone
                changed.append({"key": "instructions", "value": "off", "scope": "everywhere"})
            if not changed:  # a line no longer said: just note it
                run(["hc", "label", addr, f"{LABEL}={digest(rs)}"])
                continue
            text = notice(changed)
        if not news_send(addr, text):
            continue  # busy with the person: next time
        run(["hc", "label", addr, f"{LABEL}={digest(rs)}"])
        on = next(r for r in rs if r["key"] == "reactions")["value"]
        run(["hc", "label", addr, f"{reactions.LABEL}={on}"])
        report.setdefault("settings", []).append({"to": addr, "changed": [r["key"] for r in changed]})
        if str(labels.get(READ)) == str(k.get("turn")) and addr not in quiet:
            quiet[addr] = {"turn": k.get("turn"), "at": now()}
