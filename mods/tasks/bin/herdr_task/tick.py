"""Tick: one pass over the tasks (start queued ones, finish merged ones, retry cut turns, hand a
task whose CLI can't go on to its backup)."""

import fcntl
import json
import os
import secrets
import subprocess
import time

from .base import Fail, guard, hc_json, now, PR_EVERY, run, SHELLS, STORE
from .settings import machine_name, worker_argv
from .agents import agent_log, agent_running, busy_again, detail, held_ask, live_agents, status_word, task_status
from .provider import NUDGE, provider_cut, provider_error, PROVIDER_WAITS
from .sessions import find_lost_logs, refresh_sessions, session_of
from .github import finish, merged_here, pr_pending, pr_problem, pr_view, watch_main
from .launch import default_space
from .store import locate, read_list, Store, store_files
from .queues import machine_hold, refresh_ext, running_count, set_hold, waiting_ext, waiting_for
from .archive import archive_pass
from .browsers import browser_pass
from .output import progress_clock, say
from .commands import back_to_work, begin, merge_now, MERGE_FAILED
from .news import news_pass, typing
from .takeover import cant_go_on, takeover
from .ghnews import main_pass, pr_deliver, pr_news
from .scheduler import SCHEDULER
from .revive import revive_pass


def at_work(s, t):
    """Its agent is mid-turn (working, or asking): a task is never marked merged under it (SHEP-23);
    a later tick looks again."""
    return any(status_word(k) in ("working", "blocked") for k in live_agents(s.key(t)))


def facts(s, t, report):
    """A worktree task whose own work merged anywhere is done (once its agent is between turns); a
    pull request's problems need the person."""
    if t.get("pr"):
        pr = t["pr"]
        if now() - pr.get("checked", 0) < PR_EVERY:
            return
        pr["checked"] = now()
        s.dirty = True
        v = pr_view(t)
        if not v:
            return
        if v.get("state") == "MERGED":
            if at_work(s, t):
                return
            t["merged"] = True
            watch_main(s, t, (v.get("mergeCommit") or {}).get("oid"))
            finish(s, t)
            report["done"].append(t["id"])
            return
        problem = pr_problem(v)
        t["_pr_fresh"] = not problem and not pr_pending(v)
        try:
            pr_news(s, t, v, report)
        except Exception as e:  # never stops the tick
            report.setdefault("github_error", []).append(f"{s.ref(t)}: {e}")
        # Kept up to date while it is back at work too (a fix pushed: the problem goes away), so its
        # agent going quiet with the problem still there reads Needs you (on_it()).
        if t["state"] in ("ready", "running") and problem != t.get("attention"):
            if problem:
                t["attention"], t["attention_at"] = problem, now()
                report["attention"].append(t["id"])
            elif t.get("attention", "").startswith(("Checks failing", "It conflicts", "The pull request was closed", MERGE_FAILED)):
                t.pop("attention")
    elif merged_here(s, t) and not at_work(s, t):
        t["merged"] = True
        finish(s, t)
        report["done"].append(t["id"])


def back_pass(s, t, report):
    """A Ready task whose agent took up work again (a message from anyone in its chat) is Working
    again until its next ready (busy_again()); its Assistant hears it (news: working-again)."""
    live = live_agents(s.key(t))
    # Cheap while nothing works: hc ls alone; its records in full (roles) only then.
    if any(status_word(k) == "working" for k in live) and busy_again(t, [detail(k) for k in live]):
        back_to_work(s, t, "its agent is at work again")
        report.setdefault("working_again", []).append(s.ref(t))


def due_pass(s, report):
    """Scheduled tasks whose time has come (SHEP-38), a time passed while the machine was off too, join
    the queue in the order they were due: the queue below starts them (after their --after tasks,
    when there's room), each once."""
    for t in s.data["tasks"]:
        if t["state"] == "scheduled" and (t.get("scheduled_for") or 0) <= now():
            t["state"], t["queued_at"] = "queued", t.get("scheduled_for") or now()
            t.pop("scheduled_for", None)
            s.dirty = True
            report.setdefault("due", []).append(s.ref(t))


