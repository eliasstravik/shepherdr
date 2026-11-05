"""News: what changed in a space's tasks, told to its Assistant."""

import fcntl
import json
import os
import re
import select
import subprocess
import time
from contextlib import contextmanager

from .base import guard, hc_json, now, run, STORE
from .settings import bare
from .agents import (
    agent_log, agent_running, detail, from_person, live_agents, log_tail, said, starting, status_word,
    STATUSES,
)
from .sessions import session_of
from .launch import coordinator_in
from .store import locate, read_list, Store, store_files
from .output import line, minutes, view
from .takeover import backup_news


# ---- news -----------------------------------------------------------------------------------
# Herdr itself tells a space's Assistant (its coordinator) when one of its tasks needs the person
# (with the reason), is Ready, is Done, failed, or went quiet: one tagged line each, and the lines
# of one moment as one message (as Shepherdr's task news); workers don't report. The status is
# the one people see (view(): task_status() and its reason, as `list` and the Tasks panel). Each
# task's last told status is kept in .news.json, so a change is told once, also across restarts.
# A line goes only if its task still says so when it's sent: a status that flickers tells nothing.

NEWS = os.path.join(STORE, ".news.json")
NEWS_SETTLE_MS = 5000          # a line waits this long for others of the same moment
NEWS_KEEP_MS = 6 * 3600000     # undelivered (no Assistant to tell) this long: dropped
QUIET_MS = 20 * 60000          # Working with nothing happening this long: stalled


def activity(task, live):
    """When its agent last did something: its session log written, its status changed, a report."""
    times = [task.get("started") or 0, ((task.get("agents") or [{}])[-1] or {}).get("at") or 0,
             (task.get("progress") or {}).get("at") or 0]
    times += [k.get("status_ms") or 0 for k in live]
    log = agent_log(task)
    try:
        times.append(int(os.path.getmtime(log) * 1000) if log else 0)
    except OSError:
        pass
    return max(times)


def stall_of(task, v, live):
    """(mark, words) when a Working task went quiet (QUIET_MS) or is far past its own time left
    (as Shepherdr: its report's minutes, plus as many again, at least 20, gone by); else None.
    The mark says which stall it is: the same one is told once."""
    if v["status"] != "working" or task["state"] != "running" or starting(task) or task.get("retry"):
        return None
    last = activity(task, live)
    if now() - last >= QUIET_MS:
        return f"quiet:{last}", f"went quiet: nothing for {(now() - last) // 60000} min"
    p = task.get("progress") or {}
    if isinstance(p.get("left"), (int, float)) and p.get("at"):
        eta = p["left"] // 60000
        gone = (now() - p["at"]) // 60000
        if gone > eta + max(eta, 20):
            return f"late:{p['at']}", f"is far past its time: said {minutes(eta)} left, {minutes(gone)} ago"
    return None


def news_line(s, t, v, event, words=None):
    ref, title = s.ref(t), " ".join(t["title"].split())
    attr = lambda x: str(x).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    note = " ".join(str(t.get("agents_md") or "").split())
    said = " ".join(str(t.get("summary") or "").split())
    text = {"ready": f"{ref} is ready: {title}" + (f" · {said}" if said else "") + (f" · For AGENTS.md: {note}" if note else ""),
            "needs-you": f"{ref} needs you: {v.get('why') or 'Needs you'} ({title})",
            "failed": f"{ref} failed: {v.get('why') or 'Agent stopped'} ({title})",
            "stalled": f"{ref} {words} ({title})",
            "working-again": f"{ref} is working again: {(t.get('back') or {}).get('why') or 'its agent is at work again'} ({title})",
            "backup": f"{ref} backup: {words} ({title})",
            "done": f"{ref} is done" + (": merged" if t.get("merged") else ": nothing to merge" if t.get("nothing_to_merge")
                                        else ": accepted" if t.get("accepted_at") else "") + f" ({title})"}[event]
    return f'<herdr-news task="{attr(ref)}" event="{event}">{text.replace("<", "‹").replace(">", "›")}</herdr-news>'


