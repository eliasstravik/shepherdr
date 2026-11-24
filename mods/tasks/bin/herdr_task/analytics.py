"""Personal analytics: a record, on this machine only, of how the person uses Shepherdr, for them and their agents.

The promise is the feature: nothing here ever leaves the person's machines. It records events and timings, never
content (no message text, prompts, titles, secrets or file contents: `clean` keeps only the fields named in FIELDS,
and only numbers, true/false or short id-like words). It reads and writes files in this machine's own data folder,
`analytics/` (layout.py), and nothing else: no network, no third party. Reading the person's other machines goes
over herdr-core's own links to them (`hc exec`, as every `herdr-task --on` does), never anywhere else.
test/test_analytics.py checks all of it. The service writes the app's own events with core/analytics.js, the same
rules in JavaScript (the test checks they agree).

One file per day, `YYYY-MM-DD.jsonl`, one event a line: {"t": ms, "e": name, ...fields}. Days older than KEEP_DAYS
fold into one small `rollup-YYYY-MM.json` per month (counts and summed timings), and rollups older than KEEP_MONTHS
go. A day's file stops growing at DAY_MAX. Off (Settings › Personal analytics) records nothing at all.
"""
import json
import os
import re
import shutil
import time

from .base import WHERE

KEEP_DAYS = 90
KEEP_MONTHS = 24
DAY_MAX = 4 * 1024 * 1024

# Every event and what it means. The same list is EVENTS in core/analytics.js.
EVENTS = {
    "app.opened": "the app opened on a device (device: phone, tablet or desktop)",
    "app.link_lost": "the app lost its link to the service",
    "message.sent": "a message sent to a chat (how: typed, dictated, bubble or talk)",
    "message.failed": "a message that didn't go through",
    "question.answered": "an agent's question answered (how: pick, typed or talk)",
    "task.added": "a task added",
    "task.started": "a task's agent started (waited_ms: from added to started)",
    "task.ready": "a task said it is ready for review (worked_ms: from started)",
    "task.sent_back": "a ready task sent back to work with feedback (wait_ms: how long it sat in Ready)",
    "task.done": "a task marked as done (wait_ms: how long it sat in Ready; merged)",
    "task.reopened": "a done task opened again",
    "task.stopped": "a task's agent stopped (by: you, error or limit)",
    "task.carried_on": "a stopped task's agent carried on (blocked_ms: how long it was stopped)",
    "task.needs_you": "a task needed the person",
    "task.needs_answered": "a task's Needs you cleared (wait_ms: how long it waited)",
    "task.removed": "a task deleted",
    "review.done": "a review round recorded on a task",
    "checks.failed": "a task's merge failed or its checks were red",
    "schedule.ran": "a schedule added its task",
    "schedule.failed": "a schedule's run failed",
    "settings.changed": "a setting changed (key: which one, never its value)",
    "shepherdr.updated": "Shepherdr updated on a machine",
    "analytics.on": "personal analytics switched on",
}

# The only fields an event may carry: numbers, true/false and short id-like words. Same as FIELDS in core/analytics.js.
FIELDS = {
    "task", "space", "machine", "chat", "agent", "model", "effort", "how", "device", "by", "mode", "key", "kind",
    "merged", "auto", "n", "ms", "wait_ms", "worked_ms", "waited_ms", "blocked_ms", "round", "version",
}
# fields whose words are one of a few, so nothing else fits there
CHOICES = {
    "how": {"typed", "dictated", "bubble", "talk", "pick"},
    "device": {"phone", "tablet", "desktop"},
    "by": {"you", "error", "limit"},
}
WORD = re.compile(r"^[A-Za-z0-9_.:@/\[\]-]{1,80}$")
DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")
ROLLUP = re.compile(r"^rollup-(\d{4}-\d{2})\.json$")


def folder():
    # a throwaway task store (tests, tries) keeps its record beside it, never in the real data folder
    if os.environ.get("HERDR_ANALYTICS_DIR"):
        return os.environ["HERDR_ANALYTICS_DIR"]
    if os.environ.get("HERDR_TASK_STORE"):
        return os.path.join(os.environ["HERDR_TASK_STORE"], ".analytics")
    return WHERE.path("analytics")


def settings_file():
    return os.environ.get("HERDR_TASK_SETTINGS") or WHERE.path("settings")


