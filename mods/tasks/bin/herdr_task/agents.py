"""Live agents: a task's terminals, its status and what its agent last said or asks."""

import datetime
import json
import os
import re
import time

from .base import hc_json, HOME, now, RANK, SHELLS, run


# ---- live agents ----------------------------------------------------------------------------

# A worker's own helper agents (SHEP-54): hc children of its terminal it starts itself (`hc run`), labelled
# herdr.task (its task) and herdr.role reviewer or helper. Never one of the task's agents: no second worker, no
# status of their own; a working one keeps its quiet worker Working (own_work).
HELPER_ROLES = ("reviewer", "helper")


def parent_of(k):
    """Its parent's address as hc ls writes this terminal's: another machine's names its parent there ("t5" for "vm/t5")."""
    p, a = str(k.get("parent") or ""), str(k.get("address") or "")
    return f"{a.split('/')[0]}/{p}" if p and "/" in a and "/" not in p else p or None


def is_helper(k, mine=()):
    """hc ls gives no labels: a helper is also told by its parent, another terminal of the same task
    (a worker's parent is its Assistant, never the task's)."""
    return bool(k.get("parent")) and ((k.get("labels") or {}).get("herdr.role") in HELPER_ROLES or parent_of(k) in mine)


def _live(key):
    d = hc_json("ls", "--label", f"herdr.task={key}") or {}
    live = [dict(k, labels=dict(k.get("labels") or {}, **{"herdr.task": key}))
            for k in d.get("terminals", []) if k.get("state") == "live"]
    mine = {k.get("address") for k in live}
    return [(k, is_helper(k, mine)) for k in live]


def live_agents(key):
    """The task's live terminals, with labels (hc ls leaves labels out unless filtering by them),
    its worker's helpers left out (live_helpers()). Agents start inside the person's shell, which
    stays when the agent exits: agent_running()."""
    return [k for k, helper in _live(key) if not helper]


def live_helpers(key):
    """The helper agents its worker started (a reviewer, a second opinion), still live."""
    return [k for k, helper in _live(key) if helper]


def detail(k):
    """hc ls gives no foreground; hc get does."""
    return hc_json("get", k["address"]) or k


def prog_name(name):
    """A foreground program's own name: its path's last part, and Nix's makeWrapper's ".claude-wrapped" as "claude"
    (#1410). The same as core/send.js progName()."""
    base = os.path.basename(str(name or ""))
    return base[1:-len("-wrapped")] if base.startswith(".") and base.endswith("-wrapped") and len(base) > 9 else base


def agent_running(k):
    fg = k.get("foreground") or {}
    if fg.get("name"):
        if prog_name(fg["name"]) not in SHELLS:
            return True
        # fish keeps the agent its child, in its own process group (#780): the terminal's foreground
        # stays the shell running its launch command (fish -ic "claude …; exec fish -i") the whole
        # time. Only once it exec'ed its plain interactive shell has the agent exited.
        return runs_command(fg.get("argv"))
    return bool(k.get("agent")) and k.get("agent") not in SHELLS


# SHEP-324: what is in front of an agent's terminal, checked right before anything is typed into it. A terminal whose
# agent exited (or that herdr-core gave a fresh shell after losing its program) is still live: a message pasted there
# runs as a shell command. Only "agent" may be typed into. The same rule is core/send.js inFront().
RUNTIMES = {"node", "bun", "deno"}  # a CLI run as a script shows its runtime's name


def front(k):
    """What is in front in terminal k (its hc get): "agent", "shell" (its agent exited: a plain shell), "other" (another
    program than its agent, an editor say) or "gone" (no such terminal, or finished)."""
    if not k or k.get("state") != "live":
        return "gone"
    fg = k.get("foreground") or {}
    name = prog_name(fg.get("name"))
    if not name:
        # not told (an older hc's record): hc ls's own word for its program, else as before (core/send.js: null)
        return "shell" if os.path.basename(str(k.get("agent") or "")) in SHELLS else "agent"
    if name in SHELLS:
        return "agent" if runs_command(fg.get("argv")) else "shell"
    kind = (k.get("labels") or {}).get("herdr.agent")
    if kind in ("claude", "codex") and not name.startswith(kind) and name not in RUNTIMES and not name[:1].isdigit():
        return "other"
    return "agent"


def runs_command(argv):
    """A shell's argv that runs a command (-c, -ic, -lic, --command), not a plain shell."""
    for a in (argv or [])[1:]:
        if a == "--command" or a.startswith("--command="):
            return True
        if not a.startswith("-") or a.startswith("--"):
            break
        if "c" in a[1:]:
            return True
    return False


def mid_turn_agents(records, look=None):
    """Those of these hc records (hc ls is enough) mid-turn: working or asking, their agent still
    there. #1022: an agent that died mid-turn (crashed, killed) leaves its plain shell, and hc keeps
    the status it last reported ("working" for good, its ls even naming the dead agent), holding its
    task in Working. So a record that says mid-turn is read in full (look: hc get) for what is in
    front: a plain shell is no agent; fish running its agent (#780) still is."""
    out = []
    for k in records:
        if status_word(k) not in ("working", "blocked"):
            continue
        full = k if (k.get("foreground") or {}).get("name") else (look or detail)(k)
        if (full.get("foreground") or {}).get("name") and not agent_running(full):
            continue
        out.append(full)
    return out


def status_of(task, live):
    """A task's status now: its stored state, or for running tasks the most urgent agent status
    (blocked > done > working > idle), or "stopped" when no agent is left."""
    if task["state"] not in ("running", "ready"):
        return task["state"]
    best = None
    for k in live:
        st = k.get("status")
        st = st.get("state") if isinstance(st, dict) else st
        st = st if st in RANK else "idle"
        if best is None or RANK[st] > RANK[best]:
            best = st
    if task["state"] == "ready":
        return "ready"
    return best or "stopped"


# What people see a task as: one of eight, derived, never stored. From the task's record (todo,
# scheduled (SHEP-38: starts by itself at a time), queued, ready, done, attention, a merge asked for or waiting on checks) and its agents' own
# Herdr status (working, blocked, idle/done), which agents report as always.
IN_QUEUE_LINE = "In GitHub's merge queue"
APPROVAL_LINE = "Merges once it's approved"
STATUSES = {"todo": "To do", "scheduled": "Scheduled", "queued": "Queued", "working": "Working", "needs": "Needs you",
            "ready": "Ready", "merging": "Merging", "done": "Done"}


