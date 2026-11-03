"""Backups of every machine's spaces, and restoring them."""

import concurrent.futures
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import time

from .base import APP_HOME, Fail, guard, hc_json, not_real, now, SHELLS
from .store import read_list
from .output import say


# ---- backups --------------------------------------------------------------------------------
# Herdr keeps each machine's spaces, tabs and splits in that machine's herdr-core (docs.json,
# its "herdr-app" document) with no history, and the sidebar's sections and icons are pruned
# when their spaces go. So every 10 minutes the scheduler saves, where the window lives, each
# connected machine's document and live terminals, and the sidebar's own state, to
# ~/.config/herdr-app/data/backups/<time>/. A round that finds nothing changed saves nothing,
# so the newest BACKUP_KEEP are that many different moments. restore-spaces reads one back.
BACKUPS = os.path.join(APP_HOME, "data", "backups")
BACKUP_EVERY_MS = 10 * 60000
BACKUP_KEEP = 48
BACKUP_NAME = re.compile(r"^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$")
THIS = "this-computer"
# The sidebar's state in shared.json: sections, icons, pins, machine names; space colors; the
# Assistant chats waiting for a first message.
SIDEBAR_KEYS = ("spaces-chat", "space.colors", "coordinator.slots")
# What a terminal was, enough to start it again (its status and turn change all the time).
TERMINAL_KEYS = ("address", "name", "agent", "template", "cwd", "parent", "state")
MARK = "--herdr-backup--"
# On a machine: its docs.json, the mark, its live terminals.
STATE_SCRIPT = ('PATH="$HOME/.local/bin:$PATH"; cat "${XDG_STATE_HOME:-$HOME/.local/state}/herdr-core/default/docs.json"'
                f' && echo && echo {MARK} && hc ls --json')


def machine_state(machine):
    """A machine's herdr-app document and live terminals ({doc, version, terminals}), or {error}."""
    call = ["sh", "-c", STATE_SCRIPT] if machine is None else ["hc", "exec", "--on", machine, "--", "sh", "-c", STATE_SCRIPT]
    guard(["hc"])
    try:
        r = subprocess.run(call, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
    except subprocess.TimeoutExpired:
        return {"error": "timed out"}
    docs, _, live = r.stdout.partition(f"\n{MARK}\n")
    try:
        doc = json.loads(docs).get("herdr-app") or {}
    except ValueError:
        return {"error": (r.stderr.strip() or "no docs.json")[:300]}
    try:
        terms = json.loads(live).get("terminals") or []
    except ValueError:
        terms = []
    # This machine's hc also lists other machines' terminals (vm/t3): only its own.
    terms = [{k: t[k] for k in TERMINAL_KEYS if k in t} for t in terms if "/" not in t.get("address", "")]
    return {"doc": doc.get("value"), "version": doc.get("version"), "terminals": terms}


def backup_now():
    """Everything one backup holds: {file name: content}."""
    names = [m["name"] for m in (hc_json("machine", "ls") or {}).get("machines") or []
             if m.get("state") == "connected" and not m.get("temporary")]
    # All at once: a slow machine holds up the round by its own timeout only.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        states = list(pool.map(machine_state, [None, *names]))
    out = {f"{m or THIS}.json": {"machine": m, **st} for m, st in zip([None, *names], states)}
    try:
        with open(os.path.join(APP_HOME, "shared.json")) as f:
            shared = json.load(f)
    except (OSError, ValueError):
        shared = {}
    out["sidebar.json"] = {k: shared.get(k) for k in SIDEBAR_KEYS}
    return out


def backups():
    try:
        return sorted(n for n in os.listdir(BACKUPS) if BACKUP_NAME.match(n) and os.path.isdir(os.path.join(BACKUPS, n)))
    except OSError:
        return []


def backup_pass(report=None, force=False):
    """Saves a backup when the last round was 10 minutes ago (force: now) and something changed.
    Returns the new backup's folder, or None."""
    if not os.path.isdir(os.path.join(APP_HOME, "mods")) or not_real():
        return None
    last_path = os.path.join(BACKUPS, ".last.json")
    last = read_list(last_path) or {}
    if not force and now() - (last.get("at") or 0) < BACKUP_EVERY_MS:
        return None
    files = backup_now()
    digest = hashlib.sha1(json.dumps(files, sort_keys=True).encode()).hexdigest()
    names = backups()
    made = None
    if digest != last.get("hash") or not names:
        made = os.path.join(BACKUPS, time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime()))
        tmp = os.path.join(BACKUPS, f".new-{os.getpid()}")
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        for name, content in files.items():
            with open(os.path.join(tmp, name), "w") as f:
                json.dump(content, f, indent=1, ensure_ascii=False)
        os.replace(tmp, made)
        names = backups()
        for old in names[:-BACKUP_KEEP]:
            shutil.rmtree(os.path.join(BACKUPS, old), ignore_errors=True)
        if report is not None:
            report.setdefault("backups", []).append(made)
    tmp = f"{last_path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump({"at": now(), "hash": digest, "saved": os.path.basename(made) if made else last.get("saved")}, f)
    os.replace(tmp, last_path)
    return made