def is_on():
    """On unless the person switched it off (settings.json everywhere.analytics_off, which reaches every machine)."""
    try:
        with open(settings_file()) as f:
            return not ((json.load(f) or {}).get("everywhere") or {}).get("analytics_off")
    except (OSError, ValueError, AttributeError):
        return True


def clean(fields):
    """Only the allowed fields, each a number, true/false or a short id-like word (never text)."""
    out = {}
    for k, v in (fields or {}).items():
        if k not in FIELDS or v is None:
            continue
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)) and v == v and abs(v) < 1e15:
            out[k] = round(v) if k.endswith("ms") else v
        elif isinstance(v, str) and WORD.match(v) and (k not in CHOICES or v in CHOICES[k]):
            out[k] = v
    return out


def day_of(ms):
    return time.strftime("%Y-%m-%d", time.localtime(ms / 1000))


def record(event, at=None, **fields):
    """Append one event. Never raises: analytics must never get in the way of the work."""
    try:
        if event not in EVENTS or not is_on():
            return False
        t = int(at if at is not None else time.time() * 1000)
        line = json.dumps({"t": t, "e": event, **clean(fields)}, separators=(",", ":")) + "\n"
        d = folder()
        os.makedirs(d, mode=0o700, exist_ok=True)
        p = os.path.join(d, day_of(t) + ".jsonl")
        try:
            if os.path.getsize(p) > DAY_MAX:
                return False
        except OSError:
            pass
        fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(fd, line.encode())
        finally:
            os.close(fd)
        roll()
        return True
    except Exception:
        return False


def roll(now_ms=None):
    """Once a day: days older than KEEP_DAYS fold into their month's rollup; rollups older than KEEP_MONTHS go."""
    d = folder()
    now_ms = now_ms or time.time() * 1000
    today = day_of(now_ms)
    mark = os.path.join(d, ".rolled")
    try:
        with open(mark) as f:
            if f.read().strip() == today:
                return
    except OSError:
        pass
    cut = day_of(now_ms - KEEP_DAYS * 86400_000)
    month_cut = time.strftime("%Y-%m", time.localtime(now_ms / 1000 - KEEP_MONTHS * 31 * 86400))
    for name in sorted(os.listdir(d)):
        m = DAY.match(name)
        if m and m.group(1) < cut:
            fold(os.path.join(d, name), os.path.join(d, f"rollup-{m.group(1)[:7]}.json"))
        r = ROLLUP.match(name)
        if r and r.group(1) < month_cut:
            os.remove(os.path.join(d, name))
    with open(mark, "w") as f:
        f.write(today)


def fold(day_path, rollup_path):
    try:
        with open(rollup_path) as f:
            r = json.load(f)
    except (OSError, ValueError):
        r = {}
    counts, sums = r.setdefault("counts", {}), r.setdefault("sums", {})
    for ev in read_file(day_path):
        e = ev["e"]
        counts[e] = counts.get(e, 0) + 1
        for k, v in ev.items():
            if k.endswith("ms") and isinstance(v, (int, float)):
                sums[f"{e}.{k}"] = sums.get(f"{e}.{k}", 0) + v
    r.setdefault("days", [])
    r["days"] = sorted(set(r["days"]) | {os.path.basename(day_path)[:10]})
    tmp = rollup_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(r, f, separators=(",", ":"))
    os.replace(tmp, rollup_path)
    os.remove(day_path)


def read_file(p):
    out = []
    try:
        with open(p) as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if isinstance(ev, dict) and isinstance(ev.get("t"), (int, float)) and ev.get("e") in EVENTS:
                    out.append({"t": ev["t"], "e": ev["e"], **clean(ev)})
    except OSError:
        pass
    return out


def events(days, now_ms=None):
    """This machine's events of the last `days` days, oldest first."""
    now_ms = now_ms or time.time() * 1000
    since = now_ms - days * 86400_000
    d = folder()
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return []
    first = day_of(since)
    out = []
    for name in names:
        m = DAY.match(name)
        if m and m.group(1) >= first:
            out += [e for e in read_file(os.path.join(d, name)) if e["t"] >= since]
    return sorted(out, key=lambda e: e["t"])


def files():
    d = folder()
    try:
        return [os.path.join(d, n) for n in sorted(os.listdir(d)) if DAY.match(n) or ROLLUP.match(n)]
    except OSError:
        return []


