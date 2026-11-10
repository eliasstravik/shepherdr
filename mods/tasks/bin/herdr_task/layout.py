"""Where Shepherdr keeps its own data, and the one-time move there from ~/.herdr (SHEP-141).

Shepherdr's data lives in its own `shepherdr` folders (XDG, on macOS too; caches in ~/Library/Caches
there), never under Herdr's name:

  config  ~/.config/shepherdr/          settings.json, model-picks.json
  data    ~/.local/share/shepherdr/     tasks/, artifacts/, secrets/{vault.json,remote}, worktrees/ (new
                                        tasks' worktrees; a setting picks another root), tools.json, LAYOUT
  state   ~/.local/state/shepherdr/     service/ (the web service's token, socket, log, usage), browser/
                                        (task browsers' sign-ins), secret-drop/, cli-check.json,
                                        machine-hold.json, migrate.json (the move's journal)
  cache   ~/.cache/shepherdr/ (macOS: ~/Library/Caches/shepherdr/), with CACHEDIR.TAG

SHEPHERDR_HOME=<root> puts all four under <root>/{config,data,state,cache}; else XDG_CONFIG_HOME,
XDG_DATA_HOME, XDG_STATE_HOME and XDG_CACHE_HOME are honoured. Every process must see the same ones:
one without them still lands right through the old paths' links (below).

The move (migrate()) runs once per machine, by itself: the installer runs it on install and update,
and herdr-task runs it on its first start after a sync brought a new copy to another machine. Each
kind moves in one rename (same disk), with a link left at its old place (~/.herdr/tasks ->
~/.local/share/shepherdr/tasks), so an older herdr-task, a Herdr window not yet reloaded, another
machine on an older Shepherdr (which reads $HOME/.herdr/... over herdr-core) and absolute paths in
old briefs all keep working. On another disk, a file (settings, the vault) is copied, checked,
then swapped (the old copy kept beside as <old>.pre-layout2); a folder (tasks, artifacts, browsers) stays
where it is and the new path links to it instead. LAYOUT (in data) is written last: until it says 2, every
reader uses the old paths. A crash anywhere leaves a state the next run finishes (migrate.json
records copies; a half-made link is finished; a half-made copy is dropped and made again).

Worktrees never move: git keeps their absolute paths, and agents, editors and session logs key on
them. A task keeps the worktree it has; new ones go to the new root; the old root drains.

Older code writing an old file path after the move (an older machine pushing settings, an old
helper replacing its file atomically) replaces the link with a plain file: heal() takes that file in
(when it is newer) and puts the link back. herdr-task heals at every start and on each scheduler
round.

rollback() moves everything back to ~/.herdr and leaves ~/.herdr/.layout-rollback, which keeps this
version on the old paths (no move by itself) until `shepherdr migrate` is run again. The links stay
until `shepherdr migrate --cleanup-legacy`, which refuses while a linked machine might still read them.

Standalone on purpose (no other herdr_task module): the herdr-task entry runs it before anything
reads a path, and bin/shepherdr imports it from the source it installs.
"""

import errno
import fcntl
import hashlib
import json
import os
import shutil
import stat
import sys
import time

LAYOUT = 2                      # the layout this code knows; a higher one stops it ("update Shepherdr")
LEGACY = ".herdr"               # under home: the old place, Shepherdr's data under Herdr's name
ROLLBACK = ".layout-rollback"   # in LEGACY: rolled back; stay on the old paths until `shepherdr migrate`
BACKUP = ".pre-layout2"         # a copied kind's old copy, kept beside it until cleanup
FS_SHARED = {"nfs", "nfs4", "cifs", "smbfs", "smb3", "afpfs", "fuse.sshfs", "9p", "davfs", "fuse.rclone"}

# kind: (old path under home, base, new path under base, "dir" | "file", big)
# big: on another disk it stays where it is (the new path links to it) instead of being copied.
KINDS = {
    "settings": (".herdr/shepherdr.json", "config", "settings.json", "file", False),
    "model-picks": (".herdr/model-picks.json", "config", "model-picks.json", "file", False),
    "tasks": (".herdr/tasks", "data", "tasks", "dir", False),
    "artifacts": (".herdr/artifacts", "data", "artifacts", "dir", True),
    "vault": (".herdr/vault.json", "data", "secrets/vault.json", "file", False),
    "secret-remote": (".herdr/secret-remote", "data", "secrets/remote", "file", False),
    "tools": (".herdr/tools.json", "data", "tools.json", "file", False),
    "service": (".herdr/shepherdr", "state", "service", "dir", False),
    "browser": (".herdr/browser", "state", "browser", "dir", True),
    "secret-drop": (".herdr/secret-drop", "state", "secret-drop", "dir", False),
    "secret-served": (".herdr/secret-served", "state", "secret-served", "dir", False),
    "cli-check": (".herdr/cli-check.json", "state", "cli-check.json", "file", False),
    "machine-hold": (".herdr/machine-hold.json", "state", "machine-hold.json", "file", False),
}
PRIVATE = {"vault", "secret-remote", "secret-drop", "secret-served", "service", "browser"}  # 0700 folders
LEGACY_WORKTREES = ".herdr/worktrees"


