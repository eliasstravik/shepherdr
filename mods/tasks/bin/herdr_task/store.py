"""Where a folder's tasks live (~/.herdr/tasks/<slug>.json) and the locked Store that edits them."""

import errno
import fcntl
import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager

from . import analytics
from .base import beside_store, Fail, git, hc_json, HOME, LEGACY, now, run, STORE
from .settings import settings_for
from .agents import agent_running, live_agents, live_helpers
from .sessions import session_of
from .launch import retag_tabs
from .layout import PY

ARTIFACTS = beside_store("artifacts", "artifacts")


# ---- where a folder's tasks live ------------------------------------------------------------

def locate(path):
    """The task folder for a path: {folder, kind: repo|folder, name, common}."""
    path = os.path.realpath(os.path.expanduser(path or os.getcwd()))
    if not os.path.isdir(path):
        raise Fail(f"No such folder: {path}")
    ok, out, _ = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel")
    lines = out.split("\n") if ok else []
    if len(lines) == 2:
        common, top = lines
        main = common[:-5] if common.endswith("/.git") else top
        return {"folder": main, "kind": "repo", "name": os.path.basename(main) or "/", "common": common}
    name = "~" if path == HOME else (os.path.basename(path) or "/")
    return {"folder": path, "kind": "folder", "name": name, "common": None}


def bare_by_mistake(path):
    """#1052: a repo whose .git/config says core.bare = true though its files are checked out (a .git
    folder with work beside it): git then sees no work tree, so to herdr-task it looked like a plain
    folder and tasks quietly worked in it, Worktrees on or not. Returns what to say, else None."""
    ok, out, _ = git(path, "rev-parse", "--is-bare-repository", "--path-format=absolute", "--git-dir")
    lines = out.split("\n") if ok else []
    if len(lines) != 2 or lines[0] != "true" or os.path.basename(lines[1]) != ".git":
        return None
    folder = os.path.dirname(lines[1])
    return (f"{folder} is a git repo, but its .git/config says core.bare = true, so git sees no work tree here and "
            f"tasks would quietly skip their worktrees. If its files belong there, run: git -C {folder} config core.bare false")


def slug_of(folder):
    # Folders in home drop the home part: ~/dev/app -> dev-app, ~ -> home.
    rel = os.path.relpath(folder, HOME) if folder == HOME or folder.startswith(HOME + "/") else folder
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", "home" if rel == "." else rel.strip("/")).strip("-")
    return s or "root"


# ---- a repo's stable id (SHEP-141) ------------------------------------------------------------
# A repo's tasks are kept by its folder's name (the slug), so renaming or moving the folder would lose them. Each
# repo gets an id of its own in its .git/config (`git config --local shepherdr.id`: never committed, shared by its
# worktrees, moved with it), recorded in its task list as "project_id": a folder with no list of its own finds the
# list whose repo it is when the old folder is gone. Its task numbers and prefix stay the same.

def project_id(folder, make=False):
    """The repo's id (None outside git); make: give it one when it has none."""
    ok, out, _ = git(folder, "config", "--local", "--get", "shepherdr.id")
    if ok and out.strip():
        return out.strip()
    if not make:
        return None
    import uuid
    new = str(uuid.uuid4())
    return new if git(folder, "config", "--local", "shepherdr.id", new)[0] else None


def folder_store_path(folder, root, pid=None):
    """The filename for a folder, disambiguated when two paths produce the same slug."""
    slug = slug_of(folder)
    p = os.path.join(root, slug + ".json")
    data = read_list(p)
    if isinstance(data, dict) and data.get("folder") not in (None, folder):
        if not pid or data.get("project_id") != pid or os.path.isdir(data["folder"]):
            slug = f"{slug}-{hashlib.sha1(folder.encode()).hexdigest()[:6]}"
            p = os.path.join(root, slug + ".json")
    return slug, p


