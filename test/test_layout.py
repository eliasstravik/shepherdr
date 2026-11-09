"""SHEP-141: Shepherdr's data in its own folders, and the one-time move there from ~/.herdr (herdr_task/layout.py).

Every test works in a throwaway home (tempfile): never the person's ~/.herdr, never a live task. The "machines" in
the mixed-version tests are two throwaway homes, one moved and one not, with the shell and Python each version
really runs against the other.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import errno
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import layout as L  # noqa: E402

SHEPHERDR = os.path.join(ROOT, "bin", "shepherdr")
BUN = shutil.which("bun")

# What Shepherdr 3.1.26 (before the move) runs on a machine, word for word: the Tasks panel's read of a machine's
# lists (core/tasklists.js), the settings window's push to another machine (mods/shepherdr-settings), the Jump
# panel's and the web's read of artifacts. Its sync script is test/fixtures/install-3.1.26.py.
OLD_READ_LISTS = ('cd "$HOME/.herdr/tasks" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && printf "%s\\n" "$f" '
                  '&& cat "$f" && printf "\\n@@herdr-task-list@@\\n"; done; true')
OLD_PUSH = '''f="$HOME/.herdr/shepherdr.json"; mkdir -p "$HOME/.herdr" || exit 1
if [ -f "$f" ] && ! grep -q '"pushed_from"' "$f"; then echo own; exit 0; fi
if [ -f "$f" ] && [ "$(cat "$f")" = "$1" ]; then exit 0; fi
umask 077; printf '%s\\n' "$1" > "$f.tmp" && mv "$f.tmp" "$f"'''
OLD_READ_ARTS = 'cd "$HOME/.herdr/artifacts" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true'
OLD_INSTALL = open(os.path.join(ROOT, "test", "fixtures", "install-3.1.26.py")).read()


def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"})
    if r.returncode:
        raise AssertionError(f"git {' '.join(args)}: {r.stderr}")
    return r.stdout.strip()


def write(p, text, mode=None):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)
    if mode:
        os.chmod(p, mode)


def snapshot(top):
    """{relative path: content or link target} of everything under top (links not followed)."""
    out = {}
    for d, dirs, files in os.walk(top):
        for n in dirs + files:
            p = os.path.join(d, n)
            r = os.path.relpath(p, top)
            if os.path.islink(p):
                out[r] = ("link", os.readlink(p))
            elif os.path.isfile(p):
                out[r] = ("file", open(p, "rb").read())
            elif os.path.isdir(p):
                out[r] = ("dir", None)
    return out


def realistic(home):
    """A Shepherdr 3.1.26 home: task lists (one with a live worktree task, one finished), artifacts with files, a
    vault and its remote mark, settings (global and per space), a task browser's profile, the service's files with
    its socket, the tools stamp, cli-check and machine-hold, plus a real repo with a live and a finished worktree in
    ~/.herdr/worktrees. Returns {name: path} of what tests look at."""
    h = os.path.join(home, ".herdr")
    repo = os.path.join(home, "dev", "shop")
    os.makedirs(repo)
    git(repo, "init", "-q", "-b", "main")
    write(os.path.join(repo, "README"), "shop\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "first")
    live = os.path.join(h, "worktrees", "shop", "task-2-cart")
    done = os.path.join(h, "worktrees", "shop", "task-1-done")
    git(repo, "worktree", "add", "-q", "-b", "task/2-cart", live)
    git(repo, "worktree", "add", "-q", "-b", "task/1-done", done)
    write(os.path.join(live, "cart.txt"), "work in progress, not committed\n")
    tasks = {"version": 1, "folder": repo, "kind": "repo", "name": "shop", "slug": "dev-shop", "prefix": "SHOP", "next": 4,
             "tasks": [{"id": 1, "title": "Done one", "state": "done", "mode": "worktree", "worktree": done, "branch": "task/1-done"},
                       {"id": 2, "title": "Cart", "state": "running", "mode": "worktree", "worktree": live, "branch": "task/2-cart"},
                       {"id": 3, "title": "Queued", "state": "queued", "mode": "worktree"}]}
    write(os.path.join(h, "tasks", "dev-shop.json"), json.dumps(tasks, indent=2))
    write(os.path.join(h, "tasks", ".autopilot.json"), json.dumps({"spaces": {"sp1": {"on": True}}}))
    write(os.path.join(h, "tasks", ".dev-shop.json.lock"), "")
    write(os.path.join(h, "tasks", ".remote", "vm-a"), "abc")
    write(os.path.join(h, "artifacts", "dev-shop.json"), json.dumps({"artifacts": [{"id": "plan-1a2b", "title": "Plan", "versions": 2}]}))
    write(os.path.join(h, "artifacts", "files", "plan-1a2b", "v2", "index.html"), "<h1>plan</h1>\n")
    write(os.path.join(h, "artifacts", "notes", "shot-1.png"), "png")
    write(os.path.join(h, "vault.json"), json.dumps({"version": 1, "secrets": [{"name": "API_KEY", "scope": "everywhere", "value": "fake-value"}]}), 0o600)
    write(os.path.join(h, "shepherdr.json"), json.dumps({"version": 1, "everywhere": {"tasks": {"merge": "ask"}},
                                                         "spaces": {"sp1": {"tasks": {"review_rounds": 2}}}}))
    write(os.path.join(h, "model-picks.json"), json.dumps({"claude": {"pin": "opus"}}))
    write(os.path.join(h, "browser", "dev-shop-2", "Default", "Cookies"), "signed in")
    write(os.path.join(h, "browser", "dev-shop-2.task"), "dev-shop#2\n")
    write(os.path.join(h, "shepherdr", "service.json"), json.dumps({"port": 7788, "id": "svc-1"}))
    write(os.path.join(h, "shepherdr", "token"), "local-token\n", 0o600)
    write(os.path.join(h, "shepherdr", "usage.jsonl"), '{"kind":"view"}\n')
    sock, here = socket.socket(socket.AF_UNIX), os.getcwd()
    os.chdir(os.path.join(h, "shepherdr"))   # bound by a short name: a long home's path passes the socket limit
    try:
        sock.bind("service.sock")   # the live service's socket (its file moves with the folder)
    finally:
        os.chdir(here)
        sock.close()
    write(os.path.join(h, "tools.json"), json.dumps({"version": "v1", "files": {}}))
    write(os.path.join(h, "cli-check.json"), json.dumps({"machines": {"": {"claude": True}}}))
    write(os.path.join(h, "machine-hold.json"), json.dumps({"machine": None}))
    os.makedirs(os.path.join(h, "secret-drop"), mode=0o700)
    os.makedirs(os.path.join(h, "instructions"))   # an older Shepherdr's: not Shepherdr 3's data, never touched
    write(os.path.join(h, "instructions", "worker.md"), "old\n")
    return {"repo": repo, "live": live, "done": done, "herdr": h}


class Home(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-layout-")
        self.addCleanup(shutil.rmtree, self.home, True)
        # the throwaway home's folders: never the person's (no SHEPHERDR_HOME or XDG_* from this shell)
        self.env = {}

    def w(self):
        return L.Where(home=self.home, env=self.env, mac=False)

    def migrate(self, **k):
        return L.migrate(home=self.home, env=self.env, mac=False, **k)


class Fresh(Home):
    def test_fresh_install(self):
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        w = self.w()
        self.assertTrue(w.migrated)
        self.assertEqual(w.path("tasks"), os.path.join(self.home, ".local/share/shepherdr/tasks"))
        self.assertEqual(w.path("settings"), os.path.join(self.home, ".config/shepherdr/settings.json"))
        self.assertTrue(os.path.isdir(w.path("tasks")))
        self.assertTrue(os.path.isfile(os.path.join(self.home, ".cache/shepherdr/CACHEDIR.TAG")))
        # the old paths lead to the new ones (an older Shepherdr on another machine reads them over herdr-core)
        for k in L.KINDS:
            self.assertEqual(os.path.realpath(w.old(k)), os.path.realpath(w.new(k)), k)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(w.path("vault"))).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(w.path("browser")).st_mode), 0o700)

    def test_layout_newer_stops(self):
        write(os.path.join(self.home, ".local/share/shepherdr/LAYOUT"), "3\n")
        res = self.migrate()
        self.assertEqual(res["state"], "newer")
        self.assertFalse(os.path.exists(os.path.join(self.home, ".herdr")))


class Upgrade(Home):
    def setUp(self):
        super().setUp()
        self.x = realistic(self.home)
        self.before = snapshot(self.x["herdr"])

    def test_upgrade_moves_everything_and_keeps_it_working(self):
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        moved = {k for k, how in res["moved"].items() if how == "moved"}
        self.assertTrue({"tasks", "artifacts", "vault", "settings", "browser", "service", "tools"} <= moved, res["moved"])
        w = self.w()
        # every file is at its new place, byte for byte, and readable through its old path too
        for rel, (kind, data) in self.before.items():
            if kind != "file" or rel.startswith(("worktrees/", "instructions/")):
                continue
            old = os.path.join(self.x["herdr"], rel)
            top = rel.split("/")[0]
            k = next(k for k, (o, *_r) in L.KINDS.items() if o == f".herdr/{top}")
            new = os.path.join(w.new(k), rel[len(top) + 1:]) if "/" in rel else w.new(k)
            self.assertEqual(open(new, "rb").read(), data, rel)
            self.assertEqual(open(old, "rb").read(), data, f"{rel} through the old path")
        # the socket's file moved with the service's folder; the vault stays owner-only
        self.assertTrue(stat.S_ISSOCK(os.lstat(os.path.join(w.path("service"), "service.sock")).st_mode))
        self.assertEqual(stat.S_IMODE(os.stat(w.path("vault")).st_mode), 0o600)
        # worktrees never move: git still knows both, the live one keeps its uncommitted work
        self.assertTrue(os.path.isdir(self.x["live"]) and not os.path.islink(os.path.join(self.x["herdr"], "worktrees")))
        self.assertEqual(open(os.path.join(self.x["live"], "cart.txt")).read(), "work in progress, not committed\n")
        listed = git(self.x["repo"], "worktree", "list", "--porcelain")
        self.assertIn(f"worktree {self.x['live']}", listed)
        self.assertNotIn("prunable", listed)
        self.assertIn("cart.txt", git(self.x["live"], "status", "--porcelain"))
        # the task list keeps its worktree paths; a new task's worktree goes to the new root
        lst = json.load(open(os.path.join(w.path("tasks"), "dev-shop.json")))
        self.assertEqual(lst["tasks"][1]["worktree"], self.x["live"])
        self.assertEqual(w.worktrees(), os.path.join(self.home, ".local/share/shepherdr/worktrees"))
        self.assertEqual(w.worktrees("~/big/wt"), os.path.expanduser("~/big/wt"))
        # what isn't Shepherdr 3's data stays where it was
        self.assertTrue(os.path.isfile(os.path.join(self.x["herdr"], "instructions", "worker.md")))
        st = L.status(home=self.home, env=self.env, mac=False)
        self.assertEqual(st["worktrees"]["old_left"], 2)
        self.assertTrue(all(v["state"].startswith("moved (old path links here)") for v in st["kinds"].values()), st["kinds"])

    def test_run_again_changes_nothing(self):
        self.migrate()
        after = snapshot(self.home)
        res = self.migrate()
        self.assertEqual(res["state"], "done")
        self.assertEqual(res["moved"], {})
        self.assertEqual(snapshot(self.home), after)

    def test_dry_run_moves_nothing(self):
        res = self.migrate(dry=True)
        self.assertEqual(res["state"], "would migrate")
        self.assertIn("tasks", res["moved"])
        self.assertEqual(snapshot(self.x["herdr"]), self.before)
        self.assertFalse(os.path.exists(os.path.join(self.home, ".local/share/shepherdr")))

    def test_a_crash_halfway_is_finished_by_the_next_run(self):
        # a power cut after the third kind moved: os.rename fails from then on, as if the process died there
        real, n = os.rename, {"c": 0}

        def dies(a, b):
            n["c"] += 1
            if n["c"] > 3:
                raise KeyboardInterrupt("power cut")
            return real(a, b)
        with mock.patch.object(L.os, "rename", dies):
            with self.assertRaises(KeyboardInterrupt):
                self.migrate()
        self.assertFalse(self.w().migrated, "LAYOUT is written last: readers stay on the old paths")
        # every old path still works meanwhile (moved ones through links, the rest where they were)
        for rel, (kind, data) in self.before.items():
            if kind == "file":
                self.assertEqual(open(os.path.join(self.x["herdr"], rel), "rb").read(), data, rel)
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        for rel, (kind, data) in self.before.items():
            if kind == "file":
                self.assertEqual(open(os.path.join(self.x["herdr"], rel), "rb").read(), data, rel)

    def test_a_crash_between_the_rename_and_the_link(self):
        # the folder moved, its link made but not yet in place: the old path is missing for a moment
        w = self.w()
        os.makedirs(os.path.dirname(w.new("tasks")), exist_ok=True)
        os.symlink(w.new("tasks"), w.old("tasks") + ".shep-link")
        os.rename(w.old("tasks"), w.new("tasks"))
        self.assertFalse(os.path.lexists(w.old("tasks")))
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        self.assertEqual(res["moved"]["tasks"], "linked")
        self.assertTrue(os.path.islink(w.old("tasks")))
        self.assertTrue(os.path.isfile(os.path.join(w.old("tasks"), "dev-shop.json")))

    def test_a_crash_after_the_rename_then_an_old_writer(self):
        # moved, then the power went before the link; an older herdr-task then made ~/.herdr/tasks again and wrote a
        # list there. The next run keeps both: nothing that moved is set aside in its place.
        w = self.w()
        real = os.replace

        def dies(a, b):
            if a == w.old("tasks") + ".shep-link":
                raise KeyboardInterrupt("power cut")
            return real(a, b)
        with mock.patch.object(L.os, "replace", dies):
            with self.assertRaises(KeyboardInterrupt):
                self.migrate()
        self.assertFalse(os.path.lexists(w.old("tasks")))
        write(os.path.join(w.old("tasks"), "dev-later.json"), json.dumps({"folder": "/later", "tasks": []}))
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        self.assertTrue(os.path.islink(w.old("tasks")))
        self.assertTrue(os.path.isfile(os.path.join(w.path("tasks"), "dev-shop.json")), "what moved is still there")
        self.assertTrue(os.path.isfile(os.path.join(w.path("tasks"), "dev-later.json")), "what the old writer wrote is taken in")
        self.assertFalse(any(n.startswith("tasks.aside") for n in os.listdir(os.path.dirname(w.new("tasks")))))

    def test_another_disk_a_write_between_the_check_and_the_swap(self):
        # an older writer saves settings in the old copy after it was checked: the change reaches the new place
        real = os.rename
        lst = os.path.join(self.x["herdr"], "shepherdr.json")

        def cross(a, b):
            if a.startswith(self.x["herdr"] + "/") and not a.endswith(".shep-link") and not b.startswith(self.x["herdr"] + "/"):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            if a == lst and b.endswith(L.BACKUP):
                d = json.load(open(lst))
                d["everywhere"]["tasks"]["merge"] = "saved just now"
                write(lst, json.dumps(d))
                os.utime(lst, (os.stat(lst).st_atime, os.stat(lst).st_mtime + 5))
            return real(a, b)
        with mock.patch.object(L.os, "rename", cross):
            self.assertEqual(self.migrate()["state"], "migrated")
        self.assertEqual(json.load(open(self.w().path("settings")))["everywhere"]["tasks"]["merge"], "saved just now")

    def test_another_disk_a_crash_before_the_catch_up(self):
        # a settings save in the old copy after its check, then the power goes right after the swap: the next run catches up
        real_rename, real_catch = os.rename, L._catch_up
        lst = os.path.join(self.x["herdr"], "shepherdr.json")

        def cross(a, b):
            if a.startswith(self.x["herdr"] + "/") and not a.endswith(".shep-link") and not b.startswith(self.x["herdr"] + "/"):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            if a == lst and b.endswith(L.BACKUP):
                d = json.load(open(lst))
                d["everywhere"]["tasks"]["merge"] = "saved just now"
                write(lst, json.dumps(d))
                os.utime(lst, (os.stat(lst).st_atime, os.stat(lst).st_mtime + 5))
            return real_rename(a, b)

        def dies(backup, new):
            raise KeyboardInterrupt("power cut")
        with mock.patch.object(L.os, "rename", cross), mock.patch.object(L, "_catch_up", dies):
            with self.assertRaises(KeyboardInterrupt):
                self.migrate()
        with mock.patch.object(L.os, "rename", cross):
            self.assertEqual(self.migrate()["state"], "migrated")
        self.assertEqual(json.load(open(self.w().path("settings")))["everywhere"]["tasks"]["merge"], "saved just now")

    def test_another_disk_a_crash_between_the_swap_and_its_link(self):
        # the old copy renamed to its backup, then the power goes before the link is in place
        real_rename, real_replace = os.rename, os.replace
        lst = os.path.join(self.x["herdr"], "shepherdr.json")
        tmp_link = lst + ".shep-link"

        def cross(a, b):
            if a.startswith(self.x["herdr"] + "/") and not a.endswith(".shep-link") and not b.startswith(self.x["herdr"] + "/"):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            if a == lst and b.endswith(L.BACKUP):
                d = json.load(open(lst))
                d["everywhere"]["tasks"]["merge"] = "saved just now"
                write(lst, json.dumps(d))
                os.utime(lst, (os.stat(lst).st_atime, os.stat(lst).st_mtime + 5))
            return real_rename(a, b)

        def dies(a, b):
            if a == tmp_link and os.path.lexists(lst + L.BACKUP):
                raise KeyboardInterrupt("power cut")
            return real_replace(a, b)
        with mock.patch.object(L.os, "rename", cross), mock.patch.object(L.os, "replace", dies):
            with self.assertRaises(KeyboardInterrupt):
                self.migrate()
        with mock.patch.object(L.os, "rename", cross):
            self.assertEqual(self.migrate()["state"], "migrated")
        self.assertEqual(json.load(open(self.w().path("settings")))["everywhere"]["tasks"]["merge"], "saved just now")

    def test_a_copy_waits_for_a_task_being_saved(self):
        import fcntl
        import threading
        import time as _t
        lock = open(os.path.join(self.x["herdr"], "tasks", ".dev-shop.json.lock"), "a")
        fcntl.flock(lock, fcntl.LOCK_EX)
        threading.Timer(0.5, lambda: (fcntl.flock(lock, fcntl.LOCK_UN), lock.close())).start()
        t0 = _t.time()
        with L._held_locks(os.path.join(self.x["herdr"], "tasks")):
            self.assertGreaterEqual(_t.time() - t0, 0.4, "it waited for the save to finish")

    def test_rollback_over_an_old_writers_file_keeps_the_newer(self):
        self.migrate()
        w = self.w()
        # an older machine's push replaced the settings link with its file; then the person changed settings here
        os.remove(w.old("settings"))
        write(w.old("settings"), json.dumps({"v": "pushed"}))
        os.utime(w.old("settings"), (1, 1))
        write(w.path("settings"), json.dumps({"v": "newer here"}))
        L.rollback(home=self.home, env=self.env, mac=False)
        self.assertEqual(json.load(open(w.old("settings")))["v"], "newer here")

    def test_a_write_at_the_new_paths_just_after_a_rollback_is_taken_back(self):
        self.migrate()
        L.rollback(home=self.home, env=self.env, mac=False)
        w = self.w()
        # an open window still had the new paths for a few seconds and saved settings there
        write(w.new("settings"), json.dumps({"v": "saved by a window that hadn't noticed"}))
        os.utime(w.new("settings"), None)
        self.assertEqual(L.heal_back(w), ["settings"])
        self.assertEqual(json.load(open(w.old("settings")))["v"], "saved by a window that hadn't noticed")
        self.assertFalse(os.path.lexists(w.new("settings")))

    def test_another_disk(self):
        # Shepherdr's folders on another disk than ~/.herdr: files (settings, the vault) are copied, checked, swapped
        # (the old copy kept); folders stay where they are and the new path links to them: no gigabytes copied, and a
        # task list's lock stays the one file every writer takes
        real = os.rename

        def cross(a, b):
            if a.startswith(self.x["herdr"] + "/") and not a.endswith(".shep-link") and not b.startswith(self.x["herdr"] + "/"):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            return real(a, b)
        with mock.patch.object(L.os, "rename", cross):
            res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        self.assertEqual(res["moved"]["tasks"], "kept")
        self.assertEqual(res["moved"]["settings"], "copied")
        self.assertEqual(res["moved"]["artifacts"], "kept")
        self.assertEqual(res["moved"]["browser"], "kept")
        w = self.w()
        self.assertTrue(os.path.islink(w.new("artifacts")) and not os.path.islink(w.old("artifacts")))
        self.assertEqual(open(os.path.join(w.path("artifacts"), "files/plan-1a2b/v2/index.html")).read(), "<h1>plan</h1>\n")
        self.assertTrue(os.path.isfile(w.old("settings") + L.BACKUP), "the old copy is kept until cleanup")
        self.assertTrue(os.path.islink(w.new("tasks")) and os.path.isdir(w.old("tasks")) and not os.path.islink(w.old("tasks")))
        self.assertEqual(json.load(open(os.path.join(w.path("tasks"), "dev-shop.json")))["prefix"], "SHOP")
        self.assertEqual(stat.S_IMODE(os.stat(w.path("vault")).st_mode), 0o600)
        # and a second run, crossing again, changes nothing
        with mock.patch.object(L.os, "rename", cross):
            self.assertEqual(self.migrate()["moved"], {})

    def test_rollback_and_move_again(self):
        self.migrate()
        w = self.w()
        write(os.path.join(w.path("tasks"), "dev-new.json"), json.dumps({"folder": "/x", "tasks": []}))  # added after the move
        res = L.rollback(home=self.home, env=self.env, mac=False)
        self.assertEqual(res["state"], "rolled-back")
        self.assertFalse(self.w().migrated)
        # an older Shepherdr finds everything as it left it, plus what was added since
        after = snapshot(self.x["herdr"])
        for rel, v in self.before.items():
            if v[0] == "file":
                self.assertEqual(after.get(rel), v, rel)
        self.assertIn("tasks/dev-new.json", after)
        self.assertFalse(any(os.path.islink(os.path.join(self.x["herdr"], k)) for k in os.listdir(self.x["herdr"])))
        # this version stays on the old paths: no move by itself until `shepherdr migrate`
        self.assertEqual(self.migrate()["state"], "rolled-back")
        self.assertEqual(self.migrate(again=True)["state"], "migrated")
        self.assertTrue(self.w().migrated)
        self.assertTrue(os.path.isfile(os.path.join(self.w().path("tasks"), "dev-new.json")))

    def test_cleanup_legacy(self):
        self.migrate()
        gone = L.cleanup_legacy(home=self.home, env=self.env, mac=False)
        self.assertIn(os.path.join(self.x["herdr"], "tasks"), gone)
        self.assertFalse(os.path.lexists(os.path.join(self.x["herdr"], "tasks")))
        # heal doesn't put the links back once cleaned up
        L.heal(self.w())
        self.assertFalse(os.path.lexists(os.path.join(self.x["herdr"], "tasks")))
        self.assertTrue(os.path.isdir(os.path.join(self.x["herdr"], "worktrees")), "worktrees and Herdr's own stay")

    def test_a_squatter_at_the_new_place_is_set_aside(self):
        write(os.path.join(self.home, ".local/share/shepherdr/tasks/stray.json"), "{}")
        res = self.migrate()
        self.assertEqual(res["state"], "migrated")
        aside = [n for n in os.listdir(os.path.join(self.home, ".local/share/shepherdr")) if n.startswith("tasks.aside-")]
        self.assertEqual(len(aside), 1)
        self.assertTrue(any("set aside" in n for n in res["notes"]))
        self.assertTrue(os.path.isfile(os.path.join(self.w().path("tasks"), "dev-shop.json")))

    def test_the_persons_own_link_stays(self):
        # artifacts on a bigger disk through the person's own link: they stay there, the new path leads there too
        big = tempfile.mkdtemp(prefix="shep-bigdisk-")
        self.addCleanup(shutil.rmtree, big, True)
        shutil.move(os.path.join(self.x["herdr"], "artifacts"), os.path.join(big, "artifacts"))
        os.symlink(os.path.join(big, "artifacts"), os.path.join(self.x["herdr"], "artifacts"))
        res = self.migrate()
        self.assertEqual(res["moved"]["artifacts"], "kept")
        self.assertTrue(os.path.isdir(os.path.join(big, "artifacts", "files")))
        self.assertEqual(os.path.realpath(self.w().path("artifacts")), os.path.realpath(os.path.join(big, "artifacts")))

    def test_network_disk_is_not_moved_by_itself(self):
        with mock.patch.object(L, "_fs_type", lambda p: "nfs4"):
            res = self.migrate()
            self.assertEqual(res["state"], "refused")
            self.assertEqual(snapshot(self.x["herdr"]), self.before)
            self.assertEqual(self.migrate(force=True)["state"], "migrated")


class CustomRoots(Home):
    def test_shepherdr_home(self):
        one = os.path.join(self.home, "one")
        self.env = {"SHEPHERDR_HOME": one}
        realistic(self.home)
        self.assertEqual(self.migrate()["state"], "migrated")
        w = self.w()
        self.assertEqual(w.path("tasks"), os.path.join(one, "data", "tasks"))
        self.assertEqual(w.path("settings"), os.path.join(one, "config", "settings.json"))
        self.assertEqual(w.path("browser"), os.path.join(one, "state", "browser"))
        self.assertTrue(os.path.isfile(os.path.join(one, "cache", "CACHEDIR.TAG")))
        # a process that doesn't see SHEPHERDR_HOME still finds the data, through the old paths' links
        plain = L.Where(home=self.home, env={}, mac=False)
        self.assertFalse(plain.migrated)
        self.assertTrue(os.path.isfile(os.path.join(plain.path("tasks"), "dev-shop.json")))

    def test_xdg(self):
        self.env = {"XDG_CONFIG_HOME": os.path.join(self.home, "c"), "XDG_DATA_HOME": os.path.join(self.home, "d"),
                    "XDG_STATE_HOME": os.path.join(self.home, "s"), "XDG_CACHE_HOME": "relative/is/ignored"}
        r = L.roots(self.home, self.env, mac=False)
        self.assertEqual(r["config"], os.path.join(self.home, "c", "shepherdr"))
        self.assertEqual(r["data"], os.path.join(self.home, "d", "shepherdr"))
        self.assertEqual(r["cache"], os.path.join(self.home, ".cache", "shepherdr"))
        self.assertEqual(L.roots(self.home, {}, mac=True)["cache"], os.path.join(self.home, "Library", "Caches", "shepherdr"))

    def test_installer_root_ignores_the_shells_folders(self):
        # `install --root <scratch>` must never reach the real folders through SHEPHERDR_HOME or XDG_*
        sys.path.insert(0, os.path.join(ROOT, "bin"))
        import importlib.machinery
        import importlib.util
        loader = importlib.machinery.SourceFileLoader("shepherdr_installer", SHEPHERDR)
        spec = importlib.util.spec_from_loader("shepherdr_installer", loader)
        inst = importlib.util.module_from_spec(spec)
        loader.exec_module(inst)
        with mock.patch.dict(os.environ, {"SHEPHERDR_HOME": "/nonexistent/real", "XDG_DATA_HOME": "/nonexistent/xdg"}):
            w = inst.where_for(self.home)
            self.assertEqual(w.roots["data"], os.path.join(self.home, ".local/share/shepherdr"))
            self.assertEqual(inst.env_for(self.home), {})


class Healing(Home):
    def setUp(self):
        super().setUp()
        self.x = realistic(self.home)
        self.migrate()

    def test_an_old_writer_replacing_a_link_is_taken_in(self):
        w = self.w()
        # an older machine pushes settings here the old way: its mv replaces the link with a plain file
        r = subprocess.run(["sh", "-c", OLD_PUSH, "sh", json.dumps({"pushed_from": "herdr-app", "here": "vm-a"})],
                           env={"HOME": self.home, "PATH": os.environ["PATH"]}, capture_output=True, text=True)
        self.assertEqual(r.stdout.strip(), "own", "the old push sees the person's own file through the link and leaves it")
        os.remove(w.path("settings"))
        write(w.path("settings"), json.dumps({"pushed_from": "herdr-app", "here": "vm-a", "v": 1}))
        r = subprocess.run(["sh", "-c", OLD_PUSH, "sh", json.dumps({"pushed_from": "herdr-app", "here": "vm-a", "v": 2})],
                           env={"HOME": self.home, "PATH": os.environ["PATH"]})
        self.assertEqual(r.returncode, 0)
        self.assertFalse(os.path.islink(w.old("settings")), "the old mv replaced the link")
        took = L.heal(w)
        self.assertEqual(took, ["settings"])
        self.assertTrue(os.path.islink(w.old("settings")))
        self.assertEqual(json.load(open(w.path("settings")))["v"], 2)

    def test_an_older_file_is_set_aside_not_taken(self):
        w = self.w()
        write(w.path("settings"), json.dumps({"v": "new"}))
        os.remove(w.old("settings"))
        write(w.old("settings"), json.dumps({"v": "old"}))
        os.utime(w.old("settings"), (1, 1))
        L.heal(w)
        self.assertEqual(json.load(open(w.path("settings")))["v"], "new")
        aside = os.path.join(w.roots["state"], "taken-in")
        self.assertTrue(any("settings" in f for _d, _s, fs in os.walk(aside) for f in fs) or os.path.isdir(aside))

    def test_an_old_folder_made_again_is_merged(self):
        w = self.w()
        os.remove(w.old("tasks"))
        write(os.path.join(w.old("tasks"), "dev-later.json"), json.dumps({"folder": "/later", "tasks": []}))
        L.heal(w)
        self.assertTrue(os.path.islink(w.old("tasks")))
        self.assertTrue(os.path.isfile(os.path.join(w.path("tasks"), "dev-later.json")))
        self.assertTrue(os.path.isfile(os.path.join(w.path("tasks"), "dev-shop.json")))


class MixedVersions(unittest.TestCase):
    """Two machines: `new` on this version (moved), `old` still on 3.1.26 (not moved). Each one's commands run
    against the other's home, as herdr-core's `machine.exec` runs them there."""

    def setUp(self):
        self.new = tempfile.mkdtemp(prefix="shep-new-")
        self.old = tempfile.mkdtemp(prefix="shep-old-")
        self.addCleanup(shutil.rmtree, self.new, True)
        self.addCleanup(shutil.rmtree, self.old, True)
        realistic(self.new)
        realistic(self.old)
        self.assertEqual(L.migrate(home=self.new, env={}, mac=False)["state"], "migrated")

    def sh(self, home, script, *args):
        r = subprocess.run(["sh", "-c", script, "sh", *args], env={"HOME": home, "PATH": os.environ["PATH"]},
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_an_old_machine_reads_a_new_one(self):
        out = self.sh(self.new, OLD_READ_LISTS)
        self.assertIn("dev-shop.json", out)
        self.assertIn('"prefix": "SHOP"', out)
        self.assertIn("plan-1a2b", self.sh(self.new, OLD_READ_ARTS))

    def test_a_new_machine_reads_an_old_one(self):
        from_new = L.SH + 'cd "$SHEP_TASKS" && ls'
        self.assertIn("dev-shop.json", self.sh(self.old, from_new))
        self.assertIn("dev-shop.json", self.sh(self.new, from_new))
        self.assertEqual(self.sh(self.old, L.SH + 'printf %s "$SHEP_SETTINGS"'), os.path.join(self.old, ".herdr/shepherdr.json"))
        self.assertEqual(self.sh(self.new, L.SH + 'printf %s "$SHEP_SETTINGS"'), os.path.join(self.new, ".config/shepherdr/settings.json"))

    def test_the_new_push_lands_where_each_machine_reads(self):
        if not BUN:
            self.skipTest("bun isn't installed here")
        push = subprocess.run([BUN, "-e", 'import { PUSH } from "./service/settings.ts"; process.stdout.write(PUSH)'],
                              cwd=ROOT, capture_output=True, text=True, env={**os.environ, "SHEPHERDR_TEST": "1"}).stdout
        self.assertIn("SHEP_SETTINGS", push)
        body = json.dumps({"pushed_from": "herdr-app", "here": "vm-a"})
        for home, where in ((self.old, ".herdr/shepherdr.json"), (self.new, ".config/shepherdr/settings.json")):
            os.remove(os.path.join(home, where))   # a machine with only a pushed copy
            self.sh(home, push, body)
            self.assertEqual(json.load(open(os.path.join(home, where)))["here"], "vm-a", home)
        self.assertTrue(os.path.islink(os.path.join(self.new, ".herdr/shepherdr.json")), "the new push keeps the link")

    def test_an_old_main_syncing_tools_to_a_new_machine(self):
        # 3.1.26's sync writes ~/.herdr/tools.json and touches ~/.herdr/secret-remote there (its own words)
        os.remove(os.path.join(self.new, ".local/share/shepherdr/secrets/vault.json"))
        payload = {"op": "install", "stamp": ".herdr/tools.json", "files": [], "links": [], "version": "v9", "from": "old-main",
                   "touch": [{"path": ".herdr/secret-remote", "unless": ".herdr/vault.json"}], "force": False}
        r = subprocess.run([sys.executable, "-c", OLD_INSTALL], input=json.dumps(payload), capture_output=True, text=True,
                           env={"HOME": self.new, "PATH": os.environ["PATH"], "XDG_STATE_HOME": os.path.join(self.new, "core-state")})
        self.assertEqual(r.returncode, 0, r.stderr)
        w = L.Where(home=self.new, env={}, mac=False)
        self.assertTrue(os.path.exists(w.path("secret-remote")), "touched through the dangling link: lands at the new place")
        L.heal(w)   # the stamp's os.replace put a plain file at the old path: taken in
        self.assertTrue(os.path.islink(w.old("tools")))
        self.assertEqual(json.load(open(w.path("tools")))["version"], "v9")

    def test_a_new_main_syncing_tools_to_both(self):
        from herdr_task import machines
        for home, stamp in ((self.old, ".herdr/tools.json"), (self.new, ".local/share/shepherdr/tools.json")):
            payload = {"op": "install", "stamp": ".herdr/tools.json", "files": [], "links": [], "version": "v10", "from": "new-main",
                       "touch": [], "force": False}
            r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(payload), capture_output=True, text=True,
                               env={"HOME": home, "PATH": os.environ["PATH"], "XDG_STATE_HOME": os.path.join(home, "core-state")})
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.load(open(os.path.join(home, stamp)))["version"], "v10", home)
        self.assertTrue(os.path.islink(os.path.join(self.new, ".herdr/tools.json")), "written at the new place: the link stays")


class ProjectId(unittest.TestCase):
    """A repo's tasks follow it when its folder is renamed: its id in .git/config, recorded in its list."""

    def test_a_renamed_repo_keeps_its_tasks(self):
        from herdr_task import store
        tmp = tempfile.mkdtemp(prefix="shep-pid-")
        self.addCleanup(shutil.rmtree, tmp, True)
        repo = os.path.join(tmp, "shop")
        os.makedirs(repo)
        git(repo, "init", "-q", "-b", "main")
        with mock.patch.object(store, "STORE", os.path.join(tmp, "tasks")):
            with store.Store(store.locate(repo)) as s:
                s.new("Cart")
                s.dirty = True
            pid = git(repo, "config", "--local", "--get", "shepherdr.id")
            self.assertTrue(pid)
            self.assertEqual(json.load(open(s.path))["project_id"], pid)
            os.rename(repo, os.path.join(tmp, "shop-renamed"))
            with store.Store(store.locate(os.path.join(tmp, "shop-renamed"))) as s2:
                self.assertEqual(s2.path, s.path, "the same list, its slug and task keys kept")
                self.assertEqual([t["title"] for t in s2.data["tasks"]], ["Cart"])
            self.assertEqual(json.load(open(s.path))["folder"], os.path.realpath(os.path.join(tmp, "shop-renamed")))
            # a second clone (its own .git/config, no id yet) gets its own list
            other = os.path.join(tmp, "shop")
            os.makedirs(other)
            git(other, "init", "-q", "-b", "main")
            self.assertNotEqual(store.store_path(store.locate(other)["folder"])[1], s.path)