# ---- where ----------------------------------------------------------------------------------

def _abs(p):
    return p if p and os.path.isabs(p) else None   # XDG: a relative path is ignored


def roots(home=None, env=None, mac=None):
    """{config, data, state, cache} for this home. SHEPHERDR_HOME first, then XDG_*, then defaults.
    A home that isn't the real one (an installer --root, a test) ignores the variables."""
    env = os.environ if env is None else env
    home = home or os.path.expanduser("~")
    mac = sys.platform == "darwin" if mac is None else mac
    one = _abs(env.get("SHEPHERDR_HOME"))
    if one:
        return {k: os.path.join(one, k) for k in ("config", "data", "state", "cache")}
    x = lambda var, *dflt: os.path.join(_abs(env.get(var)) or os.path.join(home, *dflt), "shepherdr")
    cache = _abs(env.get("XDG_CACHE_HOME"))
    return {"config": x("XDG_CONFIG_HOME", ".config"), "data": x("XDG_DATA_HOME", ".local", "share"),
            "state": x("XDG_STATE_HOME", ".local", "state"),
            "cache": os.path.join(cache, "shepherdr") if cache else os.path.join(home, *(("Library", "Caches") if mac else (".cache",)), "shepherdr")}


class Where:
    """The paths for one home. `migrated`: this machine is on the new layout (else every kind is
    its old path). Paths are read fresh by each call of where(): the move can happen any time."""

    def __init__(self, home=None, env=None, mac=None):
        self.home = home or os.path.expanduser("~")
        self.env = os.environ if env is None else env
        self.roots = roots(self.home, self.env, mac)
        self.legacy = os.path.join(self.home, LEGACY)
        self.layout_file = os.path.join(self.roots["data"], "LAYOUT")
        self.journal = os.path.join(self.roots["state"], "migrate.json")
        self.lock = os.path.join(self.roots["state"], "migrate.lock")

    def layout(self):
        """The layout number written here (0: none)."""
        try:
            with open(self.layout_file) as f:
                return int((f.read().split() or ["0"])[0])
        except (OSError, ValueError):
            return 0

    def rolled_back(self):
        return os.path.lexists(os.path.join(self.legacy, ROLLBACK))

    @property
    def migrated(self):
        return self.layout() >= LAYOUT and not self.rolled_back()

    def new(self, kind):
        _, base, rel, _, _ = KINDS[kind]
        return os.path.join(self.roots[base], rel)

    def old(self, kind):
        return os.path.join(self.home, KINDS[kind][0])

    def path(self, kind):
        """Where `kind` is now: the new path once migrated, else the old one."""
        return self.new(kind) if self.migrated else self.old(kind)

    def worktrees(self, setting=None):
        """Where new task worktrees go: the setting's folder (Settings > Tasks > Worktree folder), else
        the data folder's worktrees/ once migrated, else the old ~/.herdr/worktrees."""
        if setting:
            return os.path.expanduser(setting)
        return os.path.join(self.roots["data"], "worktrees") if self.migrated else os.path.join(self.home, LEGACY_WORKTREES)

    def worktree_roots(self, setting=None):
        """Every root task worktrees may be in (the old one drains as its tasks finish)."""
        out = [self.worktrees(setting), os.path.join(self.roots["data"], "worktrees"), os.path.join(self.home, LEGACY_WORKTREES)]
        return list(dict.fromkeys(out))


def where(home=None, env=None, mac=None):
    return Where(home, env, mac)


def path(kind):
    """`kind`'s path on this machine now (the new one once migrated)."""
    return Where().path(kind)


# Shell: the same paths on any machine, old or new, for commands run there over herdr-core.
# Sets SHEP_CONFIG, SHEP_DATA, SHEP_STATE and one variable per kind (SHEP_TASKS, SHEP_SETTINGS, ...):
# the new path once that machine is migrated, else its old one.
def _sh():
    var = lambda k: "SHEP_" + k.upper().replace("-", "_")
    lines = ['if [ -n "${SHEPHERDR_HOME:-}" ]; then SHEP_CONFIG="$SHEPHERDR_HOME/config"; SHEP_DATA="$SHEPHERDR_HOME/data"; '
             'SHEP_STATE="$SHEPHERDR_HOME/state"; else SHEP_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shepherdr"; '
             'SHEP_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/shepherdr"; SHEP_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/shepherdr"; fi',
             f'if [ "$(cat "$SHEP_DATA/LAYOUT" 2>/dev/null | cut -c1)" = "{LAYOUT}" ] && [ ! -e "$HOME/{LEGACY}/{ROLLBACK}" ]; then',
             " ".join(f'{var(k)}="$SHEP_{b.upper()}/{rel}";' for k, (_, b, rel, _, _) in KINDS.items()),
             "else", " ".join(f'{var(k)}="$HOME/{old}";' for k, (old, _, _, _, _) in KINDS.items()), "fi"]
    return "\n".join(lines) + "\n"


