"""Home: each machine's home space (the space at its home folder, ~) has an Assistant that also
looks after the machine, as Shepherdr's home coordinator: its disk, load and memory (HERD-40's
health sample), processes stuck busy, and worktrees finished tasks left behind. Herdr tells it in
tagged lines only what changed (a meter crossing its alert limit or coming back, a process newly
stuck, worktrees newly left over); it tells the person only what matters. The main machine's home
Assistant (where the window lives) also keeps every machine's overview: every space's task news,
one line each, and each home machine's health news.

Opt-in per machine: Shepherdr settings machines[<name> | "local"].home (true / false); unset, on
for this computer only. The main machine's scheduler does all of it (home_pass): it reads each
home machine (`herdr-task home report` there, over its herdr-core link) once a minute, judges,
and sends. Nothing is installed or run on another machine beyond herdr-task itself.
"""

import json
import os
import re
import subprocess
import threading

from .base import APP_HOME, Fail, guard, HOME, hc_json, now, run, STORE, WHERE
from .settings import LOCAL_MACHINE, SETTINGS
from .output import say
from .store import is_task_list, read_list, store_files

HOME_STATE = os.path.join(STORE, ".home.json")
NEWSLOG = os.path.join(STORE, ".newslog.json")  # news_pass's sent lines, for the overview
NEWSLOG_KEEP = 300
EVERY_MS = 60000               # a round reads every home machine this often
LOAD_FOR_MS = 120000           # the load stays over its limit this long first: one test run's spike is no news
BACK_UNDER = 0.9               # back under: below this share of its limit, so a value hovering at it is told once
STUCK_AFTER_S = 30 * 60        # busy since at least this long ...
STUCK_SHARE = 0.9              # ... at this share of one core all along: stuck
LEFTOVER_MS = 24 * 3600000     # a finished task's worktree this long after it finished: left over
KEEP_MS = 6 * 3600000          # lines nobody could be told (no live home Assistant) this long: dropped


def main_here():
    """This is the main machine: the Herdr window lives here."""
    return os.path.isdir(os.path.join(APP_HOME, "mods"))


def read_settings():
    try:
        with open(SETTINGS) as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def home_on(cfg, key):
    """Whether machine `key` ("local" or its name) has a home Assistant: its own setting, else on
    for this computer only. On another machine its pushed settings say which it is ("here")."""
    v = ((cfg.get("machines") or {}).get(key) or {}).get("home")
    return v if isinstance(v, bool) else key == LOCAL_MACHINE


# ---- what one machine knows of itself (runs there) ------------------------------------------

def _secs(text):
    """ps times ([[dd-]hh:]mm:ss[.xx]) in seconds."""
    days, _, rest = text.strip().rpartition("-")
    parts = [float(p) for p in rest.split(":") if p]
    s = 0.0
    for p in parts:
        s = s * 60 + p
    return s + (int(days) * 86400 if days else 0)