def news_state(s, t, live):
    """What news would say of this task now: {status, why, event, stall}, with live = its running agents."""
    if t["state"] in ("running", "ready"):
        v = view(s, t, live)
    else:
        v = {"status": t["state"] if t["state"] in STATUSES else "todo", "needs": None, "why": None}
    event = {"ready": "ready", "done": "done", "needs": "needs-you"}.get(v["status"])
    if event == "needs-you" and (v["needs"] in ("stopped", "provider") or str(v.get("why") or "").startswith("Couldn't start")):
        event = "failed"
    stall = stall_of(t, v, live) if v["status"] == "working" else None
    return v, event, stall


def news_pass(report, folder=None):
    """Notes each task's status; queues a line for each change worth telling, and sends the lines
    that settled, one message per Assistant. Runs inside the tick lock (scheduler, tick)."""
    try:
        with open(NEWS) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    seen, outbox, quiet = state.setdefault("seen", {}), state.setdefault("outbox", []), state.setdefault("quiet", {})
    current = {}  # key -> (status, stall mark), to check queued lines against
    for path in store_files(folder):
        d = read_list(path)
        if not d or not os.path.isdir(d.get("folder") or ""):
            continue
        active = any(t.get("state") in ("running", "ready") for t in d.get("tasks") or [])
        with Store(locate(d["folder"]), write=active) as s:
            mine = seen.setdefault(s.slug, {})
            # The first look at a list only notes how its tasks are: old news isn't news.
            first = "_init" not in mine
            mine["_init"] = True
            for t in s.data["tasks"]:
                key = f"{s.slug}#{t['id']}"
                live = [k for k in map(detail, live_agents(s.key(t))) if agent_running(k)] if t["state"] in ("running", "ready") else []
                v, event, stall = news_state(s, t, live)
                # The Tasks panel reads the store, not the log: why its agent waits (its own status
                # line, its question, its last words), as `list` says it, it shows from here.
                waits = v["why"] if v.get("needs") in ("reply", "asks") else None
                if s.write and t.get("waits") != waits:
                    if waits:
                        t["waits"] = waits
                    else:
                        t.pop("waits", None)
                    s.dirty = True
                cur = {"status": v["status"], "why": v.get("why"), "stall": stall[0] if stall else None}
                current[key] = cur
                prev = mine.get(str(t["id"]))
                mine[str(t["id"])] = {"status": cur["status"], "stall": cur["stall"] or (prev or {}).get("stall"),
                                      **({"needs": v["needs"]} if v.get("needs") else {})}
                # Its backup took over (takeover()): told once; on a first look, old news.
                b = t.get("backup") or {}
                backup = s.write and b.get("state") == "started" and not b.get("told")
                if backup:
                    b["told"] = True
                    s.dirty = True
                if first or t.get("archived") or not t.get("space"):
                    continue
                lines = [("backup", news_line(s, t, v, "backup", backup_news(t)))] if backup else []
                # Taken back to work after it said ready (back_to_work(), busy_again()): told as it happens.
                # Its agent took up what needed the person (failing checks: on_it()) too.
                if v["status"] == "working" and ((prev or {}).get("status") in ("ready", "merging")
                                                 or (prev or {}).get("needs") == "attention" and t.get("attention")):
                    event = "working-again"
                if event and (prev or {}).get("status") != v["status"]:
                    lines.append((event, news_line(s, t, v, event)))
                if stall and stall[0] != (prev or {}).get("stall"):
                    lines.append(("stalled", news_line(s, t, v, "stalled", stall[1])))
                for ev, text in lines:
                    # A newer word on the same task replaces one not sent yet.
                    # A backup's line stands apart: it neither replaces nor is replaced.
                    outbox[:] = [x for x in outbox if not (x["key"] == key and "backup" not in (ev, x["event"])
                                                           and (x["event"] == ev or ev != "stalled"))]
                    outbox.append({"key": key, "space": bare(t["space"]), "folder": os.path.basename(s.loc["folder"]), "event": ev, "status": v["status"],
                                   "stall": stall[0] if ev == "stalled" else None, "text": text, "at": now()})
            ids = {str(t["id"]) for t in s.data["tasks"]}
            for k in [k for k in mine if k not in ids and k != "_init"]:
                mine.pop(k)
    report.setdefault("news", [])
    # Still true? A line whose task moved on since (or was removed) goes unsaid.
    def holds(x):
        c = current.get(x["key"])
        if (folder and c is None) or x["event"] == "backup":
            return True  # another folder's task: not looked at this time; a backup's line is news either way
        return bool(c) and (c["stall"] == x["stall"] if x["event"] == "stalled" else c["status"] == x["status"])
    outbox[:] = [x for x in outbox if holds(x) and now() - x["at"] < NEWS_KEEP_MS]
    for space in dict.fromkeys(x["space"] for x in outbox):
        batch = [x for x in outbox if x["space"] == space]
        if now() - min(x["at"] for x in batch) < NEWS_SETTLE_MS:
            continue
        to = coordinator_in(space)
        k = hc_json("get", to) if to else None
        if to and news_send(to, "\n".join(x["text"] for x in batch)):
            outbox[:] = [x for x in outbox if x not in batch]
            report["news"].append({"to": to, "lines": [x["text"] for x in batch]})
            # Kept for the main machine's home Assistant, which keeps every machine's overview.
            try:
                from .home import log_news
                log_news([{"at": now(), "space": space, "folder": batch[0].get("folder"), "to": to, "lines": [x["text"] for x in batch]}])
            except Exception:  # never stops the news
                pass
            # Read before the news: a <no-reply> to it leaves it read (news_read()).
            read = (k.get("labels") or {}).get(READ) if k else None
            if k and str(read) == str(k.get("turn")) and to not in quiet:
                quiet[to] = {"turn": k.get("turn"), "at": now()}
    # Settings changed for a space: its running Assistant told once, in one message (assistant_settings.py).
    try:
        from .assistant_settings import settings_pass
        settings_pass(report, quiet)
    except Exception as e:  # never stops the news
        report["settings_error"] = str(e)
    # Reactions changed for a space: every other running agent its hook taught told once (reactions.py).
    try:
        from .reactions import reactions_pass
        reactions_pass(report, quiet)
    except Exception as e:  # never stops the news
        report["reactions_error"] = str(e)
    news_read(quiet)
    held_pass(report)
    tmp = f"{NEWS}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, NEWS)