SH = _sh()


# Python (3.8+), for scripts run on another machine (python3 -c): SHEP(".herdr/tools.json") is that
# path on that machine, new or old as it is there. Needs `import os`.
def _py():
    table = {old: (base, rel) for old, base, rel, _, _ in KINDS.values()}
    return f"""
def SHEP(rel, _t={table!r}):
    H, E = os.path.expanduser("~"), os.environ
    a = lambda v: E.get(v) if (E.get(v) or "").startswith("/") else None
    one = a("SHEPHERDR_HOME")
    R = dict((k, os.path.join(one, k)) for k in ("config", "data", "state")) if one else {{
        "config": os.path.join(a("XDG_CONFIG_HOME") or os.path.join(H, ".config"), "shepherdr"),
        "data": os.path.join(a("XDG_DATA_HOME") or os.path.join(H, ".local", "share"), "shepherdr"),
        "state": os.path.join(a("XDG_STATE_HOME") or os.path.join(H, ".local", "state"), "shepherdr")}}
    try:
        with open(os.path.join(R["data"], "LAYOUT")) as f:
            on = int((f.read().split() or ["0"])[0]) >= {LAYOUT} and not os.path.lexists(os.path.join(H, "{LEGACY}", "{ROLLBACK}"))
    except (OSError, ValueError):
        on = False
    if on:
        for old, (base, new) in _t.items():
            if rel == old or rel.startswith(old + "/"):
                return os.path.join(R[base], new + rel[len(old):])
    return os.path.join(H, rel)
"""


PY = _py()


# ---- the move ---------------------------------------------------------------------------------