def processes():
    """This user's processes: [{pid, name, args, up (s), cpu_s, cpu (%), rss (bytes)}]."""
    try:
        out = subprocess.run(["ps", "-axo", "pid=,uid=,etime=,time=,pcpu=,rss=,args="], stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, universal_newlines=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    me, rows = os.getuid(), []
    for line in out.splitlines():
        f = line.split(None, 6)
        if len(f) < 7 or not f[0].isdigit() or f[1] != str(me):
            continue
        try:
            rows.append({"pid": int(f[0]), "up": int(_secs(f[2])), "cpu_s": int(_secs(f[3])), "cpu": float(f[4]),
                         "rss": int(f[5]) * 1024, "args": " ".join(f[6].split())[:120],
                         "name": os.path.basename(f[6].split()[0])})
        except ValueError:
            continue
    return rows


def stuck(rows):
    """Processes busy on a whole core all along for STUCK_AFTER_S or more: a runaway loop, a hung
    build, a test that never ends. Each with how long and how busy."""
    return [{"pid": p["pid"], "name": p["name"], "args": p["args"], "hours": round(p["up"] / 3600, 1),
             "share": round(p["cpu_s"] / p["up"], 2), "start": now() // 1000 - p["up"]}
            for p in rows if p["up"] >= STUCK_AFTER_S and p["cpu_s"] >= STUCK_SHARE * p["up"] and p["pid"] != os.getpid()]


def top(rows, n=3):
    """What uses the machine most: the most memory, the most CPU (lifetime share)."""
    gb = lambda b: f"{b / 2 ** 30:.1f} GB"
    mem = sorted(rows, key=lambda p: -p["rss"])[:n]
    cpu = sorted((p for p in rows if p["up"] >= 300), key=lambda p: -p["cpu"])[:n]
    return {"memory": [f"{p['name']} {gb(p['rss'])} (pid {p['pid']})" for p in mem],
            "cpu": [f"{p['name']} {round(p['cpu'])}% (pid {p['pid']})" for p in cpu if p["cpu"] >= 5]}


def leftover_worktrees():
    """Task worktrees (<root>/<repo>/<branch>, in every root: the old ~/.herdr/worktrees drains) whose task finished more than LEFTOVER_MS ago,
    or that no task here knows: [{path, task, state, days, dirty}]. dirty: uncommitted work there,
    never to be removed without the person."""
    known = {}
    for p in store_files():
        d = read_list(p)
        if not is_task_list(d):
            continue
        for t in d.get("tasks") or []:
            if t.get("worktree"):
                known[os.path.realpath(t["worktree"])] = (f"{d.get('prefix') or 'T'}-{t['id']}", t)
    out = []
    pairs = []
    for root in WHERE.worktree_roots(str((read_settings().get("everywhere") or {}).get("tasks", {}).get("worktree_root") or "").strip() or None):
        try:
            pairs += [(root, r) for r in sorted(os.listdir(root))]
        except OSError:
            pass
    seen = set()
    for wroot, repo in pairs:
        try:
            branches = sorted(os.listdir(os.path.join(wroot, repo)))
        except OSError:
            continue
        for b in branches:
            path = os.path.join(wroot, repo, b)
            if os.path.realpath(path) in seen:
                continue
            seen.add(os.path.realpath(path))
            if not os.path.isdir(path):
                continue
            ref, t = known.get(os.path.realpath(path), (None, None))
            if t and (t.get("state") != "done" or now() - (t.get("done_at") or now()) < LEFTOVER_MS):
                continue
            if not t:
                try:
                    if now() - int(os.path.getmtime(path) * 1000) < LEFTOVER_MS:
                        continue
                except OSError:
                    continue
            r = subprocess.run(["git", "-C", path, "status", "--porcelain"], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, universal_newlines=True)
            out.append({"path": path.replace(HOME, "~", 1), "task": ref, "state": (t or {}).get("state"),
                        "days": int((now() - ((t or {}).get("done_at") or now())) / 86400000) if t else None,
                        "dirty": bool(r.stdout.strip()) if r.returncode == 0 else None})
    return out


def assistant_in(space):
    """The space's live Assistant here, or None."""
    from .launch import coordinator_in
    return coordinator_in(space)


def local_report(candidates=None, since=None, news_only=False):
    """This machine's facts: {machine, home, space, assistant, health, top, stuck, worktrees,
    news}. candidates: [[space id, folder]] of this machine's spaces; the first at the home folder
    is the home space. since: news log lines after this time (ms); None: none."""
    from .machine import sample
    out = {"home": HOME, "at": now()}
    real = os.path.realpath(HOME)
    space = next((sid for sid, folder in candidates or [] if folder and os.path.realpath(folder) == real), None)
    if space:
        out["space"], out["assistant"] = space, assistant_in(space)
    if since is not None:
        try:
            with open(NEWSLOG) as f:
                log = json.load(f)
        except (OSError, ValueError):
            log = []
        out["news"] = [x for x in log if x.get("at", 0) > since]
    if not news_only:
        rows = processes()
        out.update({"health": sample(), "top": top(rows), "stuck": stuck(rows), "worktrees": leftover_worktrees()})
    return out


def log_news(entries):
    """news_pass's sent batches go here too (at most NEWSLOG_KEEP lines): the main machine's home
    Assistant reads every machine's (overview)."""
    try:
        with open(NEWSLOG) as f:
            log = json.load(f)
    except (OSError, ValueError):
        log = []
    log = (log + entries)[-NEWSLOG_KEEP:]
    tmp = f"{NEWSLOG}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(log, f)
    os.replace(tmp, NEWSLOG)


# ---- the main machine's round ---------------------------------------------------------------

def remote_report(machine, candidates, since, news_only, timeout=40):
    guard(["hc"])
    args = ["home", "report", "--json", "--spaces", json.dumps(candidates)]
    if since is not None:
        args += ["--since", str(since)]
    if news_only:
        args.append("--news-only")
    cmd = 'exec "$HOME/.local/bin/herdr-task" "$@"'
    try:
        r = subprocess.run(["hc", "exec", "--on", machine, "--timeout", str(timeout), "--", "sh", "-c", cmd, "sh", *args],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=timeout + 15)
    except subprocess.TimeoutExpired:
        raise Fail("timed out")
    line = next((l for l in reversed(r.stdout.splitlines()) if l.startswith("{")), None)
    if r.returncode != 0 or not line:
        raise Fail((r.stderr or r.stdout).strip()[-200:] or "no answer")
    d = json.loads(line)
    if d.get("error"):
        raise Fail(d["error"])
    return d


def judge(was, h):
    """Shepherdr's: each meter told once when over its alert limit long enough, and again (back)
    once well under. was/next: {kind: {since, told}}. Returns (next, [(kind, "over" | "back")])."""
    from .machine import ALERT
    alert = {"cpu": (h["load"], ALERT["load"] * h["cores"]), "memory": (h["memory"], ALERT["memory"]),
             "disk": (h["disk"], ALERT["disk"])}
    hold = {"cpu": LOAD_FOR_MS, "memory": 0, "disk": 0}
    nxt, events, at = {}, [], now()
    for kind, (v, limit) in alert.items():
        w = dict(was.get(kind) or {})
        if w.get("told"):
            if v < limit * BACK_UNDER:
                events.append((kind, "back"))
            else:
                nxt[kind] = w
            continue
        if v <= limit:
            continue
        w.setdefault("since", at)
        if at - w["since"] >= hold[kind]:
            w["told"] = True
            events.append((kind, "over"))
        nxt[kind] = w
    return nxt, events


def meters_words(h):
    disks = " · ".join(f"{d['path']} {d['pct']}% ({d['free_gb']} GB free)" for d in h.get("disks") or [])
    return (f"CPU {h['cpu']}% (load {h['load']} on {h['cores']} cores) · Memory {h['memory']}% · Disk {h['disk']}%"
            + (f" [{disks}]" if disks else ""))


def attr(x):
    return str(x).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def tagged(tag, text, **attrs):
    a = "".join(f' {k}="{attr(v)}"' for k, v in attrs.items() if v is not None)
    return f"<{tag}{a}>{str(text).replace('<', '‹').replace('>', '›')}</{tag}>"


def health_lines(name, rep, st):
    """What changed on one home machine since it was last told: [(line, overview words)]. st is
    its state ({meters, stuck, worktrees}), updated in place."""
    out, h = [], rep.get("health")
    label = name or "this computer"
    if h:
        st["meters"], events = judge(st.get("meters") or {}, h)
        names = {"cpu": "CPU", "memory": "Memory", "disk": "Disk"}
        t = rep.get("top") or {}
        uses = "; ".join(x for x in (f"most memory: {', '.join(t['memory'])}" if t.get("memory") else "",
                                     f"most CPU: {', '.join(t['cpu'])}" if t.get("cpu") else "") if x)
        for kind, what in events:
            words = f"{names[kind]} {'crossed its alert limit' if what == 'over' else 'is back under its alert limit'}"
            text = f"{words}. Now: {meters_words(h)}." + (f" {uses[0].upper()}{uses[1:]}." if uses and what == "over" else "")
            if what == "over":
                text += " Inspect the machine before changing tasks."
            out.append((tagged("herdr-health", text, machine=name or "", event=f"{kind}-{what}"), f"{words} ({names[kind]} {h[kind]}%)"))
    told = {str(x) for x in st.get("stuck") or []}
    now_stuck = rep.get("stuck") or []
    ids = [f"{p['pid']}@{p['start'] // 60}" for p in now_stuck]  # pid and start: a reused pid is a new process
    fresh = [p for p, i in zip(now_stuck, ids) if i not in told]
    st["stuck"] = ids
    if fresh:
        what = "; ".join(f"{p['name']} (pid {p['pid']}) busy at {round(p['share'] * 100)}% of a core for {p['hours']} h: {p['args']}" for p in fresh[:5])
        more = f"; and {len(fresh) - 5} more" if len(fresh) > 5 else ""
        text = f"{'A process looks' if len(fresh) == 1 else f'{len(fresh)} processes look'} stuck: {what}{more}. Look before stopping anything; ask the person unless it's clearly yours."
        out.append((tagged("herdr-health", text, machine=name or "", event="stuck"), f"{len(fresh)} process{'es look' if len(fresh) > 1 else ' looks'} stuck"))
    paths = [w["path"] for w in rep.get("worktrees") or []]
    told_wt = set(st.get("worktrees") or [])
    new_wt = [w for w in rep.get("worktrees") or [] if w["path"] not in told_wt]
    if "worktrees" in rep:
        st["worktrees"] = paths
    if new_wt:
        def one(w):
            why = f"{w['task']} done {w['days']} d ago" if w.get("task") else "no task knows it"
            return f"{w['path']} ({why}{', has uncommitted changes' if w.get('dirty') else ''})"
        listed = "; ".join(one(w) for w in new_wt[:6]) + (f"; and {len(new_wt) - 6} more" if len(new_wt) > 6 else "")
        text = (f"{len(new_wt)} leftover worktree{'s' if len(new_wt) > 1 else ''} of finished tasks: {listed}. Tell the person and "
                "offer to clean up only what is safely finished (`git worktree remove` in its repo); never remove one with uncommitted changes.")
        out.append((tagged("herdr-health", text, machine=name or "", event="worktrees"), f"{len(new_wt)} leftover worktree{'s' if len(new_wt) > 1 else ''}"))
    return out


def deliver(to, lines, quiet=None, idle_only=False):
    """Sends one message of lines to an Assistant; False when it can't take it now. idle_only:
    not while it works (the overview alone never steers a turn about something else)."""
    from .news import news_send, READ
    from .agents import status_word
    k = hc_json("get", to) or {}
    if k.get("state") != "live" or (idle_only and status_word(k) == "working") or not news_send(to, "\n".join(lines)):
        return False
    read = (k.get("labels") or {}).get(READ)
    if quiet is not None and "/" not in to and str(read) == str(k.get("turn")) and to not in quiet:
        quiet[to] = {"turn": k.get("turn"), "at": now()}
    return True


def home_pass(report, force=False, only=None, to=None):
    """The main machine's round, at most every EVERY_MS: each home machine's health news to its own
    home Assistant; every machine's task news and each home machine's health news, one line each,
    to the main machine's home Assistant. only: just this machine ("local" or a name; a test).
    to: send everything to this address instead (a test's own Assistant)."""
    if not main_here() and not to:
        return
    try:
        with open(HOME_STATE) as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    if not force and now() - state.get("at", 0) < EVERY_MS:
        return
    state["at"] = now()
    cfg = read_settings()
    r = run(["herdr-app", "ls"])
    try:
        spaces = json.loads(r.stdout).get("spaces") or [] if r.returncode == 0 else []
    except ValueError:
        spaces = []
    from .machines import connected_machines
    names = [None] + [m["name"] for m in connected_machines() if m.get("state") == "connected"]
    key = lambda m: m or LOCAL_MACHINE
    if only:
        names = [m for m in names if key(m) == only]
    main_on = home_on(cfg, LOCAL_MACHINE)
    machines = state.setdefault("machines", {})
    reports, errors = {}, {}

    def look(m):
        k = key(m)
        on = home_on(cfg, k)
        if not on and not main_on:
            return
        mine = [[s["id"].split("/")[-1], s.get("folder")] for s in spaces if (s.get("machine") or None) == m]
        st = machines.setdefault(k, {})
        since = st.get("news_at") if main_on else None
        if main_on and since is None:
            since = now()  # the first look: old news isn't news
            st["news_at"] = since
        try:
            reports[k] = local_report(mine, since, not on) if m is None else remote_report(m, mine, since, not on)
        except Exception as e:  # one machine never stops the rest
            errors[k] = str(e)[:200]

    threads = [threading.Thread(target=look, args=(m,)) for m in names]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    outbox = state.setdefault("outbox", [])
    main_rep = reports.get(LOCAL_MACHINE) or {}
    main_to = to or main_rep.get("assistant")
    for m in names:
        k = key(m)
        rep = reports.get(k)
        if not rep:
            continue
        st = machines[k]
        if rep.get("news"):
            st["news_at"] = max(x.get("at", 0) for x in rep["news"])
        if not home_on(cfg, k) or "health" not in rep:
            continue
        st["space"] = rep.get("space")
        st["assistant"] = rep.get("assistant") and (f"{m}/{rep['assistant']}" if m else rep["assistant"])
        for line, words in health_lines(m, rep, st):
            outbox.append({"to": f"home:{k}", "line": line, "at": now()})
            if m and main_on:
                outbox.append({"to": "home:local", "line": tagged("herdr-overview", f"Machine {m}: {words}", machine=m, event="health"), "at": now()})
    if main_on:
        names_by_id = {s["id"]: s.get("name") for s in spaces}
        for m in names:
            for x in (reports.get(key(m)) or {}).get("news") or []:
                to_there = f"{m}/{x['to']}" if m and x.get("to") else x.get("to")
                if to_there and to_there == main_to:
                    continue  # its own space's news: it had them
                sid = f"{m}/{x.get('space')}" if m else x.get("space")
                space = names_by_id.get(sid) or x.get("folder") or "?"
                place = f"{m} · {space}" if m else space
                for line in x.get("lines") or []:
                    mt = re.match(r'<herdr-news task="([^"]*)" event="([^"]*)">(.*)</herdr-news>$', line)
                    task, event, text = mt.groups() if mt else (None, None, re.sub(r"<[^>]+>", "", line))
                    text = text.split(" · For AGENTS.md:")[0]  # the space's own Assistant decides that
                    outbox.append({"to": "home:local", "line": tagged("herdr-overview", f"{place}: {text}", machine=m or "",
                                                                                space=space, task=task, event=event), "at": now()})
    # Each line waits for its home's Assistant (as seen this round): one that isn't live yet, or
    # whose machine didn't answer, gets it on a later round.
    homes = {f"home:{k}": to or machines[k].get("assistant") for k in reports if k in machines}
    homes["home:local"] = main_to
    quiet = state.setdefault("quiet", {})
    sent = report.setdefault("home", [])
    outbox[:] = [x for x in outbox if now() - x["at"] < KEEP_MS]
    by = {}
    for x in outbox:
        if homes.get(x["to"]):
            by.setdefault(homes[x["to"]], []).append(x)
    for dest, batch in by.items():
        idle_only = all(x["line"].startswith("<herdr-overview") for x in batch)
        if deliver(dest, [x["line"] for x in batch], quiet, idle_only):
            outbox[:] = [x for x in outbox if x not in batch]
            sent.append({"to": dest, "lines": [x["line"] for x in batch]})
    # A machine that can't answer is said once per new reason (an older herdr-task there says so
    # every round until it's synced).
    for k in reports:
        machines.get(k, {}).pop("error", None)
    told = {k: e for k, e in errors.items() if machines.setdefault(k, {}).get("error") != e}
    for k, e in errors.items():
        machines[k]["error"] = e
    if told:
        report["home_errors"] = told
    if quiet:
        from .news import news_read
        news_read(quiet)
    tmp = f"{HOME_STATE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, HOME_STATE)


# ---- the command ----------------------------------------------------------------------------

def cmd_home(args):
    """herdr-task home: what the home Assistant asks. `show` (default): is this Assistant its
    machine's home one, the main machine's, and the machine now. `report`: the facts, for the
    main machine's round. `pass`: one round now (--to: a test's own Assistant)."""
    what = getattr(args, "home", None) or "show"
    if what == "report":
        try:
            spaces = json.loads(args.spaces) if args.spaces else []
        except ValueError:
            raise Fail("--spaces takes JSON: [[space id, folder], ...]")
        print(json.dumps(local_report(spaces, args.since, args.news_only)))
        return
    if what == "pass":
        rep = {}
        home_pass(rep, force=True, only=args.only, to=args.to)
        say(args, rep, "\n".join(f"to {x['to']}:\n  " + "\n  ".join(x["lines"]) for x in rep.get("home") or [])
            or ("Errors: " + json.dumps(rep["home_errors"]) if rep.get("home_errors") else "Nothing new to tell."))
        return
    cfg = read_settings()
    here = cfg.get("here") or LOCAL_MACHINE
    me = hc_json("get", os.environ.get("HC_TERMINAL_ID") or "") if os.environ.get("HC_TERMINAL_ID") else None
    cwd = (me or {}).get("cwd") or os.getcwd()
    home = home_on(cfg, here) and os.path.realpath(cwd) == os.path.realpath(HOME)
    rep = local_report()
    out = {"home": home, "main": home and main_here(), "machine": None if here == LOCAL_MACHINE else here,
           "on": home_on(cfg, here), "health": rep["health"], "top": rep["top"], "stuck": rep["stuck"], "worktrees": rep["worktrees"]}
    if args.json:
        print(json.dumps(out))
        return
    role = ("the main machine's home Assistant: this machine, plus every machine's overview" if out["main"]
            else "this machine's home Assistant" if home else
            "not a home Assistant" + ("" if out["on"] else " (Home Assistant is off for this machine in Settings)"))
    print(f"You are {role}.")
    print(f"Now: {meters_words(rep['health'])}")
    for k, v in rep["top"].items():
        if v:
            print(f"Most {k}: {', '.join(v)}")
    print(f"Stuck processes: {len(rep['stuck'])}" + "".join(f"\n  {p['name']} (pid {p['pid']}) {p['hours']} h at {round(p['share'] * 100)}%: {p['args']}" for p in rep["stuck"]))
    print(f"Leftover worktrees: {len(rep['worktrees'])}" + "".join(
        f"\n  {w['path']} ({w['task'] or 'no task'}{', uncommitted changes' if w.get('dirty') else ''})" for w in rep["worktrees"]))
