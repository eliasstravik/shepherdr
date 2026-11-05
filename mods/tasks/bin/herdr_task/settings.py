"""The person's settings (~/.herdr/shepherdr.json and per-folder), the agent each task runs, and
the Settings block a task's brief ends with."""

import json
import os
import re
import shutil

from .base import Fail, HOME, MAX_RUNNING


# What each agent key starts by default. Unknown keys run as themselves; --argv overrides.
AGENTS = {"claude": ["claude"], "codex": ["codex", "--no-daemon"]}


# ---- the person's settings ------------------------------------------------------------------

SETTINGS = os.environ.get("HERDR_TASK_SETTINGS") or os.path.join(HOME, ".herdr", "shepherdr.json")
# The role instructions are herdr-core templates (`hc templates` lists them): assistant.md (the
# coordinator's), worker.md and reviewer.md. Workers and reviewers used ~/.herdr/instructions.
TEMPLATES = os.environ.get("HERDR_TASK_TEMPLATES") or os.path.join(HOME, ".config", "herdr-core", "templates")
OLD_INSTRUCTIONS = os.path.join(HOME, ".herdr", "instructions")
ASSISTANT_TEMPLATES = ("assistant", "coordinator")  # "coordinator": Assistants started before the rename
DEFAULTS = {"tasks": {"merge": "ask", "review_rounds": 0, "must_fix": "major", "max_running": MAX_RUNNING, "worktrees": True,
                      "start_notes": "", "finish_notes": "", "archive_after": 7, "proof": True, "base": ""},
            "automations": {"enabled": True}, "worker": {}, "reviewer": {}, "coordinator": {}, "backup": {},
            "agents": {"reactions": True}}
LEVELS = ["blocker", "major", "minor"]


# The machine layer's key for the computer whose Herdr window wrote the file. A copy the window
# pushes to another machine says which machine that is in "here" (and holds that machine's
# spaces by their bare ids), so the same lookup works there.
LOCAL_MACHINE = "local"