def cmd_backup(args):
    if not_real():
        raise Fail(f"no backup: {not_real()}")
    made = backup_pass(force=True)
    saved = made or os.path.join(BACKUPS, (read_list(os.path.join(BACKUPS, ".last.json")) or {}).get("saved") or "")
    say(args, {"saved": made, "latest": saved}, f"Saved {made}." if made else f"Nothing changed since {saved}.")


def blocks(node):
    """A tab's panes, in order: its layout tree's blocks."""
    if node.get("type") == "block":
        yield node
    for c in node.get("children") or []:
        yield from blocks(c)


def restore_plan(folder):
    """What a backup holds, as the spaces it would recreate, machine by machine."""
    sidebar = read_list(os.path.join(folder, "sidebar.json")) or {}
    side = sidebar.get("spaces-chat") or {}
    sections = side.get("sections") or []
    out = {"backup": os.path.basename(folder), "machines": [], "sections": sections,
           "icons": side.get("icons") or {}, "pinned": side.get("pinned") or []}
    for name in sorted(os.listdir(folder), key=lambda n: (n != f"{THIS}.json", n)):
        if not name.endswith(".json") or name == "sidebar.json":
            continue
        d = read_list(os.path.join(folder, name)) or {}
        machine = d.get("machine")
        prefix = f"{machine}/" if machine else ""
        live = {t["address"]: t for t in d.get("terminals") or []}
        spaces = []
        for sp in (d.get("doc") or {}).get("spaces") or []:
            sid = prefix + sp["id"]
            tabs = []
            for tb in sp.get("tabs") or []:
                panes = []
                for b in blocks(tb.get("root") or {}):
                    c = b.get("content") or {}
                    term = c.get("terminal") or (c.get("props") or {}).get("terminal")
                    panes.append({"mod": c.get("mod"), "terminal": term, "was": live.get(term) if term else None})
                tabs.append({"id": tb["id"], "name": tb.get("name"), "panes": panes})
            spaces.append({"id": sp["id"], "name": sp.get("name"), "folder": sp.get("folder"),
                           "section": next((s.get("name") for s in sections if sid in (s.get("spaces") or [])), None),
                           "icon": (side.get("icons") or {}).get(sid), "pinned": sid in (side.get("pinned") or []), "tabs": tabs})
        out["machines"].append({"machine": machine, "error": d.get("error"), "spaces": spaces})
    return out


def cmd_restore_spaces(args):
    """Dry run only: prints what a backup would recreate; changes nothing."""
    names = backups()
    if not args.backup:
        say(args, {"backups": names}, "\n".join(names) + "\nrestore-spaces <backup> (or latest) shows what one would recreate." if names else f"No backups in {BACKUPS} yet.")
        return
    pick = names[-1] if args.backup == "latest" and names else args.backup
    folder = pick if os.path.isdir(pick) else os.path.join(BACKUPS, pick)
    if not os.path.isdir(folder):
        raise Fail(f"No backup {args.backup}: see herdr-task restore-spaces")
    plan = restore_plan(folder)
    rows = [f"Backup {plan['backup']}. Dry run: nothing is changed.", ""]
    for m in plan["machines"]:
        where = m["machine"] or THIS
        if m["error"]:
            rows += [f"{where}: not saved ({m['error']})", ""]
            continue
        rows.append(f"{where}: {len(m['spaces'])} space(s)")
        on = ["--on", m["machine"]] if m["machine"] else []
        for sp in m["spaces"]:
            look = ", ".join(x for x in (sp["icon"] and f"icon {sp['icon']}", sp["section"] and f"section \"{sp['section']}\"", sp["pinned"] and "pinned") if x)
            rows.append(f"  space \"{sp['name']}\" in {sp['folder']}  [{sp['id']}]" + (f"  ({look})" if look else ""))
            for tb in sp["tabs"]:
                rows.append(f"    tab \"{tb['name']}\"  [{tb['id']}]")
                for p in tb["panes"]:
                    was = p["was"] or {}
                    what = was.get("agent") or (p["mod"] and f"mod {p['mod']}") or "terminal"
                    rows.append(f"      {p['terminal'] or '-'}: {what}" + (f" in {was['cwd']}" if was.get("cwd") else "")
                                + ("" if was or not p["terminal"] else " (not live when saved)"))
                    if p["terminal"] and (was.get("cwd") or sp["folder"]):
                        prog = "<its shell>" if not was.get("agent") or was["agent"] in SHELLS else f"<{was['agent']}, resumed by hand>"
                        rows.append("        would run: " + shlex.join(["hc", "run", *on, "--keep", "--cwd", was.get("cwd") or sp["folder"],
                                                                         "--label", f"herdr.space={sp['id']}", "--label", f"herdr.tab={tb['id']}", "--"]) + f" {prog}")
        rows.append("")
    say(args, plan, "\n".join(rows).rstrip())