class OneTable(unittest.TestCase):
    """layout.py is the one source; core/paths.js, herdr-secret's and herdr-artifact's copies say the same."""

    def test_python_copies(self):
        for f in ("bin/herdr-secret", "mods/artifacts/bin/herdr-artifact"):
            text = open(os.path.join(ROOT, f)).read()
            a = text.index("# ---- SHEP:")
            a = text.index("\n", a) + 1
            b = text.index("# ---- end SHEP ----")
            self.assertEqual(text[a:b], L.PY.lstrip("\n"), f"{f}: run bin/sync-shared (it writes layout.py's PY there)")

    def test_js_says_the_same(self):
        if not BUN:
            self.skipTest("bun isn't installed here")
        r = subprocess.run([BUN, "-e", 'import * as P from "./core/paths.js"; console.log(JSON.stringify({SH: P.SH, PY: P.PY, KINDS: P.KINDS, LAYOUT: P.LAYOUT}))'],
                           cwd=ROOT, capture_output=True, text=True)
        js = json.loads(r.stdout)
        self.assertEqual(js["SH"], L.SH)
        self.assertEqual(js["PY"], L.PY)
        self.assertEqual(js["LAYOUT"], L.LAYOUT)
        self.assertEqual(js["KINDS"], {k: [o, b, r_] for k, (o, b, r_, _t, _big) in L.KINDS.items()})

    def test_herdr_task_never_moves_a_tests_world(self):
        with mock.patch.dict(os.environ, {"HERDR_TASK_STORE": "/nonexistent"}):
            with mock.patch.object(L, "migrate", side_effect=AssertionError("moved")):
                self.assertIsNone(L.ensure())

    def test_browser_keeps_a_running_profiles_path(self):
        home = tempfile.mkdtemp(prefix="shep-browser-")
        self.addCleanup(shutil.rmtree, home, True)
        write(os.path.join(home, ".herdr", "browser", "dev-shop-2", "Default", "Cookies"), "signed in")
        L.migrate(home=home, env={}, mac=False)
        name = lambda task: json.loads(subprocess.run(["sh", os.path.join(ROOT, "bin", "herdr-browser"), "--task", task, "--name"],
                                                     env={"HOME": home, "PATH": os.environ["PATH"]}, capture_output=True, text=True).stdout)
        # the browser started before the move: the same path agent-browser knows it by (a link to the same folder)
        self.assertEqual(name("dev-shop#2")["profile"], os.path.join(home, ".herdr", "browser", "dev-shop-2"))
        # a new task's browser: the new place
        self.assertEqual(name("dev-shop#3")["profile"], os.path.join(home, ".local", "state", "shepherdr", "browser", "dev-shop-3"))