def task_status(task, live):
    """(status, needs, why): a STATUSES key; for Needs you what kind ("attention", "asks",
    "reply", "stopped") and a one-line reason. live = its running agents (hc records)."""
    st = task["state"]
    if st == "scheduled":
        from .when import starts_words
        return "scheduled", None, starts_words(task.get("scheduled_for") or now(), now())
    if st not in ("running", "ready"):
        return (st if st in STATUSES else "todo"), None, None
    # #995: a question or permission waiting on the chat's card counts as asking, whatever the
    # agent's own status says (Codex reads working until its hook returns; Claude Code may too).
    states = ["blocked" if asking(k, task.get("ready_at") if st == "ready" else 0) else status_word(k) for k in live]
    # A problem Herdr just found (SHEP-133): not Needs you before GRACE_MS have passed, while its
    # agent is told and takes it up; until then the task reads as it would without it.
    if task.get("attention") and now() - (task.get("attention_at") or 0) < GRACE_MS:
        return task_status({**task, "attention": None}, live)
    # What Herdr found that stops it (failing checks, a conflict): Needs you, unless its agent is
    # already on it (on_it()); then it is Working, with its agent's own status line.
    if task.get("attention") and not on_it(task, live):
        return "needs", "attention", task["attention"]
    # Stopped (3.2, step 38 and 39): the person's Stop, or its agent crashed, was cut off or hit its plan's limit
    # (stopped_by, kept by `stop` and the tick's stopped_pass). Needs you until its agent takes a new turn (the
    # next message carries on) or it is restarted; nothing restarts it by itself.
    if st == "running" and task.get("stopped_by") and not carried_on(task, live, states):
        return "needs", "stopped", task.get("stopped_why") or STOPPED
    # Its agent reports an error itself (OSC 7501's fifth state).
    if st == "running" and "error" in states and "working" not in states and "blocked" not in states:
        return "needs", "stopped", error_words(live)
    if "blocked" in states:
        return "needs", "asks", REASONS["question"]
    startup = startup_asked(live)
    if startup:
        return "needs", "asks", startup[1]
    # Out of review rounds (ready refused, review_out): its agent was told to end its turn and wait for its
    # Assistant's review-more, so once it's quiet that is the Assistant's at once (#784). #1040: a problem it had
    # been on (a conflict it fixed by merging the base) kept it Working while its status line was fresh, and only
    # the 20-minute stall woke the Assistant. As core/tasks.js place().
    if st == "running" and task.get("review_out") and live and not any(
            status_word(k) == "working" and (k.get("labels") or {}).get("herdr.role") != "reviewer" for k in live):
        return "needs", "reply", OUT_OF_ROUNDS
    if busy_again(task, live):
        return "working", None, WORKING_AGAIN
    if task.get("attention"):
        return "working", None, WORKING_AGAIN if st == "ready" else None
    if st == "ready":
        # Nothing for the person yet (SHEP-175): its merge under way (asked, in GitHub's merge queue, or
        # by itself), or its pull request's checks still running. Working, with what it waits for.
        wait = ready_wait(task, live)
        if wait:
            return "working", None, wait
        # Said ready but not at rest yet (SHEP-148): Working until it is, and only then Ready.
        if live and not_at_rest(task, live):
            return "working", None, None
        return "ready", None, None
    # An agent that hasn't reported yet is starting: working.
    if any(x not in ("idle", "done", "blocked") for x in states):
        return "working", None, None
    # Just started: its terminal still runs the shell that starts the agent, or the agent is idle
    # before its first message lands. Working, until it ends or STARTING_MS pass.
    if starting(task):
        return "working", None, None
    # Quiet without saying ready, but on its own work (SHEP-53): a background shell, Monitor or
    # agent still running, or its fresh status line says it waits on CI or a review: Working, its
    # status line shown, unless its last message asks the person something.
    if live and own_work(task, live):
        return "working", None, None
    # Just gone quiet (SHEP-133): still Working for GRACE_MS, as its agent often ends a turn a
    # moment before it says ready or takes up the next thing on its own.
    if live and settling(live):
        return "working", None, None
    # Quiet without saying ready: alive, it ended its turn (view() says on what: its question or
    # its last sentence); its process gone, the agent stopped.
    if live:
        return "needs", "reply", REASONS["reply"]
    return "needs", "stopped", STOPPED


STOPPED = "Agent stopped"
GONE = "Its agent is no longer running."
BY_YOU = "Stopped by you."
NOT_TRUSTED = "You didn't trust its folder, so it didn't start."


def carried_on(task, live, states=None):
    """A stopped task's agent took up work again: after the person's Stop, a new turn (its agents' turns
    as the stop kept them, stopped_turns: as ready_turns) or a question; after an error or a limit, an
    agent at work (the tick looks at the rest: its log no longer ending on what cut it off)."""
    states = states if states is not None else ["blocked" if asking(k) else status_word(k) for k in live]
    if task.get("stopped_by") != "you":
        return "working" in states
    seen = task.get("stopped_turns") or {}
    for k in live:
        if (k.get("labels") or {}).get("herdr.role") == "reviewer":
            continue
        turn, was = k.get("turn") or 0, seen.get(k.get("address"))
        if was is None:
            if status_word(k) in ("working", "blocked"):
                return True
        elif turn > was or (turn >= was and status_word(k) in ("working", "blocked")):
            return True
    return False


def error_words(live):
    """What an agent that reports an error says of it, in one line."""
    for k in live:
        st = k.get("status")
        if isinstance(st, dict) and st.get("state") == "error":
            return fit(" ".join(str(st.get("msg") or "").split()), 200) or "Its agent reported an error."
    return "Its agent reported an error."


def stopped_facts(task, status, needs, why):
    """{stopped_by, stopped_why} as every list of tasks carries them (3.2): who or what stopped a task that now
    needs a restart or the person's next message, in one plain line; {} when it isn't stopped."""
    if status != "needs" or needs != "stopped":
        return {}
    by = task.get("stopped_by") if task.get("stopped_by") in ("you", "error", "limit") else "error"
    return {"stopped_by": by, "stopped_why": task.get("stopped_why") or (GONE if why == STOPPED else why) or GONE}


def clear_stopped(task):
    """A message to it, a resume or a restart: no longer stopped. Returns whether it was."""
    had = [task.pop(k, None) for k in ("stopped_by", "stopped_why", "stopped_at", "stopped_turns", "retry")]
    return any(x is not None for x in had)


OUT_OF_ROUNDS = "Out of review rounds"


# ---- Ready only when the person must act (SHEP-175) ----------------------------------------------
# A task said ready is Ready (and its news and alerts) only once the person's Accept is what's
# left: not while its pull request's checks still run or GitHub works out whether it can merge
# (pr["wait"], kept by the tick), nor while it merges by itself. Then it is Working, its row saying
# in small words what it waits for. As core/tasks.js readyWait().
MERGING, MERGES_ITSELF = "Merging", "Merges once its checks pass"


def ready_wait(task, live):
    """What a Ready task waits on that needs nobody, in a few words; None when it's the person's."""
    if task.get("merge_requested") and live:
        return MERGING
    if task.get("merge_queued") and task.get("pr"):
        return IN_QUEUE_LINE
    if task.get("auto_merge") and task.get("pr") and not task.get("merged"):
        # #743: waits calmly for a review GitHub requires
        # merge "on its own": it waits on no check its base doesn't require: Merging
        return APPROVAL_LINE if task["pr"].get("needs_approval") else MERGING if task["auto_merge"] == "auto" else MERGES_ITSELF
    return (task.get("pr") or {}).get("wait") or None


# ---- a short grace before Needs you (SHEP-133) ------------------------------------------------
# A task flips to Needs you for a few seconds and moves on by itself: its agent ends a turn a
# moment before it runs herdr-task ready or status, a background job's notice wakes it, a problem
# is found just before its agent is handed it. So a quiet agent (Needs you: reply) and a problem
# Herdr found (attention) need the person only once they've lasted GRACE_MS: the agent's own
# status change (hc's status_ms) or the problem's attention_at says since when. What really asks
# (a question tool, a permission: blocked) needs the person at once. As core/tasks.js GRACE_MS.
GRACE_MS = 20_000


def quiet_since(live):
    """When its agents last changed status (ms; hc's status_ms), or 0 when none says."""
    return max([k.get("status_ms") or 0 for k in live if isinstance(k.get("status_ms"), (int, float))] or [0])


def settling(live):
    """Its agents went quiet under GRACE_MS ago."""
    since = quiet_since(live)
    return bool(since) and now() - since < GRACE_MS


# ---- a Ready task back at work ----------------------------------------------------------------
# A Ready task whose agent takes up work again (a message in its chat from anyone, herdr-task fix
# or resume) is Working again until its next ready (as core/tasks.js busyAgain()). Herdr counts
# an agent's finished turns (hc's "turn"): ready keeps, per agent, the turn it is on once the one
# it said ready in has ended (ready_turns); working on that turn or a later one is new work.
WORKING_AGAIN = "Working again"


def ready_turns(live):
    """At ready: {address: the first turn that is new work} for its agents now."""
    return {k["address"]: (k.get("turn") or 0) + (1 if status_word(k) == "working" else 0)
            for k in live if k.get("address")}