def resolve_store(folder):
    """Canonical task list and, when the repo moved, the older file it still lives in."""
    pid = project_id(folder) if os.path.exists(os.path.join(folder, ".git")) else None
    slug, path = folder_store_path(folder, STORE, pid)
    data = read_list(path)
    if is_task_list(data) and data["folder"] == folder:
        return slug, path, None
    if pid:
        for p in store_files():
            d = read_list(p)
            if is_task_list(d) and d.get("project_id") == pid and (
                    d["folder"] == folder or not os.path.isdir(d["folder"])):
                return slug, path, p
    return slug, path, None


def store_path(folder):
    slug, path, old = resolve_store(folder)
    return (os.path.basename(old)[:-5], old) if old else (slug, path)


def lock_path(path):
    return os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".lock")


def write_list(path, data):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def move_artifacts(old_folder, old_slug, loc):
    """Move the artifact index. Version files are stored by artifact ID and stay where they are."""
    folder = loc["folder"]
    slug, destination = folder_store_path(folder, ARTIFACTS)
    source = folder_store_path(old_folder, ARTIFACTS)[1] if old_folder != folder else os.path.join(
        ARTIFACTS, old_slug + ".json")
    if source == destination or not os.path.isfile(source):
        return
    with ExitStack() as locks:
        for path in sorted((source, destination)):
            f = locks.enter_context(open(lock_path(path), "a"))
            fcntl.flock(f, fcntl.LOCK_EX)
        if not os.path.isfile(source):
            return
        old = read_list(source)
        if not isinstance(old, dict) or not isinstance(old.get("artifacts"), list):
            raise Fail(f"Can't move the artifacts in {source}: the list isn't readable.")
        origin = old.get("folder")
        if origin not in (old_folder, folder) and (old_folder != folder or os.path.isdir(origin or "")):
            return  # The old task slug also happens to name a different folder's artifacts.
        new = read_list(destination)
        if os.path.exists(destination) and not isinstance(new, dict):
            raise Fail(f"Can't move the artifacts: {destination} isn't readable.")
        new = new or {}
        if new.get("folder") not in (None, folder):
            raise Fail(f"Can't move the artifacts: {destination} belongs to another folder.")
        items = {a["id"]: a for a in old["artifacts"]}
        items.update((a["id"], a) for a in new.get("artifacts") or [])
        values = sorted((dict(a, folder=folder) for a in items.values()), key=lambda a: a.get("at") or 0, reverse=True)
        write_list(destination, {**old, **new, "artifacts": values, "slug": slug,
                                 **{k: loc[k] for k in ("folder", "kind", "name")}})
        os.unlink(source)


def remote_repo(folder):
    """GitHub's owner/name from the git remote, with no network or credentials."""
    ok, out, _ = git(folder, "remote", "-v")
    lines = [ln.split() for ln in out.splitlines()] if ok else []
    rows = [row for row in lines if len(row) == 3 and row[-1] == "(fetch)"]
    rows.sort(key=lambda row: row[0] != "origin")
    for _, url, _ in rows:
        m = re.search(r"(?:^|[@/])github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url, re.I)
        if m:
            return m[1]
    return None


# Ask peers for a number only, using their own store path (including on older Shepherdr installs).
PEER_NEXT = "import json, os, re, subprocess, sys\n" + PY + r"""
pid, repo = json.load(sys.stdin)
root = os.environ.get("HERDR_TASK_STORE") or SHEP(".herdr/tasks")
highest = 0
for name in os.listdir(root) if os.path.isdir(root) else []:
    if not name.endswith(".json"):
        continue
    try:
        with open(os.path.join(root, name)) as f:
            d = json.load(f)
    except (OSError, ValueError):
        continue
    if not isinstance(d, dict) or not isinstance(d.get("tasks"), list) or not isinstance(d.get("folder"), str):
        continue
    if not (pid and d.get("project_id") == pid):
        if not repo:
            continue
        known = (d.get("github") or {}).get("repo")
        if not known and os.path.isdir(d["folder"]):
            try:
                result = subprocess.run(["git", "-C", d["folder"], "remote", "get-url", "origin"],
                                        capture_output=True, text=True, timeout=1)
                match = re.search(r"(?:^|[@/])github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$",
                                  result.stdout.strip(), re.I)
                known = match[1] if match else None
            except (OSError, subprocess.TimeoutExpired):
                pass
        if not known or known.lower() != repo:
            continue
    highest = max(highest, *(t["id"] for t in d["tasks"] if isinstance(t, dict) and isinstance(t.get("id"), int)),
                  int(d.get("next") or 1) - 1)
print(json.dumps(highest))
"""


def peer_next(folder, pid):
    """Seed a new repo list from the highest number reachable on its linked machines."""
    from .machines import connected_machines, _remote_python
    try:
        peers = [m["name"] for m in connected_machines() if m.get("state") == "connected" and m.get("name")]
    except (Fail, OSError):
        return 1
    if not peers:
        return 1
    repo = remote_repo(folder)

    def read(peer):
        try:
            result = _remote_python(peer, PEER_NEXT, [pid, repo.lower() if repo else None], timeout=5)
            return result if type(result) is int else 0
        except (Fail, OSError):
            return 0

    with ThreadPoolExecutor(max_workers=min(8, len(peers))) as pool:
        return 1 + max(pool.map(read, peers))


def words_of(name):
    """A folder name's words: split on anything but letters, and at camelCase humps."""
    return [w for w in re.split(r"[^A-Za-z]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", name)) if w]