READ = "herdr.chat.read"  # the Assistant's turn last read (mods/chat/unread.js)
NO_REPLY = re.compile(r"^\s*(?:<hc\s+no-reply\b[^>]*/>|</?no-reply\b[^\n]*)\s*$")


def news_read(quiet):
    """Unread is a new turn of the Assistant's (mods/chat/unread.js). News it answered only with
    <no-reply> shows nothing, so it isn't new: an Assistant read before the news is read after
    it too. quiet = {address: {turn, at}}, the ones told while read; done ones leave it."""
    for addr, q in list(quiet.items()):
        k = hc_json("get", addr) or {}
        if k.get("state") != "live" or now() - q["at"] > 30 * 60000:
            quiet.pop(addr)
            continue
        if status_word(k) == "working" or (k.get("turn") or 0) <= (q.get("turn") or 0):
            continue
        quiet.pop(addr)
        if str((k.get("labels") or {}).get(READ)) != str(q["turn"]):
            continue  # read since, or changed by someone else
        log = session_of((k.get("foreground") or {}).get("pid") or "")[1] if (k.get("foreground") or {}).get("pid") else None
        for d in reversed(log_tail(log, 65536)):
            if from_person(d) is not None:
                break
            text = said(d)
            if text is None or not text:
                continue
            if all(NO_REPLY.match(line) for line in text.split("\n") if line.strip()):
                run(["hc", "label", addr, f"{READ}={k.get('turn')}"])
            break


