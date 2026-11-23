"""The 3.1 to 3.2 switch: what lived in herdr-core's default session (the Herdr app's) is brought into Shepherdr's own.

Each named herdr-core session is a core of its own: its own documents, its own machines list and its own ids (a
machine's id in the default session is not its id in Shepherdr's). Until 3.2 Shepherdr kept in the default one:
  shepherdr          the shared document (the spaces list, groups, pins, ...)
  shepherdr.secrets  which machine keeps the secrets
  shepherdr.host     which machine serves the web app (Serve from)
  shepherdr.web      the web app's link
  herdr-app          the window's spaces, which the service takes into its own list once (service/carry-over.ts)
and the machines it links to. `herdr-task carry-over` copies them, once each:
  - the machines first (machines.adopt), since the records below name machines by id;
  - each document into Shepherdr's session when that has none yet (nothing there is ever replaced), with every
    herdr-core id in it changed to the same machine's id in Shepherdr's session; a record that names a machine whose
    new id isn't known yet (its link isn't up) waits: a later run copies it, and the services hand theirs on anyway;
  - each linked machine's own herdr-app document, on that machine (one that only runs tasks never runs an installer);
  - the scheduler 3.1 left in the default session (the terminal named herdr-automations, and only that) is removed;
  - Shepherdr's agents still live there (an Assistant, a task's agent: the labels herdr.role=coordinator or herdr.task,
    here and on the machines the default session links to) move: herdr-core can't move a live program between sessions,
    so an idle one is ended there and started again in Shepherdr's session on its own conversation (its herdr.resume
    record), with the same labels, folder and command. One at work, or waiting on the person, waits for a later run;
    one whose conversation isn't known, or that Shepherdr's session already runs its own of, stays and is said, with
    what the person can do (agents_pass). SHEP-295: until then nothing moved them, and the serving Mac's stayed.
The default session is only read, but for that one terminal and the agents moved. Safe to run again: what is done is
left alone, and nothing in Shepherdr's session is replaced.
shepherdr.node is not carried: each service writes its own every minute.
"""

import json
import os
import subprocess
import time

from .base import CALLER_SESSION, Fail, FOREIGN_SESSION, guard, HOME, OLD_SESSION, SESSION
from .output import say

SHARED = ("shepherdr", "shepherdr.secrets", "shepherdr.host", "shepherdr.web", "herdr-app")
# These name one machine by its herdr-core id ("id"): without that machine's id in Shepherdr's session they'd name nobody.
RECORDS = ("shepherdr.secrets", "shepherdr.host", "shepherdr.web")
SPACES_DOC = "herdr-app"
WAIT_S = 20


def core_dir(session):
    return os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local", "state"), "herdr-core", session)


