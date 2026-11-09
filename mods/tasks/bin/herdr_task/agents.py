"""Live agents: a task's terminals, its status and what its agent last said or asks."""

import datetime
import json
import os
import re

from .base import hc_json, HOME, now, RANK, SHELLS


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


def agent_running(k):
    fg = k.get("foreground") or {}
    if fg.get("name"):
        if os.path.basename(fg["name"]) not in SHELLS:
            return True
        # fish keeps the agent its child, in its own process group (#780): the terminal's foreground
        # stays the shell running its launch command (fish -ic "claude …; exec fish -i") the whole
        # time. Only once it exec'ed its plain interactive shell has the agent exited.
        return runs_command(fg.get("argv"))
    return bool(k.get("agent")) and k.get("agent") not in SHELLS


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
    states = []
    for k in live:
        x = k.get("status")
        states.append(x.get("state") if isinstance(x, dict) else x)
    # A problem Herdr just found (SHEP-133): not Needs you before GRACE_MS have passed, while its
    # agent is told and takes it up; until then the task reads as it would without it.
    if task.get("attention") and now() - (task.get("attention_at") or 0) < GRACE_MS:
        return task_status({**task, "attention": None}, live)
    # What Herdr found that stops it (failing checks, a conflict): Needs you, unless its agent is
    # already on it (on_it()); then it is Working, with its agent's own status line.
    if task.get("attention") and not on_it(task, live):
        return "needs", "attention", task["attention"]
    # Cut off by its provider (retry_pass): still Working while Herdr waits to tell it to carry
    # on; Needs you once the tries are used up, or at once for what waiting can't fix.
    r = task.get("retry") if st == "running" else None
    if r and any(k.get("address") == r.get("address") for k in live) and ("blocked" not in states or r.get("over")):
        return ("needs", "provider", r.get("reason")) if r.get("over") else ("working", None, retry_line(r))
    if "blocked" in states:
        return "needs", "asks", REASONS["question"]
    if trust_asked(live):
        return "needs", "asks", REASONS["trust"]
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
        return APPROVAL_LINE if task["pr"].get("needs_approval") else MERGES_ITSELF
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
    """A Ready task whose agent is at work again since it said ready. Not while it merges as
    asked (the merge is its work), nor a reviewer's turn. A ready said before turns were kept:
    any work once STARTING_MS have passed."""
    if task["state"] != "ready" or task.get("merge_requested"):
        return False
    seen = task.get("ready_turns")
    if seen is None and now() - (task.get("ready_at") or 0) < STARTING_MS:
        return False
    return any(status_word(k) == "working" and (k.get("labels") or {}).get("herdr.role") != "reviewer"
               and (k.get("turn") or 0) >= (seen or {}).get(k.get("address"), 0) for k in live)


# ---- Ready only at rest (SHEP-148) --------------------------------------------------------------
# An agent often says ready and carries on in the same turn (a last check, its final message), or
# leaves its own work running: a background shell, a Monitor, a subagent, a helper of its own. That
# is no Ready yet: the person would be told to accept work that is still moving. Working until its
# agents are at rest, then Ready (and its news). A later turn is busy_again()'s.


def not_at_rest(task, live):
    """A Ready task's agent still at it: at work in the turn it said ready in, or its own work
    still running (own_work(), its hard signs only: no status line, a question asked doesn't end it)."""
    if any(status_word(k) == "working" and (k.get("labels") or {}).get("herdr.role") != "reviewer" for k in live):
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


def retry_line(r):
    """A provider retry's status line: "Provider overloaded · retry in 2m"."""
    if r.get("due"):
        return f"{r['reason']} · retry in {max(1, -(-(r['due'] - now()) // 60000))}m"
    return f"{r['reason']} · retrying"


# A Needs-you reason or an agent's status line: at most this many characters (as Shepherdr's
# STATUS_MAX), never the agent's message pasted, never a model's words.
LINE_MAX = 40
# A ready summary: at most this many characters of plain words on what the person now sees or can
# do (as Shepherdr's SUMMARY_MAX); the rest goes in --details or the proof.
SUMMARY_MAX = 160
REASONS = {"plan": "Plan to approve", "permission": "Asks permission", "question": "Question for you",
           "reply": "Waits for your reply", "signed_out": "Signed out", "trust": "Asks to trust this folder"}

# Claude Code's folder-trust dialog (#755): shown before it reports any status, so to Herdr the
# agent looked like it was starting, then Working, until it stalled. Read off its screen.
TRUST = re.compile(r"Quick safety check|Do you trust the files in this folder|Yes, I trust this folder", re.I)
_trust_seen = {}


def trust_asked(live):
    """The address of a live agent showing Claude Code's folder-trust dialog, else None. Only an
    agent that never reported a status nor took a turn: its screen is read at most every 5 s."""
    from .base import run
    for k in live:
        if status_word(k) or k.get("turn") or (k.get("labels") or {}).get("herdr.agent", "claude") != "claude":
            continue
        address = k.get("address")
        seen = _trust_seen.get(address)
        if not seen or now() - seen[0] > 5000:
            screen = run(["hc", "read", address, "--lines", "40"]).stdout or ""
            seen = _trust_seen[address] = (now(), bool(TRUST.search(screen)))
        if seen[1]:
            return address
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


