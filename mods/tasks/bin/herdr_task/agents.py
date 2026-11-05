"""Live agents: a task's terminals, its status and what its agent last said or asks."""

import datetime
import json
import os
import re

from .base import hc_json, HOME, now, RANK, SHELLS


# ---- live agents ----------------------------------------------------------------------------

def live_agents(key):
    """The task's live terminals, with labels (hc ls leaves labels out unless filtering by them).
    Agents start inside the person's shell, which stays when the agent exits: agent_running()."""
    d = hc_json("ls", "--label", f"herdr.task={key}") or {}
    return [dict(k, labels=dict(k.get("labels") or {}, **{"herdr.task": key}))
            for k in d.get("terminals", []) if k.get("state") == "live"]


def detail(k):
    """hc ls gives no foreground; hc get does."""
    return hc_json("get", k["address"]) or k


def agent_running(k):
    fg = (k.get("foreground") or {}).get("name") or ""
    if fg:
        return os.path.basename(fg) not in SHELLS
    return bool(k.get("agent")) and k.get("agent") not in SHELLS


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
    if busy_again(task, live):
        return "working", None, WORKING_AGAIN
    if task.get("attention"):
        return "working", None, WORKING_AGAIN if st == "ready" else None
    if st == "ready":
        if task.get("merge_requested") and live:
            return "merging", None, None
        if task.get("auto_merge") and task.get("pr") and not task.get("merged"):
            return "merging", None, "Merges once its checks pass"
        return "ready", None, None
    # An agent that hasn't reported yet is starting: working.
    if any(x not in ("idle", "done", "blocked") for x in states):
        return "working", None, None
    # Just started: its terminal still runs the shell that starts the agent, or the agent is idle
    # before its first message lands. Working, until it ends or STARTING_MS pass.
    if starting(task):
        return "working", None, None
    # Quiet without saying ready: alive, it ended its turn (view() says on what: its question or
    # its last sentence); its process gone, the agent stopped.
    if live:
        return "needs", "reply", REASONS["reply"]
    return "needs", "stopped", STOPPED


STOPPED = "Agent stopped"


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
           "reply": "Waits for your reply", "signed_out": "Signed out"}


def fit(text, n=LINE_MAX):
    """One line of at most n characters, cut at a word ("…" at the end) when longer."""
    text = " ".join(str(text or "").split())
    if len(text) <= n:
        return text
    cut = text[:n - 1]
    if " " in cut and text[n - 1] != " ":
        cut = cut[:cut.rindex(" ")]
    return cut.rstrip(" ,;:.-") + "…"


def log_tail(log, size=262144):
    """The last lines of an agent's session log (Claude Code's or Codex's JSONL), parsed; [] when
    it can't be read. A first line cut in half is left out."""
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
    out = []
    for raw in lines[1:] if at else lines:
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
    if not p.get("text"):
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