def busy_again(task, live):
    """A Ready task whose agent is at work again since it said ready, on a message someone sent it
    (prompted()). Not while it merges as asked (the merge is its work), nor a reviewer's turn. A ready
    said before turns were kept: any work once STARTING_MS have passed."""
    if task["state"] != "ready" or task.get("merge_requested"):
        return False
    seen = task.get("ready_turns")
    if seen is None and now() - (task.get("ready_at") or 0) < STARTING_MS:
        return False
    return any(status_word(k) == "working" and (k.get("labels") or {}).get("herdr.role") != "reviewer"
               and (k.get("turn") or 0) >= (seen or {}).get(k.get("address"), 0) and prompted(task, k) for k in live)


def unasked_turn(task, k):
    """#1082: a Ready task's agent at work on a turn of its own, nobody's message behind it (a compaction, a
    toast, a background job's notice): no new work yet. Judged once it ends by what it left (tick's back_pass)."""
    seen = task.get("ready_turns")
    return task["state"] == "ready" and isinstance(seen, dict) and k.get("address") in seen \
        and status_word(k) == "working" and (k.get("turn") or 0) >= seen[k["address"]] and not prompted(task, k)


# Lines in its log that are no one's message: Claude Code's own (a compaction's summary, a command's output),
# a background job's notice.
NOT_A_PROMPT = re.compile(r"^\s*<(task-notification|local-command-\w+|command-name|system-reminder)\b")


def prompted(task, k):
    """Someone wrote to this agent since its task said ready (its session log): the person, its Assistant,
    news, a fix. True when its log can't be read (as before #1082)."""
    log = agent_log(task, k.get("address"))
    rows = log_tail(log, 131072) if log else None
    if not rows:
        return True
    since = task.get("ready_at") or 0
    for d in reversed(rows):
        when = _ms(d.get("timestamp")) if d.get("timestamp") else None
        if when is not None and when < since:
            return False
        if d.get("isCompactSummary") or d.get("isMeta") or d.get("isVisibleInTranscriptOnly"):
            continue
        words = from_person(d)
        if words and not NOT_A_PROMPT.match(words):
            return True
    return False


# ---- Ready only at rest (SHEP-148) --------------------------------------------------------------
# An agent often says ready and carries on in the same turn (a last check, its final message), or
# leaves its own work running: a background shell, a Monitor, a subagent, a helper of its own. That
# is no Ready yet: the person would be told to accept work that is still moving. Working until its
# agents are at rest, then Ready (and its news). A later turn is busy_again()'s.


def not_at_rest(task, live):
    """A Ready task's agent still at it: at work in the turn it said ready in, or its own work
    still running (own_work(), its hard signs only: no status line, a question asked doesn't end it)."""
    if any(status_word(k) == "working" and (k.get("labels") or {}).get("herdr.role") != "reviewer" and not unasked_turn(task, k)
           for k in live):
        return True
    return own_work(task, live, ready=True)


# ---- someone is on what needs the person -------------------------------------------------------
# A task's attention (failing checks, a conflict, a failed merge) needs the person only while
# nobody is on it (SHEP-8). On it: one of its agents is at work (working, or asking: then the
# question shows), it was just handed the problem (herdr-task fix, GitHub news: handed_at) and is
# starting, or its agent said what it's doing (herdr-task status) since the problem came up and
# that is still fresh: an agent that set its line and waits on CI in the background is idle to
# Herdr. Nobody on it and the problem still there: Needs you. As core/tasks.js onIt().
ON_IT_MS = 30 * 60000  # how long an agent's own status line counts, or its own time left if longer


def on_it(task, live):
    """live: its running agents (hc records). Cheap: the task's record and their status only."""
    if any(status_word(k) in ("working", "blocked") and (k.get("labels") or {}).get("herdr.role") != "reviewer"
           for k in live):
        return True
    if now() - (task.get("handed_at") or 0) < STARTING_MS:
        return True
    p = task.get("progress") or {}
    said = p.get("set") or 0
    if p.get("by") or not live or not said or said < (task.get("attention_at") or 0):
        return False
    left = p.get("left") if isinstance(p.get("left"), (int, float)) else 0
    return now() - said < max(ON_IT_MS, left)


def status_word(k):
    x = k.get("status")
    return x.get("state") if isinstance(x, dict) else x


# A Needs-you reason or an agent's status line: at most this many characters (as Shepherdr's
# STATUS_MAX), never the agent's message pasted, never a model's words.
LINE_MAX = 40
# What a task row shows uncut on a regular phone (360 px wide, SHEP-370: 231 px for the title at 16px Inter,
# about 7.7 px a letter): a task's title and the status line agents are asked for are at most this long. Only asked,
# never enforced: a longer status is cut at LINE_MAX.
ROW_MAX = 30
# A ready summary: at most this many characters of plain words on what the person now sees or can
# do (as Shepherdr's SUMMARY_MAX); the rest goes in --details or the proof.
SUMMARY_MAX = 160
REASONS = {"plan": "Plan to approve", "permission": "Asks permission", "question": "Question for you",
           "reply": "Waits for your reply", "signed_out": "Signed out", "trust": "Asks to trust this folder"}

# These startup prompts are visible before the agent reports a status.
CLAUDE_TRUST = re.compile(r"Quick safety check|Do you trust the files in this folder|Yes, I trust this folder", re.I)
CODEX_TRUST = re.compile(r"Do you trust the contents of this directory|allow Codex to work in this folder", re.I)
_startup_seen = {}


def startup_reason(cli, screen):
    words = " ".join(screen.split())
    if (CODEX_TRUST if cli == "codex" else CLAUDE_TRUST).search(words):
        return REASONS["trust"]
    if cli == "codex" and re.search(r"^\s*Hooks need review\s*$", screen, re.M) and "Review hooks" in words:
        return "Hooks need review"
    if cli == "codex" and "Choose how you want to use Codex" in words and "Sign in with ChatGPT" in words:
        return "Codex needs you to sign in"
    if cli == "claude" and re.search(r"select (?:a )?login method", words, re.I) and ("Claude account" in words or "Anthropic Console" in words):
        return "Claude Code needs you to sign in"
    return None


def startup_asked(live):
    """An agent's address and startup prompt, if it hasn't reported status or taken a turn.
    Read its screen at most every 5 seconds."""
    from .base import run
    for k in live:
        cli = (k.get("labels") or {}).get("herdr.agent", "claude")
        if status_word(k) or k.get("turn") or cli not in ("claude", "codex"):
            continue
        address = k.get("address")
        seen = _startup_seen.get(address)
        if not seen or now() - seen[0] > 5000:
            screen = run(["hc", "read", address]).stdout or ""
            seen = _startup_seen[address] = (now(), startup_reason(cli, screen))
        if seen[1]:
            return address, seen[1]
    return None


def fit(text, n=LINE_MAX):
    """One line of at most n characters, cut at a word ("…" at the end) when longer."""
    text = " ".join(str(text or "").split())
    if len(text) <= n:
        return text
    cut = text[:n - 1]
    if " " in cut and text[n - 1] != " ":
        cut = cut[:cut.rindex(" ")]
    return cut.rstrip(" ,;:.-") + "…"


def log_lines(log, size=262144):
    """The last lines of an agent's session log, as text; [] when it can't be read. A first line
    cut in half is left out."""
    if not log:
        return []
    try:
        with open(log, "rb") as f:
            f.seek(0, 2)
            at = max(0, f.tell() - size)
            f.seek(at)
            lines = f.read().decode("utf-8", "replace").split("\n")
    except OSError:
        return []
    return lines[1:] if at else lines


def log_tail(log, size=262144):
    """The last lines of an agent's session log (Claude Code's or Codex's JSONL), parsed; [] when
    it can't be read. A first line cut in half is left out."""
    out = []
    for raw in log_lines(log, size):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def agent_log(task, address=None):
    a = [x for x in task.get("agents") or [] if x.get("log") and (address is None or x.get("address") == address)]
    return a[-1]["log"] if a else None


