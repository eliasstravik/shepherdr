"""GitHub and merging: pull requests, checks, and finishing a merged task."""

import json
import os
import shutil

from .base import Fail, GH, git, now, run, STORE
from .agents import agent_running, live_agents


# ---- GitHub ---------------------------------------------------------------------------------

def gh(*args, cwd=None):
    # gh not installed (or not on this caller's PATH, as a background service's): it doesn't work here, said plainly
    try:
        r = run([GH, *args], cwd=cwd or STORE)
    except FileNotFoundError:
        return False, "", "gh isn't installed here (GitHub CLI)"
    return r.returncode == 0, r.stdout.strip(), (r.stderr or r.stdout).strip()


def github(s):
    """The repo on GitHub ("owner/name") when it has a GitHub remote and gh works there; asked
    again after an hour. None: tasks merge locally."""
    if s.loc["kind"] != "repo" or not shutil.which(GH):
        return None
    g = s.data.get("github") or {}
    if g and now() - g.get("at", 0) < 3600000:
        return g.get("repo")
    ok, out, _ = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner", cwd=s.loc["folder"])
    s.data["github"] = {"repo": out if ok and out else None, "at": now()}
    s.dirty = True
    return s.data["github"]["repo"]


def remote_of(main):
    names = git(main, "remote")[1].split()
    return "origin" if "origin" in names else (names[0] if names else "origin")


def pr_open(s, task, repo, summary=None):
    """Pushes the task's branch and opens its pull request (or keeps the open one, also one opened
    by hand or by its agent for the branch: SHEP-13's "already exists")."""
    wt, br = task["worktree"], task["branch"]
    ok, _, err = git(wt, "push", "--force-with-lease", "-u", remote_of(s.loc["folder"]), br)
    if not ok:
        raise Fail(f"Couldn't push {br}: {err}")
    pr = task.get("pr") or {}
    if pr.get("number"):
        ok, out, _ = gh("pr", "view", str(pr["number"]), "--repo", repo, "--json", "state", "-q", ".state")
        if ok and out == "OPEN":
            if summary:
                gh("pr", "comment", str(pr["number"]), "--repo", repo, "--body", summary)
            return pr
    if pr_adopt(task, repo):
        if summary:
            gh("pr", "comment", str(task["pr"]["number"]), "--repo", repo, "--body", summary)
        return task["pr"]
    body = (task.get("prompt") or "").strip() or task["title"]
    if summary:
        body += "\n\n## Summary\n\n" + summary.strip()
    if (task.get("details") or "").strip():
        body += "\n\n## Details\n\n" + task["details"].strip()
    ok, out, err = gh("pr", "create", "--repo", repo, "--head", br, "--base", task.get("base") or "main",
                      "--title", f"{s.ref(task)} {task['title']}", "--body", body)
    if not ok or not out:
        raise Fail(f"Couldn't open a pull request: {err}")
    url = out.split()[-1]
    task["pr"] = {"number": int(url.rstrip("/").split("/")[-1]), "url": url, "repo": repo}
    return task["pr"]


def pr_adopt(task, repo):
    """The open pull request for the task's branch, opened by hand or by its agent, recorded on the
    task; None when there is none (SHEP-13: ready failed with "already exists"). Only one from this
    repo (never a fork's branch of the same name), into the task's base, at the branch's tip here."""
    ok, out, _ = gh("pr", "list", "--repo", repo, "--head", task["branch"], "--state", "open",
                    "--json", "number,url,isCrossRepository,baseRefName,headRefOid")
    tip_ok, tip, _ = git(task["worktree"], "rev-parse", task["branch"])
    try:
        found = next((p for p in json.loads(out) if not p.get("isCrossRepository")
                      and p.get("baseRefName") == (task.get("base") or "main")
                      and tip_ok and tip and p.get("headRefOid") == tip), None) if ok and out else None
    except (ValueError, TypeError, AttributeError):
        found = None
    if found:
        task["pr"] = {"number": found["number"], "url": found["url"], "repo": repo}
    return task.get("pr") if found else None


