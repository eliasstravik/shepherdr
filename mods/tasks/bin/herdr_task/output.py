"""Output: a task as JSON and as one line of text."""

import json

from .base import now
from .agents import (
    agent_running, ask_reason, held_ask, last_words, own_line, status_word, STATUSES, task_status,
)
from .queues import waiting_ext, waiting_for


# ---- output ---------------------------------------------------------------------------------

def view(s, task, live=None):
    known, live = live is not None, live if live is not None else []
    running = [k for k in live if agent_running(k)]
    v = dict(task)
    v["key"] = s.key(task)
    v["folder"] = s.loc["folder"]
    v["status"], v["needs"], v["why"] = task_status(task, running)
    if v["needs"] == "asks":
        # Why it waits, at most LINE_MAX characters: a standard reason or its own question.
        k = next((k for k in running if status_word(k) == "blocked"), None)
        st = k.get("status") if k and isinstance(k.get("status"), dict) else {}
        v["why"] = own_line(task, k and k["address"]) or (ask_reason(task, k["address"], held_ask(k["address"]), st.get("kind"), st.get("msg")) if k else v["why"])
    if v["needs"] == "reply":
        # Refused ready with its rounds used up (review_refusal): the Assistant can add one.
        v["why"] = own_line(task) or ("Out of review rounds" if task.get("review_out") else None) or last_words(task)
    if known:
        progress_clock(s, task, v["status"])
    v["report"] = report_of(task, v["status"])
    v["status_text"] = STATUSES[v["status"]]
    v["live"] = [{"address": k["address"], "status": (k.get("status") or {}).get("state") if isinstance(k.get("status"), dict) else k.get("status"),
                  "tab": (k.get("labels") or {}).get("herdr.tab"), "role": (k.get("labels") or {}).get("herdr.role") or "worker"} for k in running]
    v["ref"], v["prefix"] = s.ref(task), s.prefix
    v["waiting_for"] = waiting_for(s, task)
    v["waiting_ext"] = waiting_ext(task)
    return v


def progress_clock(s, task, status):
    """A task's minutes left count down while it works and stop while it waits on the person: the
    report's clock (at) moves on by the time it waited (paused_at), noted whenever it's looked at."""
    p = task.get("progress")
    if not p or not s.write:
        return
    if status == "needs" and not p.get("paused_at"):
        p["paused_at"] = now()
        s.dirty = True
    elif status != "needs" and p.get("paused_at"):
        p["at"] = p.get("at", now()) + now() - p.pop("paused_at")
        s.dirty = True


# Minutes left show from the agent's very first estimate on, a rough guess beats none (as
# core/tasks.js estimated(), SHEP-13).
def estimated(p):
    return isinstance(p.get("left"), (int, float))


def report_of(task, status):
    """What its agent last reported (herdr-task status), as shown: {text, done, left (minutes, or
    None), paused}; None once it is ready, waits for a go or for other tasks."""
    p = task.get("progress")
    if not p or status not in ("working", "needs") or task["state"] != "running":
        return None
    left = None
    if estimated(p):
        rem = max(0, p["left"] - ((p.get("paused_at") or now()) - p.get("at", now())))
        left = 0 if rem < 60000 else -(-rem // 60000)
    return {"text": p.get("text", ""), "done": p.get("done"), "left": left, "paused": status == "needs"}


def minutes(n):
    return "<1m" if n < 1 else f"{n}m" if n < 60 else f"{round(n / 60)}h"


def say(args, data, text):
    if getattr(args, "json", False):
        print(json.dumps(data, indent=None))
    elif text:
        print(text)


def line(v):
    word = v.get("status_text") or v["state"]
    extra = v.get("why") or ""
    if v["status"] in ("ready", "merging") and not extra:
        extra = f"PR #{v['pr']['number']}" if v.get("pr") else v.get("branch") or ""
    elif v["status"] == "queued":
        wait = [f"{v['prefix']}-{i}" for i in v.get("waiting_for") or []] + (v.get("waiting_ext") or [])
        extra = v.get("reason") or ("after " + ", ".join(wait) if wait else "")
    elif v["status"] == "working" and v.get("report") and not extra:
        w = v["report"]
        extra = w["text"] + (f" · {w['done']}%" if w.get("done") is not None else "") + (f" · ~{minutes(w['left'])} left" if w.get("left") is not None else "")
    return f"{v['ref']:<7} {word:<9} {v['title']}" + (f"  ({extra})" if extra else "")
