"""Which agent CLIs a machine can run: installed and signed in (cli-check.json). Until 3.1 this also held the
backup agent that took a task over by itself; from 3.2 nothing restarts an agent on its own (step 38)."""

import json
import os
import re

from .base import beside_store, now, run


# ---- which CLIs a machine can run -----------------------------------------------------------
# As Shepherdr's machine-check: each CLI's own status command says whether it is installed and
# signed in (an API key, a keychain or a login file all count), every CHECK_EVERY on each machine
# the scheduler reaches. Only yes or no is kept: their status also names the account. An answer
# that can't be read leaves that CLI unknown (None), never signed out. Settings reads the file to
# say which agents a machine can run.

CLI_CHECK = beside_store("cli-check", "cli-check.json")
CHECK_EVERY = 15 * 60000
CHECK = r"""
limit=; if command -v timeout >/dev/null 2>&1; then limit='timeout 10'; fi
if command -v claude >/dev/null 2>&1; then echo "claude=$($limit claude auth status </dev/null 2>/dev/null | grep -o '"loggedIn": *[a-z]*' | head -n 1)"; else echo claude=missing; fi
if command -v codex >/dev/null 2>&1; then echo "codex=$($limit codex login status </dev/null 2>&1 | grep -iE '^(not )?logged in' | head -n 1)"; else echo codex=missing; fi
"""
# In the login shell agents start in, so its PATH has what mise, nvm or a profile put there.
LOGIN = 'if command -v bash >/dev/null 2>&1; then exec bash -lc "$1"; else exec sh -lc "$1"; fi'
NAMES = {"claude": "Claude Code", "codex": "Codex"}


def cli_state(word):
    if word == "missing":
        return "missing"
    if re.search(r'"loggedIn": *true|^logged in', word or "", re.I):
        return "ready"
    if re.search(r'"loggedIn": *false|^not logged in', word or "", re.I):
        return "signed-out"
    return None


def check_machine(machine=None):
    """{claude, codex: "ready" | "signed-out" | "missing" | None, at}, or None when it couldn't run."""
    on = ["--on", machine] if machine else []
    r = run(["hc", "exec", *on, "--timeout", "30", "--", "sh", "-c", LOGIN, "x", CHECK])
    words = dict(ln.split("=", 1) for ln in r.stdout.split("\n") if "=" in ln)
    if r.returncode != 0 or not words:
        return None
    return {"claude": cli_state(words.get("claude", "").strip()), "codex": cli_state(words.get("codex", "").strip()), "at": now()}


def read_checks():
    try:
        with open(CLI_CHECK) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def write_checks(d):
    tmp = f"{CLI_CHECK}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=1)
    os.replace(tmp, CLI_CHECK)


def cli_check_pass(report=None, force=False):
    """Every CHECK_EVERY: this machine's CLIs (each machine's own scheduler checks its own).
    {"machines": {"": this machine}}."""
    d = read_checks()
    if not force and now() - (d.get("at") or 0) < CHECK_EVERY:
        return d
    d["at"] = now()
    machines = d.setdefault("machines", {})
    c = check_machine()
    if c:
        machines[""] = c
    elif "" in machines:
        machines[""]["failed"] = now()
    write_checks(d)
    if report is not None and "" in machines:
        report["cli_check"] = {"": {k: v for k, v in machines[""].items() if k in ("claude", "codex")}}
    return d


def here_state(kind):
    """This machine's word on a CLI: checked now when the last check is older than CHECK_EVERY."""
    return ((cli_check_pass().get("machines") or {}).get("") or {}).get(kind)