def from_person(d):
    """A line that is someone writing to the agent (not a tool's result): its words, else None."""
    if d.get("type") == "user" and not d.get("isSidechain"):
        c = (d.get("message") or {}).get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list) and not any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
            return "\n".join(x.get("text") or "" for x in c if isinstance(x, dict) and x.get("type") == "text")
    if d.get("type") == "event_msg" and (d.get("payload") or {}).get("type") == "user_message":
        return str(d["payload"].get("message") or "")
    return None


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


def held_ask(address):
    """The ask Herdr's chat hook holds for this terminal (mods/chat/ask-hook.sh), or None."""
    d = os.path.join(HOME, ".config", "herdr-app", "data", "chat-asks", "req")
    try:
        names = sorted(n for n in os.listdir(d) if n.startswith(address + ".") and n.endswith(".json"))
    except OSError:
        return None
    for n in reversed(names):
        try:
            with open(os.path.join(d, n)) as f:
                return json.load(f)
        except (OSError, ValueError):
            continue
    return None


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
            "Monitor started", "Async agent launched", "session_id", "session ID")
BG_MAX_MS = 3 * 3600_000  # a background job started longer ago than this no longer counts
BG_STARTED = re.compile(r"Command running in background with ID: (\w+)|Monitor started \(task (\w+)|Async agent launched[\s\S]*?agentId: (\w+)")
BG_ENDED = re.compile(r"<task-id>(\w+)</task-id>(?:(?!</task-notification>)[\s\S])*?<status>(\w+)</status>")
CODEX_RUNNING = re.compile(r"Process running with session ID (\d+)")
CODEX_OBJECT = re.compile(r"\{[^{}]*\"session_id\"\s*:\s*(\d+)[^{}]*\}")
CODEX_EXITED = re.compile(r"\"exit_code\"\s*:|Process exited with code")
WAITS_ON = re.compile(r"\b(wait\w*|watch\w*|polling)\b.*\b(ci|checks?|reviews?|reviewer|build|tests?|background|jobs?|deploy\w*|"
                      r"release|github|pipeline|actions?|run|workflow)\b|\breviewing\b", re.I)
WAITS_ON_PERSON = re.compile(r"\b(you|your|yours|person|human|answer|reply|approv\w*|decid\w*|decision|confirm\w*|ok|okay|"
                             r"input|accept\w*|sign(?:ed)?[- ]?in|login|a go|go-ahead)\b", re.I)
_bg_cache = {}


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
        c = {"ino": st.st_ino, "offset": max(0, st.st_size - BG_LOG_BYTES), "running": {}, "ended": 0, "calls": {}, "cut": True}
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
    return {i: t for i, t in c["running"].items() if now() - t < BG_MAX_MS}, c["ended"]


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
            if "<task-notification>" in raw and (d.get("type") in ("queue-operation", "attachment") or from_person(d) is not None):
                for m in BG_ENDED.finditer(raw):
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
            # Codex: a process left running has a session id until an output says it exited.
            p = d.get("payload") or {}
            if d.get("type") == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
                calls[p.get("call_id")] = str(p.get("arguments") or p.get("input") or "")
            elif d.get("type") == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
                text = _text(p.get("output"))
                for m in CODEX_RUNNING.finditer(text):
                    running.setdefault("codex:" + m.group(1), at)
                for m in CODEX_OBJECT.finditer(text):
                    if CODEX_EXITED.search(m.group(0)):
                        if running.pop("codex:" + m.group(1), None) is not None:
                            ended = max(ended, at)
                    else:
                        running.setdefault("codex:" + m.group(1), at)
                # write_stdin to a session whose output says it exited
                sids = set(re.findall(r"session_id\W{0,4}(\d+)", calls.get(p.get("call_id"), "")))
                if len(sids) == 1 and CODEX_EXITED.search(text) and not CODEX_OBJECT.search(text):
                    if running.pop("codex:" + sids.pop(), None) is not None:
                        ended = max(ended, at)
    seen["ended"] = ended


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
    return bool(WAITS_ON.search(text)) and not WAITS_ON_PERSON.search(text)


def own_work(task, live, ready=False):
    """Its quiet agent is on its own work (above). What really runs (a background job, a command
    open in the foreground, a helper of its own at work: SHEP-54) counts whatever its last message
    says: a plain question with work still running is no ask yet (SHEP-148; asking for real is its
    question tool or a permission: blocked). Its status line alone counts only when its last message
    asks nothing, and never for a Ready task (ready: not_at_rest())."""
    for k in live:
        if (k.get("labels") or {}).get("herdr.role") == "reviewer" or status_word(k) == "blocked":
            continue
        address = k.get("address")
        key = (k.get("labels") or {}).get("herdr.task")
        if key and any(parent_of(h) == address and status_word(h) in ("working", "blocked") for h in live_helpers(key)):
            return True
        log = agent_log(task, address) or agent_log(task)
        jobs, ended = background_jobs(log) if log else ({}, 0)
        if jobs:
            return True
        if not ready and waits_on_own(task, address, ended) and not last_question(task, address):
            return True
        # Mid-turn, a long command of its own still running in the foreground: Herdr can read
        # Claude Code idle then (SHEP-133: HOME-1 read Needs you during a 50 s Bash). Unless a
        # permission for it waits on the person (the chat's hook holds it).
        if log and open_tool(log) and not held_ask(address):
            return True
    return False