def tick_store(s, report):
    """One folder's turn: Ready tasks back at work are Working again, merged tasks become done,
    auto-merges go when they can, and queued tasks start while there's room."""
    for t in s.data["tasks"]:
        if t["state"] == "ready":
            back_pass(s, t, report)
        if t.get("worktree") and t["state"] in ("running", "ready"):
            facts(s, t, report)
            if t["state"] == "ready" and (t.get("pr") or {}).get("news"):
                try:
                    pr_deliver(s, t, report)
                except Exception as e:  # never stops the tick
                    report.setdefault("github_error", []).append(f"{s.ref(t)}: {e}")
            if t["state"] == "ready" and t.get("auto_merge") and t.get("pr") and not t.get("attention") and t.get("_pr_fresh"):
                if not merge_now(s, t):
                    report["done"].append(t["id"])
            t.pop("_pr_fresh", None)
    due_pass(s, report)
    queued = sorted((t for t in s.data["tasks"] if t["state"] == "queued"), key=lambda t: t.get("queued_at") or 0)
    n = running_count(s) if queued else 0
    budget = [3]  # other machines asked this pass, at most
    for t in queued:
        waits = bool(waiting_for(s, t))
        if not waits:
            refresh_ext(s, t, budget=budget)
            waits = bool(waiting_ext(t))
        if waits or n >= s.max_running():
            if t.pop("held", None):  # waits for something else now
                s.dirty = True
            continue
        # Its machine too busy (HERD-40): it, and every one after it, waits with why.
        held = machine_hold()
        if (t.get("held") or None) != held:
            t["held"] = held
            if not held:
                t.pop("held")
            s.dirty = True
        if held:
            continue
        q = t.get("queue") or {}
        try:
            sp = q.get("space") or t.get("space") or default_space()
            a = begin(s, t, q.get("argv") or worker_argv(s, t, sp), sp, q.get("parent"))
        except Fail as e:
            t["attention"] = f"Couldn't start: {e}"
            s.dirty = True
            continue
        n += 1
        report["started"].append({"folder": s.loc["folder"], "id": t["id"], "ref": s.ref(t), "terminal": a["address"]})
    if s.data.get("main_watch"):
        try:
            main_pass(s, report)
        except Exception as e:  # never stops the tick
            report["main_error"] = str(e)


def lost_log(t, a):
    """An agent of task t that ended with no log recorded, not looked for yet (find_lost_logs())."""
    gone = a.get("ended") or (t.get("state") == "done" and (t.get("ended_at") or 0) > (t.get("done_at") or 0))
    return bool(gone and not a.get("log") and not a.get("log_looked"))