def auto_prefix(name):
    """A task id prefix from a folder name: the initials of its words (herdr-app-ttt -> HAT, up
    to 5), or a single word's first 4 letters (shepherdr -> SHEP); at least 2 letters."""
    ws = words_of(name)
    p = "".join(w[0] for w in ws)[:5] if len(ws) > 1 else (ws[0][:4] if ws else "")
    if len(p) < 2:
        letters = "".join(ws)
        p = letters[:2] if len(letters) >= 2 else "TASK"
    return p.upper()


def prefixes_in_use(skip=None):
    """{prefix: folder} for every folder's tasks on this machine, but `skip` (a list's path)."""
    out = {}
    for path in store_files():
        d = read_list(path) if path != skip else None
        if is_task_list(d) and d.get("prefix"):
            out[d["prefix"]] = d.get("folder")
    return out


def parse_ref(ref):
    """"HAT-1", "hat-1", "#1", "1" or a label key "<slug>#1" -> (prefix or None, number); else Fail (a title: find())."""
    r = str(ref).strip()
    if "#" in r[1:]:
        r = r.rsplit("#", 1)[-1]
    r = r.lstrip("#")
    m = re.fullmatch(r"([A-Za-z]+[0-9]*)-([0-9]+)", r)
    if m:
        return m.group(1).upper(), int(m.group(2))
    if r.isdigit():
        return None, int(r)
    raise Fail(f"{ref!r} isn't a task id; use one like HAT-4 or 4.")


def norm_title(text):
    """A title as matched: case and runs of spaces ignored, quotes around it dropped."""
    t = " ".join(str(text or "").split()).casefold()
    return t[1:-1].strip() if len(t) > 1 and t[0] + t[-1] in ('""', "''", "\u201c\u201d") else t


def by_title(tasks, text):
    """The tasks (or schedules) a title names: those whose whole title it is, else those whose title holds it (SHEP-322)."""
    q = norm_title(text)
    if not q:
        return []
    exact = [t for t in tasks if norm_title(t.get("title")) == q]
    return exact or [t for t in tasks if q in norm_title(t.get("title"))]


def quoted(title):
    """A title as said in a line: "Fix login"."""
    return '"' + (" ".join(str(title or "").split()) or "untitled") + '"'


def open_lock(path):
    """(a list's lock file, writable): opened to write, else, where nothing can be written (a
    read-only sandbox: a Codex reviewer's, #841), to read (a shared lock still works on it), else
    None when it doesn't exist yet."""
    try:
        return open(path, "a"), True
    except OSError as e:
        if e.errno not in (errno.EROFS, errno.EACCES, errno.EPERM):
            raise
    try:
        return open(path), False
    except OSError:
        return None, False


