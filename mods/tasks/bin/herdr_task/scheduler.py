"""Keeps the scheduler (herdr-automations) running on this machine."""

import hashlib
import os
import sys

from .base import bundle, ENTRY, hc_json, HOME, run, SESSION
from .store import read_list, store_files


def script_hash():
    return hashlib.sha1(bundle()).hexdigest()


SCHEDULER = "herdr-automations"


def ensure_scheduler(quiet=False):
    """Keeps one scheduler on this machine while any folder has automations or tasks at work (it
    runs the queue and tells Assistants their tasks' news), and always on the machine that serves the web app
    (its home round tells Everything every machine's news: home.main_here): herdr-core runs it (hc run --keep) as
    herdr-automations, in Shepherdr's own herdr-core session (base.SESSION) like everything it starts."""
    need = any((d := read_list(p) or {}).get("automations") or any(t.get("state") in ("scheduled", "queued", "running", "ready") for t in d.get("tasks") or [])
               for p in store_files())
    if not need:
        from .home import main_here
        need = main_here()
    k = hc_json("get", SCHEDULER)
    ok = bool(k and k.get("state") == "live" and "scheduler" in " ".join((k.get("foreground") or {}).get("argv") or k.get("argv") or []))
    if ok or not need:
        return {"running": ok, "started": False, "note": "The scheduler is running." if ok else "Nothing at work here: no scheduler needed."}
    if k:
        # Its program was lost (a restart left a shell): replace it.
        run(["hc", "kill", SCHEDULER])
        run(["hc", "rm", SCHEDULER])
    r = run(["hc", "run", "--bg", "--json", "--keep", "--no-parent", "--no-notify", "--name", SCHEDULER, "--cwd", HOME,
             "--", sys.executable, ENTRY, "scheduler"])
    started = r.returncode == 0
    return {"running": started, "started": started, "note": "Started the scheduler." if started else f"Couldn't start the scheduler: {r.stderr.strip()}"}
