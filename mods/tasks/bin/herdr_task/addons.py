"""Add-ons from the command line (GitHub #1091): which are off, and a switch for each, as Settings › Add-ons has.

Since 3.1.35 herdr-task obeys the add-ons switched off (Everywhere's "off" in the settings file: base.addon_off), so
tell-assistant, assistants, autopilot and the sync say when one they need is off (off_note) instead of going quiet.
A flip goes through this machine's Shepherdr service when it runs (it writes the settings file and the window's shared
list together, as the web app's switch does); without one, straight into the settings file.
"""

import json
import os
import urllib.error
import urllib.request

from .base import addon_off, APP_HOME, Fail, WHERE
from .settings import read_settings, SETTINGS

# The add-ons herdr-task itself obeys, by their titles in lib/addons.json (test_other_machines checks they agree), so a
# machine with only herdr-task (no lib/addons.json) can still say which one is off.
NAMES = {"machines": "Other machines", "autopilot": "Autopilot", "browser": "Task browser", "chat": "Chat"}


def manifest():
    """lib/addons.json's add-ons as installed here (the window's, else the web-only install's), or []."""
    for p in (os.path.join(APP_HOME, "lib", "addons.json"), os.path.join(os.path.expanduser("~"), ".local", "share", "shepherdr", "lib", "addons.json")):
        try:
            with open(p) as f:
                return json.load(f).get("addons") or []
        except (OSError, ValueError, AttributeError):
            continue
    return []


def title(addon_id):
    return next((a.get("title") for a in manifest() if a.get("id") == addon_id), None) or NAMES.get(addon_id) or addon_id


def off_note(addon_id):
    """Plain words for an add-on that is off and what turns it on; None when it is on."""
    if not addon_off(addon_id):
        return None
    return (f"The {title(addon_id)} add-on is off on this machine: turn it on in Settings › Window › Add-ons, "
            f"or run `herdr-task addons on {addon_id}`.")


def off_list():
    off = (read_settings().get("everywhere") or {}).get("off")
    return off if isinstance(off, list) else []


def _service_flip(addon_id, on):
    """Through this machine's service (it updates the window too): None when no service answers here, else
    (ok, error)."""
    data = WHERE.path("service")
    try:
        with open(os.path.join(data, "service.json")) as f:
            svc = json.load(f)
        with open(os.path.join(data, "token")) as f:
            token = f.read().strip()
        base = f"http://127.0.0.1:{int(svc['port'])}"
        with urllib.request.urlopen(base + "/api/health", timeout=3) as r:
            if json.load(r).get("id") != svc.get("id"):
                return None
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        return None
    req = urllib.request.Request(base + "/api/action", method="POST", data=json.dumps(
        {"type": "setting", "key": f"addon.{addon_id}", "value": "on" if on else "off"}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            got = json.load(r)
    except (OSError, ValueError, urllib.error.URLError) as e:
        return False, str(e)
    return bool(got.get("ok")), got.get("error")


def _file_flip(addon_id, on, addons):
    d = read_settings()
    if d.get("pushed_from"):
        raise Fail("This machine's Shepherdr settings are a copy from the machine whose window sets them: switch it there.")
    off = off_list()
    by = {a.get("id"): a for a in addons}
    if on:
        need = [n for n in (by.get(addon_id) or {}).get("needs") or [] if n in off]
        if need:
            raise Fail(f"Turn on what it needs first: {', '.join(title(n) for n in need)}.")
        off = [x for x in off if x != addon_id]
    else:
        users = [a.get("id") for a in addons if a.get("id") not in off and addon_id in (a.get("needs") or [])]
        if users:
            raise Fail(f"Turn off what needs it first: {', '.join(title(n) for n in users)}.")
        off = list(dict.fromkeys(off + [addon_id]))
    e = d.setdefault("everywhere", {})
    if off:
        e["off"] = off
    else:
        e.pop("off", None)
    d.setdefault("version", 1)
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    tmp = f"{SETTINGS}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    os.replace(tmp, SETTINGS)


def cmd_addons(args):
    from .output import say
    addons = manifest()
    switchable = [a for a in addons if a.get("switch")] or [{"id": k, "title": v, "switch": True} for k, v in NAMES.items() if k != "chat"]
    if not args.addons or args.addons == "list":
        off = off_list()
        rows = [{"id": a["id"], "title": a.get("title") or a["id"], "on": a["id"] not in off} for a in switchable]
        say(args, {"addons": rows}, "\n".join(f"{r['title']} ({r['id']}): {'on' if r['on'] else 'off'}" for r in rows))
        return
    want = args.addon
    hit = next((a for a in switchable if want in (a["id"], a.get("title"))) or
               (a for a in switchable if want.casefold() == (a.get("title") or "").casefold()), None)
    if not hit:
        raise Fail(f"No add-on {want!r} with a switch: " + ", ".join(a["id"] for a in switchable))
    on = args.addons == "on"
    if (hit["id"] not in off_list()) == on:
        say(args, {"id": hit["id"], "on": on}, f"{hit.get('title')} is {'on' if on else 'off'} already.")
        return
    got = _service_flip(hit["id"], on)
    if got is not None and not got[0]:
        raise Fail(got[1] or "the service refused it")
    if got is None:
        _file_flip(hit["id"], on, addons)
    note = "" if got is not None else " An open Herdr window here shows it once Herdr starts again."
    say(args, {"id": hit["id"], "on": on, "via": "service" if got is not None else "file"},
        f"{hit.get('title')} is {'on' if on else 'off'} now.{note}")