class Busy(Fail):
    """The list's lock not free within a change's wait."""


def progress_dir(path):
    """#1490: where status lines wait while their list is busy: one file per task, the newest replacing the last."""
    return os.path.join(STORE, "." + os.path.basename(path) + ".progress")


def queue_progress(path, task_id, progress):
    """A status line kept for the list's next holder (Store.save()), since its lock is held now."""
    d = progress_dir(path)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, f".{task_id}.{os.getpid()}.tmp")
    with open(tmp, "w") as f:
        json.dump({"id": task_id, "progress": progress}, f)
    os.replace(tmp, os.path.join(d, f"{task_id}.json"))


class Store:
    """One folder's tasks, locked while open. `with Store(loc) as s: s.data[...]; s.dirty = True`.
    write: True (refused where nothing can be written), False (read only), or "try" (a read that
    saves what it learns when it can: show, list)."""

    def __init__(self, loc, write=True, wait=None):
        self.loc, self.write, self.best_effort = loc, bool(write), write == "try"
        self.slug, self.path, self.moved = resolve_store(loc["folder"])
        self.dirty = self.read_only = False
        self.read_as = None   # the list as read or saved last (save() writes when it differs)
        self.wait = wait  # seconds a change waits for the lock before it gives up (None: as long as it takes)

    def __enter__(self):
        try:
            os.makedirs(STORE, exist_ok=True)
        except OSError:
            pass
        self.lock, can = open_lock(lock_path(self.path))
        if not can:
            if self.write and not self.best_effort:
                if self.lock:
                    self.lock.close()
                raise Fail(f"Can't change the task list here: {STORE} is read-only (a sandbox?). Run this outside it.")
            self.write, self.read_only = False, True
        # #1130: a read never waits for the lock. Every save replaces the list whole (os.replace), so a read sees the old
        # list or the new one, never half: a plain read takes no lock, and one that would save what it learns (show,
        # list) saves only when the lock is free now; else it reads like any other. A change waits, up to `wait`.
        if self.lock and not self.write:
            self.lock.close()
            self.lock = None
        elif self.lock:
            self.take_lock()
        try:
            _, _, moved = resolve_store(self.loc["folder"]) if self.moved else (None, None, None)
            if moved and self.write:
                self.move(moved)
            source = (moved if not self.write else None) or self.path
            try:
                with open(source) as f:
                    self.data = json.load(f)
                if source != self.path:
                    self.slug, self.path = os.path.basename(source)[:-5], source
            except FileNotFoundError:
                self.data = (read_list(self.path) if source != self.path else None) or {}
            except ValueError:
                raise Fail(f"{self.path} isn't valid JSON. Fix it first.")
        except BaseException:
            if self.lock:
                self.lock.close()
            raise
        d = self.data
        d.setdefault("version", 1)
        d["folder"], d["kind"], d["name"] = self.loc["folder"], self.loc["kind"], self.loc["name"]
        if d.get("slug") != self.slug and os.path.exists(self.path):
            d["slug"] = self.slug
            self.dirty = True
        d["slug"] = self.slug
        d.setdefault("next", 1)
        d.setdefault("tasks", [])
        self.before = analytics.snapshot(d["tasks"]) if self.write else None
        self.new_prefix = False
        if self.write and self.loc["kind"] == "repo" and not d.get("project_id"):
            pid = project_id(self.loc["folder"], make=True)
            if pid:
                d["project_id"] = pid
                self.dirty = self.dirty or os.path.exists(self.path)
        if self.write:
            self.migrate()
            if not d.get("prefix"):
                # Its id prefix, unique on this machine; lists made before prefixes get one too.
                taken, base = prefixes_in_use(self.path), auto_prefix(os.path.basename(self.loc["folder"]))
                n = 1
                while (base if n == 1 else f"{base}{n}") in taken:
                    n += 1
                d["prefix"] = base if n == 1 else f"{base}{n}"
                self.dirty = self.new_prefix = bool(d["tasks"]) or os.path.exists(self.path)
        self.read_as = self.text() if self.write else None
        return self

    def move(self, source):
        """Move under both locks. A reader can still use the old file until the move completes."""
        if source == self.path:
            self.move_locked(source)
            return
        lock, can = open_lock(lock_path(source))
        if not can:
            if lock:
                lock.close()
            raise Fail("Can't move the old task list here: it is read-only.")
        with lock:
            flags = fcntl.LOCK_EX | (fcntl.LOCK_NB if self.best_effort else 0)
            try:
                fcntl.flock(lock, flags)
            except BlockingIOError:
                self.write = False
                return
            self.move_locked(source)

    def move_locked(self, source):
        d = read_list(source)
        if not is_task_list(d):
            return
        old_folder, folder = d["folder"], self.loc["folder"]
        old_slug = d.get("slug") or os.path.basename(source)[:-5]
        if old_folder == folder and source == self.path:
            return
        if source != self.path and os.path.exists(self.path):
            raise Fail("The old and new folders each have a task list. Move one aside before retrying.")
        move_artifacts(old_folder, old_slug, self.loc)
        if old_folder != folder and any(t.get("worktree") for t in d["tasks"]):
            git(folder, "worktree", "repair")
        if source != self.path:
            os.replace(source, self.path)
        repo = remote_repo(folder)
        d.update(folder=folder, name=self.loc["name"], slug=self.slug,
                 github={"repo": repo, "at": 0})
        write_list(self.path, d)
        if old_slug != self.slug:
            for t in d["tasks"]:
                if not t.get("agents"):
                    continue
                old_key = f"{old_slug}#{t['id']}"
                for k in live_agents(old_key) + live_helpers(old_key):
                    run(["hc", "label", k["address"], f"herdr.task={self.key(t)}"])

    def text(self):
        # compact (#1175: the panels read every list through one capped exec; indented, a busy list was
        # a third spaces); ASCII-escaped still, since readers open it in the locale's encoding
        return json.dumps(self.data, separators=(",", ":"))

    def take_lock(self):
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            pass
        if self.best_effort:
            self.lock.close()
            self.lock, self.write = None, False
            return
        if self.wait is None:
            fcntl.flock(self.lock, fcntl.LOCK_EX)
            return
        end = time.time() + self.wait
        while True:
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.time() >= end:
                    self.lock.close()
                    self.lock = None
                    raise Busy(f"The task list for {self.loc['name']} is busy: another herdr-task has held it for over "
                               f"{self.wait:g} s (the scheduler, or a slow command), so nothing was changed. Try again in a minute.")
                time.sleep(0.2)

    def take_progress(self):
        """#1490: the status lines queued while the list was busy (queue_progress()), on their tasks: a newer one
        than its task shows wins. Each file is claimed by a rename first, so one queued meanwhile waits for the next."""
        d = progress_dir(self.path)
        try:
            names = os.listdir(d)
        except OSError:
            return False
        by_id = {t.get("id"): t for t in self.data.get("tasks") or [] if isinstance(t, dict)}
        changed = False
        for n in names:
            if not n.endswith(".json"):
                continue
            mine = os.path.join(d, f".{n}.{os.getpid()}.taking")
            try:
                os.rename(os.path.join(d, n), mine)
            except OSError:
                continue
            try:
                with open(mine) as f:
                    q = json.load(f)
            except (OSError, ValueError):
                q = None
            try:
                os.remove(mine)
            except OSError:
                pass
            t = by_id.get(q.get("id")) if isinstance(q, dict) else None
            p = q.get("progress") if t else None
            if isinstance(p, dict) and t.get("state") in ("running", "ready") and \
                    (p.get("set") or 0) >= ((t.get("progress") or {}).get("set") or 0):
                t["progress"] = p
                changed = True
        return changed

    def save(self):
        """Writes the list when anything in it changed since it was read or saved, flagged (`dirty`) or not
        (#1489, #1488: ready's head, set without `dirty`, was dropped when released() read the list again)."""
        if not self.write:
            return
        if self.lock and self.take_progress():
            self.dirty = True
        text = self.text()
        if self.dirty or text != self.read_as:
            tmp = f"{self.path}.{os.getpid()}.tmp"
            with open(tmp, "w") as f:
                f.write(text + "\n")
            os.replace(tmp, self.path)
            self.dirty, self.read_as = False, text
            # personal analytics (analytics.py): what changed, as ids and timings, on this machine only
            if self.before is not None:
                analytics.saved(self.before, self.data)
                self.before = analytics.snapshot(self.data.get("tasks"))

    @contextmanager
    def released(self):
        """The lock let go while slow work outside the list runs (#1007: a git push through the repo's
        pre-push hook can take many minutes, and every other command here waited on it): what changed
        is saved first, and the list read again after, since others may have changed it meanwhile.
        Each task's dict stays the same object, updated in place, so a caller's `t` sees the new state.
        Never inside a loop over the tasks (the list itself is a new one after)."""
        if not (self.lock and self.write):
            yield
            return
        self.save()
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        try:
            yield
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_EX)
            try:
                with open(self.path) as f:
                    fresh = json.load(f)
            except (OSError, ValueError):
                fresh = None
            if isinstance(fresh, dict) and isinstance(fresh.get("tasks"), list):
                mine = {t.get("id"): t for t in self.data.get("tasks") or []}
                tasks = []
                for t in fresh["tasks"]:
                    old = mine.get(t.get("id")) if isinstance(t, dict) else None
                    if old is not None:
                        old.clear()
                        old.update(t)
                        t = old
                    tasks.append(t)
                fresh["tasks"] = tasks
                self.data.clear()
                self.data.update(fresh)
                # what others changed meanwhile, they recorded themselves
                self.before = analytics.snapshot(tasks)
                # what is on disk now: anything the caller changes after this is saved on the way out (save())
                self.read_as = self.text()
            elif not os.path.isdir(self.loc["folder"]):
                self.write = False
                raise Fail("The task folder moved while this command was running. Try again from the new folder.")
            else:
                self.dirty = True   # unreadable just now: what this command holds is saved on the way out

    def __exit__(self, kind, *_):
        try:
            if kind is None:
                self.save()
        finally:
            if self.lock:
                fcntl.flock(self.lock, fcntl.LOCK_UN)
                self.lock.close()
        if kind is None and self.new_prefix:
            # A list that just got its prefix: its running tasks' tabs say it too.
            retag_tabs(self)

    def key(self, task):
        return f"{self.slug}#{task['id']}"

    @property
    def prefix(self):
        return self.data.get("prefix") or auto_prefix(os.path.basename(self.loc["folder"]))

    def ref(self, task):
        """Its hidden key, HAT-4: what commands, links and tags carry. Never shown to the person (SHEP-322):
        people and agents' words name a task by its title (name())."""
        return f"{self.prefix}-{task['id']}"

    def name(self, task):
        """What people and agents call it: its title, in quotes ("Fix login")."""
        return quoted(task.get("title"))

    def find(self, ref):
        """A task by its key (HAT-4, 4, #4, a label's key), else by its title: the exact title, else a unique part of
        one (SHEP-322). Two or more that fit are refused with each listed, never a guess."""
        try:
            pre, n = parse_ref(ref)
        except Fail:
            pre = n = None
        if n is not None and (not pre or pre == self.prefix):
            for t in self.data["tasks"]:
                if t["id"] == n:
                    return t
        hits = by_title(self.data["tasks"], ref)
        if len(hits) == 1:
            return hits[0]
        if hits:
            raise Fail(f"{len(hits)} tasks here fit {quoted(ref)}, so nothing was done. Name one by its key (for commands "
                       f"only; never say it to the person) or its full title:\n" +
                       "\n".join(f"  {self.ref(t)}  {t.get('state', 'todo'):<8} {' '.join(str(t.get('title') or '').split())}"
                                  for t in hits[:12]) + (f"\n  … and {len(hits) - 12} more" if len(hits) > 12 else ""))
        raise Fail(f"No task {quoted(ref)} in {self.loc['folder']}.")

    def new(self, title, prompt="", mode="here"):
        d = self.data
        if d["next"] == 1 and not d["tasks"] and d.get("kind") == "repo":
            d["next"] = peer_next(d["folder"], d.get("project_id"))
        t = {"id": d["next"], "title": title, "prompt": prompt, "mode": mode, "state": "todo",
             "created": now(), "agents": []}
        d["next"] += 1
        d["tasks"].append(t)
        self.dirty = True
        return t

    # The Tasks panel's old lists: <repo>/.git/herdr-tasks.json, and data/tasks/<slug>.json in the
    # app's home for folders outside git. Read once, then set aside as *.migrated.
    def migrate(self):
        old = []
        if self.loc["common"]:
            old.append(os.path.join(self.loc["common"], "herdr-tasks.json"))
        old.append(os.path.join(LEGACY, re.sub(r"[^\w.-]+", "_", "local" + self.loc["folder"]) + ".json"))
        for p in old:
            if not os.path.isfile(p):
                continue
            try:
                with open(p) as f:
                    items = json.load(f).get("tasks") or []
            except (OSError, ValueError):
                continue
            for o in items:
                if not isinstance(o, dict) or not o.get("title"):
                    continue
                state = {"started": "running", "complete": "done"}.get(o.get("state"), "todo")
                t = self.new(o["title"], o.get("prompt") or "", "here")
                t.update(state=state, created=o.get("created") or now(), legacy_id=o.get("id"))
                if o.get("started"):
                    t["started"] = o["started"]
                if o.get("completed"):
                    t["done_at"] = o["completed"]
                if o.get("terminal"):
                    a = {"address": o["terminal"], "agent": o.get("agent") or "", "at": o.get("started") or now()}
                    k = hc_json("get", o["terminal"])
                    if k and k.get("state") == "live":
                        # Still running: label it so it shows as this task's agent.
                        run(["hc", "label", o["terminal"], f"herdr.task={self.key(t)}"])
                        labels = k.get("labels") or {}
                        t["space"], t["tab"] = labels.get("herdr.space"), labels.get("herdr.tab")
                        pid = (k.get("foreground") or {}).get("pid")
                        sid, log = session_of(pid) if pid and agent_running(k) else (None, None)
                        if sid:
                            a["session"], a["log"] = sid, log
                    t["agents"].append(a)
            os.replace(p, p + ".migrated")
            self.dirty = True