def said(d):
    """An assistant line's words (Claude Code's, or Codex's response item), or None for anything else."""
    msg = d.get("message") if d.get("type") == "assistant" and not d.get("isSidechain") and not d.get("isApiErrorMessage") else None
    if d.get("type") == "response_item" and (d.get("payload") or {}).get("role") == "assistant":
        msg = d["payload"]
    if msg is None:
        return None
    parts = [c.get("text") for c in msg.get("content") or [] if isinstance(c, dict) and c.get("type") in ("text", "output_text")]
    return "\n".join(x for x in parts if x).strip()


def claude_user_words(d):
    """Text carried by a Claude Code user record, including background task notices."""
    if d.get("type") == "user" and not d.get("isSidechain"):
        c = (d.get("message") or {}).get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list) and not any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
            return "\n".join(x.get("text") or "" for x in c if isinstance(x, dict) and x.get("type") == "text")


def from_person(d):
    """A line that is someone writing to the agent: its words, else None."""
    if d.get("type") == "event_msg" and (d.get("payload") or {}).get("type") == "user_message":
        return str(d["payload"].get("message") or "")
    words = claude_user_words(d)
    origin = d.get("origin")
    if (isinstance(origin, dict) and origin.get("kind") == "task-notification") or (
            words and words.lstrip().startswith("<task-notification>")):
        return None
    return words


SHORT_ASK = 25
# Herdr's chat tags in an agent's words (mods/chat/log.js): reactions and <hc no-reply/>, a message
# from another terminal, task and GitHub news, <no-reply>. None of it is the agent speaking.
CHAT_TAGS = re.compile(r"<(hc|herdr-news|herdr-github)\b[^>]*>[\s\S]*?</\1\s*>|<hc\b[^>]*/>|</?no-reply\b[^>]*>|<hc\b[^\n]*")


def spoken(text):
    """An agent's words without Herdr's chat tags: "" when nothing else is left."""
    return CHAT_TAGS.sub("", str(text or "")).strip()


def asking_sentence(text):
    """The last sentence of a message that asks (ends in "?"), or "" when it asks without one. A
    short one ("Go?", "Shall I?") says nothing alone: the sentence before it makes it a question
    ("I'll take the window 30s to test the menu. Go?" -> "I'll take the window 30s to test the menu?")."""
    lines = [x.strip(" *_`>-#") for x in text.split("\n") if x.strip(" *_`>-#")]
    sentences = [x.strip(" *_`") for ln in lines for x in re.split(r"(?<=[.!?:])\s+", ln) if x.strip(" *_`")]
    for i in range(len(sentences) - 1, -1, -1):
        ask = sentences[i]
        if not ask.rstrip(" *_`\"')]").endswith("?"):
            continue
        before = sentences[i - 1] if i else ""
        if len(ask) >= SHORT_ASK or not before:
            return ask
        if len(f"{before} {ask}") <= LINE_MAX:
            return f"{before} {ask}"
        before = before.rstrip(" .:;!,")
        return before + "?" if len(before) < LINE_MAX else fit(before, LINE_MAX - 1).rstrip("…") + "…?"
    return ""


def last_question(task, address=None):
    """Why an agent that ended its turn without saying ready waits: the question its last message
    asks, cut to LINE_MAX (Shepherdr: a "?" anywhere in its last words), "Waits for your reply" when
    no sentence can be told, or None when it didn't ask. Only the log's tail is read."""
    for d in reversed(log_tail(agent_log(task, address), 65536)):
        if from_person(d) is not None:
            return None  # the person wrote after it: no open question
        text = spoken(said(d))
        if not text:
            continue
        if not re.search(r"\?(?=[\s*_`\"')\]]|$)", text):
            return None
        q = asking_sentence(text)
        return fit(q) if q else REASONS["reply"]
    return None


def turn_began(task, address=None):
    """When its agent's current turn began: the last time someone wrote to it (its log's
    timestamp, ms), or None when its log doesn't say."""
    for d in reversed(log_tail(agent_log(task, address), 131072)):
        if from_person(d) is not None:
            try:
                return int(datetime.datetime.fromisoformat(str(d.get("timestamp")).replace("Z", "+00:00")).timestamp() * 1000)
            except ValueError:
                return None
    return None


def own_line(task, address=None):
    """The agent's own words for why it waits: its latest status line (herdr-task status), when it
    set one since its turn began. Agents set it before they ask or stop to wait; what Herdr
    works out (its question, its last sentence) is only for when it didn't."""
    p = task.get("progress") or {}
    # Herdr's own words ("Working again": back_to_work()) are never the agent's reason (SHEP-133).
    if not p.get("text") or p.get("by"):
        return None
    began = turn_began(task, address)
    if began and (p.get("set") or p.get("at") or 0) < began:
        return None
    text = fit(p["text"])
    return text[:1].upper() + text[1:]


def last_words(task, address=None):
    """Why an agent that ended its turn without saying ready waits: the question its last message
    asks, else that message's last sentence, cut to LINE_MAX at a word ("Waiting for your go on
    the screenshot…"), else "Waits for your reply" (nothing said since the person last wrote)."""
    for d in reversed(log_tail(agent_log(task, address), 65536)):
        if from_person(d) is not None:
            break
        text = spoken(said(d))
        if not text:
            continue
        q = last_question(task, address)
        if q:
            return q
        text = re.sub(r"```.*?(```|$)", "", text, flags=re.S)
        lines = [x.strip(" *_`>-#|") for x in text.split("\n") if x.strip(" *_`>-#|")]
        for ln in reversed(lines):
            parts = [x.strip(" *_`") for x in re.split(r"(?<=[.!?])\s+", ln) if x.strip(" *_`")]
            if parts:
                return fit(parts[-1])
        break
    return REASONS["reply"]


def permission_words(tool, value, cwd=None):
    """What a permission is for, as the chat's card says it (mods/chat/asks.js words()): "Run:
    npm test", "Edit mods/chat/main.js", "Fetch github.com"; None for a tool it can't name."""
    def rel(f):
        f = str(f or "")
        r = f[len(cwd) + 1:] if cwd and f.startswith(cwd + "/") else "~" + f[len(HOME):] if f.startswith(HOME + "/") else f
        return r if len(r) <= 32 else os.path.basename(f)
    first = lambda x: str(x or "").split("\n")[0]
    if tool == "Bash" or (tool in ("shell", "exec_command", "local_shell") and value.get("command")):
        cmd = value.get("command") or value.get("cmd")
        return f"Run: {first(' '.join(cmd) if isinstance(cmd, list) else cmd)}" if cmd else None
    if tool in ("Write", "Read"):
        return f"{tool} {rel(value.get('file_path'))}" if value.get("file_path") else None
    if tool in ("Edit", "MultiEdit", "NotebookEdit"):
        f = value.get("file_path") or value.get("notebook_path")
        return f"Edit {rel(f)}" if f else None
    if tool in ("Glob", "Grep") and value.get("pattern"):
        return f"Search for {value['pattern']}"
    if tool == "WebFetch" and value.get("url"):
        return f"Fetch {re.sub(r'^[a-z]+://', '', str(value['url'])).split('/')[0]}"
    if tool == "WebSearch" and value.get("query"):
        return f"Search the web: {value['query']}"
    m = re.match(r"^mcp__(.+?)__(.+)$", str(tool or ""))
    return f"Use {m.group(1)}: {m.group(2)}" if m else (f"Use {tool}" if tool else None)


