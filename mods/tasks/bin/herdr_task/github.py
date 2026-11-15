"""GitHub and merging: pull requests, checks, and finishing a merged task."""

import contextlib
import json
import os
import re
import shutil

from .base import Fail, GH, git, hc_json, now, run, STORE
from .agents import agent_running, detail, live_agents, live_helpers, mid_turn_agents


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
    again after an hour. None: tasks merge locally. gh failing on a repo whose remote is on GitHub
    (a network blip, its sign-in lapsed) is never remembered as "not on GitHub" (#988: that hour of
    None merged a task locally while its pull request stayed open): None, with why in
    github_unreachable(s)."""
    if s.loc["kind"] != "repo" or not shutil.which(GH):
        return None
    g = s.data.get("github") or {}
    if g and now() - g.get("at", 0) < 3600000:
        return g.get("repo")
    ok, out, err = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner", cwd=s.loc["folder"])
    if not (ok and out) and not settled(err) and on_github(s.loc["folder"]):
        s.github_error = err or "gh couldn't read the repo"
        return None
    s.data["github"] = {"repo": out if ok and out else None, "at": now()}
    s.dirty = True
    return s.data["github"]["repo"]


# gh's answers that say for sure it won't work here (never signed in, no such repo or no access): tasks
# merge locally, as before; anything else (the network, GitHub's own errors) may pass.
SETTLED = ("auth login", "not logged in", "could not resolve to a repository", "none of the git remotes",
           "no git remotes", "not a git repository", "isn't installed")


def settled(err):
    return any(x in (err or "").lower() for x in SETTLED)


def on_github(folder):
    """A remote of the repo at folder points at github.com."""
    ok, out, _ = git(folder, "remote", "-v")
    return ok and bool(re.search(r"github\.com[:/]", out))


def github_unreachable(s):
    """Why GitHub couldn't be asked about a repo whose remote is there (github() said None), else None."""
    return getattr(s, "github_error", None) if s.loc["kind"] == "repo" and shutil.which(GH) else None


def released(s):
    """The task list's lock let go around slow git work (Store.released(), #1007); a no-op elsewhere."""
    let_go = getattr(s, "released", None)
    return let_go() if let_go else contextlib.nullcontext()


def remote_of(main):
    names = git(main, "remote")[1].split()
    return "origin" if "origin" in names else (names[0] if names else "origin")


