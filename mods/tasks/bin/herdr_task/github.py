"""GitHub and merging: pull requests, checks, and finishing a merged task."""

import json
import os
import shutil

from .base import Fail, GH, git, hc_json, now, run, STORE
from .agents import agent_running, live_agents, live_helpers, status_word


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
    # Continuing a pull request already open on another branch, its work pushed there (#828): that
    # one is the task's, never a second with the same commits.
    if not (task.get("pr") or {}).get("number") and pr_at_tip(task, repo):
        if summary:
            gh("pr", "comment", str(task["pr"]["number"]), "--repo", repo, "--body", summary)
        return task["pr"]
    remote = remote_of(s.loc["folder"])
    # The pull request it continues (#828) gets its new commits on its own branch, never forced.
    to = (task.get("pr") or {}).get("branch") or br
    # Already there at its exact tip (pushed by hand): no second push through its hooks (#795).
    has, tip, _ = git(wt, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")
    seen, there, _ = git(wt, "ls-remote", remote, f"refs/heads/{to}")
    if not (has and tip and seen and there.split()[:1] == [tip]):
        ok, _, err = git(wt, "push", "--force-with-lease", "-u", remote, br) if to == br else \
            git(wt, "push", remote, f"{br}:refs/heads/{to}")
        if not ok:
            raise Fail(f"Couldn't push {br}" + (f" to {to}" if to != br else "") + f": {err}")
    pr = task.get("pr") or {}
    if pr.get("number"):
        ok, out, _ = gh("pr", "view", str(pr["number"]), "--repo", repo, "--json", "state", "-q", ".state")
        if ok and out == "OPEN":
            if summary:
                gh("pr", "comment", str(pr["number"]), "--repo", repo, "--body", summary)
            return pr
        if pr.get("branch"):
            # The other branch's pull request it continued was closed or merged: its own branch from here.
            task.pop("pr")
            return pr_open(s, task, repo, summary)
    if pr_adopt(task, repo):
        if summary:
            gh("pr", "comment", str(task["pr"]["number"]), "--repo", repo, "--body", summary)
        return task["pr"]
    # SHEP-59: never a second pull request for a branch that already had one merged (one at its tip
    # is done before this: already_merged()); commits made since go on a new branch.
    done = pr_merged(task, repo)
    if done:
        raise Fail(f"Pull request #{done['number']} for {br} is already merged, and {br} has commits since. "
                   f"Put them on a new branch (a new task) rather than a second pull request.")
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


def pr_at_tip(task, repo):
    """An open pull request from this repo, into the task's base, on another branch whose head is
    exactly the task branch's tip: recorded on the task, else None (#828)."""
    ok, tip, _ = git(task["worktree"], "rev-parse", "--verify", "--quiet", f"refs/heads/{task['branch']}")
    if not (ok and tip):
        return None
    ok, out, _ = gh("pr", "list", "--repo", repo, "--state", "open", "--search", tip,
                    "--json", "number,url,isCrossRepository,baseRefName,headRefName,headRefOid")
    try:
        found = next((p for p in json.loads(out) if not p.get("isCrossRepository") and p.get("headRefOid") == tip
                      and p.get("headRefName") and p.get("headRefName") != task["branch"]
                      and p.get("baseRefName") == (task.get("base") or "main")), None) if ok and out else None
    except (ValueError, TypeError, AttributeError):
        found = None
    if found:
        task["pr"] = {"number": found["number"], "url": found["url"], "repo": repo, "branch": found["headRefName"]}
    return task.get("pr") if found else None


def pr_merged(task, repo):
    """The merged pull request for the task's branch (from this repo, into its base), or None
    (SHEP-59: a squash merge leaves the branch's commits out of the base)."""
    ok, out, _ = gh("pr", "list", "--repo", repo, "--head", task["branch"], "--state", "merged",
                    "--json", "number,url,isCrossRepository,baseRefName,headRefOid,mergeCommit")
    try:
        return next((p for p in json.loads(out) if not p.get("isCrossRepository")
                     and p.get("baseRefName") == (task.get("base") or "main")), None) if ok and out else None
    except (ValueError, TypeError, AttributeError):
        return None


def landed(s, task):
    """Its own work is in its base branch, though not as its commits (squash-merged, SHEP-59):
    merging its tip into the base, here or on its remote, would change nothing. Only a branch with
    work of its own (own_work()): one that just caught up with its base is never merged."""
    if not own_work(s, task):
        return False
    main, base = s.loc["folder"], task.get("base") or "main"
    ok, tip, _ = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{task.get('branch')}")
    tip = tip if ok and tip else task.get("head")
    for ref in (base, f"refs/remotes/{remote_of(main)}/{base}"):
        ok, tree, _ = git(main, "merge-tree", "--write-tree", ref, tip)
        has, have, _ = git(main, "rev-parse", "--verify", "--quiet", f"{ref}^{{tree}}")
        if ok and has and tree and tree.split()[0] == have:
            return True
    return False


def already_merged(s, task):
    """SHEP-59: its work is already in its base (its pull request merged, squash too, or nothing left
    to merge): ready and the tick mark it done instead of opening a pull request. Returns the merged
    pull request ({} when merged without one), or None. Its pull request is recorded on the task."""
    if merged_here(s, task):
        return {}
    repo = github(s)
    tip = task.get("head")
    if repo:
        main = s.loc["folder"]
        git(main, "fetch", "--quiet", remote_of(main), task.get("base") or "main")
        tip = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{task.get('branch')}")[1] or tip
        if task.get("pr"):
            v = pr_view(task)
            if v and v.get("state") == "MERGED" and v.get("headRefOid") == tip:
                return {**task["pr"], "mergeCommit": v.get("mergeCommit")}
        found = pr_merged(task, repo)
        if found and found.get("headRefOid") == tip:
            task["pr"] = {"number": found["number"], "url": found["url"], "repo": repo}
            return {**task["pr"], "mergeCommit": found.get("mergeCommit")}
    return {} if landed(s, task) else None


BAD = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
PENDING = {"QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED", "EXPECTED"}


VIEW = "state,mergeable,headRefOid,mergeCommit,reviewDecision,mergeStateStatus"
# SHEP-179: a token that may read a pull request but not its checks (a fine-grained one without Checks: read, as
# the exe.dev GitHub integration's) gets GitHub's "Resource not accessible" for them: a permission, never a blip.
DENIED = ("resource not accessible", "http 403", "must have", "not have permission", "insufficient scope")
CANT_READ_CHECKS = "Can't read GitHub checks here: check them on GitHub."
CHECKS_PERMISSION = "Checks: read and Commit statuses: read"


def denied(err):
    return any(x in (err or "").lower() for x in DENIED)


def pr_view(task):
    """The pull request as GitHub has it (gh pr view's fields), or None when GitHub couldn't be asked. Its checks
    (statusCheckRollup) unreadable here (SHEP-179): the rest still read, the checks asked another way (check_rows());
    neither works: "checks_unknown" set, never a wait for checks nobody can see."""
    pr = task["pr"]
    view = lambda fields: gh("pr", "view", str(pr["number"]), "--repo", pr["repo"], "--json", fields)
    ok, out, err = view(VIEW + ",statusCheckRollup")
    rest = not ok and denied(err)
    if rest:
        ok, out, _ = view(VIEW)
    try:
        v = json.loads(out) if ok else None
    except ValueError:
        return None
    if not isinstance(v, dict):
        return v
    if rest:
        rows, whole = check_rows(pr["repo"], v.get("headRefOid"))
        v["statusCheckRollup"] = rows
        if not whole:
            v["checks_unknown"] = True
    if v.get("statusCheckRollup"):
        v["statusCheckRollup"] = latest_checks(v["statusCheckRollup"])
    return v


def check_rows(repo, sha):
    """A commit's checks from GitHub's REST API (check runs and commit statuses), as statusCheckRollup's rows:
    (rows, whole). whole: both could be read. A token with one permission but not the other still sees part."""
    rows, whole = [], bool(sha)
    if not sha:
        return rows, False
    ok, out, _ = gh("api", f"repos/{repo}/commits/{sha}/check-runs?per_page=100")
    try:
        for c in json.loads(out).get("check_runs") or [] if ok else []:
            rows.append({"name": c.get("name"), "status": (c.get("status") or "").upper(),
                         "conclusion": (c.get("conclusion") or "").upper(), "startedAt": c.get("started_at") or "",
                         "completedAt": c.get("completed_at") or "",
                         "workflowName": ((c.get("app") or {}).get("slug") or "")})
    except (ValueError, AttributeError):
        ok = False
    whole = whole and ok
    ok, out, _ = gh("api", f"repos/{repo}/commits/{sha}/status")
    try:
        for c in json.loads(out).get("statuses") or [] if ok else []:
            rows.append({"context": c.get("context"), "state": (c.get("state") or "").upper(),
                         "startedAt": c.get("updated_at") or c.get("created_at") or ""})
    except (ValueError, AttributeError):
        ok = False
    return rows, whole and ok


def note_checks(s, task, v):
    """Remembers on the folder's task list whether its GitHub checks could be read (`shepherdr doctor` warns while
    they can't), and on the task's pull request (the Accept card says so)."""
    pr = task.get("pr") or {}
    if v.get("checks_unknown"):
        if not pr.get("checks_unknown"):
            pr["checks_unknown"] = True
        s.data["github_checks"] = {"repo": pr.get("repo"), "at": now(), "denied": True}
        s.dirty = True
    else:
        if pr.pop("checks_unknown", None) or (s.data.get("github_checks") or {}).get("repo") == pr.get("repo"):
            s.data.pop("github_checks", None)
            s.dirty = True


def latest_checks(rows):
    """Each check by its newest run (#781): a run that a newer run of the same check superseded (a
    workflow's cancel-in-progress leaves it CANCELLED beside the one that passed) is left out."""
    newest = {}
    for i, c in enumerate(rows):
        name = c.get("name") or c.get("context")
        key = (c.get("workflowName") or "", name) if name else i
        when = c.get("startedAt") or c.get("completedAt") or ""
        if key not in newest or when >= newest[key][0]:
            newest[key] = (when, c)
    return [c for _, c in newest.values()]


BEHIND = "It is behind its base branch, which must be up to date to merge."


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
    # #743: the base requires it up to date with itself (GitHub says BEHIND only under that rule).
    if v.get("mergeStateStatus") == "BEHIND":
        return BEHIND
    return None


def pr_pending(v):
    return any((c.get("status") or c.get("state") or "").upper() in PENDING and not (c.get("conclusion") or "")
               for c in v.get("statusCheckRollup") or [])


def needs_approval(v):
    """#743: the base requires an approving review that hasn't landed (or changes were asked for):
    a merge can't go through yet, and that is nobody's problem to fix here; it waits calmly."""
    return v.get("reviewDecision") in ("REVIEW_REQUIRED", "CHANGES_REQUESTED")


QUEUE_QUERY = """query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { state isInMergeQueue autoMergeRequest { enabledAt }
    timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { reason } } } } } }"""


def queue_entry(task):
    """Its pull request in GitHub's merge queue (#802): {"in": in the queue, "auto": set to merge by
    itself (it joins the queue once its checks pass), "reason": why the queue last removed it}, or
    None when GitHub couldn't say."""
    pr = task["pr"]
    owner, _, name = pr["repo"].partition("/")
    ok, out, _ = gh("api", "graphql", "-f", f"query={QUEUE_QUERY}", "-f", f"owner={owner}", "-f", f"name={name}",
                    "-F", f"n={pr['number']}")
    try:
        p = json.loads(out)["data"]["repository"]["pullRequest"] if ok else None
    except (ValueError, TypeError, KeyError):
        p = None
    if not isinstance(p, dict):
        return None
    removed = ((p.get("timelineItems") or {}).get("nodes") or [{}])[-1] or {}
    return {"in": bool(p.get("isInMergeQueue")), "auto": bool(p.get("autoMergeRequest")),
            "reason": removed.get("reason"), "state": p.get("state")}


def drop_branch(s, task):
    """After GitHub's merge queue merged it: its branch on GitHub goes, as --delete-branch would have
    (gh refuses that flag on a queue, #801). Already gone (the repo deletes merged branches): fine."""
    if task.get("branch"):
        main = s.loc["folder"]
        git(main, "push", "--quiet", remote_of(main), "--delete", task["branch"])


# A pull request just pushed can show no checks for a few seconds before GitHub starts them: none
# for this long after ready means none are set up (Ready then, SHEP-175).
NO_CHECKS_MS = 30000
# SHEP-179: checks that can't be read here, while GitHub blocks the merge: Working this long at most, then Ready.
UNKNOWN_CHECKS_MS = 20 * 60000
CHECKS_RUNNING, GITHUB_LOOKS, BACK_TO_AGENT = "Checks running", "Waiting for GitHub", "Back to its agent to fix"


def pr_wait(v, since):
    """SHEP-175: what a Ready task's pull request (v: pr_view's answer) still waits on before the
    person has anything to do, in a few words, or None once its checks are done and GitHub knows it
    can merge. A problem (pr_problem()) goes back to its agent: Working still, never Ready first."""
    if v.get("state") != "OPEN":
        return None
    if pr_problem(v):
        return BACK_TO_AGENT
    if pr_pending(v):
        return CHECKS_RUNNING
    if (v.get("mergeable") or "").upper() not in ("MERGEABLE",):
        return GITHUB_LOOKS
    if not v.get("statusCheckRollup") and now() - (since or 0) < NO_CHECKS_MS:
        return CHECKS_RUNNING
    if v.get("checks_unknown") and v.get("mergeStateStatus") == "BLOCKED" and not needs_approval(v) \
            and now() - (since or 0) < UNKNOWN_CHECKS_MS:
        # SHEP-179: its checks can't be read here, but GitHub blocks the merge (a required check not passed yet):
        # Working for a while, then Ready anyway (the Accept card says the checks couldn't be read; GitHub still
        # refuses a merge its checks block). CLEAN: GitHub says they passed.
        return CHECKS_RUNNING
    return None


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


def mid_turn(s, task):
    """Its agent, or a helper of its own, is mid-turn (working, or asking): its folder stays until the
    turn ends (SHEP-188). Even when the merge came from Herdr itself (even_if_busy)."""
    key = s.key(task)
    return any(status_word(k) in ("working", "blocked") for k in live_agents(key) + live_helpers(key))


def finish(s, task, even_if_busy=False):
    """Done, its branch merged: removes the worktree and branch when nothing is left uncommitted
    there and no agent still works in it: none mid-turn (mid_turn()), and (unless the person merged
    from Herdr) none running at all. Else tidy_done() removes them once its agents ended."""
    task["state"], task["done_at"] = "done", now()
    for k in ("attention", "merge_requested", "queue", "queued_at", "merge_queued", "kept_open"):
        task.pop(k, None)
    s.dirty = True
    if not task.get("worktree") or mid_turn(s, task) or (not even_if_busy and any(agent_running(k) for k in live_agents(s.key(task)))):
        return
    remove_worktree(s, task)


def remove_worktree(s, task):
    """A finished task's worktree removed when nothing is uncommitted there, then its branch. True
    once the worktree is gone."""
    wt, br, main = task.get("worktree"), task.get("branch"), s.loc["folder"]
    if os.path.isdir(wt):
        if os.path.realpath(wt) == os.path.realpath(main):
            return False
        ok, out, _ = git(wt, "status", "--porcelain", "--untracked-files=no")
        if not ok or out or not git(main, "worktree", "remove", "--force", wt)[0]:
            return False
    if br:
        git(main, "branch", "-D", br)
    return True


# A Done task's worktree left on disk (its agent was still open when it finished, SHEP-161): removed
# as finish() would have, once nothing runs in it; one that can't go yet (uncommitted work, a
# terminal there) is looked at again after TIDY_AGAIN_MS. Old leftovers go the same way on the next
# pass. A task made Done by hand with its work unmerged keeps its worktree (the person's to remove).
TIDY_AGAIN_MS = 3600000


def tidy_due(t):
    """A Done task, merged or with nothing to merge, whose worktree is still on disk and may be looked at now."""
    wt = t.get("worktree")
    return bool(t.get("state") == "done" and t.get("mode") == "worktree" and wt and (t.get("merged") or t.get("nothing_to_merge"))
                and now() - (t.get("worktree_kept") or 0) >= TIDY_AGAIN_MS and os.path.isdir(wt))


def tidy_done(s, t, report=None):
    """Removes a Done task's leftover worktree and branch (remove_worktree()) when no terminal is
    live in it (neither the task's own nor any other with its folder there) and its branch has
    nothing new since its work merged. True when removed."""
    if not tidy_due(t):
        return False
    wt, br, main = t["worktree"], t.get("branch"), s.loc["folder"]
    terms = hc_json("ls")
    real = os.path.realpath(wt)
    inside = lambda p: bool(p) and (os.path.realpath(p) + os.sep).startswith(real + os.sep)
    busy = terms is None or live_agents(s.key(t)) or live_helpers(s.key(t)) or any(
        k.get("state") == "live" and inside(k.get("cwd")) for k in terms.get("terminals") or [])
    ok, tip, _ = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}") if br else (False, "", "")
    base = t.get("base") or "main"
    newer = ok and tip and tip != t.get("own") and not any(
        git(main, "merge-base", "--is-ancestor", tip, ref)[0] for ref in (base, f"refs/remotes/{remote_of(main)}/{base}"))
    if busy or newer or not remove_worktree(s, t):
        t["worktree_kept"] = now()
        s.dirty = True
        return False
    t.pop("worktree_kept", None)
    t["worktree_removed_at"] = now()
    s.dirty = True
    if report is not None:
        report.setdefault("worktrees_removed", []).append({"task": s.ref(t), "path": wt})
    return True
