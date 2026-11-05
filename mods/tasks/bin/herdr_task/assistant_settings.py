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

from .base import addon_off, hc_json, MAX_RUNNING, now, run, STORE
from .settings import DEFAULTS, LOCAL_MACHINE, MUST_WORDS, SETTINGS, agent_key, bare, read_settings
from .launch import coordinators, is_coordinator
from . import reactions

# What an Assistant was last told, on its terminal: "review:1a2b3c,merge:…", a short hash of each line.
LABEL = "herdr.settings"
STATE = os.path.join(STORE, ".assistant-settings.json")
EVERY_MS = 60000  # looked at again this often (Autopilot's switch is in its own file), and at once when the settings file changes

HEAD = ("Your settings: (Shepherdr settings for this space, the truth for every task you add; a task's own --set wins, "
        "and `herdr-task show <id>` says what one task has)")
MERGE_SHORT = {"ask": "ask the person first (they accept it in the Tasks panel, which merges it)",
               "checks": "after checks (Herdr merges a ready task once its checks pass)",
               "auto": "on its own (Herdr merges a ready task)"}
BY = {"space": "set for this space", "machine": "this machine's setting", "everywhere": "your setting everywhere"}
NOTICE_END = "Nothing to answer: reply only <hc no-reply/>."


def space_of(k):
    labels = (k or {}).get("labels") or {}
    return labels.get("herdr.space") or labels.get("herdr.coordinator.space")


def layers(d, space):
    """(name, layer) of the settings file d, least specific first: Everywhere's, this machine's
    (agent and task values set before machine scope went), the space's own."""
    def obj(x):
        x = x if isinstance(x, dict) else {}
        # Reactions as SHEP-42 kept them (the Assistant's) where the layer has no agents' (SHEP-48)
        old = x.get("assistant") if isinstance(x.get("assistant"), dict) else {}
        if isinstance(old.get("reactions"), bool):
            x = {**x, "agents": {"reactions": old["reactions"], **(x.get("agents") if isinstance(x.get("agents"), dict) else {})}}
        return x
    machine = obj(obj(d.get("machines")).get(d.get("here") or LOCAL_MACHINE))
    own = obj(obj(d.get("spaces")).get(bare(space))) if space else {}
    return [("everywhere", obj(d.get("everywhere"))), ("machine", machine), ("space", own)]


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


def autopilot_of(space, cfg):
    """(on, schedule words, direction) of the space's Autopilot."""
    from . import autopilot as ap
    try:
        with ap.state(write=False) as d:
            eff = ap.resolve(d, (d.get("spaces") or {}).get(bare(space)) if space else None, bare(space) if space else None, cfg)
        return eff["on"], ap.trigger_of(eff), ap.direction_of(bare(space) if space else None, cfg)
    except Exception:  # never stops a session's start
        return False, "", ""


def rows(space, d=None, auto=None):
    """The block's lines for a space: [{key, label, text, value, by, scope}]. by: who set a line
    that differs from Herdr's default (None: the default); scope: "space" when the space sets one of
    its parts itself, else "everywhere" (or "machine"). d: the settings file (read when None);
    auto: (on, schedule, direction) of its Autopilot (read when None)."""
    d = read_settings() if d is None else d
    ls = layers(d, space)
    on, every, direction = autopilot_of(space, d) if auto is None else auto

    def lines(cfg, autopilot):
        t = cfg["tasks"]
        rounds = int(t.get("review_rounds") or 0)
        must = t.get("must_fix") if t.get("must_fix") in MUST_WORDS else "major"
        review = "off" if rounds <= 0 else (f"on, at most {rounds} round{'s' if rounds > 1 else ''}, must fix {MUST_WORDS[must]}, "
                                            f"reviewer {pick_words(cfg.get('reviewer'), 'the other CLI')}")
        merge = t.get("merge") if t.get("merge") in MERGE_SHORT else "ask"
        notes = [w for w, k in (("start", "start_notes"), ("finish", "finish_notes")) if str(t.get(k) or "").strip()]
        a_on, a_every, a_dir = autopilot
        reacting = (cfg.get("agents") or {}).get("reactions") is not False
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
            ("max_running", "Tasks at once", f"{t.get('max_running') or MAX_RUNNING} per folder (more wait and start by themselves)",
             str(t.get("max_running") or MAX_RUNNING), [("tasks", "max_running")]),
            ("notes", "Task notes", (" and ".join(notes) + " notes set (every brief includes them)") if notes else "none",
             ",".join(notes) or "none", [("tasks", "start_notes"), ("tasks", "finish_notes")]),
            ("autopilot", "Autopilot", ("on, " + a_every + (f", direction: {a_dir}" if a_dir else "")) if a_on
             else "off" + (f" (direction when on: {a_dir})" if a_dir else ""), "on" if a_on else "off",
             [("autopilot", "every"), ("autopilot", "events"), ("autopilot", "direction"), ("autopilot", None)]),
            ("reactions", "Reactions", "on (react to some of the person's messages with one emoji)" if reacting
             else "off (never react to the person's messages)", "on" if reacting else "off", [("agents", "reactions")]),
        ]
    have = lines(resolve(ls), (on, every, direction))
    default = {x[0]: x[2] for x in lines(resolve([]), (False, every, ""))}
    out = []
    for key, label, text, value, parts in have:
        def sets(layer):
            if key == "autopilot" and layer is ls[2][1] and on:
                return True  # its switch is the space's own
            return any((f is None and layer.get(sec)) or (f is not None and isinstance(layer.get(sec), dict) and layer[sec].get(f) is not None)
                       for sec, f in parts)
        setters = [name for name, layer in ls if sets(layer)]
        scope = setters[-1] if setters else "everywhere"
        by = setters[-1] if setters and text != default[key] else None
        out.append({"key": key, "label": label, "text": text, "value": value, "by": by, "scope": scope})
    return out


def block(rs):
    return "\n".join([HEAD] + [f"- {r['label']}: {r['text']}" + (f"; {BY[r['by']]}" if r["by"] else "") for r in rs])


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
            f"{r['label']} is now {r['text']}" + (f"; {BY[r['by']]}" if r["by"] else "; Herdr's default") + \
            ("." if r["key"] == "autopilot" else ". Tasks you add from now on get it; running ones keep their brief.")
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
