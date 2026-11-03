"""The archive: done tasks set aside after a while."""

import os
import re

from .base import hc_json, now
from .settings import settings_for
from .agents import status_word
from .store import locate, read_list, Store, store_files


# ---- archive --------------------------------------------------------------------------------
# Done tasks archive themselves after a while (Shepherdr settings > Tasks > Archive Done after:
# tasks.archive_after, in days; 0 or "off": never). Metadata only: an archived task keeps its
# record, chat and summary, and leaves every list and count (the Tasks panel's Archived row shows
# it, `list --archived` lists it). Its agent at work again (someone wrote to it), or a command that
# puts the task back to work, brings it back; its week then starts again.

def archive_after_ms(value):
    """Archive Done after as ms; None when off (0, "off", or not a number of days)."""
    m = re.fullmatch(r"\s*(\d+)(\s*days?)?\s*", "" if value is None or value is False else str(value), re.I)
    days = int(m.group(1)) if m else 0
    return days * 86400000 if days > 0 else None


def unarchive(s, t):
    if t.pop("archived", None) is not None:
        t["unarchived"] = now()
        s.dirty = True


def busy_task_keys():
    """The tasks (herdr.task keys) whose agents work or ask now: only those terminals are looked up."""
    keys = set()
    for k in (hc_json("ls") or {}).get("terminals", []):
        if k.get("state") == "live" and status_word(k) in ("working", "blocked"):
            key = ((hc_json("get", k["address"]) or {}).get("labels") or {}).get("herdr.task")
            if key:
                keys.add(key)
    return keys


class _Folder:
    """Enough of a Store for settings_for(): its folder."""
    def __init__(self, folder):
        self.loc = {"folder": folder}


def archive_pass(report, folder=None):
    """Archives Done tasks past their folder's Archive Done after, and brings back archived ones
    whose agent works again. A list is only opened (locked, written) when one of its tasks changes."""
    t0, busy = now(), None
    for p in store_files(folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not any(t.get("state") == "done" or t.get("archived") for t in tasks):
            continue
        ms = archive_after_ms(settings_for(_Folder(d["folder"]))["tasks"].get("archive_after"))
        slug = os.path.basename(p)[:-5]

        def due(t):
            return (ms and t.get("state") == "done" and not t.get("archived") and t.get("done_at")
                    and t0 - max(t["done_at"], t.get("unarchived") or 0) >= ms and f"{slug}#{t['id']}" not in busy)

        def back(t):
            return t.get("archived") and (t.get("state") != "done" or f"{slug}#{t['id']}" in busy)

        if busy is None:
            busy = busy_task_keys()
        if not any(due(t) or back(t) for t in tasks):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if back(t):
                    unarchive(s, t)
                    report.setdefault("unarchived", []).append(s.ref(t))
                elif due(t):
                    t["archived"] = t0
                    s.dirty = True
                    report.setdefault("archived", []).append(s.ref(t))