def news_send(address, text, check=True):
    """Delivers news as the chat delivers the person's words: typed in, sent at once mid-turn (for
    Claude Code its "send now", Ctrl+Enter). Not as a message from this terminal: no <hc from>.
    False when it can't take it now (a dialog of its own is open, or the person is writing to it:
    typing()): tried again next time. check=False: typing() was just asked."""
    if check and typing(address):
        return False
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    guard(["hc"])
    r = subprocess.run(["hc", "send", address, text], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    if r.returncode != 0:
        return False
    k = hc_json("get", address) or {}
    if (k.get("labels") or {}).get("herdr.agent", "claude") == "claude" and status_word(k) == "working":
        for i in range(4):
            time.sleep(0.3 if i else 0.15)
            screen = run(["hc", "read", address, "--lines", "40"]).stdout
            if re.search(r"ctrl\+enter to send now", screen, re.I):
                run(["hc", "keys", address, "ctrl+enter"])
                break
    return True


# ---- the person is writing ------------------------------------------------------------------
# Nothing automatic is typed into an agent while the person writes to it (HERD-71): news,
# autopilot wakes, the overview, GitHub news, another Assistant's words, a task's messages. They
# wait until the person has sent or cleared what they wrote, then go as one message. Writing is
# its chat box holding unsent words (mods/chat labels the terminal herdr.typing=<ms>, again each
# minute while they stay, removed once they're gone), or the CLI's own input line holding text
# typed in its terminal (read off the screen: the CLI's dim placeholder or suggestion isn't
# theirs). hc send itself also waits until no key went in for ~3 s.

TYPING = "herdr.typing"
TYPING_KEEP_MS = 5 * 60000     # unsent words untouched this long hold nothing any more
HELD = os.path.join(STORE, ".held.json")  # {address: [{text, how, at}]}: held_pass sends them
ESCAPES = re.compile(r"\x1b(?:\[([0-9;:?<=>!]*)[ -/]*([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[^\x1b]*\x1b\\|[()*+][0-9A-Za-z]|.)"
                     r"|[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]|[\r\n]|[^\x1b\x00-\x1f\x7f]+", re.S)
PROMPT = re.compile(r"^\s*[❯›>]\s")   # Claude Code's input line, Codex's
RULE = re.compile(r"^\s*[─━]{8,}")     # Claude Code's box edge


def screen_raw(address, there=None):
    """Its screen as herdr-core repaints it for a watcher (hc attach --observe: never types or
    resizes), colors and all; '' when it can't be read. there: runs a command on its machine
    (machines.py's routes)."""
    if there:
        return there(["sh", "-c", 'hc attach --observe "$1" </dev/null 2>/dev/null & p=$!; sleep 1; kill $p 2>/dev/null; wait $p 2>/dev/null; true',
                      "sh", address]).stdout or ""
    guard(["hc"])
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    p = subprocess.Popen(["hc", "attach", "--observe", address], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out, start, last = b"", time.time(), None
    try:
        while time.time() - start < 3:
            if select.select([p.stdout], [], [], 0.15)[0]:
                b = os.read(p.stdout.fileno(), 65536)
                if not b:
                    break
                out, last = out + b, time.time()
            elif last and time.time() - last > 0.25:
                break  # the repaint is all there
    finally:
        p.kill()
        p.wait()
    return out.decode("utf-8", "replace")


def screen_rows(raw):
    """A repaint's rows: {row: {col: (char, dim)}}. Only what a repaint uses: text, line ends,
    cursor moves, clears and SGR's dim."""
    rows, row, col, dim = {}, 0, 0, False
    for m in ESCAPES.finditer(raw):
        s, op = m.group(0), m.group(2)
        if s[0] == "\x1b":
            if op == "m":
                ps, i = (m.group(1) or "0").replace(":", ";").split(";"), 0
                while i < len(ps):
                    if ps[i] in ("38", "48", "58"):  # a color: 38;5;n or 38;2;r;g;b
                        i += 3 if ps[i + 1:i + 2] == ["5"] else 5
                        continue
                    dim = True if ps[i] == "2" else False if ps[i] in ("", "0", "22") else dim
                    i += 1
            elif op in ("H", "f") and not (m.group(1) or "").startswith("?"):
                a = (m.group(1) or "").split(";")
                row, col = int(a[0] or 1) - 1, int(a[1] or 1) - 1 if len(a) > 1 and a[1] else 0
            elif op == "G":
                col = int(m.group(1) or 1) - 1
            elif op == "J" and m.group(1) in ("2", "3"):
                rows = {}
        elif s == "\r":
            col = 0
        elif s == "\n":
            row, col = row + 1, 0
        elif s[0] >= " ":
            line = rows.setdefault(row, {})
            for ch in s:
                line[col] = (ch, dim)
                col += 1
    return rows


def typed_input(raw):
    """What the person typed in an agent CLI's input line on this screen (Claude Code's ❯ box,
    Codex's ›): the bottom-most prompt line and the lines under it, without the CLI's dim
    placeholder or suggestion. '' when it's empty or there's none."""
    rows = screen_rows(raw)
    text = {r: "".join(ch for _, (ch, _) in sorted(line.items())).replace("\xa0", " ") for r, line in rows.items()}
    marks = [r for r in sorted(rows) if PROMPT.match(text[r])]
    if not marks:
        return ""
    top, out = marks[-1], []
    for r in range(top, max(rows) + 1):
        if r != top and (RULE.match(text.get(r, "")) or not text.get(r, "").strip()):
            break
        cs = sorted(rows.get(r, {}).items())
        if r == top:
            cs = cs[PROMPT.match(text[r]).end():]
        out.append("".join(ch for _, (ch, dim) in cs if not dim))
    return "\n".join(out).strip()


def typing(address, k=None, there=None):
    """Why the person is writing to this agent now, else None: "chat" (its chat box holds unsent
    words) or "input" (its CLI's input line holds text they typed). k: its hc get, when at hand."""
    if k is None:
        if there:
            try:
                k = json.loads(there(["hc", "get", address, "--json"]).stdout or "null")
            except ValueError:
                k = None
        else:
            k = hc_json("get", address)
    if not k or k.get("state") != "live":
        return None
    try:
        at = int((k.get("labels") or {}).get(TYPING) or 0)
    except ValueError:
        at = 0
    if at and now() - at < TYPING_KEEP_MS:
        return "chat"
    return "input" if typed_input(screen_raw(address, there)) else None


@contextmanager
def held_messages():
    """HELD under its lock (the scheduler and an agent's herdr-task may both write it)."""
    os.makedirs(STORE, exist_ok=True)
    with open(HELD + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(HELD) as f:
                held = json.load(f)
        except (OSError, ValueError):
            held = {}
        yield held
        tmp = f"{HELD}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(held, f)
        os.replace(tmp, HELD)


def hold(address, text, how="send"):
    """Keeps a message for an agent the person is writing to; held_pass sends it once they've
    stopped. how: "send" (a plain hc send, as an agent's message) or "news" (news_send)."""
    with held_messages() as held:
        held.setdefault(address, []).append({"text": text, "how": how, "at": now()})


def send_or_hold(address, text, how="send"):
    """Sends it now, or holds it while the person is writing to that agent. Returns "sent",
    "held", or None when it couldn't go (hc refused it)."""
    if typing(address):
        hold(address, text, how)
        return "held"
    if how == "news":
        return "sent" if news_send(address, text, check=False) else None
    return "sent" if run(["hc", "send", address, text]).returncode == 0 else None


def held_pass(report):
    """Sends what was held for agents the person no longer writes to, one message per agent and
    kind. Dropped once its agent has ended, or after NEWS_KEEP_MS."""
    if not os.path.exists(HELD):
        return
    with held_messages() as held:
        for addr, items in list(held.items()):
            items[:] = [x for x in items if now() - (x.get("at") or 0) < NEWS_KEEP_MS]
            k = hc_json("get", addr) if items else None
            if not k or k.get("state") != "live":
                held.pop(addr)
                continue
            if typing(addr, k):
                continue
            for how in ("news", "send"):
                batch = [x for x in items if x.get("how", "send") == how]
                if not batch:
                    continue
                text = "\n\n".join(x["text"] for x in batch)
                ok = news_send(addr, text, check=False) if how == "news" else run(["hc", "send", addr, text]).returncode == 0
                if ok:
                    items[:] = [x for x in items if x not in batch]
                    report.setdefault("held", []).append({"to": addr, "messages": len(batch)})
            if not items:
                held.pop(addr)