def open_store(args, write=True, wait=None):
    """The list a command works on: --folder's, else the one whose prefix the id names (HAT-4
    from anywhere), else the current folder's."""
    folder = getattr(args, "folder", None)
    ref = getattr(args, "id", None)
    if not folder and ref:
        m = re.fullmatch(r"([A-Za-z]+[0-9]*)-[Aa]?[0-9]+", str(ref).strip())
        if m:
            folder = prefixes_in_use().get(m.group(1).upper())
            if folder and not os.path.isdir(folder):
                here = locate(None)
                candidate = read_list(store_path(here["folder"])[1])
                if is_task_list(candidate) and candidate.get("prefix") == m.group(1).upper():
                    folder = here["folder"]
    return Store(locate(folder), write, wait)


def is_task_list(d):
    """THE rule for what in STORE is a folder's task list: a JSON object with a string "folder"
    and a list "tasks". Everything else there (herdr-task's own .news.json, .seen.json, ...; some
    are lists) is skipped. A list's slug can start with a dot (~/.config/x: .config-x.json), so
    names can't tell them apart. The panels' copy of this rule: lib/tasklists.js."""
    return isinstance(d, dict) and isinstance(d.get("folder"), str) and isinstance(d.get("tasks"), list)


def store_files(folder=None):
    """`folder`'s list path, or every task list in STORE (see is_task_list)."""
    if folder:
        return [store_path(locate(folder)["folder"])[1]]
    names = sorted(f for f in os.listdir(STORE) if f.endswith(".json")) if os.path.isdir(STORE) else []
    return [p for p in (os.path.join(STORE, f) for f in names) if is_task_list(read_list(p))]


def read_list(p):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