def session_env(session):
    """The environment for an hc in that session, whatever terminal this was called from."""
    env = {k: v for k, v in os.environ.items() if k not in ("HC_SOCKET", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET", "HC_CORE_ID", "HC_SESSION")}
    if session != "default":
        env["HC_SESSION"] = session
    return env


def rpc(session, calls, timeout=60):
    """herdr-core's API in one session (hc connect, a JSON line each way): calls [(method, params)] in, for each
    its result or {"error": {...}}."""
    guard(["hc"])
    text = "".join(json.dumps({"jsonrpc": "2.0", "id": i + 1, "method": m, "params": p}) + "\n" for i, (m, p) in enumerate(calls))
    try:
        r = subprocess.run(["hc", "connect"], input=text.encode(), env=session_env(session), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Fail(f"herdr-core's {session} session didn't answer: {e}")
    got = {}
    for line in r.stdout.decode(errors="replace").splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if isinstance(d, dict) and "id" in d:
            got[d["id"]] = d["result"] if "result" in d else {"error": d.get("error") or {}}
    if len(got) < len(calls):
        raise Fail(f"herdr-core's {session} session didn't answer: {r.stderr.decode(errors='replace').strip()[-300:] or 'no reply'}")
    return [got[i + 1] for i in range(len(calls))]


def failed(x):
    return isinstance(x, dict) and "error" in x and len(x) == 1


def why(x):
    e = x.get("error") or {}
    return str(e.get("message") or (e.get("data") or {}).get("hint") or "herdr-core refused it")[:200]


def empty(v):
    return v is None or v == {} or v == []


def translate(v, ids):
    """v with every herdr-core id of the old session (a string, or a key) as the same machine's in Shepherdr's."""
    if isinstance(v, str):
        return ids.get(v, v)
    if isinstance(v, list):
        return [translate(x, ids) for x in v]
    if isinstance(v, dict):
        return {ids.get(k, k): translate(x, ids) for k, x in v.items()}
    return v


def who(session):
    """{id (this machine's core id in that session), machines: {name: {id, state}}}."""
    st, ml = rpc(session, [("server.status", {}), ("machine.list", {})])
    if failed(st) or failed(ml):
        raise Fail(f"herdr-core's {session} session: {why(st if failed(st) else ml)}")
    return {"id": (st.get("core") or {}).get("id"),
            "machines": {m["name"]: {"id": m.get("id"), "state": m.get("state")} for m in ml.get("machines") or [] if m.get("name") and not m.get("temporary")}}


def id_map(old, new):
    ids = {old["id"]: new["id"]} if old.get("id") and new.get("id") else {}
    for name, m in old["machines"].items():
        n = new["machines"].get(name) or {}
        if m.get("id") and n.get("id"):
            ids[m["id"]] = n["id"]
    return ids


def old_scheduler(dry):
    """The scheduler a 3.1 herdr-task left in the old session: the terminal named herdr-automations that was started
    as `herdr-task scheduler`. Only that one is ended and removed; anything else by that name is left alone."""
    from .scheduler import SCHEDULER
    env = session_env(OLD_SESSION)
    guard(["hc"])
    hc = lambda *a: subprocess.run(["hc", *a], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=30)
    try:
        r = hc("get", SCHEDULER, "--json")
        k = json.loads(r.stdout) if r.returncode == 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        k = None
    if not isinstance(k, dict) or k.get("error") or not k.get("address"):
        return "none"
    argv = [str(x) for x in k.get("argv") or []]
    if k.get("name") != SCHEDULER or "scheduler" not in argv or not any(os.path.basename(x) == "herdr-task" for x in argv):
        return "not ours"
    if dry:
        return "would-remove"
    if k.get("state") == "live":
        hc("kill", SCHEDULER)
    r = hc("rm", SCHEDULER)
    if r.returncode != 0:
        # ended a moment ago: its removal can come a beat after
        time.sleep(1)
        r = hc("rm", SCHEDULER)
    return "removed" if r.returncode == 0 else "failed"


# ---- Shepherdr's agents left in the default session ----------------------------------------------------------------

def hc_in(session, *args, timeout=60):
    """hc in that session: (returncode, stdout, stderr)."""
    guard(["hc"])
    try:
        r = subprocess.run(["hc", *args], env=session_env(session), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)
    return r.returncode, r.stdout, r.stderr


def hc_json_in(session, *args):
    code, out, _ = hc_in(session, *args, "--json")
    try:
        return json.loads(out) if code == 0 else None
    except ValueError:
        return None


def live_terminals(session):
    """Every live terminal in that session, here and through its links, as hc get says it (labels, argv, status)."""
    rows = (hc_json_in(session, "ls") or {}).get("terminals") or []
    out = []
    for k in rows:
        if k.get("state") == "live" and k.get("address"):
            d = hc_json_in(session, "get", k["address"])
            if isinstance(d, dict) and d.get("state") == "live":
                out.append(d)
    return out


def machine_of(k):
    a = str(k.get("address") or "")
    return a.split("/")[0] if "/" in a else None


def identity(k):
    """What makes two agents the same one in two sessions: a task's agent by its task and role, an Assistant by its
    machine and space."""
    lb = k.get("labels") or {}
    if lb.get("herdr.task"):
        return ("task", lb["herdr.task"], lb.get("herdr.role") or "worker")
    return ("assistant", machine_of(k), lb.get("herdr.coordinator.space") or lb.get("herdr.space"))


def who_is(k):
    """The agent in plain words, for the person."""
    lb = k.get("labels") or {}
    on = f" on {machine_of(k)}" if machine_of(k) else ""
    if lb.get("herdr.task"):
        slug, _, n = str(lb["herdr.task"]).rpartition("#")
        role = lb.get("herdr.role")
        return f"{'the reviewer of ' if role == 'reviewer' else 'a helper of ' if role == 'helper' else ''}task #{n or lb['herdr.task']}" \
               f"{' (' + slug + ')' if slug else ''}{on}"
    return f"the Assistant of space {lb.get('herdr.coordinator.space') or lb.get('herdr.space') or k.get('name') or '?'}{on}"


def resume_command(k, rec):
    """(argv, keep) starting the agent in k again on its own conversation, as it was launched (the wrappers before its
    claude or codex word kept), or None."""
    from .revive import base_argv, kind_of, resume_argv
    sid = (rec or {}).get("session")
    if not sid:
        return None
    launch = [str(a) for a in k.get("argv") or []]
    kind, base = base_argv(launch)
    if kind and kind == rec.get("kind", kind):
        at = next(i for i, a in enumerate(launch) if (i == 0 or not a.startswith("-")) and kind_of(a))
        return [*launch[:at], *resume_argv(kind, base, sid)], bool(k.get("keep"))
    # typed into a shell: the agent alone, the terminal kept as a shell once it exits (as before)
    kind, base = rec.get("kind"), rec.get("argv")
    if kind not in ("claude", "codex") or not isinstance(base, list) or not base:
        return None
    return resume_argv(kind, [str(a) for a in base], sid), True


def caller():
    """The terminal this carry-over runs in, in the default session (an agent there running `shepherdr update`):
    never ended under itself."""
    if os.environ.get("SHEPHERDR_CARRY_CALLER"):
        return os.environ["SHEPHERDR_CARRY_CALLER"]
    return os.environ.get("HC_TERMINAL_ID") if CALLER_SESSION in (None, "", "default") else None


def agents_pass(dry=False):
    """Shepherdr's agents left in the default session, each moved into Shepherdr's or said why not (module doc).
    [{name, address, state: moved | would-move | waiting | kept | stuck | failed, why?, to?}]"""
    from .agents import agent_running, status_word
    from .revive import read_record, record_of, watched
    old = live_terminals(OLD_SESSION)
    ours = [k for k in old if watched(k)]
    if not ours:
        return []
    have = {identity(k) for k in live_terminals(SESSION) if watched(k) and agent_running(k)}
    me = caller()

    def parent_of(k):
        p = k.get("parent")
        if not p:
            return None
        return f"{machine_of(k)}/{p}" if machine_of(k) and "/" not in p else p

    rows, gone = {}, set()

    def kids_left(k):
        """Its children that end with it (die_with_parent) and stay: ending it would end them too."""
        return [c for c in old if parent_of(c) == k["address"] and c.get("die_with_parent") and c["address"] not in gone]

    def row(k, state, why=None, **more):
        return {"name": who_is(k), "address": k["address"], "state": state, **({"why": why} if why else {}), **more}

    left = list(ours)
    # children before their parents: an agent whose own agents end with it waits until they moved
    while left:
        progress = False
        for k in list(left):
            if kids_left(k) and any(c in left for c in kids_left(k)):
                continue
            left.remove(k)
            progress = True
            rows[k["address"]] = move_one(k, dry, have, me, kids_left(k), agent_running, status_word, read_record, record_of)
            if rows[k["address"]]["state"] in ("moved", "would-move"):
                gone.add(k["address"])
        if not progress:
            for k in left:
                rows[k["address"]] = row(k, "waiting", "an agent it started still runs in herdr-core's default session and would end with it")
            break
    return [rows[k["address"]] for k in ours]


def move_one(k, dry, have, me, kids, agent_running, status_word, read_record, record_of):
    lb = k.get("labels") or {}
    addr = k["address"]
    base = {"name": who_is(k), "address": addr}
    rm = "end it there when you no longer need it (`hc kill " + addr + "` from a plain terminal, or close it in the Herdr app)"
    if not agent_running(k):
        return {**base, "state": "stuck", "why": f"its agent has exited, only its terminal is left: {rm}"}
    if me and addr == me:
        return {**base, "state": "waiting", "why": "it runs this carry-over; run `herdr-task carry-over` again from another terminal"}
    if identity(k) in have:
        return {**base, "state": "kept", "why": f"Shepherdr's session runs its own already, and this older one still runs: {rm}"}
    if status_word(k) in ("working", "blocked"):
        return {**base, "state": "waiting", "why": "it's at work or waits for an answer now; it moves once it's idle: run "
                                                   "`herdr-task carry-over` (or `shepherdr update`) again then"}
    if kids:
        return {**base, "state": "waiting", "why": "an agent it started still runs in herdr-core's default session and would end with it"}
    rec = read_record(k) or (record_of(k) if not machine_of(k) else None)
    cmd = resume_command(k, rec)
    if not cmd:
        what = ("a message in its task's chat, or `herdr-task resume`, starts it again in Shepherdr" if lb.get("herdr.task") else
                "a message in its chat starts a new one in Shepherdr")
        return {**base, "state": "stuck", "why": f"Shepherdr can't tell which conversation it runs, so it can't move it: {rm}; then {what}"}
    argv, keep = cmd
    if dry:
        return {**base, "state": "would-move"}
    code, _, err = hc_in(OLD_SESSION, "kill", addr)
    if code != 0:
        return {**base, "state": "failed", "why": f"couldn't end it in the default session: {(err or '').strip()[-200:] or 'hc kill failed'}"}
    labels = [x for key, v in sorted(lb.items()) if key != "herdr.resume" for x in ("--label", f"{key}={v}")]
    on = ["--on", machine_of(k)] if machine_of(k) else []
    name = ["--name", k["name"]] if k.get("name") else []
    cwd = ["--cwd", k["cwd"]] if k.get("cwd") else []
    start = ["run", "--bg", "--json", "--no-parent", "--no-notify", *(["--keep"] if keep else []), *on, *cwd, *labels]
    code, out, err = hc_in(SESSION, *start, *name, "--", *argv)
    if code != 0 and name:
        code, out, err = hc_in(SESSION, *start, "--", *argv)   # its name taken there: without it
    try:
        to = (json.loads(out) or {}).get("address") if code == 0 else None
    except ValueError:
        to = None
    if code != 0:
        again = ("`herdr-task resume` starts it again" if lb.get("herdr.task") else "a message in its chat starts a new one")
        return {**base, "state": "failed", "why": f"ended in the default session but didn't start in Shepherdr's "
                                                  f"({(err or out or '').strip()[-200:] or 'hc run failed'}): its conversation is kept, {again}"}
    have.add(identity(k))
    to = f"{machine_of(k)}/{to}" if to and machine_of(k) and "/" not in to else to
    return {**base, "state": "moved", **({"to": to} if to else {})}


def carry_over(dry=False, wait=WAIT_S, agents_only=False):
    """Does it (module doc). {from, to, machines, documents, scheduler, agents, ok}. agents_only: only the agents
    (doctor's look, with dry)."""
    out = {"from": OLD_SESSION, "to": SESSION, "dry_run": bool(dry), "machines": [], "documents": [], "scheduler": "none", "agents": [], "ok": True}
    if FOREIGN_SESSION:
        raise Fail(f"carry-over runs in Shepherdr's own session ({SESSION}); this is another (HC_SESSION).")
    if OLD_SESSION == SESSION:
        out["note"] = "Shepherdr's session is the default one here: nothing to carry over."
        return out
    if not os.path.isfile(os.path.join(core_dir(OLD_SESSION), "core.json")):
        out["note"] = f"herdr-core has no {OLD_SESSION} session here: nothing to carry over."
        return out
    if agents_only:
        out["agents"] = agents_pass(dry)
        out["ok"] = not any(x["state"] == "failed" for x in out["agents"])
        return out
    from .machines import adopt
    out["machines"] = adopt(dry)
    old = who(OLD_SESSION)
    new = who(SESSION)
    # Links just added need a moment: wait (a little) for each machine the old session reaches to answer in Shepherdr's.
    up = lambda: all((new["machines"].get(n) or {}).get("state") == "connected" for n, m in old["machines"].items()
                     if m.get("state") == "connected" and n in new["machines"])
    end = time.monotonic() + (0 if dry else max(0, wait))
    while not up() and time.monotonic() < end:
        time.sleep(1)
        new = who(SESSION)
    ids = id_map(old, new)
    name_of = {m["id"]: n for n, m in old["machines"].items() if m.get("id")}

    def copy(name, on=None):
        row = {"name": name, **({"machine": on} if on else {})}
        at = {"on": on} if on else {}
        [src] = rpc(OLD_SESSION, [("doc.get", {"name": name, **at})])
        if failed(src):
            return {**row, "state": "waiting", "why": f"couldn't read it: {why(src)}"}
        if empty(src.get("value")):
            return {**row, "state": "none"}
        [dst] = rpc(SESSION, [("doc.get", {"name": name, **at})])
        if failed(dst):
            return {**row, "state": "waiting", "why": f"couldn't read Shepherdr's: {why(dst)}"}
        if not empty(dst.get("value")):
            return {**row, "state": "kept"}
        value = src["value"]
        if name in RECORDS and isinstance(value, dict) and value.get("id") and value["id"] not in ids:
            m = name_of.get(value["id"])
            return {**row, "state": "waiting", "why": (f"it names {m}, which isn't connected in Shepherdr's session yet" if m else
                                                       "it names a machine this one doesn't link to")}
        if dry:
            return {**row, "state": "would-copy"}
        [done] = rpc(SESSION, [("doc.set", {"name": name, "value": translate(value, ids), "version": dst.get("version") or 0, **at})])
        if failed(done):
            # written by someone else meanwhile (a conflict): theirs is newer, and stays
            return {**row, "state": "kept" if ((done["error"].get("data") or {}).get("kind") == "conflict") else "failed", **(
                {} if (done["error"].get("data") or {}).get("kind") == "conflict" else {"why": why(done)})}
        return {**row, "state": "copied"}

    for name in SHARED:
        out["documents"].append(copy(name))
    for n, m in sorted(old["machines"].items()):
        if n not in new["machines"]:
            continue  # not added (adopt said why)
        if m.get("state") != "connected" or new["machines"][n].get("state") != "connected":
            out["documents"].append({"name": SPACES_DOC, "machine": n, "state": "waiting", "why": "that machine isn't connected now"})
            continue
        out["documents"].append(copy(SPACES_DOC, n))
    out["scheduler"] = old_scheduler(dry)
    out["agents"] = agents_pass(dry)
    out["ok"] = not any(x.get("state") == "failed" for x in out["machines"] + out["documents"] + out["agents"]) and out["scheduler"] != "failed"
    return out


WORDS = {"moved": "moved into Shepherdr's session", "would-move": "would move into Shepherdr's session",
         "stuck": "stays in herdr-core's default session",
         "copied": "copied", "kept": "Shepherdr's session has its own already: left alone", "none": "nothing to carry",
         "waiting": "waits for a later run", "would-copy": "would be copied", "failed": "couldn't be copied",
         "added": "added", "here": "already there", "would-add": "would be added", "wrong-session": "is there, but leads to another session",
         }


def cmd_carry_over(args):
    out = carry_over(getattr(args, "dry_run", False), getattr(args, "wait", WAIT_S), getattr(args, "agents", False))
    lines = [out["note"]] if out.get("note") else []
    lines += [f"machine {m['name']}: {WORDS.get(m['state'], m['state'])}" + (f" ({m['error']})" if m.get("error") else "") for m in out["machines"]]
    lines += [f"{d['name']}{' on ' + d['machine'] if d.get('machine') else ''}: {WORDS.get(d['state'], d['state'])}" + (f" ({d['why']})" if d.get("why") else "")
              for d in out["documents"]]
    for x in out["agents"]:
        state = x["state"]
        words = {"waiting": "stays in herdr-core's default session for now", "kept": "stays in herdr-core's default session"}.get(state) or WORDS.get(state, state)
        lines.append(f"{x['name'][0].upper() + x['name'][1:]} ({x['address']}): {words}" + (f" as {x['to']}" if x.get("to") else "")
                     + (f": {x['why']}" if x.get("why") else ""))
    if getattr(args, "agents", False) and not out["agents"] and not out.get("note"):
        lines.append("None of Shepherdr's agents is left in herdr-core's default session.")
    if out["scheduler"] not in ("none",):
        lines.append({"removed": "The old scheduler in the default session: removed.", "would-remove": "The old scheduler in the default session would be removed.",
                      "not ours": "A terminal named herdr-automations in the default session isn't Shepherdr's scheduler: left alone.",
                      "failed": "The old scheduler in the default session couldn't be removed (hc rm herdr-automations there)."}[out["scheduler"]])
    say(args, out, "\n".join(lines))
    if not out["ok"]:
        raise SystemExit(1)