BAD = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
PENDING = {"QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}


def pr_view(task):
    pr = task["pr"]
    ok, out, _ = gh("pr", "view", str(pr["number"]), "--repo", pr["repo"], "--json", "state,mergeable,headRefOid,statusCheckRollup,mergeCommit")
    try:
        return json.loads(out) if ok else None
    except ValueError:
        return None


def pr_problem(v):
    """What keeps a pull request from merging, for the person; None when nothing does."""
    if v.get("state") == "CLOSED":
        return "The pull request was closed."
    if v.get("mergeable") == "CONFLICTING":
        return "It conflicts with the base branch."
    checks = v.get("statusCheckRollup") or []
    bad = [c.get("name") or c.get("context") or "a check" for c in checks
           if (c.get("conclusion") or c.get("state") or "").upper() in BAD]
    if bad:
        return "Checks failing: " + ", ".join(bad[:3]) + (" and more." if len(bad) > 3 else ".")
    return None


def pr_pending(v):
    return any((c.get("status") or c.get("state") or "").upper() in PENDING and not (c.get("conclusion") or "")
               for c in v.get("statusCheckRollup") or [])


def update_main(s, task):
    """After a merge on GitHub: the base branch here catches up when it's checked out and clean."""
    main, base = s.loc["folder"], task.get("base") or "main"
    remote = remote_of(main)
    git(main, "fetch", remote, base)
    ok, cur, _ = git(main, "symbolic-ref", "--short", "HEAD")
    if ok and cur == base and not git(main, "status", "--porcelain", "--untracked-files=no")[1]:
        git(main, "merge", "--ff-only", f"{remote}/{base}")
    elif not (ok and cur == base):
        # A base not checked out here (a task's own --base): its branch fast-forwards (git refuses
        # anything else, and a branch checked out in another worktree).
        git(main, "fetch", remote, f"{base}:{base}")


MAIN_WATCH_MS = 3 * 3600000  # how long main is watched after a task merges through its pull request


def watch_main(s, task, sha=None):
    """A task just merged through its pull request: its base branch on GitHub is watched for a few
    hours (ghnews.main_pass), so the Assistant hears once if it goes red (as Shepherdr)."""
    if not task.get("pr"):
        return
    base = task.get("base") or "main"
    w = s.data.setdefault("main_watch", {}).setdefault(base, {})
    w.update(repo=task["pr"]["repo"], until=now() + MAIN_WATCH_MS, space=task.get("space") or w.get("space"))
    merged = [m for m in w.get("merged") or [] if now() - (m.get("at") or 0) < 24 * 3600000]
    merged.append({"ref": s.ref(task), "title": task["title"], "pr": task["pr"]["number"], "at": now(), **({"sha": sha} if sha else {})})
    w["merged"] = merged[-30:]
    s.dirty = True


def merged_here(s, task):
    """Its own work is in the base branch here (merged by anyone, without a PR): the newest commit
    its branch held that the base didn't (own_work()) is in the base now. A branch that only caught
    up with its base (SHEP-23: `git merge --ff-only main` mid-work, its tip the base's) has no work
    of its own, so it never counts as merged."""
    own = own_work(s, task)
    return bool(own) and git(s.loc["folder"], "merge-base", "--is-ancestor", own, task["base"])[0]


def own_work(s, task):
    """The newest commit of the task's own seen on its branch, or None: its tip whenever the branch
    holds commits its base branch doesn't, here or on its remote (kept on the task as "own"; the
    tick and ready look), else the last one kept."""
    main, br, base, start = s.loc["folder"], task.get("branch"), task.get("base"), task.get("start")
    if not (br and base and start):
        return None
    ok, tip, _ = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")
    tip = tip if ok and tip else task.get("head")
    if tip and tip != start and tip != task.get("own") and not any(
            git(main, "merge-base", "--is-ancestor", tip, ref)[0] for ref in (base, f"refs/remotes/{remote_of(main)}/{base}")):
        task["own"] = tip
        s.dirty = True
    return task.get("own")


def finish(s, task, even_if_busy=False):
    """Done, its branch merged: removes the worktree and branch when nothing is left uncommitted
    there and (unless the person merged from Herdr) no agent still works in it."""
    task["state"], task["done_at"] = "done", now()
    for k in ("attention", "merge_requested", "queue", "queued_at"):
        task.pop(k, None)
    s.dirty = True
    wt, br, main = task.get("worktree"), task.get("branch"), s.loc["folder"]
    if not wt or (not even_if_busy and any(agent_running(k) for k in live_agents(s.key(task)))):
        return
    if os.path.isdir(wt):
        ok, out, _ = git(wt, "status", "--porcelain", "--untracked-files=no")
        if not ok or out or not git(main, "worktree", "remove", "--force", wt)[0]:
            return
    if br:
        git(main, "branch", "-D", br)