def ask_reason(task, address, req=None, kind=None, msg=None):
    """Why a blocked agent waits, in at most LINE_MAX characters: signed out when its own report
    says so (OSC 7501 kind auth); else from the ask Herdr's hook holds (req: Claude's
    PermissionRequest), else the tool call its log left open: a plan, its question tool (the
    question itself, cut to fit), any other tool (what the permission is for: "Run: npm test");
    else what its report says (msg: Claude's "approve Bash: npm test")."""
    if kind == "auth":
        return REASONS["signed_out"]
    tool, value = None, {}
    if isinstance(req, dict):
        tool, value = req.get("tool_name"), req.get("tool_input") if isinstance(req.get("tool_input"), dict) else {}
    if not tool:
        done, pending = set(), None
        for d in log_tail(agent_log(task, address), 131072):
            c = (d.get("message") or {}).get("content") if d.get("type") in ("assistant", "user") and not d.get("isSidechain") else None
            for x in c if isinstance(c, list) else []:
                if isinstance(x, dict) and x.get("type") == "tool_result":
                    done.add(x.get("tool_use_id"))
                elif isinstance(x, dict) and x.get("type") == "tool_use":
                    pending = x
            p = d.get("payload") or {}
            if d.get("type") == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
                try:
                    args = json.loads(p.get("arguments") or "{}")
                except (TypeError, ValueError):
                    args = {}
                pending = {"id": p.get("call_id"), "name": p.get("name"), "input": args if isinstance(args, dict) else {}}
            elif d.get("type") == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
                done.add(p.get("call_id"))
        if pending and pending.get("id") not in done:
            tool, value = pending.get("name"), pending.get("input") if isinstance(pending.get("input"), dict) else {}
    if tool == "ExitPlanMode":
        return REASONS["plan"]
    if tool in ("AskUserQuestion", "request_user_input"):
        qs = value.get("questions") if isinstance(value.get("questions"), list) else []
        q = qs[0].get("question") if qs and isinstance(qs[0], dict) else None
        return fit(q) if q else REASONS["question"]
    if tool:
        words = permission_words(tool, value, req.get("cwd") if isinstance(req, dict) else (task.get("worktree") or task.get("folder")))
        return fit(words) if words else REASONS["permission"]
    if kind == "permission":
        m = re.match(r"^approve\s+(\S+?):\s*(.+)$", str(msg or "").strip(), re.I)
        if m:
            return fit({"Bash": "Run: ", "WebFetch": "Fetch "}.get(m.group(1), m.group(1) + " ") + m.group(2))
        return REASONS["permission"]
    return last_question(task, address) or REASONS["question"]


# ask-hook.sh holds an ask at most 30 minutes (its loop, the hooks' timeout): a request file older
# than that was left by a hook that was killed, and holds nothing.
HELD_MAX_MS = 31 * 60_000


HELD_SETTLE_MS = 3000  # the agent's log written this long after the ask: it went on without an answer


def _hook_alive(name):
    """Whether the hook that left request <terminal>.<time>.<pid>.json still runs (as the chat's
    readAsks() tells): one killed (its call cancelled, its turn interrupted) holds nothing."""
    try:
        os.kill(int(name[:-5].rsplit(".", 1)[1]), 0)
    except (ValueError, IndexError):
        return True  # a name without a pid: can't tell
    except ProcessLookupError:
        return False
    except OSError:
        return True  # alive under another user
    return True


def moved_on(req, at):
    """#1077 #1097 #1139: the agent went on past the ask its hook made at `at` (ms), the hook still waiting
    (its log: the request's transcript_path). Codex: its turn ended (task_complete, turn_aborted), or its
    model answered again after a sampling that ended past the ask (token_count), which it can't while a
    call waits. Claude: the call asked about has its result, or a newer message of the model follows it."""
    log = req.get("transcript_path") if isinstance(req, dict) else None
    if not log:
        return False
    rows = log_tail(log, 262144)
    sampled, use, msg, past = False, None, None, False
    for d in rows:
        p = d.get("payload") or {}
        if d.get("type") in ("event_msg", "response_item"):
            when = _ms(d.get("timestamp")) if d.get("timestamp") else None
            if when is None or when < at + HELD_SETTLE_MS:
                continue
            if d["type"] == "event_msg" and p.get("type") in ("task_complete", "turn_aborted"):
                return True
            if d["type"] == "event_msg" and p.get("type") == "token_count":
                sampled = True
            elif sampled and p.get("type") in ("function_call", "custom_tool_call", "message") and p.get("role", "assistant") == "assistant":
                return True
            continue
        if d.get("isSidechain") or d.get("type") not in ("assistant", "user"):
            continue
        m = d.get("message") or {}
        c = m.get("content")
        blocks = [x for x in c if isinstance(x, dict)] if isinstance(c, list) else []
        same = [x for x in blocks if x.get("type") == "tool_use" and x.get("name") == req.get("tool_name") and x.get("input") == req.get("tool_input")]
        if same:  # the call asked about (its latest: a call tried again after a cancel is asked anew)
            use, msg, past = same[-1].get("id"), m.get("id"), False
            continue
        if use and d["type"] == "assistant" and m.get("id") and m.get("id") != msg:
            past = True
        if use and any(x.get("type") == "tool_result" and x.get("tool_use_id") == use for x in blocks):
            past = True
    return past


def held_ask(address):
    """The ask Herdr's chat hook holds for this terminal (mods/chat/ask-hook.sh), or None: none once its
    hook is gone or its agent went on without an answer (a cancelled call: #1077 #1097 #1139 #1140 #1144)."""
    return _held(address)[0]


def _held(address):
    """held_ask()'s request and when it was made (ms), or (None, None)."""
    d = os.path.join(HOME, ".config", "herdr-app", "data", "chat-asks", "req")
    try:
        names = sorted(n for n in os.listdir(d) if n.startswith(address + ".") and n.endswith(".json"))
    except OSError:
        return None, None
    for n in reversed(names):
        try:
            p = os.path.join(d, n)
            at = os.path.getmtime(p) * 1000
            if now() - at > HELD_MAX_MS or not _hook_alive(n):
                continue
            with open(p) as f:
                req = json.load(f)
        except (OSError, ValueError):
            continue
        if not moved_on(req, at):
            return req, at
    return None, None


def asking(k, since=0):
    """Whether a live agent asks the person now: its own status says blocked, or the chat's card
    holds its question or permission (#995: a Codex agent reads working while its hook waits). since (ms): a card
    from before it is stale (#1539: its agent said ready after it, so it went on)."""
    if status_word(k) == "blocked":
        return True
    if not (k.get("address") and held_ask(k["address"])):
        return False
    at = _held(k["address"])[1] if since else None
    return not (at and at < since)


STARTING_MS = 90_000


def starting(task):
    """An agent was started for it under STARTING_MS ago and hasn't ended."""
    last = (task.get("agents") or [None])[-1]
    if last and last.get("ended"):
        return False
    at = max([x for x in (task.get("started"), (last or {}).get("at"), (task.get("review") or {}).get("at")) if isinstance(x, (int, float))] or [0])
    return now() - at < STARTING_MS


# ---- its own work in the background -------------------------------------------------------------
# An agent that ended its turn with its own work still running (SHEP-53) is not waiting on the
# person: Claude Code's background shells, Monitors and background agents (their start has an id,
# a <task-notification> with a status ends it), Codex's background terminals (a process left
# running with a session id, until an output says it exited). Or it said so: its status line, set
# this turn and still fresh, says it waits on CI, a check, a review or a background job ("Waiting on
# review round 1", "Codex reviewing the change"), and no background job of its ended since.
# It asks the person something (a question tool or permission: blocked): Needs you all the same; a
# plain question in its last message only once nothing of its own runs (SHEP-148). As core/tasks.js place() with task.own_work, which news_pass keeps.
BG_LOG_BYTES = 64 * 1048576  # a first look at a log reads at most this much of its end
# A tool call (Claude Code's log line, compact JSON) and its result; one open longer than FG_MAX_MS
# (a foreground command times out at 10 minutes) no longer counts as running.
TOOL_USE = re.compile(r'"type":\s*"tool_use",\s*"id":\s*"([^"]+)",\s*"name":\s*"([^"]+)"')
TOOL_DONE = re.compile(r'"tool_use_id":\s*"([^"]+)"')
TIMESTAMP = re.compile(r'"timestamp":\s*"([^"]+)"')
SIDECHAIN = re.compile(r'"isSidechain":\s*true')
FG_MAX_MS = 15 * 60000
# Only lines with one of these are parsed: a log's screenshots are megabytes of lines that aren't.
BG_HINTS = ("<task-notification>", "task_id", "backgroundTaskId", "timeoutMs", "isAsync", "in background with ID",
            "Monitor started", "Async agent launched", "session_id", "session ID",
            # Codex (SHEP-207): a poll's result without its session id, a wait on a code-mode cell
            "exit_code", "Process exited", "cell_id", "cell ID", "exec_command", "Unknown process id",
            # Codex 0.163+: its own word that a command ended (#1093)
            '"item_completed"')