def delete():
    """Everything stored here, gone: the folder itself."""
    d = folder()
    had = os.path.isdir(d)
    shutil.rmtree(d, ignore_errors=True)
    return had and not os.path.exists(d)


# ---- reading it: numbers and plain words -------------------------------------------------------------------------

def stat(values):
    v = sorted(x for x in values if isinstance(x, (int, float)))
    if not v:
        return None
    return {"n": len(v), "avg_ms": round(sum(v) / len(v)), "median_ms": round(v[len(v) // 2])}


def summary(evs, days, machines=None):
    """The main numbers for a period, from events (each may carry "machine")."""
    def of(name):
        return [e for e in evs if e["e"] == name]

    def count_by(rows, key):
        out = {}
        for e in rows:
            if e.get(key) is not None:
                out[str(e[key])] = out.get(str(e[key]), 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    sent = of("message.sent")
    agents = {}
    for e in of("task.ready"):
        k = "/".join(str(e.get(x) or "?") for x in ("agent", "model", "effort"))
        a = agents.setdefault(k, {"agent": e.get("agent"), "model": e.get("model"), "effort": e.get("effort"), "tasks": 0, "worked": []})
        a["tasks"] += 1
        a["worked"].append(e.get("worked_ms"))
    out = {
        "days": days,
        "events": len(evs),
        "machines": machines or sorted({e.get("machine") for e in evs if e.get("machine")}),
        "app": {"opened": len(of("app.opened")), "devices": count_by(of("app.opened"), "device")},
        "messages": {"sent": len(sent), "how": count_by(sent, "how"), "chats": dict(list(count_by(sent, "chat").items())[:5]),
                     "failed": len(of("message.failed"))},
        "questions": {"answered": len(of("question.answered")), "how": count_by(of("question.answered"), "how")},
        "tasks": {k: len(of(f"task.{k}")) for k in ("added", "started", "ready", "sent_back", "done", "reopened", "removed")},
        "stopped": count_by(of("task.stopped"), "by"),
        "waits": {
            "ready_for_review": stat([e.get("wait_ms") for e in of("task.done") + of("task.sent_back")]),
            "needs_you": stat([e.get("wait_ms") for e in of("task.needs_answered")]),
            "blocked": stat([e.get("blocked_ms") for e in of("task.carried_on")]),
            "before_start": stat([e.get("waited_ms") for e in of("task.started")]),
            "working": stat([e.get("worked_ms") for e in of("task.ready")]),
        },
        "agents": sorted(({**{k: v for k, v in a.items() if k != "worked"}, "worked": stat(a["worked"])} for a in agents.values()),
                         key=lambda a: -a["tasks"]),
        "reviews": len(of("review.done")),
        "checks_failed": len(of("checks.failed")),
        "schedules": {"ran": len(of("schedule.ran")), "failed": len(of("schedule.failed"))},
        "settings_changed": count_by(of("settings.changed"), "key"),
        "updates": len(of("shepherdr.updated")),
        "errors": {"send_failed": len(of("message.failed")), "link_lost": len(of("app.link_lost"))},
        "spaces": dict(list(count_by(of("task.added"), "space").items())[:5]),
    }
    out["text"] = words(out)
    return out


def took(ms):
    if ms is None:
        return "-"
    m = ms / 60000
    return f"{round(m)} min" if m < 90 else f"{m / 60:.1f} h" if m < 48 * 60 else f"{m / 1440:.1f} days"


def words(s):
    """A short plain summary of the numbers."""
    d = s["days"]
    period = "today" if d <= 1 else "this week" if d <= 7 else "this month" if d <= 31 else f"the last {d} days"
    if not s["events"]:
        return f"Nothing recorded {period} yet."
    m, t, w = s["messages"], s["tasks"], s["waits"]
    lines = [f"{period.capitalize()}: the app opened {s['app']['opened']} times"
             + (f" ({', '.join(f'{v} {k}' for k, v in s['app']['devices'].items())})" if s["app"]["devices"] else "") + "."]
    if m["sent"]:
        lines.append(f"{m['sent']} messages sent: " + ", ".join(f"{v} {k}" for k, v in m["how"].items()) + ".")
    lines.append(f"Tasks: {t['added']} added, {t['done']} done, {t['sent_back']} sent back, {t['reopened']} reopened.")
    if w["ready_for_review"]:
        lines.append(f"Tasks waited on you at Ready for review {took(w['ready_for_review']['avg_ms'])} on average "
                     f"(median {took(w['ready_for_review']['median_ms'])}).")
    if w["needs_you"]:
        lines.append(f"Needs you was answered after {took(w['needs_you']['avg_ms'])} on average.")
    if w["blocked"]:
        lines.append(f"Stopped agents sat {took(w['blocked']['avg_ms'])} on average before carrying on.")
    if s["questions"]["answered"]:
        lines.append(f"{s['questions']['answered']} agent questions answered.")
    if s["agents"]:
        a = s["agents"][0]
        lines.append(f"Most used for tasks: {a['agent']} {a['model'] or ''} {a['effort'] or ''}".rstrip() + f" ({a['tasks']} tasks).")
    if s["errors"]["send_failed"] or s["errors"]["link_lost"]:
        lines.append(f"Problems: {s['errors']['send_failed']} failed sends, {s['errors']['link_lost']} lost connections.")
    return "\n".join(lines)


# ---- what a task's changes say: one place, where a task list is saved (store.Store.save) ------------------------

def _snap(t):
    return {"state": t.get("state"), "stopped_by": t.get("stopped_by"), "stopped_at": t.get("stopped_at"), "attention": bool(t.get("attention")),
            "reviews": len(t.get("reviews") or []), "merge_failed": bool(t.get("merge_failed"))}


def snapshot(tasks):
    return {t.get("id"): _snap(t) for t in tasks or [] if isinstance(t, dict)}


def changes(before, tasks, space_of=None, now_ms=None):
    """The events a saved task list says happened since `before` (snapshot()). Only ids and timings."""
    now_ms = now_ms or int(time.time() * 1000)
    out = []
    after = {t.get("id"): t for t in tasks or [] if isinstance(t, dict)}
    for i, t in after.items():
        was, now = before.get(i), _snap(t)
        base = {"task": t.get("ref") or (str(i) if i is not None else None), "space": t.get("space"), "mode": t.get("mode")}
        who = {"agent": t.get("agent"), "model": t.get("model"), "effort": t.get("effort")}
        if was is None:
            out.append(("task.added", {**base, "auto": bool(t.get("automation"))}))
            was = {"state": None, "stopped_by": None, "stopped_at": None, "attention": False, "reviews": 0, "merge_failed": False}
        a, b = was["state"], now["state"]
        if a != b:
            if b == "running" and a in (None, "todo", "queued"):
                out.append(("task.started", {**base, **who, "waited_ms": _since(t.get("created"), t.get("started"))}))
            elif b == "ready":
                out.append(("task.ready", {**base, **who, "worked_ms": _since(t.get("started"), t.get("ready_at") or now_ms)}))
            elif b == "running" and a == "ready":
                out.append(("task.sent_back", {**base, "wait_ms": _since(t.get("ready_at"), now_ms)}))
            elif b == "done":
                out.append(("task.done", {**base, **who, "merged": bool(t.get("merged")),
                                          "wait_ms": _since(t.get("ready_at"), t.get("done_at") or now_ms) if a == "ready" else None}))
            elif a == "done":
                out.append(("task.reopened", base))
        if now["stopped_by"] and not was["stopped_by"]:
            out.append(("task.stopped", {**base, "by": now["stopped_by"]}))
        elif was["stopped_by"] and not now["stopped_by"] and b == "running":
            out.append(("task.carried_on", {**base, "blocked_ms": _since(was.get("stopped_at"), now_ms)}))
        if now["attention"] and not was["attention"]:
            out.append(("task.needs_you", base))
        elif was["attention"] and not now["attention"]:
            out.append(("task.needs_answered", {**base, "wait_ms": None}))
        if now["reviews"] > was["reviews"]:
            out.append(("review.done", {**base, "round": now["reviews"]}))
        if now["merge_failed"] and not was["merge_failed"]:
            out.append(("checks.failed", base))
    for i in before:
        if i not in after:
            out.append(("task.removed", {"task": str(i)}))
    return out


def _since(a, b):
    return b - a if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b >= a else None


class Waits:
    """When a task's Needs you started, kept beside the record so its answer can say how long it waited."""

    @staticmethod
    def path():
        return os.path.join(folder(), ".needs.json")

    @classmethod
    def mark(cls, evs, now_ms):
        if not any(e in ("task.needs_you", "task.needs_answered") for e, _ in evs):
            return evs
        try:
            with open(cls.path()) as f:
                held = json.load(f)
        except (OSError, ValueError):
            held = {}
        for e, f in evs:
            k = f.get("task")
            if e == "task.needs_you" and k:
                held[k] = now_ms
            elif e == "task.needs_answered" and k in held:
                f["wait_ms"] = now_ms - held.pop(k)
        try:
            os.makedirs(folder(), mode=0o700, exist_ok=True)
            with open(cls.path(), "w") as f:
                json.dump(dict(list(held.items())[-500:]), f)
        except OSError:
            pass
        return evs


def saved(before, data):
    """A task list was saved: record what changed in it. Never raises."""
    try:
        if not is_on():
            return
        now_ms = int(time.time() * 1000)
        prefix = data.get("prefix")
        tasks = [dict(t, ref=f"{prefix}-{t.get('id')}" if prefix else t.get("id")) for t in data.get("tasks") or [] if isinstance(t, dict)]
        evs = changes(before, tasks, now_ms=now_ms)
        for e, f in Waits.mark(evs, now_ms):
            if e == "task.removed" and prefix:
                f["task"] = f"{prefix}-{f['task']}"
            record(e, at=now_ms, **f)
    except Exception:
        pass


# ---- the command: herdr-task analytics ----------------------------------------------------------------------------

PERIODS = {"day": 1, "week": 7, "month": 30}


def _others():
    """The person's other machines, over herdr-core's own links (their names only)."""
    from .machines import connected_machines
    try:
        return [m["name"] for m in connected_machines() if isinstance(m, dict) and m.get("name")]
    except Exception:
        return []


def _theirs(machine, argv):
    """herdr-task analytics on one of the person's own machines, over its herdr-core link: its JSON, or None."""
    from .cli import remote_run
    try:
        r = remote_run(machine, ["analytics", *argv, "--here", "--json"], timeout=60)
        return json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None


def cmd_analytics(args):
    days = PERIODS.get(args.period) if args.period else None
    days = days or max(1, min(int(args.days or 7), 3660))
    what = args.what or "show"
    here = "this machine"
    if what in ("on", "off"):
        p = settings_file()
        try:
            with open(p) as f:
                s = json.load(f)
        except (OSError, ValueError):
            s = {}
        e = s.setdefault("everywhere", {})
        if what == "off":
            e["analytics_off"] = True
        else:
            e.pop("analytics_off", None)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = f"{p}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(s, f, indent=2)
        os.replace(tmp, p)
        if what == "on":
            record("analytics.on")
        out = {"on": what == "on"}
        print(json.dumps(out) if args.json else f"Personal analytics: {what}.")
        return 0
    others = [] if args.here else _others()
    if what == "delete":
        out = {"deleted": {here: delete() or not os.path.exists(folder())}}
        for m in others:
            r = _theirs(m, ["delete"])
            out["deleted"][m] = bool(r and all((r.get("deleted") or {}).values()))
        print(json.dumps(out) if args.json else "\n".join(f"{k}: {'deleted' if v else 'not reached, nothing deleted there'}" for k, v in out["deleted"].items()))
        return 0 if all(out["deleted"].values()) else 1
    evs = events(days)
    unreached = []
    for m in others:
        r = _theirs(m, ["raw", "--days", str(days)])
        if r is None:
            unreached.append(m)
            continue
        evs += [dict(e, machine=e.get("machine") or m) for e in r.get("events") or [] if isinstance(e, dict) and e.get("e") in EVENTS]
    evs.sort(key=lambda e: e["t"])
    if what in ("raw", "export"):
        out = {"days": days, "on": is_on(), "events": evs, "unreached": unreached, "meaning": EVENTS}
        if what == "export":
            out["exported_at"] = int(time.time() * 1000)
            out["promise"] = "Personal analytics stay on your machines: never sent to anyone, not to Shepherdr's makers either."
        if args.json or what == "export":
            print(json.dumps(out, separators=(",", ":")))
        else:
            for e in evs:
                print(time.strftime("%Y-%m-%d %H:%M", time.localtime(e["t"] / 1000)), e["e"],
                      " ".join(f"{k}={v}" for k, v in e.items() if k not in ("t", "e")))
        return 0
    s = summary(evs, days, machines=None)
    s["on"] = is_on()
    s["unreached"] = unreached
    print(json.dumps(s, separators=(",", ":")) if args.json else s["text"] + (f"\n(Not reached: {', '.join(unreached)}.)" if unreached else ""))
    return 0