class BrowserSessionNames(unittest.TestCase):
    """SHEP-178: agent-browser's session name stays short (its socket path is at most 103 bytes), whatever the task's
    folder; the same each call, one per task, and the old names where they fit."""

    LONG = "tmp-" + "very-long-folder-name-" * 6 + "demo#1"

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-browser-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.log = os.path.join(self.home, "ab.log")
        self.bin = os.path.join(self.home, "agent-browser")
        with open(self.bin, "w") as f:
            f.write('#!/bin/sh\n[ "$1" = --version ] && { echo "agent-browser 0.41.1"; exit 0; }\necho "$*" >> %s\n' % self.log)
        os.chmod(self.bin, 0o755)

    def run_it(self, task, *args):
        env = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin}
        return subprocess.run(["sh", os.path.join(ROOT, "bin", "herdr-browser"), "--task", task, *args],
                              env=env, capture_output=True, text=True)

    def session(self, task):
        return json.loads(self.run_it(task, "--name").stdout)["session"]

    def calls(self):
        try:
            return open(self.log).read().splitlines()
        except OSError:
            return []

    def test_a_long_folder_gets_a_short_stable_name(self):
        from herdr_task.browsers import session_of
        s = self.session(self.LONG)
        self.assertLessEqual(len(s), 40)
        self.assertRegex(s, r"^herdr-[A-Za-z0-9_-]+-[0-9a-f]{8}$")
        self.assertTrue(s.startswith("herdr-g-folder-name-demo-1-"), s)
        self.assertEqual(s, self.session(self.LONG))  # the same every call
        name = json.loads(self.run_it(self.LONG, "--name").stdout)["profile"].rsplit("/", 1)[1]
        self.assertEqual(session_of(self.LONG, name), s)  # the tick looks for the same one

    def test_two_tasks_with_the_same_tail_differ(self):
        a = self.session("tmp-aaaaaaaaaaaaaaaaaaaa-my-long-shop-repo#1")
        b = self.session("tmp-bbbbbbbbbbbbbbbbbbbb-my-long-shop-repo#1")
        self.assertNotEqual(a, b)
        self.assertEqual(a.rsplit("-", 1)[0], b.rsplit("-", 1)[0])

    def test_short_names_stay_as_they_were(self):
        self.assertEqual(self.session("dev-shepherdr#168"), "herdr-dev-shepherdr-168")
        self.assertEqual(self.session(".config-herdr-app#57"), "herdr-config-herdr-app-57")
        from herdr_task.browsers import session_of
        self.assertEqual(session_of("dev-shop#2", "dev-shop-2"), "herdr-dev-shop-2")

    def test_a_browser_opened_under_the_old_name_is_closed_once(self):
        task = "home-someone-dev-a-rather-long-repo#12"   # 37 characters: fit before, cut now
        s = self.session(task)
        self.run_it(task, "open", "about:blank")
        self.run_it(task, "snapshot")
        self.assertEqual(self.calls(), [
            "--session herdr-home-someone-dev-a-rather-long-repo-12 close",
            "--session %s --profile %s open about:blank" % (s, os.path.join(self.home, ".herdr", "browser", task.replace("#", "-"))),
            "--session %s --profile %s snapshot" % (s, os.path.join(self.home, ".herdr", "browser", task.replace("#", "-"))),
        ])

    def test_a_name_too_long_to_have_run_isnt_closed(self):
        self.run_it(self.LONG, "snapshot")
        self.assertEqual(len(self.calls()), 1)
        self.assertIn("snapshot", self.calls()[0])


if __name__ == "__main__":
    unittest.main()