def pr_push(s, task, repo):
    """Pushes the task's branch for its pull request, with the task list's lock let go meanwhile
    (#1007: a pre-push hook can run for many minutes, and every other herdr-task command here waited
    on it). Only what its remote lacks (#795); a pull request it continues gets its new commits on
    its own branch, never forced (#828)."""
    wt, br = task["worktree"], task["branch"]
    remote = remote_of(s.loc["folder"])
    to = (task.get("pr") or {}).get("branch") or br
    has, tip, _ = git(wt, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")
    seen, there, _ = git(wt, "ls-remote", remote, f"refs/heads/{to}")
    if has and tip and seen and there.split()[:1] == [tip]:
        return
    with released(s):
        ok, out, err = git(wt, "push", "--force-with-lease", "-u", remote, br) if to == br else \
            git(wt, "push", remote, f"{br}:refs/heads/{to}")
    if not ok:
        raise Fail(f"Couldn't push {br}" + (f" to {to}" if to != br else "") + f": {push_error(out, err)}")


def pr_open(s, task, repo, summary=None):
    """Pushes the task's branch and opens its pull request (or keeps the open one, also one opened
    by hand or by its agent for the branch: SHEP-13's "already exists"). Its description follows
    each ready (#1004) when Herdr wrote it."""
    br = task["branch"]
    # Continuing a pull request already open on another branch, its work pushed there (#828): that
    # one is the task's, never a second with the same commits.
    if not (task.get("pr") or {}).get("number") and pr_at_tip(task, repo):
        if summary:
            pr_note(task, repo, summary)
        return task["pr"]
    pr_push(s, task, repo)
    pr = task.get("pr") or {}
    if pr.get("number"):
        ok, out, _ = gh("pr", "view", str(pr["number"]), "--repo", repo, "--json", "state", "-q", ".state")
        if ok and out == "OPEN":
            pr_describe(s, task, summary)
            if summary:
                pr_note(task, repo, summary)
            return pr
        if pr.get("branch"):
            # The other branch's pull request it continued was closed or merged: its own branch from here.
            task.pop("pr")
            return pr_open(s, task, repo, summary)
    if pr_adopt(task, repo):
        pr_describe(s, task, summary)
        if summary:
            pr_note(task, repo, summary)
        return task["pr"]
    # SHEP-59: never a second pull request for a branch that already had one merged (one at its tip
    # is done before this: already_merged()); commits made since go on a new branch.
    done = pr_merged(task, repo)
    if done:
        raise Fail(f"Pull request #{done['number']} for {br} is already merged, and {br} has commits since. "
                   f"Put them on a new branch (a new task) rather than a second pull request.")
    ok, out, err = gh("pr", "create", "--repo", repo, "--head", br, "--base", task.get("base") or "main",
                      "--title", pr_title(s, task), "--body", pr_body(s, task, summary))
    if not ok or not out:
        raise Fail(f"Couldn't open a pull request: {err}")
    url = out.split()[-1]
    task["pr"] = {"number": int(url.rstrip("/").split("/")[-1]), "url": url, "repo": repo}
    if summary and summary.strip():
        task["pr_note"] = {"number": task["pr"]["number"], "said": summary.strip()}  # its body says it already
    return task["pr"]


def push_error(out, err, lines=15):
    """What a failed push said, for ready's refusal (#963): a pre-push hook's own words (what failed,
    where its log is) often go to stdout, which git leaves there; both, its last lines only."""
    said = [x for x in (out + "\n" + err).splitlines() if x.strip()]
    return "\n".join(said[-lines:]) or "git push failed"


def pr_note(task, repo, summary):
    """Ready's summary on the task's open pull request: one comment, edited in place on a later ready, and
    nothing when it says the same as last time (#1058: each ready posted another copy under the person's
    name). task["pr_note"] = {number, id (the comment's), said}, for the pull request it was on."""
    summary = (summary or "").strip()
    number = task["pr"]["number"]
    note = task.get("pr_note") or {}
    if note.get("number") != number:
        note = {"number": number}
    if not summary or note.get("said") == summary:
        return
    if note.get("id"):
        ok, _, _ = gh("api", "-X", "PATCH", f"repos/{repo}/issues/comments/{note['id']}", "-f", f"body={summary}")
        if ok:
            task["pr_note"] = {**note, "said": summary}
            return
    # none yet, or it was deleted: a new one, its id (gh prints the comment's link, …#issuecomment-<id>) kept
    ok, out, _ = gh("pr", "comment", str(number), "--repo", repo, "--body", summary)
    if ok:
        m = re.search(r"#issuecomment-(\d+)", out or "")
        task["pr_note"] = {"number": number, "id": int(m.group(1)) if m else None, "said": summary}


def pr_describe(s, task, summary=None):
    """#1004: an open pull request whose description Herdr wrote (pr_body(), "Task: SHEP-n" first)
    gets the one this ready says (its summary, details and proof); one written by a person or an
    agent, or another branch's it continues (#828), is left as it is."""
    pr = task.get("pr") or {}
    if not pr.get("number") or pr.get("branch"):
        return
    ok, body, _ = gh("pr", "view", str(pr["number"]), "--repo", pr["repo"], "--json", "body", "-q", ".body")
    want = pr_body(s, task, summary)
    if ok and body.strip().splitlines()[:1] == [f"Task: {s.ref(task)}"] and body.strip() != want.strip():
        gh("pr", "edit", str(pr["number"]), "--repo", pr["repo"], "--body", want)


def pr_title(s, task):
    """The repo's commit titles read "SHEP-198: the task's title" (a squash merge adds "(#945)"): the
    task's ref first, so the pull request stays findable by it."""
    ref = s.ref(task)
    title = " ".join(str(task.get("title") or "").split())
    rest = re.sub(rf"^{re.escape(ref)}\b[:\s-]*", "", title, flags=re.I)
    return f"{ref}: {rest or ref}"


def pr_body(s, task, summary=None):
    """Short: the task's ref, what ready said (summary), the details and its proof's title. Never the
    brief: that stays with the task in Shepherdr."""
    lines = [f"Task: {s.ref(task)}"]
    if summary and summary.strip():
        lines += ["", "## Summary", "", summary.strip()]
    if (task.get("details") or "").strip():
        lines += ["", "## Details", "", task["details"].strip()]
    proof = (task.get("proof") or {}).get("title")
    if proof:
        lines += ["", "## Proof", "", f"Shepherdr's proof artifact: {proof}"]
    return "\n".join(lines)


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


def pr_for_branch(task, repo):
    """The open pull request from this repo for the task's branch into its base, whatever its head
    (opened by its agent, ready never knowing: #988), as gh lists it, or None."""
    ok, out, _ = gh("pr", "list", "--repo", repo, "--head", task["branch"], "--state", "open",
                    "--json", "number,url,isCrossRepository,baseRefName,headRefOid")
    try:
        return next((p for p in json.loads(out) if not p.get("isCrossRepository")
                     and p.get("baseRefName") == (task.get("base") or "main")), None) if ok and out else None
    except (ValueError, TypeError, AttributeError):
        return None


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
    if v.get("state") == "OPEN" and not pr_pending(v) and runs_pending(pr["repo"], v.get("headRefOid")):
        # #1044: a workflow run at its head not finished, its jobs not all shown as checks yet (a job
        # that waits on another's needs, a run waiting for a runner): its checks still run.
        v["runs_pending"] = True
    return v


def runs_pending(repo, sha):
    """GitHub Actions has a run at commit sha not finished yet (queued, waiting, in progress). False
    when none, or GitHub couldn't say."""
    if not sha:
        return False
    ok, out, _ = gh("api", f"repos/{repo}/actions/runs?head_sha={sha}&per_page=50", "-q", "[.workflow_runs[].status]")
    try:
        states = json.loads(out) if ok else []
    except ValueError:
        return False
    return any(st != "completed" for st in states if isinstance(st, str))


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
    if v.get("runs_pending"):
        return True
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
        # --no-verify: a pre-push hook (a typecheck) checks what is pushed; a deletion has nothing to
        # check, and the hook would hold the task list's lock for minutes (#1007).
        git(main, "push", "--quiet", "--no-verify", remote_of(main), "--delete", task["branch"])


def queue_merge(task, head):
    """Asks GitHub to merge its pull request (squash) at exactly head: merged now, or queued in its
    merge queue. Never --delete-branch (#1045: drop_branch() once it merged). (ok, err)."""
    pr = task["pr"]
    ok, _, err = gh("pr", "merge", str(pr["number"]), "--repo", pr["repo"], "--squash", "--match-head-commit", head or "")
    return ok, err


# #1044, #1018: a pull request just pushed shows no checks until GitHub starts them, which can take
# minutes. No checks yet is never "none set up" while its repo says some will come: its workflows at
# its head run on pull requests, or GitHub blocks the merge with none there (a required check).
NO_CHECKS_MS = 30000  # no workflow of its own: this long for checks from elsewhere (another CI's statuses)
MAYBE_CHECKS_MS = 5 * 60000  # a workflow whose filters (paths, branches, a push) may leave it out: this long
CHECKS_START_MS = 20 * 60000  # one that runs on it: this long, then "they never started" (no merge by itself)
# SHEP-179: checks that can't be read here, while GitHub blocks the merge: Working this long at most, then Ready.
UNKNOWN_CHECKS_MS = 20 * 60000
CHECKS_RUNNING, GITHUB_LOOKS, BACK_TO_AGENT = "Checks running", "Waiting for GitHub", "Back to its agent to fix"
CHECKS_NEVER = "Its checks never started on GitHub."
WORKFLOWS = ".github/workflows"
PR_EVENTS = ("pull_request", "pull_request_target")


def _block(lines, i):
    """The lines nested under lines[i] (more indented), and where they end."""
    ind = len(lines[i]) - len(lines[i].lstrip())
    j = i + 1
    while j < len(lines) and len(lines[j]) - len(lines[j].lstrip()) > ind:
        j += 1
    return lines[i + 1:j], j


def _key(line):
    k, colon, rest = line.strip().partition(":")
    return (k.strip().strip("'\""), rest.strip()) if colon else (None, line.strip())


def workflow_checks(text, base="main"):
    """One workflow file's say on a task's pull request into base: "yes" (it runs on pull requests,
    unfiltered or for base), "maybe" (only on a push, or filtered by paths or other branches), or None
    (never on one). Its "on:" read by indentation (no YAML parser here)."""
    lines = [ln.split(" #")[0].rstrip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
    for i, ln in enumerate(lines):
        if ln[:1].isspace() or _key(ln)[0] not in ("on", "true"):
            continue
        inline = _key(ln)[1]
        words = set(re.findall(r"[\w-]+", inline))
        if inline:
            return "yes" if words & set(PR_EVENTS) else "maybe" if "push" in words else None
        body, _ = _block(lines, i)
        say = None
        j = 0
        while j < len(body):
            k, rest = _key(body[j].lstrip("- ").rstrip()) if body[j].lstrip().startswith("-") else _key(body[j])
            sub, end = _block(body, j)
            j = end if end > j else j + 1
            if k in PR_EVENTS or rest in PR_EVENTS:
                keys = {}
                m = 0
                while m < len(sub):
                    sk, sv = _key(sub[m])
                    inner, e = _block(sub, m)
                    keys[sk] = sv + " " + " ".join(x.strip() for x in inner)
                    m = e
                if keys.keys() & {"paths", "paths-ignore", "branches-ignore"}:
                    say = say or "maybe"
                elif "branches" in keys and not re.search(rf"(?<![\w/.-]){re.escape(base)}(?![\w/.-])|\*", keys["branches"]):
                    say = say or "maybe"
                else:
                    return "yes"
            elif k == "push" or rest == "push":
                say = say or "maybe"
        return say
    return None


def expected_checks(s, task, sha):
    """Whether checks will come for its pull request at commit sha, from its repo's workflows there:
    "yes", "maybe" or None (workflow_checks()). Kept on the pull request per commit."""
    pr = task.get("pr") or {}
    seen = pr.get("expects") or {}
    if sha and seen.get("sha") == sha:
        return seen.get("is")
    main = s.loc["folder"]
    ref = sha if sha and git(main, "cat-file", "-e", f"{sha}^{{commit}}")[0] else (task.get("branch") or task.get("head"))
    ok, out, _ = git(main, "ls-tree", "--name-only", f"{ref}:{WORKFLOWS}") if ref else (False, "", "")
    found = None
    for name in out.split() if ok else []:
        if name.endswith((".yml", ".yaml")):
            said = workflow_checks(git(main, "show", f"{ref}:{WORKFLOWS}/{name}")[1], task.get("base") or "main")
            found = "yes" if "yes" in (found, said) else said or found
    if sha:
        pr["expects"] = {"sha": sha, "is": found}
        s.dirty = True
    return found


def checks_since(s, task, v):
    """Since when its pull request's head has been what it is (ms): when it said ready, or when a newer
    commit was first seen there (#1018: a push after ready, its checks start again)."""
    pr = task.get("pr") or {}
    sha = v.get("headRefOid")
    if sha and pr.get("head_sha") != sha:
        pr["head_at"] = now() if pr.get("head_sha") else (task.get("ready_at") or now())
        pr["head_sha"] = sha
        s.dirty = True
    return max(task.get("ready_at") or 0, pr.get("head_at") or 0)


def checks_missing(v, since, expect=None):
    """No checks on its pull request yet (#1044): None when it has some or none are coming; "waiting"
    while they may still start; "never" when they should have and didn't (CHECKS_START_MS)."""
    if v.get("statusCheckRollup"):
        return None
    gone = now() - (since or 0)
    if v.get("checks_unknown"):
        # Checks that can't be read here (SHEP-179): a moment for GitHub, then pr_wait() decides.
        return "waiting" if gone < NO_CHECKS_MS else None
    blocked = v.get("mergeStateStatus") == "BLOCKED" and not needs_approval(v)
    if expect == "yes" or blocked:
        return "waiting" if gone < CHECKS_START_MS else "never"
    return "waiting" if gone < (MAYBE_CHECKS_MS if expect == "maybe" else NO_CHECKS_MS) else None


def pr_wait(v, since, expect=None):
    """SHEP-175: what a Ready task's pull request (v: pr_view's answer) still waits on before the
    person has anything to do, in a few words, or None once its checks are done and GitHub knows it
    can merge. A problem (pr_problem()) goes back to its agent: Working still, never Ready first.
    expect: expected_checks(); since: checks_since()."""
    if v.get("state") != "OPEN":
        return None
    if pr_problem(v):
        return BACK_TO_AGENT
    if pr_pending(v):
        return CHECKS_RUNNING
    if (v.get("mergeable") or "").upper() not in ("MERGEABLE",):
        return GITHUB_LOOKS
    if checks_missing(v, since, expect) == "waiting":
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
    return bool(mid_turn_agents(live_agents(key) + live_helpers(key), detail))


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