def lost_logs_pass(report, folder=None):
    """Finds the log of every ended task agent here whose session no pass saw (a short run), so its
    chat reads back after its terminal is gone (SHEP-26). Cheap once each was looked for."""
    for p in store_files(folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not any(lost_log(t, a) for t in tasks for a in t.get("agents") or []):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if any(lost_log(t, a) for a in t.get("agents") or []):
                    find_lost_logs(s, t)
                    report.setdefault("logs_found", []).append(s.ref(t))


# ---- Done tasks end their agents (as Shepherdr) -----------------------------------------------
# A Done task's worker and reviewer terminals end (their shells too) once the final news went
# and its agent is quiet; their sessions stay recorded on the task, so `resume` brings one back
# (which makes it running again). Ready tasks keep theirs. Only terminals labelled with that
# task's herdr.task key are touched. "ended_at" says a pass found nothing left of it.

DONE_GRACE_MS = 60000          # the done news and the agent's last words go first
DONE_WORKING_MS = 15 * 60000   # an agent still working this long after Done ends anyway
GUARD_MEMORY = 85              # memory in use (%) past which the guard acts (memory_guard())
GUARD_FILE = os.path.join(STORE, ".memory-guard.json")
GUARD_ALERT_EVERY_MS = 30 * 60000


def end_done(s, t, report, pressed=False):
    """Ends what is left of one Done task's agents now, or what may end: a shell at once, an agent
    once it's idle (or working past DONE_WORKING_MS); under memory pressure (pressed) every idle
    one at once. Returns the addresses it ended."""
    done_at = t.get("done_at") or 0
    if not pressed and now() - done_at < DONE_GRACE_MS:
        return []
    me = os.environ.get("HC_TERMINAL_ID")
    live = [detail(k) for k in live_agents(s.key(t))]
    live = [k for k in live if k.get("address") != me and (k.get("labels") or {}).get("herdr.role") != "coordinator"]
    if not live:
        t["ended_at"] = now()
        s.dirty = True
        return []
    refresh_sessions(s, t, live)
    ended = []
    for k in live:
        if agent_running(k) and status_word(k) == "working" and now() - done_at < DONE_WORKING_MS:
            continue
        if quiet_hc("kill", k).returncode == 0:
            ended.append(k)
    if ended:
        report.setdefault("ended", []).append({"task": s.ref(t), "terminals": [k["address"] for k in ended]})
    return ended


def end_done_pass(report, folder=None, pressed=False):
    """Every Done task here with agents left ends them (end_done()). Cheap when nothing's left:
    a task is looked at once after each time it became Done."""
    ended = []
    for p in store_files(folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not any(
                t.get("state") == "done" and (t.get("ended_at") or 0) <= (t.get("done_at") or 1) for t in tasks):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if t.get("state") == "done" and (t.get("ended_at") or 0) <= (t.get("done_at") or 1):
                    ended += end_done(s, t, report, pressed)
    if ended:
        # Ended terminals leave hc's list too (a moment after: hc rm takes finished ones only).
        time.sleep(1)
        for k in ended:
            quiet_hc("rm", k)
    return [k["address"] for k in ended]


def quiet_hc(verb, k):
    """hc kill / rm of a Done task's terminal, asked as its parent: a parent that ends its own
    child has seen the news, so no "exited" note is typed into the Assistant (hc's caller)."""
    guard(["hc"])
    env = dict(os.environ)
    env.pop("HC_TERMINAL_ID", None)
    if k.get("parent"):
        env["HC_TERMINAL_ID"] = k["parent"]
    return subprocess.run(["hc", verb, k["address"]], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)


def memory_guard(report):
    """Past GUARD_MEMORY% memory in use, before oomd ends everything: idle agents of Done tasks
    end first (whatever their grace), then the person is told (an alert from the scheduler's
    terminal, once per 30 min while it stays high). HERD-40's hold keeps new tasks waiting."""
    from .machine import sample
    h = sample()
    try:
        with open(GUARD_FILE) as f:
            g = json.load(f)
    except (OSError, ValueError):
        g = {}
    if h["memory"] <= GUARD_MEMORY:
        if g:
            os.remove(GUARD_FILE)
        return
    ended = end_done_pass(report, pressed=True)
    if ended:
        h = sample()
    report["memory_guard"] = {"memory": h["memory"], "ended": ended}
    if h["memory"] <= GUARD_MEMORY or now() - (g.get("alerted") or 0) < GUARD_ALERT_EVERY_MS:
        return
    k = hc_json("get", SCHEDULER)
    if not k or k.get("state") != "live":
        return
    agents = sum(1 for x in (hc_json("ls") or {}).get("terminals", []) if "/" not in x.get("address", "/")
                 and x.get("agent") and x.get("agent") not in SHELLS)
    alert = {"id": secrets.token_hex(4), "at": now(), "title": f"Memory at {h['memory']}%",
             "body": (f"Ended {len(ended)} finished agent{'s' if len(ended) != 1 else ''}. " if ended else "")
             + f"{agents} agents still run here. New tasks wait. Close apps or finish tasks before the system ends them all.",
             "about": True, "task": machine_name() or "This computer"}
    if run(["hc", "label", SCHEDULER, "herdr.alert=" + json.dumps(alert, ensure_ascii=False, separators=(",", ":"))]).returncode == 0:
        g["alerted"] = now()
        report["memory_guard"]["alert"] = alert["title"]
    tmp = f"{GUARD_FILE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(g, f)
    os.replace(tmp, GUARD_FILE)


RETRIES = os.path.join(STORE, ".retries.json")
STALE_CUT_MS = 30 * 60000


def retry_one(row, k, log, report):
    """One agent's provider retry: the row it has now (None: no cut). The row is
    {address, role, space, log, cut, tries, reason, due | over, nudged}."""
    addr = k["address"]
    cut = provider_cut(log) if log else None
    if not cut:
        return None
    if not row or row.get("cut") != cut["id"]:
        # One that ended long before Herdr first saw it is left to the person (old news).
        if (not row or not row.get("cut")) and cut.get("at") and now() - cut["at"] > STALE_CUT_MS:
            return {**(row or {}), "address": addr, "log": log, "cut": cut["id"], "stale": True}
        f = provider_error(cut["text"], cut["code"], cut["status"])
        wait = f["passing"] and cut["tries"] <= len(PROVIDER_WAITS) and PROVIDER_WAITS[cut["tries"] - 1]
        labels = k.get("labels") or {}
        row = {"address": addr, "role": labels.get("herdr.role") or "worker", "space": labels.get("herdr.space"),
               "log": log, "cut": cut["id"], "tries": cut["tries"],
               "reason": f"{f['reason']}, still after {cut['tries']} tries" if f["passing"] and not wait else f["reason"],
               "at": now(), **({"due": now() + wait * 60000} if wait else {"over": True})}
        report["retries"].append({"address": addr, "reason": row["reason"], "tries": row["tries"], "over": bool(row.get("over"))})
    # Not into words the person is writing to it (HERD-71): the next round tries again.
    if row.get("due") and row["due"] <= now() and status_word(k) != "working" and not typing(addr, k):
        r = run(["hc", "send", addr, NUDGE.format(row["reason"].lower())])
        if r.returncode == 0:
            row = {**row, "nudged": now()}
            row.pop("due")
    return row


def retry_pass(report):
    """Provider retries for every live coordinator and task worker here: a turn its provider cut
    off (its own log says so) gets "carry on" after 1, 2, 4 and 8 minutes; the fifth cut, or an
    error waiting can't fix, needs the person. Rows live in .retries.json; a task's row is also on
    the task (its "retry"), which its status reads. Reviewers are left alone, as are agents that
    work, ask (a card Herdr holds) or were written to since (their log no longer ends on the cut)."""
    report.setdefault("retries", [])
    try:
        with open(RETRIES) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    rows = {}
    for k in (hc_json("ls", "--label", "herdr.role=coordinator") or {}).get("terminals", []):
        if k.get("state") != "live" or "/" in k["address"] or held_ask(k["address"]):
            continue
        k = detail(k)
        k["labels"] = dict(k.get("labels") or {}, **{"herdr.role": "coordinator"})
        if not agent_running(k) or status_word(k) == "blocked":
            continue
        pid = (k.get("foreground") or {}).get("pid")
        was = old.get(k["address"]) or {}
        log = was.get("log") if was.get("pid") == pid and was.get("log") else (session_of(pid)[1] if pid else None)
        row = retry_one(was or None, k, log, report)
        if row:
            rows[k["address"]] = {**row, "pid": pid}
        elif pid and log:
            rows[k["address"]] = {"address": k["address"], "pid": pid, "log": log}
    for path in store_files():
        d = read_list(path)
        if not d or not os.path.isdir(d.get("folder") or ""):
            continue
        tasks = [t for t in d.get("tasks") or [] if t.get("state") == "running" or t.get("retry")]
        if not tasks:
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if t["state"] != "running":
                    if t.pop("retry", None):
                        s.dirty = True
                    continue
                mine = [detail(k) for k in live_agents(s.key(t))]
                want = None
                for k in mine:
                    if (k.get("labels") or {}).get("herdr.role") == "reviewer" or not agent_running(k) or held_ask(k["address"]):
                        continue
                    if not agent_log(t, k["address"]):
                        refresh_sessions(s, t, [k])
                    log = agent_log(t, k["address"])
                    # Blocked waits for the person, unless its log ends on what only the backup gets past.
                    if status_word(k) == "blocked" and not cant_go_on(log):
                        continue
                    b = t.get("backup") or {}
                    if b.get("state") == "started" and b.get("from_address") == k["address"]:
                        continue  # the agent its backup took over from, still ending
                    row = retry_one(old.get(k["address"]), k, log, report)
                    if row and row.get("over") and not row.get("stale"):
                        row = takeover(s, t, k, row, log, report)
                    if row:
                        row["task"] = f"{s.loc['folder']}#{t['id']}"
                        rows[k["address"]] = row
                    if row and not row.get("stale"):
                        want = {x: row[x] for x in ("address", "reason", "tries", "due", "over") if x in row}
                if (t.get("retry") or None) != want:
                    if want:
                        t["retry"] = want
                    else:
                        t.pop("retry", None)
                    s.dirty = True
                progress_clock(s, t, task_status(t, [k for k in mine if agent_running(k)])[0])
    if rows != old:
        tmp = f"{RETRIES}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(rows, f)
        os.replace(tmp, RETRIES)


def cmd_tick(args):
    """Starts queued tasks that can go now and finds merged ones. Cheap when nothing waits; one
    at a time (a second tick while one runs does nothing)."""
    os.makedirs(STORE, exist_ok=True)
    lock = open(os.path.join(STORE, ".tick.lock"), "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        say(args, {"busy": True}, "Another tick is running.")
        return
    report = {"started": [], "done": [], "attention": [], "fired": [], "retries": []}
    if getattr(args, "machine", None) or getattr(args, "hold", None):
        try:
            set_hold(args.machine, json.loads(args.hold) if args.hold else None)
        except ValueError:
            pass
    try:
        # First: an Assistant or worker the core gave a plain shell (a crash, a reboot) gets its agent back.
        revive_pass(report)
    except Exception as e:  # never stops the queue
        report["revive_error"] = str(e)
    try:
        retry_pass(report)
    except Exception as e:  # never stops the queue
        report["retry_error"] = str(e)
    try:
        archive_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["archive_error"] = str(e)
    for p in store_files(args.folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not (d.get("main_watch") or any(
                t.get("state") in ("queued", "scheduled", "ready") or (t.get("worktree") and t.get("state") == "running") for t in tasks)):
            continue
        with Store(locate(d["folder"])) as s:
            tick_store(s, report)
    try:
        news_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["news_error"] = str(e)
    try:
        end_done_pass(report, args.folder)
        memory_guard(report)
    except Exception as e:  # never stops the queue
        report["ended_error"] = str(e)
    try:
        lost_logs_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["logs_error"] = str(e)
    try:
        browser_pass(report)
    except Exception as e:  # never stops the queue
        report["browser_error"] = str(e)
    say(args, report, "; ".join(f"{k}: {v}" for k, v in report.items() if v) or "Nothing to do.")