def read_settings():
    """The settings file as it is ({} when there is none or it can't be read)."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def autopilot_layers(d, space=None):
    """(Everywhere's, the space's own) Autopilot in a settings file d: {every, events, heartbeat, direction},
    each only when set. A space is found by its id on this machine (a pushed copy holds this
    machine's spaces by their bare ids, as herdr-task names them)."""
    def part(layer):
        a = (layer or {}).get("autopilot") if isinstance(layer, dict) else None
        return {k: v for k, v in a.items() if k in ("every", "events", "heartbeat", "direction") and v is not None} if isinstance(a, dict) else {}
    return part(d.get("everywhere")), part((d.get("spaces") or {}).get(space) if space else None)


def write_autopilot(space, values):
    """Sets Autopilot fields at one level of the settings file (space None: Everywhere's); a value
    None unsets it there, so it follows the level above again. Refused on a copy the window
    pushed here: the window's machine holds the truth and would put its own back."""
    d = read_settings()
    if d.get("pushed_from"):
        raise Fail("This machine's Shepherdr settings are a copy from the machine whose window sets them: change Autopilot in Settings there.")
    if space:
        layer = (d.setdefault("spaces", {})).setdefault(space, {})
    else:
        layer = d.setdefault("everywhere", {})
    a = dict(layer.get("autopilot") or {})
    for k, v in values.items():
        if v is None:
            a.pop(k, None)
        else:
            a[k] = v
    if a:
        layer["autopilot"] = a
    else:
        layer.pop("autopilot", None)
    if space and not layer:
        d["spaces"].pop(space, None)
    d["version"] = 1
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    tmp = f"{SETTINGS}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    os.replace(tmp, SETTINGS)


def reactions_on(space=None, d=None):
    """Settings › Agents › Reactions in a space, for every agent there (reactions.py): the space's
    own, else Everywhere's, else on. A layer's agents.reactions, else what SHEP-42 kept as
    assistant.reactions (when only the Assistant reacted): the window and the web app move it."""
    d = read_settings() if d is None else d
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    for layer in (own, d.get("everywhere")):
        for key in ("agents", "assistant"):
            a = layer.get(key) if isinstance(layer, dict) else None
            v = a.get("reactions") if isinstance(a, dict) else None
            if isinstance(v, bool):
                return v
    return DEFAULTS["agents"]["reactions"]


def settings_layers(s, space=None):
    """(Everywhere's, this machine's, this folder's) raw settings, least specific first: the
    folder's are those of the space working in it (--space's when several do)."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    spaces = d.get("spaces") or {}
    mine = [v for k, v in spaces.items() if (v or {}).get("folder") == s.loc["folder"]]
    pick = (spaces.get(bare(space)) if space and (spaces.get(bare(space)) or {}).get("folder") == s.loc["folder"] else None) or (mine[0] if mine else None)
    machine = (d.get("machines") or {}).get(d.get("here") or LOCAL_MACHINE)
    return d.get("everywhere") or {}, machine or {}, pick or {}


def settings_for(s, space=None):
    """The settings for this folder's tasks: Shepherdr settings' Everywhere, then this machine's,
    then the override of the space working in this folder (--space's when several do): the most
    specific wins. The window no longer writes agent or task values for a machine (only its
    machine-only rows, read by machine_limits/machine_option); ones set before still apply here. Written by the settings window (~/.herdr/shepherdr.json); herdr-task only
    reads them."""
    everywhere, machine, pick = settings_layers(s, space)
    out = {k: dict(v) for k, v in DEFAULTS.items()}

    def merge(part):
        for k, v in (part or {}).items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k].update({kk: vv for kk, vv in v.items() if vv is not None})
            elif k in out and v is not None:
                out[k] = v
    merge(everywhere)
    merge(machine)
    merge(pick)
    return out


def notes(s, task, which, space=None):
    """A task's "When a task starts" / "finishes" notes (which: "start" or "finish"): its own
    (--start-notes / --finish-notes), else its folder's from Shepherdr settings. Herdr runs
    nothing itself: the notes go into the agents' starting prompts."""
    own = (task.get(f"{which}_notes") or "").strip()
    return own or (settings_for(s, space or task.get("space"))["tasks"].get(f"{which}_notes") or "").strip()


def notes_part(head, text):
    """ "Before you start: ..." on one line, or the head over the notes when they have several."""
    return f"{head}:\n{text}" if "\n" in text else f"{head}: {text}" if text else ""


def worktrees_on(s, space=None):
    """Tasks here get a git worktree each: in a git repo, unless the person's Shepherdr settings
    turn worktrees off for it (then it works in the folder itself, as a folder without git)."""
    return s.loc["kind"] == "repo" and settings_for(s, space)["tasks"].get("worktrees") is not False


def argv_for(pick):
    """How to start an agent from a role's settings {agent, model, effort, fast, perm} (or its own
    argv), as the chat's agent picker builds it (mods/chat/agent.js argvFor). None: no setting."""
    if not pick:
        return None
    if pick.get("argv"):
        return [str(x) for x in pick["argv"]]
    agent = pick.get("agent")
    if agent == "claude":
        a = ["claude"]
        if pick.get("model"):
            a += ["--model", pick["model"]]
        if pick.get("effort"):
            a += ["--effort", pick["effort"]]
        a += ["--settings", json.dumps({"fastMode": bool(pick.get("fast"))})]
        perm = pick.get("perm")
        if perm == "bypassPermissions":
            a.append("--dangerously-skip-permissions")
        elif perm:
            a += ["--permission-mode", "default" if perm == "manual" else perm]
        return a
    if agent == "codex":
        a = ["codex", "--no-daemon"]
        if pick.get("model"):
            a += ["-m", pick["model"]]
        if pick.get("effort"):
            a += ["-c", f'model_reasoning_effort="{pick["effort"]}"']
        # always said, so Fast off wins over a service_tier in config.toml (default: the standard tier)
        a += ["-c", 'service_tier="%s"' % ("fast" if pick.get("fast") else "default")]
        perm = pick.get("perm")
        if perm == "full":
            a.append("--dangerously-bypass-approvals-and-sandbox")
        elif perm == "read-only":
            a += ["-s", "read-only", "-a", "on-request"]
        elif perm:
            a += ["-s", "workspace-write", "-a", "on-request"]
        return a
    return [agent] if agent else None


def worker_pick(s, task, space=None, agent=None):
    """What a task's agent runs on, {agent, model, effort, fast, perm}: Settings' worker, then the
    task's own --agent / --model / --effort, then `agent` (start --agent). Another CLI than
    Settings' starts from its own defaults (models and permissions differ per CLI)."""
    pick = dict(settings_for(s, space)["worker"] or {})
    for key in (task.get("agent"), agent):
        if key and key != pick.get("agent"):
            pick = {"agent": key}
    if not pick.get("agent") and not pick.get("argv"):
        pick["agent"] = "claude"
    for k in ("model", "effort"):
        if task.get(k):
            pick[k] = task[k]
    return pick


def worker_argv(s, task, space=None, agent=None):
    """A task's agent when nobody gave an argv: worker_pick's."""
    pick = worker_pick(s, task, space, agent)
    if pick.get("argv") and not (task.get("model") or task.get("effort")):
        return argv_for(pick)
    pick.pop("argv", None)
    pick.setdefault("agent", "claude")
    return argv_for(pick) or agent_argv(pick["agent"])


def argv_model(argv):
    """(model, effort) an agent's argv asks for, as argv_for writes them; None where it doesn't."""
    model = effort = None
    for i, a in enumerate(argv[:-1]):
        nxt = argv[i + 1]
        if a in ("--model", "-m"):
            model = nxt
        elif a == "--effort":
            effort = nxt
        elif a in ("-c", "--config") and nxt.startswith("model_reasoning_effort="):
            effort = nxt.split("=", 1)[1].strip("\"'")
    return model, effort


# ---- the Settings block: the settings that shape a task's work, as words in its brief ---------
# As in Shepherdr: settings only change what goes into an agent's starting prompt. Every brief
# ends with this block, one line per setting; a line that differs from Herdr's default says who
# changed it. The coordinator changes one task's with `add --set key=value` (and --model, --effort,
# --reviewer...). The brief's own words win over the block.

SETTINGS_HEAD = "Settings: (from herdr-task show; where the brief above says otherwise, it wins)"
SET_BY = {"task": "set by the assistant for this task", "folder": "this folder's setting", "machine": "this machine's setting",
          "all": "your setting everywhere"}
MERGE_WORDS = {"ask": "ask the person first: they accept it in the Tasks panel, which merges it",
               "checks": "after checks: once you say ready, Herdr merges it when its checks pass",
               "auto": "on its own: once you say ready, Herdr merges it"}
MUST_WORDS = {"blocker": "blocker", "major": "major and up (blocker, major)", "minor": "everything (blocker, major, minor)"}
# --set's keys (Shepherdr's spellings too) and the task fields they set.
SET_KEYS = {"review": "review", "brief.review": "review", "merge": "merge", "brief.merge": "merge",
            "rounds": "review_rounds", "review.rounds": "review_rounds", "review-rounds": "review_rounds", "review_rounds": "review_rounds",
            "mustfix": "must_fix", "must-fix": "must_fix", "must_fix": "must_fix", "review.mustfix": "must_fix",
            "agent": "agent", "task.agent": "agent", "model": "model", "task.model": "model", "effort": "effort", "task.effort": "effort",
            "reviewer": "reviewer", "reviewer.agent": "reviewer", "reviewer.model": "reviewer_model", "reviewer.effort": "reviewer_effort",
            "proof": "proof", "brief.proof": "proof"}
# The Proof line (as Shepherdr's skill asks of its task agents), on and off.
PROOF_WORDS = {"on": "show verifiable proof in one recipe artifact: each proof with a one-line caption, real and from this work now, "
                     "plus a \"Not proven\" list; then say ready with --proof <its id>",
               "off": "not needed for this task: no proof artifact; say in your summary how you checked it"}
MERGE_VALUES = {"ask": "ask", "ask me first": "ask", "ask first": "ask", "ask the person first": "ask", "wait": "ask",
                "checks": "checks", "after checks": "checks", "after github checks": "checks", "after checks pass": "checks",
                "auto": "auto", "on its own": "auto", "merge it": "auto", "at once": "auto"}
MUST_VALUES = {"blocker": "blocker", "blockers": "blocker", "critical": "blocker", "major": "major",
               "minor": "minor", "trivial": "minor", "everything": "minor"}
EFFORTS = {"none", "minimal", "lowest", "low", "medium", "high", "xhigh", "max", "ultra"}
ONOFF = {"on": "on", "yes": "on", "true": "on", "1": "on", "off": "off", "no": "off", "false": "off", "0": "off"}


def set_task(t, key, value):
    """One --set key=value (or flag) on task t; an empty value or "default" goes back to Settings'."""
    field = SET_KEYS.get(key.strip().lower())
    if not field:
        raise Fail(f"--set takes review, review.rounds, review.mustFix, merge, proof, agent, model, effort or reviewer settings, not {key!r}.")
    v = value.strip().strip("\"'").strip()
    sets = t.setdefault("set", {})
    if not v or v.lower() == "default":
        sets.pop(field, None)
        t.pop(field, None)
        if not sets:
            t.pop("set", None)
        return
    low = v.lower()
    if field in ("review", "proof"):
        if low not in ONOFF:
            raise Fail(f"{field} is on or off.")
        sets[field] = ONOFF[low]
    elif field == "review_rounds":
        m = re.fullmatch(r"(\d+)\s*(rounds?)?", low)
        if not m or not 0 <= int(m.group(1)) <= 10:
            raise Fail("review.rounds is 1 to 10 (0: no review).")
        sets[field] = int(m.group(1))
    elif field == "must_fix":
        if low not in MUST_VALUES:
            raise Fail("review.mustFix is blocker, major or minor.")
        sets[field] = MUST_VALUES[low]
    elif field == "merge":
        if low not in MERGE_VALUES:
            raise Fail('merge is "on its own", "after checks" or "ask me first".')
        sets[field] = MERGE_VALUES[low]
    else:
        # Agents, models and efforts are the task's own fields (worker_pick reads them).
        if field in ("effort", "reviewer_effort") and low not in EFFORTS:
            raise Fail(f"{field.replace('_', ' ')} is one of {', '.join(sorted(EFFORTS))} (or default).")
        sets.pop(field, None)
        t[field] = v
    if not sets:
        t.pop("set", None)


def set_opts(t, args):
    """add/edit's --set pairs and --agent, --model, --effort, --reviewer, --reviewer-model,
    --reviewer-effort, in that order (a --set pair wins over its flag)."""
    for flag in ("agent", "model", "effort", "reviewer", "reviewer_model", "reviewer_effort"):
        v = getattr(args, flag, None)
        if v is not None:
            set_task(t, flag, v)
    for pair in getattr(args, "set", None) or []:
        if "=" not in pair:
            raise Fail(f"--set takes key=value, not {pair!r}.")
        k, v = pair.split("=", 1)
        set_task(t, k, v)


def by_layer(s, space, section, key, value, default):
    """Who set a setting that differs from Herdr's default: "folder", "machine", "all", or None."""
    if value == default:
        return None
    everywhere, machine, mine = settings_layers(s, space)
    for by, layer in (("folder", mine), ("machine", machine), ("all", everywhere)):
        if key in ((layer.get(section) or {}) if key else {}) or (not key and layer.get(section)):
            return by
    return None


def other_cli(agent):
    """The reviewer by default: the other CLI than the task agent's where it's installed, else its own."""
    other = {"claude": "codex", "codex": "claude"}.get(agent)
    return other if other and shutil.which(other) else agent


def task_settings(s, t, space=None, argv=None):
    """The settings that shape this task's work, each {label, text, value, by}."""
    space = space or t.get("space")
    cfg = settings_for(s, space)
    k, sets = cfg["tasks"], t.get("set") or {}
    lines = []

    def add(label, text, value, by):
        lines.append({"label": label, "text": text, "value": value, "by": by})

    rounds_cfg = int(k.get("review_rounds") or 0)
    if "review" in sets:
        on, rev_by = sets["review"] == "on", "task"
    elif "review_rounds" in sets:
        on, rev_by = sets["review_rounds"] > 0, "task"
    else:
        on, rev_by = rounds_cfg > 0, by_layer(s, space, "tasks", "review_rounds", rounds_cfg > 0, False)
    here = t.get("mode") != "worktree"
    add("Review", "off" if not on else "on", on, rev_by)
    # What it runs on: the given argv, else its last agent's, else what it would start with.
    argv = argv or (t["agents"][-1].get("argv") if t.get("agents") else None) or worker_argv(s, t, space)
    agent = agent_key(argv)
    if on:
        rv = dict(cfg.get("reviewer") or {})
        if t.get("reviewer") and t["reviewer"] != rv.get("agent"):
            rv = {"agent": t["reviewer"]}
        rv_by = "task" if any(t.get(f) for f in ("reviewer", "reviewer_model", "reviewer_effort")) else \
            by_layer(s, space, "reviewer", None, bool(cfg.get("reviewer")), False)
        for f in ("model", "effort"):
            if t.get(f"reviewer_{f}"):
                rv[f] = t[f"reviewer_{f}"]
        who = rv.get("agent") or other_cli(agent)
        text = who + (f", model {rv['model']}" if rv.get("model") else "") + (f", effort {rv['effort']}" if rv.get("effort") else "")
        if not rv.get("agent"):
            text += " (the other CLI)" if who != agent else " (your own CLI: no other is installed)"
        add("Reviewer", text, {"agent": who, "model": rv.get("model"), "effort": rv.get("effort")}, rv_by)
        must = sets.get("must_fix") or (k.get("must_fix") if k.get("must_fix") in LEVELS else "major")
        add("Must fix", MUST_WORDS[must], must, "task" if "must_fix" in sets else by_layer(s, space, "tasks", "must_fix", must, "major"))
        rounds = sets.get("review_rounds") or (rounds_cfg if rounds_cfg > 0 else 3)
        more = int(t.get("review_rounds_added") or 0)
        add("Review rounds", f"at most {rounds + more}" + (f" ({more} added by the assistant)" if more else ""), rounds + more,
            "task" if "review_rounds" in sets else by_layer(s, space, "tasks", "review_rounds", rounds, 3))
    policy = sets.get("merge") or (k.get("merge") if k.get("merge") in MERGE_WORDS else "ask")
    m_by = "task" if "merge" in sets else by_layer(s, space, "tasks", "merge", policy, "ask")
    if here:
        add("Merge", "nothing to merge: you work in the folder itself, and the person accepts it", policy, m_by)
    else:
        add("Merge", MERGE_WORDS[policy], policy, m_by)
        if t.get("base_set"):
            add("Base", f"{t['base']}: your branch starts from it and merges into it", t["base"],
                "folder" if t.get("base_by") == "space" else "task")
    proof = sets["proof"] == "on" if "proof" in sets else k.get("proof") is not False
    add("Proof", PROOF_WORDS["on" if proof else "off"], proof,
        "task" if "proof" in sets else by_layer(s, space, "tasks", "proof", proof, True))
    model, effort = argv_model(argv)
    text = agent + (f", model {model}" if model else "") + (f", effort {effort}" if effort else "")
    a_by = "task" if any(t.get(f) for f in ("agent", "model", "effort")) else \
        by_layer(s, space, "worker", None, bool(cfg.get("worker")), False)
    add("Agent", text, {"agent": agent, "model": model, "effort": effort}, a_by)
    return lines


def settings_block(s, t, space=None, argv=None):
    rows = [f"- {x['label']}: {x['text']}" + (f" ({SET_BY[x['by']]})" if x["by"] else "") for x in task_settings(s, t, space, argv)]
    return "\n".join([SETTINGS_HEAD, *rows])


def review_limits(s, t):
    """(review on, rounds allowed now): the Settings block's Review and Review rounds lines, with
    the rounds the assistant added (review-more)."""
    on, rounds = False, 0
    for x in task_settings(s, t):
        if x["label"] == "Review":
            on = x["value"]
        elif x["label"] == "Review rounds":
            rounds = x["value"]
    return on, rounds


def space_base(s, space=None):
    """The branch a space's new tasks branch from and merge into (Shepherdr settings > Tasks >
    Base branch, per space); "" when unset: the folder's current branch."""
    return str(settings_for(s, space)["tasks"].get("base") or "").strip()


def merge_policy(s, t):
    """How a ready task merges: its own --set merge, else Settings' (auto, checks or ask)."""
    p = (t.get("set") or {}).get("merge") or settings_for(s, t.get("space"))["tasks"].get("merge")
    return p if p in MERGE_WORDS else "ask"

def agent_argv(key, argv_json=None):
    if argv_json:
        argv = json.loads(argv_json)
        if not isinstance(argv, list) or not argv:
            raise Fail("--argv must be a JSON list")
        argv = [str(x) for x in argv]
    else:
        argv = list(AGENTS.get(key, [key]))
    # Codex runs its commands outside hc without --no-daemon.
    if agent_key(argv) == "codex" and "--no-daemon" not in argv:
        argv.append("--no-daemon")
    return argv


def agent_key(argv):
    return os.path.basename(argv[0])


def bare(i):
    """Ids as labels use them: "vm/sp12" -> "sp12"."""
    return i.split("/")[-1] if i else i


def machine_limits(machine=None):
    """A machine's start limits (Settings > Machines; HERD-40): Everywhere's ("everywhere" ->
    "machine"), then that machine's own ("machines" -> its key -> "machine"; "local" is this
    computer, and a file Herdr pushed to another machine names it in "here"). Each is a number,
    or null for off; one not set is Shepherdr's default (machine.HOLD)."""
    from .machine import hold_limits
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    key = machine or d.get("here") or "local"
    out = dict((d.get("everywhere") or {}).get("machine") or {})
    out.update(((d.get("machines") or {}).get(key) or {}).get("machine") or {})
    return hold_limits(out)


def machine_option(name, default=None, machine=None):
    """One of a machine's own settings (Settings > Machines; HERD-61: low_priority, worker_memory):
    Everywhere's "machine" layer, then the machine's own; set in neither: default."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    if not isinstance(d, dict):
        return default
    key = machine or d.get("here") or "local"
    out = default
    for layer in ((d.get("everywhere") or {}).get("machine") or {}, ((d.get("machines") or {}).get(key) or {}).get("machine") or {}):
        if name in layer:
            out = layer[name]
    return out


def machine_name():
    """This machine's name as Herdr's window knows it (a pushed settings file's "here"), else None."""
    try:
        with open(SETTINGS) as f:
            return json.load(f).get("here") or None
    except (OSError, ValueError, AttributeError):
        return None