def _fs_type(p):
    """The filesystem type `p` is on (Linux: /proc/mounts; macOS: `mount`), or None."""
    p = os.path.realpath(p)
    rows = []
    try:
        with open("/proc/mounts") as f:
            rows = [(parts[1].replace("\\040", " "), parts[2]) for parts in (line.split() for line in f) if len(parts) >= 3]
    except OSError:
        try:
            import re
            import subprocess
            out = subprocess.run(["mount"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True, timeout=5).stdout
            # "//server/share on /Volumes/x (smbfs, nodev, ...)"
            rows = [(m.group(1), m.group(2)) for m in (re.match(r".* on (.+) \(([^,)]+)", line) for line in out.splitlines()) if m]
        except (OSError, ValueError):
            return None
    best = ("", None)
    for mnt, typ in rows:
        if (p == mnt or p.startswith(mnt.rstrip("/") + "/")) and len(mnt) >= len(best[0]):
            best = (mnt, typ)
    return best[1]


def shared_disk(w):
    """The home or a new root is on a network filesystem (locks unreliable there): no move by itself."""
    for p in [w.home] + list(w.roots.values()):
        q = p
        while not os.path.exists(q) and os.path.dirname(q) != q:
            q = os.path.dirname(q)
        t = _fs_type(q)
        if t and t.lower() in FS_SHARED:
            return f"{q} is on {t}"
    return None


def _sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _tree(top):
    """{relative path: (kind, size, sha or link target)} of a file or a folder, links not followed."""
    out = {}
    if not os.path.isdir(top) or os.path.islink(top):
        st = os.lstat(top)
        out["."] = ("link", 0, os.readlink(top)) if stat.S_ISLNK(st.st_mode) else ("file", st.st_size, _sha(top)) if stat.S_ISREG(st.st_mode) else ("other", 0, "")
        return out
    for d, dirs, files in os.walk(top):
        for n in dirs + files:
            p = os.path.join(d, n)
            r = os.path.relpath(p, top)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                out[r] = ("link", 0, os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                out[r] = ("dir", 0, "")
            elif stat.S_ISREG(st.st_mode):
                out[r] = ("file", st.st_size, _sha(p))
            else:
                out[r] = ("other", 0, "")  # sockets, fifos: not copied (runtime; made again)
    return out


def _copy(src, dst):
    """src copied to dst (links kept as links, sockets and fifos left out), then checked file by file."""
    if os.path.isdir(src) and not os.path.islink(src):
        def ignore(d, names):
            return [n for n in names if not (os.path.islink(os.path.join(d, n)) or os.path.isdir(os.path.join(d, n))
                                             or os.path.isfile(os.path.join(d, n)))]
        shutil.copytree(src, dst, symlinks=True, ignore=ignore)
    else:
        shutil.copy2(src, dst, follow_symlinks=False)
    a = {k: v for k, v in _tree(src).items() if v[0] != "other"}
    b = _tree(dst)
    if a != b:
        bad = sorted(set(a.items()) ^ set(b.items()))[:3]
        raise OSError(f"the copy of {src} doesn't match it ({bad})")


def _fsync_dir(d):
    try:
        fd = os.open(d, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _link(target, at):
    """`at` becomes a link to `target`, in one step (a link left half-made is finished next run)."""
    tmp = at + ".shep-link"
    if os.path.lexists(tmp):
        os.remove(tmp)
    os.symlink(target, tmp)
    os.replace(tmp, at)
    _fsync_dir(os.path.dirname(at))


def _links_to(p, target):
    return os.path.islink(p) and os.path.realpath(p) == os.path.realpath(target)


def _empty(p):
    return os.path.isdir(p) and not os.path.islink(p) and not os.listdir(p)


def _journal(w):
    try:
        with open(w.journal) as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def _save_journal(w, j):
    os.makedirs(os.path.dirname(w.journal), exist_ok=True)
    tmp = w.journal + f".{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(j, f, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, w.journal)


class Locked(Exception):
    pass


class _Lock:
    def __init__(self, w, wait):
        self.w, self.wait = w, wait

    def __enter__(self):
        os.makedirs(os.path.dirname(self.w.lock), exist_ok=True)
        self.f = open(self.w.lock, "a")
        end = time.time() + self.wait
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.time() >= end:
                    self.f.close()
                    raise Locked("another Shepherdr process is moving the data now")
                time.sleep(0.2)

    def __exit__(self, *_):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def _aside(w, kind):
    return os.path.join(w.roots["state"], "taken-in", time.strftime("%Y%m%d-%H%M%S"), kind)


def _take_in(src, dst, aside):
    """src (a file or a folder an older writer made at an old path) into dst: what dst lacks moves in; on a clash
    the newer stays at dst and the other goes to `aside`. src is gone after."""
    if not os.path.isdir(src) or os.path.islink(src) or (os.path.lexists(dst) and not os.path.isdir(dst)):
        if not os.path.lexists(dst) or os.lstat(src).st_mtime >= os.lstat(dst).st_mtime:
            if os.path.lexists(dst):
                os.makedirs(os.path.dirname(aside), exist_ok=True)
                _replace_across(dst, aside)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            _replace_across(src, dst)
        else:
            os.makedirs(os.path.dirname(aside), exist_ok=True)
            _replace_across(src, aside)
        return
    os.makedirs(dst, exist_ok=True)
    for n in os.listdir(src):
        _take_in(os.path.join(src, n), os.path.join(dst, n), os.path.join(aside, n))
    os.rmdir(src)


def _catch_up(backup, new):
    """After a copy's swap: anything an older writer changed in the old copy since it was checked (newer there and
    different) is brought into the new place. The old copy stays as it is."""
    if os.path.isdir(backup) and not os.path.islink(backup):
        for d, _dirs, files in os.walk(backup):
            for n in files:
                a = os.path.join(d, n)
                _catch_up(a, os.path.join(new, os.path.relpath(a, backup)))
        return
    if not os.path.isfile(backup) or os.path.islink(backup):
        return
    if os.path.isfile(new) and (os.lstat(backup).st_mtime <= os.lstat(new).st_mtime or _sha(backup) == _sha(new)):
        return
    os.makedirs(os.path.dirname(new), exist_ok=True)
    shutil.copy2(backup, new + ".shep-tmp")
    os.replace(new + ".shep-tmp", new)


class _held_locks:
    """Every task list's lock (.<list>.json.lock) in a folder held while a copy is made and swapped: a writer already
    saving finishes first. Process-long locks (the scheduler's) aren't taken. Folders are no longer copied (another
    disk keeps them in place), so this guards only what a later kind might copy."""

    def __init__(self, folder):
        self.folder, self.held = folder, []

    def __enter__(self):
        names = sorted(n for n in os.listdir(self.folder) if n.endswith(".json.lock")) if os.path.isdir(self.folder) and not os.path.islink(self.folder) else []
        for n in names:
            try:
                f = open(os.path.join(self.folder, n), "a")
            except OSError:
                continue
            end = time.time() + 30
            while True:
                try:
                    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    self.held.append(f)
                    break
                except OSError:
                    if time.time() >= end:
                        f.close()
                        self.__exit__()
                        raise Locked(f"{n} stays locked: a task is being saved")
                    time.sleep(0.1)
        return self

    def __exit__(self, *_):
        for f in self.held:
            try:
                fcntl.flock(f, fcntl.LOCK_UN)
                f.close()
            except OSError:
                pass
        self.held = []


def _move_kind(w, kind, j, notes, dry):
    """One kind to its new place, from wherever an earlier run stopped. Returns what happened."""
    old, new = w.old(kind), w.new(kind)
    typ, big = KINDS[kind][3], KINDS[kind][4]
    done = j.setdefault("kinds", {})
    tmp_link = old + ".shep-link"
    # A run that stopped after the rename (the journal says "renaming" before it): finish. An older writer may have
    # made the old path again meanwhile (its tasks folder, a settings file): what it wrote is taken in, never set aside
    # in place of what moved.
    if done.get(kind) == "renaming" and os.path.lexists(new) and not (os.path.islink(old) and _links_to(old, new)):
        if dry:
            return "linked"
        if os.path.lexists(old) and not os.path.islink(old):
            _take_in(old, new, _aside(w, kind))
        elif os.path.lexists(old):
            os.remove(old)
        _link(new, old)
        if os.path.lexists(tmp_link):
            os.remove(tmp_link)
        done[kind] = "moved"
        _save_journal(w, j)
        return "linked"
    if done.get(kind) == "swapping" and not dry:
        backup = (j.get("backups") or {}).get(kind)
        if backup and os.path.lexists(backup) and os.path.lexists(new):
            # stopped between a copy's swap and its catch-up: finish both
            if not os.path.lexists(old) and os.path.lexists(tmp_link):
                os.replace(tmp_link, old)
            if _links_to(old, new):
                _catch_up(backup, new)
                done[kind] = "swapped"
                _save_journal(w, j)
                return "copied"
        if os.path.lexists(old) and not os.path.islink(old):
            done[kind] = "copied"   # the old copy wasn't swapped out yet: check it again and swap
            _save_journal(w, j)
    # A run that stopped between the rename and the link: finish the link.
    if not os.path.lexists(old) and os.path.lexists(tmp_link) and os.path.lexists(new):
        if not dry:
            os.replace(tmp_link, old)
        return "linked"
    if os.path.lexists(tmp_link) and not dry:
        os.remove(tmp_link)
    if _links_to(old, new) or (os.path.islink(new) and os.path.realpath(new) == os.path.realpath(old)):
        return "done"
    partial = new + ".partial"
    if os.path.lexists(partial) and not dry:
        (shutil.rmtree if os.path.isdir(partial) and not os.path.islink(partial) else os.remove)(partial)
    if os.path.islink(old) and os.path.exists(old):
        # The person's own link (their artifacts on a bigger disk): it stays, and the new path leads
        # to the same place. Nothing is moved off the disk they chose.
        if dry:
            return "kept"
        if os.path.lexists(new) and not _empty(new):
            aside = f"{new}.aside-{time.strftime('%Y%m%d-%H%M%S')}"
            notes.append(f"{new} was already there (not from this move): set aside as {aside}")
            os.rename(new, aside)
        elif _empty(new):
            os.rmdir(new)
        os.makedirs(os.path.dirname(new), exist_ok=True)
        _link(os.path.realpath(old), new)
        done[kind] = "kept"
        _save_journal(w, j)
        notes.append(f"{KINDS[kind][0]} is your own link to {os.path.realpath(old)}: kept, and the new path leads there too")
        return "kept"
    old_here = os.path.lexists(old) and not os.path.islink(old)  # a link to nothing: nothing there
    if not old_here:
        # Nothing here to move: the new place is all there is. The old path links to it, for
        # older code and other machines (a link to a file not made yet works for writing too).
        if dry:
            return "new"
        os.makedirs(os.path.dirname(new), exist_ok=True)
        if typ == "dir":
            os.makedirs(new, exist_ok=True)
        if os.path.islink(old):
            os.remove(old)
        _link(new, old)
        return "new"
    # Something already at the new place before this run moved anything there.
    if os.path.lexists(new) and done.get(kind) != "copied":
        if _empty(new):
            if not dry:
                os.rmdir(new)
        elif typ == "file" and os.path.isfile(new) and os.path.isfile(old) and _sha(new) == _sha(old):
            if not dry:
                os.remove(new)
        else:
            aside = f"{new}.aside-{time.strftime('%Y%m%d-%H%M%S')}"
            notes.append(f"{new} was already there (not from this move): set aside as {aside}")
            if not dry:
                os.rename(new, aside)
    if dry:
        return "move"
    os.makedirs(os.path.dirname(new), exist_ok=True)
    if done.get(kind) != "copied":
        try:
            os.symlink(new, tmp_link)
            done[kind] = "renaming"   # from here a crash is finished by the next run (see the top)
            _save_journal(w, j)
            os.rename(old, new)
            _fsync_dir(os.path.dirname(new))
            os.replace(tmp_link, old)
            _fsync_dir(os.path.dirname(old))
            done[kind] = "moved"
            _save_journal(w, j)
            return "moved"
        except OSError as e:
            if os.path.lexists(tmp_link):
                os.remove(tmp_link)
            if done.get(kind) == "renaming" and not os.path.lexists(new):
                done.pop(kind)   # the rename didn't happen
                _save_journal(w, j)
            if e.errno != errno.EXDEV:
                raise
        # Another disk.
        if big or typ == "dir":
            # Stays where it is: the new path leads to it. No copying of gigabytes, and a folder's live locks (a task
            # list being saved, the scheduler's) stay the one file every writer, old or new, takes.
            _link(old, new)
            done[kind] = "kept"
            _save_journal(w, j)
            notes.append(f"{KINDS[kind][0]} is on another disk than {new}: kept where it is, linked from the new place")
            return "kept"
        with _held_locks(old):
            _copy(old, partial)
            os.rename(partial, new)
        _fsync_dir(os.path.dirname(new))
        done[kind] = "copied"
        _save_journal(w, j)
    # Copied: check again (a run that stopped here finds the copy whole), then swap the old one out.
    a = {k: v for k, v in _tree(old).items() if v[0] != "other"}
    if a != _tree(new):
        # The old one changed since (an older process wrote it): copy again.
        (shutil.rmtree if os.path.isdir(new) and not os.path.islink(new) else os.remove)(new)
        done.pop(kind, None)
        _save_journal(w, j)
        return _move_kind(w, kind, j, notes, dry)
    backup = old + BACKUP
    if os.path.lexists(backup):
        backup = f"{backup}-{int(time.time())}"
    os.symlink(new, tmp_link)
    done[kind] = "swapping"           # a crash from here on: the next run catches up from the backup (see the top)
    j.setdefault("backups", {})[kind] = backup
    _save_journal(w, j)
    with _held_locks(old):            # no writer is mid-save in the old copy while it is swapped out
        os.rename(old, backup)
        os.replace(tmp_link, old)
    # An older writer that wrote the old copy between the check and the swap: its change comes along.
    _catch_up(backup, new)
    done[kind] = "swapped"
    _save_journal(w, j)
    return "copied"


def _private(w):
    for k in PRIVATE:
        p = w.new(k)
        d = p if KINDS[k][3] == "dir" else os.path.dirname(p)
        if os.path.isdir(d) and not os.path.islink(d):
            os.chmod(d, 0o700)


def _cache_tag(w):
    c = w.roots["cache"]
    os.makedirs(c, exist_ok=True)
    tag = os.path.join(c, "CACHEDIR.TAG")
    if not os.path.exists(tag):
        with open(tag, "w") as f:
            f.write("Signature: 8a477f597d28d172789f06886806bc55\n# Shepherdr's cache: safe to delete, skipped by backups.\n")


def migrate(home=None, env=None, mac=None, dry=False, force=False, wait=30, again=False):
    """Moves this home's data to the new layout. Safe to run again (and after a crash: it finishes).
    Returns {state, moved: {kind: how}, notes}. state: done (already), migrated, refused (why in notes),
    rolled-back (stays on the old paths until `again`: the person's own `shepherdr migrate`), newer (a later
    layout: update Shepherdr). force: also on a network disk."""
    w = Where(home, env, mac)
    out = {"state": "done", "moved": {}, "notes": [], "roots": w.roots}
    n = w.layout()
    if n > LAYOUT:
        out["state"] = "newer"
        out["notes"].append(f"this machine's data is on layout {n}, newer than this Shepherdr knows ({LAYOUT}): update Shepherdr")
        return out
    if w.rolled_back() and not again:
        out["state"] = "rolled-back"
        out["notes"].append("rolled back to ~/.herdr: run `shepherdr migrate` to move again")
        return out
    if n == LAYOUT and not dry:
        heal(w)
        return out
    why = shared_disk(w)
    if why and not force:
        out["state"] = "refused"
        out["notes"].append(f"not moved by itself: {why} (a network disk; file locks aren't safe there). "
                            "`shepherdr migrate --force` moves it when no other machine uses this home.")
        return out
    if dry:
        j = _journal(w)
        for k in KINDS:
            how = _move_kind(w, k, j, out["notes"], True)
            if how != "done":
                out["moved"][k] = how
        out["state"] = "would migrate"
        return out
    with _Lock(w, wait):
        if w.layout() >= LAYOUT and not w.rolled_back():
            return out
        for r in w.roots.values():
            os.makedirs(r, exist_ok=True)
        os.makedirs(w.legacy, exist_ok=True)
        j = _journal(w)
        j.setdefault("started", int(time.time() * 1000))
        _save_journal(w, j)
        for k in KINDS:
            how = _move_kind(w, k, j, out["notes"], False)
            if how != "done":
                out["moved"][k] = how
        _private(w)
        _cache_tag(w)
        os.makedirs(os.path.join(w.roots["data"], "worktrees"), exist_ok=True)
        rb = os.path.join(w.legacy, ROLLBACK)
        if os.path.lexists(rb):
            os.remove(rb)
        j["finished"] = int(time.time() * 1000)
        j["notes"] = out["notes"]
        _save_journal(w, j)
        tmp = w.layout_file + ".tmp"
        with open(tmp, "w") as f:
            f.write(f"{LAYOUT}\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, w.layout_file)   # last: until now every reader used the old paths
        _fsync_dir(os.path.dirname(w.layout_file))
    out["state"] = "migrated"
    return out


def summary(res):
    """The one plain line the person reads about the move."""
    if res["state"] == "migrated":
        moved = [k for k, how in res["moved"].items() if how in ("moved", "copied", "kept")]
        r = res["roots"]
        return (f"Shepherdr's data moved to its own folders ({_short(r['config'])}, {_short(r['data'])}, {_short(r['state'])}). "
                f"{'Old paths in ~/.herdr link there; nothing to do.' if moved else 'Nothing to move.'}")
    if res["state"] in ("refused", "newer", "rolled-back"):
        return "Shepherdr's data stays in ~/.herdr: " + "; ".join(res["notes"])
    return ""


def _short(p):
    h = os.path.expanduser("~")
    return "~" + p[len(h):] if p.startswith(h + "/") else p


# ---- healing: older code wrote an old path after the move ----------------------------------------

def heal(w=None):
    """A plain file or folder at an old path (an older writer replaced its link): taken in, link put
    back. A file is taken when it is newer than the new one (else set aside); a folder's entries move
    in one by one (on a clash the newer stays, the other is set aside). Returns what it took."""
    w = w or Where()
    if not w.migrated:
        return []
    took = []
    cleaned = bool(_journal(w).get("cleaned"))
    for k, (_, _, _, typ, _) in KINDS.items():
        old, new = w.old(k), w.new(k)
        try:
            if not os.path.lexists(old) or os.path.islink(old):
                if not os.path.lexists(old) and not os.path.lexists(old + ".shep-link") and os.path.isdir(w.legacy) and not cleaned:
                    _link(new, old)   # removed by hand or by an older uninstall: put the link back
                continue
            if os.path.islink(new) and os.path.realpath(new) == os.path.realpath(old):
                continue  # kept on another disk: the old path is the real one
            _take_in(old, new, _aside(w, k))
            _link(new, old)
            took.append(k)
        except OSError:
            continue  # tried again next time
    return took


def heal_back(w=None):
    """Rolled back: a window or service that still had the new paths for a moment wrote there; that is taken back to
    the old place (the newer of each wins), so nothing written just after a rollback is hidden."""
    w = w or Where()
    if not w.rolled_back():
        return []
    took = []
    for k in KINDS:
        old, new = w.old(k), w.new(k)
        try:
            if os.path.lexists(new) and not os.path.islink(new) and not os.path.islink(old):
                _take_in(new, old, os.path.join(w.legacy, ".rollback-aside", time.strftime("%Y%m%d-%H%M%S"), k))
                took.append(k)
        except OSError:
            continue
    return took


def _replace_across(a, b):
    try:
        os.replace(a, b)
    except OSError as e:
        if e.errno != errno.EXDEV:
            raise
        if os.path.isdir(a) and not os.path.islink(a):
            if os.path.lexists(b):
                shutil.rmtree(b)
            shutil.copytree(a, b, symlinks=True)
            shutil.rmtree(a)
        else:
            shutil.copy2(a, b, follow_symlinks=False)
            os.remove(a)


# ---- rollback and cleanup ---------------------------------------------------------------------

def rollback(home=None, env=None, mac=None, wait=30):
    """Everything back to ~/.herdr (an older Shepherdr then finds it as it left it). Marks the old
    layout first, so readers switch to the old paths (still links) before anything moves."""
    w = Where(home, env, mac)
    out = {"state": "rolled-back", "moved": {}, "notes": []}
    with _Lock(w, wait):
        os.makedirs(w.legacy, exist_ok=True)
        with open(os.path.join(w.legacy, ROLLBACK), "w") as f:
            f.write(f"rolled back at {time.strftime('%Y-%m-%d %H:%M:%S')}: `shepherdr migrate` moves the data again\n")
        _fsync_dir(w.legacy)
        for k in KINDS:
            old, new = w.old(k), w.new(k)
            if os.path.islink(new) and os.path.realpath(new) == os.path.realpath(old):
                os.remove(new)  # was kept on the other disk
                out["moved"][k] = "unlinked"
                continue
            if not os.path.lexists(new) or os.path.islink(new):
                if _links_to(old, new) or (os.path.islink(old) and not os.path.exists(old)):
                    os.remove(old)
                continue
            if os.path.lexists(old) and not os.path.islink(old):
                # an older writer put a plain copy back at the old path: both are merged there, the newer of each wins
                _take_in(new, old, os.path.join(w.legacy, ".rollback-aside", time.strftime("%Y%m%d-%H%M%S"), k))
                out["moved"][k] = "merged back"
                continue
            tmp = old + ".shep-back"
            if os.path.lexists(tmp):
                (shutil.rmtree if os.path.isdir(tmp) and not os.path.islink(tmp) else os.remove)(tmp)
            try:
                if os.path.lexists(old):
                    os.remove(old)
                os.rename(new, old)
            except OSError as e:
                if e.errno != errno.EXDEV:
                    raise
                _copy(new, tmp)
                if os.path.lexists(old):
                    os.remove(old)
                os.rename(tmp, old)
                kept = new + ".rolled-back"
                os.rename(new, kept)
                out["notes"].append(f"{new} copied back to {old} (another disk); the new copy is kept as {kept}")
            out["moved"][k] = "back"
        _fsync_dir(w.legacy)
        try:
            os.remove(w.layout_file)
        except FileNotFoundError:
            pass
    return out


def cleanup_legacy(home=None, env=None, mac=None):
    """The old paths' links removed (and copies kept from another disk). Only on the person's word."""
    w = Where(home, env, mac)
    if not w.migrated:
        return ["not on the new layout: nothing to clean up"]
    gone = []
    for k in KINDS:
        old = w.old(k)
        if _links_to(old, w.new(k)):
            os.remove(old)
            gone.append(old)
        if os.path.lexists(old + BACKUP):
            p = old + BACKUP
            (shutil.rmtree if os.path.isdir(p) and not os.path.islink(p) else os.remove)(p)
            gone.append(p)
    j = _journal(w)
    j["cleaned"] = int(time.time() * 1000)
    _save_journal(w, j)
    return gone


# ---- state, for `shepherdr where` and `shepherdr doctor` ------------------------------------------

def status(home=None, env=None, mac=None):
    """{layout, migrated, rolled_back, roots, kinds: {kind: {path, old, state}}, worktrees, journal}."""
    w = Where(home, env, mac)
    kinds = {}
    for k in KINDS:
        old, new = w.old(k), w.new(k)
        if not w.migrated:
            st = "old place"
        elif os.path.islink(new) and os.path.realpath(new) == os.path.realpath(old):
            st = "kept on the other disk (new path links to it)"
        elif _links_to(old, new):
            st = "moved (old path links here)"
        elif os.path.islink(old):
            st = "moved (old path links elsewhere!)"
        elif os.path.lexists(old):
            st = "moved, but an old plain copy is back at the old path (taken in on the next herdr-task run)"
        else:
            st = "moved (no link at the old path)"
        kinds[k] = {"path": w.path(k), "old": old, "state": st}
    old_wt = os.path.join(w.home, LEGACY_WORKTREES)
    try:
        left = sum(len([b for b in os.listdir(os.path.join(old_wt, r)) if os.path.isdir(os.path.join(old_wt, r, b))])
                   for r in os.listdir(old_wt) if os.path.isdir(os.path.join(old_wt, r)))
    except OSError:
        left = 0
    return {"layout": w.layout(), "knows": LAYOUT, "migrated": w.migrated, "rolled_back": w.rolled_back(), "roots": w.roots,
            "kinds": kinds, "worktrees": {"new": w.worktrees(None), "old": old_wt, "old_left": left},
            "journal": _journal(w), "shared_disk": shared_disk(w)}


def ensure(quiet=True):
    """herdr-task's start: moves the data once (the first run after an update brought this code), and
    heals old-path writes. Never in a test's world (HERDR_TASK_STORE / SHEPHERDR_NO_MIGRATE) and never
    fails the command: on any problem it stays on the old paths and `shepherdr doctor` says why."""
    if os.environ.get("HERDR_TASK_STORE") or os.environ.get("SHEPHERDR_NO_MIGRATE") or os.environ.get("HERDR_TASK_SETTINGS"):
        return None
    try:
        w = Where()
        n = w.layout()
        if n > LAYOUT:
            return "newer"
        if w.rolled_back():
            heal_back(w)
            return None
        if n == LAYOUT:
            heal(w)
            return None
        res = migrate(wait=5)
        line = summary(res)
        if line and not quiet:
            print(line, file=sys.stderr)
        return res["state"]
    except Exception:   # Locked, a full disk, anything: next run tries again
        return None