BG_MAX_MS = 3 * 3600_000  # a background job started longer ago than this no longer counts
BG_STARTED = re.compile(r"Command running in background with ID: (\w+)|Monitor started \(task (\w+)|Async agent launched[\s\S]*?agentId: (\w+)")
BG_ENDED = re.compile(r"<task-id>(\w+)</task-id>(?:(?!</task-notification>)[\s\S])*?<status>(\w+)</status>")
# #1270: a Monitor's expiry notice has no <status>, only its event "[Monitor expired after 15m ...]"
BG_EXPIRED = re.compile(r"<task-id>(\w+)</task-id>(?:(?!</task-notification>)[\s\S])*?\[Monitor expired\b")
CODEX_RUNNING = re.compile(r"Process running with session ID (\d+)")
CODEX_GONE = re.compile(r"Unknown process id:? (\d+)", re.I)
# Codex 0.163+ code mode (SHEP-207): a script starts commands and polls them with tools.exec_command /
# tools.write_stdin, all inside one exec call. Its output says "Script running with cell ID N" while
# it waits, and a wait call names that cell; the script's results come as one JSON array, in the order
# its calls were made, and a poll's result drops its session_id once the command has exited.
CODEX_CELL = re.compile(r"Script running with cell ID (\d+)")
CODEX_CELL_ARG = re.compile(r'"cell_id"\s*:\s*"?(\d+)')
CODEX_SESSION_ARG = re.compile(r"session_id[\"']?\s*:\s*[\"']?(\d+)[\"']?\s*(?=[,}])")
CODEX_HOST = "codex-code-mode-host"  # Codex's code-mode process: no job of its own
WAITS_ON = re.compile(r"\b(wait\w*|watch\w*|polling)\b.*\b(ci|checks?|reviews?|reviewer|build|tests?|background|jobs?|deploy\w*|"
                      r"release|github|pipeline|actions?|run|workflow)\b|\breviewing\b", re.I)
WAITS_ON_PERSON = re.compile(r"\b(you|your|yours|person|human|answer|reply|approv\w*|decid\w*|decision|confirm\w*|ok|okay|"
                             r"input|accept\w*|sign(?:ed)?[- ]?in|login|a go|go-ahead)\b", re.I)
# The same in other languages (#1259: a Chinese "等待 GitHub 檢查" read as Needs you): a word for
# waiting and one for what it waits on, in either order (Japanese and Korean put the wait last). CJK
# has no spaces, so the ASCII names (CI, GitHub) are bounded by letters, not \b.
_ASCII_ON = (r"(?<![a-z])(ci|github|checks?|reviews?|build|tests?|pipeline|actions?|workflows?|deploy\w*|pr)(?![a-z])")
WAITS_ON_ANY = re.compile(
    # zh, ja, ko
    r"(等待|等候|稍候|等著|等着|監看|监看|監控|监控|輪詢|轮询|待ち|待機|待って|監視|대기|기다리|기다림|"
    # es, pt, fr, it, de, nl, ru, pl, tr
    r"\b(?:esper\w*|aguard\w*|attend\w*|attente|aspett\w*|attesa|wart\w*|warte|wacht\w*|"
    r"жд\w*|ожида\w*|czek\w*|oczek\w*|bekl\w*)\b)", re.I)
WAITS_ON_WHAT = re.compile(
    _ASCII_ON + r"|檢查|检查|審查|审查|測試|测试|建置|構建|构建|部署|發佈|发布|流水線|流水线|工作流|"
    r"チェック|レビュー|テスト|ビルド|デプロイ|검사|체크|리뷰|테스트|빌드|배포|"
    r"\b(?:prueba\w*|revisi\w*|compila\w*|despliegue|verifica\w*|teste\w*|v[ée]rification\w*|revue|"
    r"d[ée]ploiement|controll\w*|prüf\w*|überprüf\w*|проверк\w*|тест\w*|сборк\w*|ревью|"
    r"sprawdz\w*|kontrol\w*|testy)\b", re.I)
WAITS_ON_PERSON_ANY = re.compile(
    r"你|您|本人|批准|核准|同意|決定|决定|回覆|回复|答覆|答复|あなた|承認|返事|返信|判断|당신|승인|답변|결정|"
    r"\b(?:t[uú]|usted\w*|vous|votre|dein\w*|ihr\w*|deine|вас|ваш\w*|тво\w*|ты|aprob\w*|aprova\w*|approv\w*|"
    r"confirm\w*|bestätig\w*|freigabe|подтвержд\w*|одобр\w*|decis\w*|décision|entscheid\w*|решени\w*|"
    r"respuesta|resposta|réponse|antwort\w*|ответ\w*)\b", re.I)
_bg_cache = {}


def says_it_waits(text):
    """Its words say it waits on CI, a check, a review or a job of its own, not on the person, in English or
    another language (#1259)."""
    if WAITS_ON_PERSON.search(text) or WAITS_ON_PERSON_ANY.search(text):
        return False
    return bool(WAITS_ON.search(text)) or bool(WAITS_ON_ANY.search(text) and WAITS_ON_WHAT.search(text))


def _ms(stamp):
    try:
        return int(datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def _text(x):
    """A tool result's or output's words, whatever its shape."""
    if isinstance(x, str):
        return x
    if isinstance(x, list):
        return "\n".join(_text(y) for y in x)
    if isinstance(x, dict):
        return _text(x.get("text") if "text" in x else x.get("content"))
    return ""


def background_jobs(log):
    """(running, last_ended): its agent's background jobs still running by its session log ({id:
    started ms}), and when the last one ended (ms, or 0). Read as the log grows: only what was
    added since the last look, so a job started before megabytes of screenshots still counts
    (SHEP-133: a 1 MB tail lost it, and its quiet agent read Needs you)."""
    try:
        st = os.stat(log)
    except (OSError, TypeError):
        return {}, 0
    c = _bg_cache.get(log)
    if not c or c["ino"] != st.st_ino or st.st_size < c["offset"]:
        c = {"ino": st.st_ino, "offset": max(0, st.st_size - BG_LOG_BYTES), "running": {}, "ended": 0, "calls": {}, "cells": {}, "cut": True}
        _bg_cache[log] = c
    if st.st_size > c["offset"]:
        try:
            with open(log, "rb") as f:
                f.seek(c["offset"])
                chunk = f.read(st.st_size - c["offset"])
        except OSError:
            chunk = b""
        if c.pop("cut", False) and c["offset"]:
            nl = chunk.find(b"\n")  # a first line cut in half is left out
            c["offset"] += nl + 1 if nl >= 0 else 0
            chunk = chunk[nl + 1:] if nl >= 0 else b""
        end = chunk.rfind(b"\n") + 1  # a last line still being written waits for its end
        c["offset"] += end
        _bg_scan(chunk[:end].decode("utf-8", "replace").split("\n"), c)
    # #1270: a Monitor past its own timeout has ended, its notice or not
    until = c.get("until") or {}
    return {i: t for i, t in c["running"].items() if now() - t < BG_MAX_MS and now() < until.get(i, now() + 1)}, c["ended"]


def open_tool(log):
    """The tool call its agent (Claude Code) has open in its log's main thread, started under
    FG_MAX_MS ago: (name, started ms), or None. A question tool or a plan is no work of its own."""
    background_jobs(log)
    c = _bg_cache.get(log) or {}
    calls = c.get("open") or {}
    for i in [i for i, (_, at) in calls.items() if now() - at >= FG_MAX_MS]:
        calls.pop(i)
    mine = [x for x in calls.values() if x[0] not in ("AskUserQuestion", "ExitPlanMode")]
    return max(mine, key=lambda x: x[1]) if mine else None


def _bg_scan(lines, seen):
    """background_jobs()'s reading of new lines, into seen: {running, calls, ended, open}. Tool
    calls open and done are read off the raw line (an image's result is megabytes of JSON)."""
    running, calls, ended = seen["running"], seen["calls"], seen["ended"]
    cells = seen.setdefault("cells", {})  # Codex code-mode cell id -> the session ids its wait polls
    opened = seen.setdefault("open", {})
    for raw in lines:
        # Claude Code keeps a copy of each request it sends (api-request-blob): every call and
        # result so far again, never news of one.
        if '"api-request' in raw[:200]:
            continue
        if '"tool_use"' in raw and not SIDECHAIN.search(raw):
            stamp = TIMESTAMP.search(raw)
            for m in TOOL_USE.finditer(raw):
                opened[m.group(1)] = (m.group(2), (_ms(stamp.group(1)) if stamp else None) or now())
        if '"tool_use_id"' in raw:
            for m in TOOL_DONE.finditer(raw):
                opened.pop(m.group(1), None)
        if any(h in raw for h in BG_HINTS):
            try:
                d = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            at = _ms(d.get("timestamp")) or now()
            # Claude Code: ended by its notice (in the queue, an attachment or a user line), or stopped.
            if "<task-notification>" in raw and (d.get("type") in ("queue-operation", "attachment") or claude_user_words(d) is not None):
                for m in [*BG_ENDED.finditer(raw), *BG_EXPIRED.finditer(raw)]:
                    running.pop(m.group(1), None)
                    ended = max(ended, at)
            r = d.get("toolUseResult")
            if isinstance(r, dict) and r.get("task_id") and "stopped" in str(r.get("message") or "").lower():
                running.pop(str(r["task_id"]), None)
                ended = max(ended, at)
            if d.get("type") == "user" and '"tool_result"' in raw and not d.get("isSidechain"):
                ids = []
                if isinstance(r, dict):
                    ids = [r.get("backgroundTaskId") or (r.get("taskId") if r.get("timeoutMs") is not None else None)
                           or (r.get("agentId") if r.get("isAsync") else None)]
                for c in (d.get("message") or {}).get("content") or []:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        m = BG_STARTED.match(_text(c.get("content")).strip())
                        ids += [next(g for g in m.groups() if g)] if m else []
                for i in filter(None, ids):
                    running.setdefault(str(i), at)
                # a Monitor that isn't persistent expires after its timeoutMs (#1270)
                if isinstance(r, dict) and r.get("taskId") and isinstance(r.get("timeoutMs"), (int, float)) \
                        and r["timeoutMs"] > 0 and not r.get("persistent"):
                    seen.setdefault("until", {})[str(r["taskId"])] = at + r["timeoutMs"]
            # Codex: a process left running has a session id until an output says it exited.
            p = d.get("payload") or {}
            # #1093 #1143: Codex says itself when a command ended, whatever polled it (a batch, an id no
            # longer known): its CommandExecution item, completed or failed, with the session's process id
            item = p.get("item") if d.get("type") == "event_msg" and p.get("type") == "item_completed" else None
            if isinstance(item, dict) and item.get("type") == "CommandExecution" and item.get("process_id") is not None \
                    and item.get("status") in ("completed", "failed", "declined"):
                if running.pop("codex:" + str(item["process_id"]), None) is not None:
                    ended = max(ended, at)
                seen.setdefault("done", {})["codex:" + str(item["process_id"])] = at
                continue
            if d.get("type") == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
                calls[p.get("call_id")] = str(p.get("arguments") or p.get("input") or "")
            elif d.get("type") == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
                call = calls.get(p.get("call_id")) or ""
                cell = CODEX_CELL_ARG.search(call)  # a wait on a code-mode cell: the sessions it polls
                polled = cells.get(cell.group(1), []) if cell else _codex_polled(call)
                before = set(running)
                if _codex_output(p.get("output"), polled, cells, running, at, seen.get("done")):
                    ended = max(ended, at)
                if any(k not in before for k in running):  # what each started job runs, for ready to name it (#1093)
                    what, cmds = seen.setdefault("what", {}), _codex_cmds(call)
                    results = _codex_results(p.get("output"))
                    for i, r in enumerate(results if len(results) == len(cmds) else []):
                        if r.get("session_id") is not None and cmds[i] and "codex:" + str(r["session_id"]) not in before:
                            what["codex:" + str(r["session_id"])] = cmds[i]
                    for k in running:
                        if k not in before and k not in what and len([c for c in cmds if c]) == 1:
                            what[k] = next(c for c in cmds if c)  # the legacy call: its one command
    seen["ended"] = ended


def _codex_polled(call):
    """Recognise literal polls and the numeric for-of batch emitted by Codex.

    Keep command slots too: an exec_command result must never end a neighbouring poll.
    Unknown JavaScript stays unresolved; never execute an agent's script to read its log.
    """
    call = _expand_loops(call)
    slots = []
    for m in re.finditer(r"tools\.(exec_command|write_stdin)\s*\(\s*\{([^{}]*)\}", call):
        sid = CODEX_SESSION_ARG.search(m.group(2) + "}") if m.group(1) == "write_stdin" else None
        slots.append(sid.group(1) if sid else None)
    if slots:
        return slots
    try:  # legacy write_stdin takes a JSON argument object
        sid = json.loads(call).get("session_id")
        return [str(sid)] if isinstance(sid, (int, str)) and str(sid).isdigit() else []
    except (ValueError, AttributeError):
        return []


LOOP_HEAD = re.compile(r"for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+\[([\d,\s]+)\]\s*\)\s*\{")


def _expand_loops(call):
    """Each `for (const id of [7, 8]) { … }` written out once per id, whatever its body holds (a try block, one
    results.push(…) call: #1108), its end found by counting braces outside strings. A loop whose end isn't found
    stays as it was."""
    out, i = [], 0
    while True:
        m = LOOP_HEAD.search(call, i)
        if not m:
            return "".join(out) + call[i:]
        depth, j, quote = 1, m.end(), None
        while j < len(call) and depth:
            c = call[j]
            if quote:
                if c == "\\":
                    j += 1
                elif c == quote:
                    quote = None
            elif c in "'\"`":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            j += 1
        if depth:
            return "".join(out) + call[i:]
        body = call[m.end():j - 1]
        name = re.compile(r"session_id\s*:\s*" + re.escape(m.group(1)) + r"\b")
        out.append(call[i:m.start()])
        out.append("\n".join(name.sub("session_id:" + sid.strip(), body) for sid in m.group(2).split(",") if sid.strip()))
        i = j


def _codex_cmds(call):
    """What each tool call in a Codex call runs, in order: an exec_command's cmd string, None for a write_stdin
    (code mode's script); a legacy exec_command's JSON arguments: its one cmd."""
    out = []
    for m in re.finditer(r'tools\.(exec_command|write_stdin)\s*\(', call):
        c = re.match(r'\s*\{\s*"?cmd"?\s*:\s*"((?:[^"\\]|\\.)*)"', call[m.end():]) if m.group(1) == "exec_command" else None
        try:
            out.append(json.loads('"' + c.group(1) + '"') if c else None)
        except ValueError:
            out.append(None)
    if out:
        return out
    try:
        cmd = json.loads(call).get("cmd")
    except (ValueError, AttributeError):
        return []
    return [" ".join(map(str, cmd)) if isinstance(cmd, list) else str(cmd)] if cmd else []


def job_names(log, ids):
    """Each job's words for the agent: what a Codex job runs ("gh pr checks --watch"), else its id."""
    what = (_bg_cache.get(log) or {}).get("what") or {}
    out = []
    for i in ids:
        cmd = " ".join(str(what.get(i) or "").split())
        out.append(f"`{cmd[:60]}{'…' if len(cmd) > 60 else ''}`" if cmd else i.replace("codex:", "Codex session "))
    return out


def own_jobs(task, k):
    """Its agent's background jobs still running ({id: started ms}, as background_jobs()), Codex's only while
    a process of its own runs under it (SHEP-207)."""
    address = k.get("address")
    log = agent_log(task, address) or agent_log(task)
    jobs = background_jobs(log)[0] if log else {}
    if any(i.startswith("codex:") for i in jobs) and not codex_working(k):
        jobs = {i: t for i, t in jobs.items() if not i.startswith("codex:")}
    return jobs, log


def _codex_results(output):
    """Read result envelopes, never JSON or session-id examples inside command stdout."""
    results = []
    blocks = output if isinstance(output, list) else [output]
    def add(value):
        if isinstance(value, list):
            for item in value:
                add(item)
        elif isinstance(value, dict):
            if value.get("status") == "fulfilled":
                add(value.get("value"))
            elif value.get("status") == "rejected":
                results.append({})  # preserves its place in allSettled
            elif "session_id" in value or "exit_code" in value:
                results.append(value)
    for block in blocks:
        text = _text(block)
        try:
            add(json.loads(text))
        except ValueError:
            pass
    return results


def _codex_output(output, polled, cells, running, at, done=None):
    """One Codex output's word on the sessions it covers, applied to running ({"codex:<id>": started
    ms}). polled: the session ids the call that made it polled, in order (a code-mode script's
    calls, or a write_stdin's own). done: sessions Codex said ended ({key: ms}), never counted again by an
    output written just after. Returns True when a session ended."""
    text = _text(output)
    ended = False
    done = done or {}

    def start(key):
        if at - done.get(key, -10**15) > 60000:
            running.setdefault(key, at)
    results = _codex_results(output)
    # Legacy plain-text output only. Structured command stdout is not tool metadata.
    if not results:
        for m in CODEX_RUNNING.finditer(text):
            start("codex:" + m.group(1))
    cell = CODEX_CELL.search(text)
    if cell:
        cells[cell.group(1)] = polled
    for i, d in enumerate(results):
        sid = d.get("session_id")
        if sid is None and len(results) == len(polled):
            sid = polled[i]  # an exited command's poll drops its session id: its place in the script says which
        if sid is None:
            continue
        key = "codex:" + str(sid)
        if d.get("exit_code") is not None:
            ended = running.pop(key, None) is not None or ended
        elif d.get("session_id") is not None:
            start(key)
    # #1143: a poll of a session Codex no longer knows (its process gone): ended, wherever it sits in a batch
    for m in CODEX_GONE.finditer(text):
        ended = running.pop("codex:" + m.group(1), None) is not None or ended
    # a poll of one session whose output says it exited (no session id in it, or the old format's text)
    if len(polled) == 1 and polled[0] is not None and not results and re.search(r"^Process exited with code", text, re.M):
        ended = running.pop("codex:" + str(polled[0]), None) is not None or ended
    return ended


def waits_on_own(task, address=None, ended=0):
    """Its status line, set this turn by the agent itself and still fresh, says it waits on CI, a
    check, a review or a background job, and no background job of its ended since."""
    p = task.get("progress") or {}
    said = p.get("set") or p.get("at") or 0
    # Out of review rounds (ready refused, review_out): it waits on its Assistant's review-more,
    # never on a review of its own, whatever its line says ("waiting for a review round", #784).
    if task.get("review_out"):
        return False
    if p.get("by") or not said or said < ended or not own_line(task, address):
        return False
    left = p.get("left") if isinstance(p.get("left"), (int, float)) else 0
    if now() - said >= max(ON_IT_MS, left):
        return False
    text = str(p.get("text") or "")
    return says_it_waits(text)


# Codex starts its tool servers (MCP servers from its config, its own runtime helpers) as its own
# children within a second or two of starting, and they live as long as it does (#946). A command of
# the agent's own starts in a turn, after the model answered: never this soon.
CODEX_STARTUP_S = 5


def _ps_started(stamp):
    """ps's lstart ("Sun Nov 15 10:50:03 2026", in the C locale) as epoch seconds, or None."""
    try:
        return time.mktime(time.strptime(" ".join(stamp.split()), "%a %b %d %H:%M:%S %Y"))
    except (ValueError, OverflowError):
        return None


def codex_working(k):
    """Whether a Codex agent has a process of its own running under it: a background terminal or a
    command of its code mode, but not its code-mode host (SHEP-207), nor what it started with itself:
    its MCP servers and runtime helpers and all under them (#946: they kept finished jobs counting).
    Its pid unknown: True, so its log decides as before. One `ps` for all processes, so it works on
    macOS too."""
    fg = k.get("foreground") or {}
    if not fg.get("pid") and k.get("address"):
        fg = detail(k).get("foreground") or {}
    if not fg.get("pid"):
        return True
    children, started, parent = {}, {}, {}
    out = run(["ps", "-axo", "pid=,ppid=,lstart=,args="], env=dict(os.environ, LC_ALL="C", LANG="C")).stdout
    for line in out.splitlines():
        parts = line.split(None, 7)  # pid, ppid, the five words of lstart, args
        if len(parts) >= 7 and parts[1].isdigit():
            started[parts[0]] = _ps_started(" ".join(parts[2:7]))
            parent[parts[0]] = parts[1]
            children.setdefault(parts[1], []).append((parts[0], parts[7] if len(parts) > 7 else ""))
    root = str(fg["pid"])
    born = started.get(root)
    # #1540: this herdr-task run (ready, status), a command the agent runs, and the shells running it: no job
    me, mine = str(os.getpid()), set()
    while me in parent and me not in mine and me != root:
        mine.add(me)
        me = parent[me]
    todo, seen_pids = [root], set()
    while todo:
        for pid, args in children.get(todo.pop(), []):
            if pid in seen_pids:
                continue
            seen_pids.add(pid)
            if pid == str(os.getpid()):
                continue  # this run's own children (this very ps)
            if CODEX_HOST in args or pid in mine:
                todo.append(pid)  # its code mode's commands run under it
                continue
            at = started.get(pid)
            if born is not None and at is not None and at - born <= CODEX_STARTUP_S:
                continue  # started with Codex itself: a tool server, never a job (nor anything under it)
            return True
    return False


def own_work(task, live, ready=False, background_only=False):
    """Its quiet agent is on its own work (above). What really runs (a background job, a command
    open in the foreground, a helper of its own at work: SHEP-54) counts whatever its last message
    says: a plain question with work still running is no ask yet (SHEP-148; asking for real is its
    question tool or a permission: blocked). Its status line alone counts only when its last message
    asks nothing, and never for a Ready task (ready: not_at_rest()). While the agent is in a turn,
    background_only keeps just the jobs that can still be running when that turn ends."""
    for k in live:
        if (k.get("labels") or {}).get("herdr.role") == "reviewer" or status_word(k) == "blocked":
            continue
        address = k.get("address")
        key = (k.get("labels") or {}).get("herdr.task")
        if not background_only and key and any(parent_of(h) == address and status_word(h) in ("working", "blocked") for h in live_helpers(key)):
            return True
        # Codex's jobs are only what its process tree shows (SHEP-207): a session the log says is
        # still open, with no process of the agent running, is over.
        jobs, log = own_jobs(task, k)
        if jobs:
            return True
        if background_only:
            continue
        ended = background_jobs(log)[1] if log else 0
        if not ready and waits_on_own(task, address, ended) and not last_question(task, address):
            return True
        # Mid-turn, a long command of its own still running in the foreground: Herdr can read
        # Claude Code idle then (SHEP-133: HOME-1 read Needs you during a 50 s Bash). Unless a
        # permission for it waits on the person (the chat's hook holds it).
        if log and open_tool(log) and not held_ask(address):
            return True
    return False
