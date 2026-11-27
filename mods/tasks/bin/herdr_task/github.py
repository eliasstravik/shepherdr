"""GitHub and merging: pull requests, checks, and finishing a merged task."""

import contextlib
import json
import os
import re
import shutil

from .base import Fail, GH, git, hc_json, now, run, STORE
from .agents import agent_running, detail, live_agents, live_helpers, mid_turn_agents
from .after_accept import start as after_accept


# ---- GitHub ---------------------------------------------------------------------------------

def gh(*args, cwd=None):
    # gh not installed (or not on this caller's PATH, as a background service's): it doesn't work here, said plainly
    try:
        r = run([GH, *args], cwd=cwd or STORE)
    except FileNotFoundError:
        return False, "", "gh isn't installed here (GitHub CLI)"
    return r.returncode == 0, r.stdout.strip(), (r.stderr or r.stdout).strip()


# #1490: what the scheduler asked GitHub with the task list's lock let go (tick.prefetch()), each answer used once by
# the call below that would ask it again under the lock; cleared after its list's turn.
_ANSWERS = {}
_ASK = object()


@contextlib.contextmanager
def answered(found):
    _ANSWERS.clear()
    _ANSWERS.update(found or {})
    try:
        yield
    finally:
        _ANSWERS.clear()


def answer(*key):
    """An answer asked ahead (answered()), else _ASK."""
    return _ANSWERS.pop(key, _ASK)


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
    """Push the task's branch, or the branch of a PR it explicitly took, under a branch-specific lease."""
    wt, br = task["worktree"], task["branch"]
    remote = remote_of(s.loc["folder"])
    pr = task.get("pr") or {}
    to = pr.get("branch") or br
    base = task.get("base") or "main"
    if to == base or pr.get("from_base") or (to != br and not pr.get("taken")):
        raise Fail(f"Can't push this task to {to}. Use the task's own branch or explicitly take its pull request.")
    ref = f"refs/heads/{to}"
    has, tip, _ = git(wt, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")
    seen, there, _ = git(wt, "ls-remote", remote, ref)
    if has and tip and seen and there.split()[:1] == [tip]:
        if to != br:
            pr["lease"] = tip
        return
    # #1215: GitHub locks a branch while its pull request sits in the merge queue (its push is refused):
    # out of the queue first; ready puts it back once its checks pass (finalize()).
    q = queue_entry(task) if pr.get("number") and pr.get("repo") else None
    if q and q["in"]:
        ok, err = unqueue(q)
        if not ok:
            raise Fail(f"Couldn't take pull request #{pr['number']} out of GitHub's merge queue to push {br}: {err}")
        task["dequeued"] = now()
        task.pop("merge_queued", None)
    # #1497: its branch gone on the remote (GitHub deletes it once its pull request merged): the lease is "not there",
    # never the stale tracking ref (git refuses that as "stale info"). A merged pull request's branch takes no more.
    gone = seen and not there.strip()
    if gone and to == br:
        done = pr_merged(task, repo) if repo else None
        if done:
            raise Fail(f"Pull request #{done['number']} for {br} is already merged (GitHub deleted its branch), and {br} has "
                       f"commits since. Put them on a new branch (a new task) rather than a second pull request.")
    tracking = git(wt, "rev-parse", "--verify", "--quiet", f"refs/remotes/{remote}/{to}")[1]
    expected = (pr.get("lease") or tracking) if to != br else ("" if gone else tracking)
    # Older taken PRs may have no saved tip and no tracking ref. Git can still push a fast-forward.
    lease = [f"--force-with-lease={ref}:{expected}"] if to == br or expected else []
    with released(s):
        ok, out, err = git(wt, "push", *lease, *(["-u"] if to == br else []), remote, f"refs/heads/{br}:{ref}")
    if not ok:
        raise Fail(f"Couldn't push {br}" + (f" to {to}" if to != br else "") + f": {push_error(out, err)}")
    current = task.get("pr") or {}
    if to != br and current.get("branch") == to and current.get("number") == pr.get("number"):
        current["lease"] = tip


def pr_open(s, task, repo, summary=None):
    """Pushes the task's branch and opens its pull request (or keeps the open one, also one opened
    by hand or by its agent for the branch: SHEP-13's "already exists"). Its description follows
    each ready (#1004) when Herdr wrote it."""
    br = task["branch"]
    pr_push(s, task, repo)
    pr = task.get("pr") or {}
    if pr.get("number"):
        ok, out, _ = gh("pr", "view", str(pr["number"]), "--repo", repo, "--json", "state", "-q", ".state")
        if ok and out == "OPEN":
            pr_describe(s, task, summary)
            if summary:
                pr_note(task, repo, summary)
            return pr
        if ok and pr.get("taken"):
            # --pr (#1155): the pull request it took is closed: said, never a new one of its own instead.
            raise Fail(f"Pull request #{pr['number']}, which this task took, is {out.lower() or 'not open'}. Reopen it, take "
                       f"another (ready --pr <n>), or let it go (ready --pr \"\") for a pull request of its own.")
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
    if commit_base(task):
        raise Fail(f"This task's base is a commit ({task['base'][:9]}), not a branch: its folder was on a detached commit "
                   f"when it started. Give it a branch to merge into (herdr-task edit <task> --base <branch>), then ready again.")
    ok, out, err = gh("pr", "create", "--repo", repo, "--head", br, "--base", task.get("base") or "main",
                      "--title", pr_title(s, task), "--body", pr_body(s, task, summary),
                      *(["--draft"] if task.get("pr_draft") else []))
    task.pop("pr_title_new", None)
    task.pop("pr_body_new", None)
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


# #1208: Shepherdr's part of a pull request's description, between these marks: a later ready rewrites only that part,
# and keeps what a person or an agent added around it (gh pr edit).
MARK_START, MARK_END = "<!-- shepherdr -->", "<!-- /shepherdr -->"
OWN_SECTIONS = {"Summary", "Details", "Proof"}


def described(s, task, body, want):
    """The description a ready makes of the one there now (body), or None to leave it as it is: Shepherdr's marked part
    replaced; an older unmarked one of Herdr's ("Task: SHEP-n" first, before SHEP-322) only while it holds nothing but its own sections;
    anything else is a person's or an agent's."""
    body = body or ""
    a, b = body.find(MARK_START), body.find(MARK_END)
    if a >= 0 and b > a:
        new = body[:a] + want + body[b + len(MARK_END):]
    elif body.strip().splitlines()[:1] == [f"Task: {s.ref(task)}"] and \
            all(h in OWN_SECTIONS for h in re.findall(r"^## (.+?)\s*$", body, flags=re.M)):
        new = want
    else:
        return None
    return new if new.strip() != body.strip() else None


def pr_describe(s, task, summary=None):
    """#1004: an open pull request whose description Herdr wrote (pr_body()) gets the one this ready says (its summary,
    details and proof), only its own part (#1208); one written by a person or an agent, or another branch's it continues
    (#828), is left as it is. #1087: a title or description its agent gave (ready --pr-title/--pr-body) replaces the
    open one's, once per time it is given."""
    pr = task.get("pr") or {}
    if not pr.get("number"):
        return
    n, repo = str(pr["number"]), pr["repo"]
    if task.pop("pr_title_new", None) and task.get("pr_title"):
        gh("pr", "edit", n, "--repo", repo, "--title", task["pr_title"])
    if task.pop("pr_body_new", None) and task.get("pr_body"):
        gh("pr", "edit", n, "--repo", repo, "--body", task["pr_body"])
        return
    if pr.get("branch") or task.get("pr_body"):
        return
    ok, body, _ = gh("pr", "view", n, "--repo", repo, "--json", "body", "-q", ".body")
    new = described(s, task, body, pr_body(s, task, summary)) if ok else None
    if new is not None:
        gh("pr", "edit", n, "--repo", repo, "--body", new)


def pr_title(s, task):
    """The task's title (SHEP-322: no task number; a squash merge's commit then reads "Fix login (#945)"). An older
    title that starts with its key keeps only the rest. Its agent's own (--pr-title, #1087) when given."""
    if task.get("pr_title"):
        return task["pr_title"]
    ref = s.ref(task)
    title = " ".join(str(task.get("title") or "").split())
    return re.sub(rf"^{re.escape(ref)}\b[:\s-]*", "", title, flags=re.I) or title or "Task"


def pr_body(s, task, summary=None):
    """Short: what ready said (summary), the details and its proof's title (SHEP-322: no task key; its marks find it). Never the
    brief: that stays with the task in Shepherdr. Between its marks (#1208), so a later ready keeps what was added around
    it. Its agent's own (--pr-body, #1087) instead, as written, when given."""
    if task.get("pr_body"):
        return task["pr_body"]
    lines = [MARK_START]
    if summary and summary.strip():
        lines += ["## Summary", "", summary.strip()]
    if (task.get("details") or "").strip():
        lines += ["", "## Details", "", task["details"].strip()]
    proof = (task.get("proof") or {}).get("title")
    if proof:
        proof = re.sub(rf"^{re.escape(s.ref(task))}\b[:\s-]*", "", proof, flags=re.I) or proof
        lines += ["", "## Proof", "", f"Shepherdr's proof artifact: {proof}"]
    return "\n".join(lines + [MARK_END])


def commit_base(task):
    """#1533: its base is a commit, not a branch (started while its folder was on a detached commit)."""
    return bool(re.fullmatch(r"[0-9a-f]{7,40}", task.get("base") or ""))


def pr_adopt(task, repo):
    """The open pull request for the task's branch, opened by hand or by its agent, recorded on the
    task; None when there is none (SHEP-13: ready failed with "already exists"). Only one from this
    repo (never a fork's branch of the same name), into the task's base, at the branch's tip here."""
    ok, out, _ = gh("pr", "list", "--repo", repo, "--head", task["branch"], "--state", "open",
                    "--json", "number,url,isCrossRepository,baseRefName,headRefOid")
    tip_ok, tip, _ = git(task["worktree"], "rev-parse", task["branch"])
    loose = commit_base(task)
    try:
        found = next((p for p in json.loads(out) if not p.get("isCrossRepository")
                      and (loose or p.get("baseRefName") == (task.get("base") or "main"))
                      and tip_ok and tip and p.get("headRefOid") == tip), None) if ok and out else None
    except (ValueError, TypeError, AttributeError):
        found = None
    if found:
        task["pr"] = {"number": found["number"], "url": found["url"], "repo": repo}
        if loose and found.get("baseRefName"):
            task["base"] = found["baseRefName"]  # #1533: its pull request's base, a real branch
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


def pr_merged(task, repo, any_base=False):
    """The merged pull request for the task's branch (from this repo, into its base), or None (SHEP-59: a squash
    merge leaves the branch's commits out of the base). any_base: else one into another branch (#1157: a parent
    pull request's branch), its work merged all the same (the callers then check it merged at its tip)."""
    ok, out, _ = gh("pr", "list", "--repo", repo, "--head", task["branch"], "--state", "merged",
                    "--json", "number,url,isCrossRepository,baseRefName,headRefOid,mergeCommit")
    try:
        mine = [p for p in json.loads(out) if not p.get("isCrossRepository")] if ok and out else []
    except (ValueError, TypeError, AttributeError):
        return None
    return next((p for p in mine if p.get("baseRefName") == (task.get("base") or "main")), None) \
        or (mine[0] if mine and any_base else None)


def landed(s, task):
    """Its own work is in its base branch, though not as its commits (squash-merged, SHEP-59):
    merging its tip into the base, here or on its remote, would change nothing. Only a branch with
    work of its own (own_work()): one that just caught up with its base is never merged."""
    if not own_work(s, task):
        return False
    main, base = s.loc["folder"], task.get("base") or "main"
    tip = last_tip(s, task)
    for ref in (base, f"refs/remotes/{remote_of(main)}/{base}"):
        ok, tree, _ = git(main, "merge-tree", "--write-tree", ref, tip)
        has, have, _ = git(main, "rev-parse", "--verify", "--quiet", f"{ref}^{{tree}}")
        if ok and has and tree and tree.split()[0] == have:
            return True
    return False


def last_tip(s, task):
    """The task branch's last commit: its branch here, else the one it said ready at, else its own work last seen
    (#1426: its branch deleted after a merge, and a reopened task's head is gone too); None when none is known."""
    ok, tip, _ = git(s.loc["folder"], "rev-parse", "--verify", "--quiet", f"refs/heads/{task.get('branch')}")
    return (tip if ok and tip else None) or task.get("head") or task.get("own") or None


def already_merged(s, task):
    """SHEP-59: its work is already in its base (its pull request merged, squash too, or nothing left
    to merge): ready and the tick mark it done instead of opening a pull request. Returns the merged
    pull request ({} when merged without one), or None. Its pull request is recorded on the task."""
    if merged_here(s, task):
        return {}
    repo = github(s)
    if repo:
        main = s.loc["folder"]
        git(main, "fetch", "--quiet", remote_of(main), task.get("base") or "main")
        tip = last_tip(s, task)
        if task.get("pr"):
            v = pr_view(task)
            if v and v.get("state") == "MERGED" and v.get("headRefOid") == tip:
                return {**task["pr"], "mergeCommit": v.get("mergeCommit")}
        found = pr_merged(task, repo, any_base=True)
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


# #1106: closed on GitHub (often on purpose): the person's Accept then closes the task, nothing merged.
PR_CLOSED = "The pull request was closed. Accept closes the task without merging, or reopen it on GitHub."


def pr_problem(v):
    """What keeps a pull request from merging, for the person; None when nothing does."""
    if v.get("state") == "CLOSED":
        return PR_CLOSED
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


REQUIRED_QUERY = """query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name isRequired(pullRequestNumber: $n) }
    ... on StatusContext { context isRequired(pullRequestNumber: $n) } } } } } } } } } }"""


def required_checks(task):
    """The names of its pull request's checks that its base branch requires (GitHub marks them: branch protection,
    rulesets), or None when GitHub couldn't say."""
    pr = task.get("pr") or {}
    owner, _, name = (pr.get("repo") or "").partition("/")
    if not (owner and name and pr.get("number")):
        return None
    found = answer("required", pr["repo"], pr["number"])
    if found is not _ASK:
        return found
    ok, out, _ = gh("api", "graphql", "-f", f"query={REQUIRED_QUERY}", "-f", f"owner={owner}", "-f", f"name={name}",
                    "-F", f"n={pr['number']}")
    try:
        nodes = json.loads(out)["data"]["repository"]["pullRequest"]["commits"]["nodes"] if ok else None
        rows = ((nodes[-1]["commit"]["statusCheckRollup"] or {}).get("contexts") or {}).get("nodes") or [] if nodes else []
    except (ValueError, TypeError, KeyError, IndexError):
        return None
    if not ok:
        return None
    return {c.get("name") or c.get("context") for c in rows if isinstance(c, dict) and c.get("isRequired")}


def _unsettled(c):
    return (c.get("conclusion") or c.get("state") or "").upper() in BAD or \
        ((c.get("status") or c.get("state") or "").upper() in PENDING and not (c.get("conclusion") or ""))


def merge_checks(task, v, now_=False):
    """GitHub #1221: what a merge waits on is its base branch's required checks: v with only those, once one isn't
    passed (a red or running optional check never stops a merge, nor its queueing). The base requires none: merge
    "on its own" (now_) waits on nothing (the person wants it fast; main going red is a fix-forward task's), "after
    checks" on every check, as its name says. GitHub couldn't say: every check. A running optional one left out while
    GitHub still blocks the merge (a required check it doesn't show yet): runs_pending, so it waits."""
    rows = v.get("statusCheckRollup") or []
    if not any(_unsettled(c) for c in rows):
        return v
    names = required_checks(task)
    keep = [c for c in rows if (c.get("name") or c.get("context")) in (names or ())]
    if names is None or len(keep) == len(rows) or (not keep and not now_):
        return v
    out = {**v, "statusCheckRollup": keep, "optional_checks": [c.get("name") or c.get("context") for c in rows if c not in keep]}
    if v.get("mergeStateStatus") == "BLOCKED" and not needs_approval(v):
        out["runs_pending"] = True
    return out


def pr_pending(v):
    if v.get("runs_pending"):
        return True
    return any((c.get("status") or c.get("state") or "").upper() in PENDING and not (c.get("conclusion") or "")
               for c in v.get("statusCheckRollup") or [])


def checks_state(v, missing=False):
    """SHEP-348: its pull request's checks in one word for its row's mark: "failed" (one failed), "running" (some still
    run, or will come), "passed" (all green), or None (none, or they can't be read here)."""
    rows = v.get("statusCheckRollup") or []
    word = lambda c: (c.get("conclusion") or c.get("state") or "").upper()
    if any(word(c) in BAD for c in rows):
        return "failed"
    if pr_pending(v) or missing:
        return "running"
    if rows and all(word(c) in ("SUCCESS", "NEUTRAL", "SKIPPED") for c in rows):
        return "passed"
    return None


def needs_approval(v):
    """#743: the base requires an approving review that hasn't landed (or changes were asked for):
    a merge can't go through yet, and that is nobody's problem to fix here; it waits calmly."""
    return v.get("reviewDecision") in ("REVIEW_REQUIRED", "CHANGES_REQUESTED")


QUEUE_QUERY = """query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) {
  pullRequest(number: $n) { id state mergeable isInMergeQueue autoMergeRequest { enabledAt }
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
            "reason": removed.get("reason"), "state": p.get("state"), "id": p.get("id"), "mergeable": p.get("mergeable")}


DEQUEUE = "mutation($id: ID!) { dequeuePullRequest(input: {id: $id}) { clientMutationId } }"
NO_AUTO = "mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { clientMutationId } }"


def unqueue(q):
    """Takes a pull request (q: queue_entry()) out of GitHub's merge queue, and off merging by itself
    (it would join the queue again once its checks pass). (ok, err)."""
    if not (q and q.get("id")):
        return False, "GitHub didn't say which pull request"
    for query, on in ((DEQUEUE, q.get("in")), (NO_AUTO, q.get("auto") and not q.get("in"))):
        if on:
            ok, _, err = gh("api", "graphql", "-f", f"query={query}", "-f", f"id={q['id']}")
            if not ok:
                return False, err or "GitHub refused"
    return True, None


def queue_dropped_why(why):
    """#1174: the merge queue's reason for removing a pull request says its merge group (it with the
    base's newest commits) failed or conflicted: queued again as it is, it fails again."""
    w = (why or "").lower().replace(" ", "_")
    return "fail" in w or "conflict" in w


def queue_refusal(task, v):
    """#1174: why its pull request (v: pr_view's answer, or queue_entry's) must not go into GitHub's
    merge queue as it is, or None: it conflicts with its base, or the queue dropped it at this very
    commit because its merge group failed (queue_out, kept by the tick). Its agent merges the base
    in first; each try costs every pull request behind it in the queue a new merge group."""
    if (v.get("mergeable") or "") == "CONFLICTING":
        return "It conflicts with its base branch."
    out, head = task.get("queue_out") or {}, v.get("headRefOid") or v.get("head")
    if out.get("head") and out["head"] == head:
        return (f"GitHub's merge queue dropped it at this same commit ({out.get('why') or 'its merge group failed'}): "
                f"its agent merges {task.get('base') or 'main'} in and fixes what broke first.")
    return None


def drop_branch(s, task):
    """After GitHub's merge queue merged it: its branch on GitHub goes, as --delete-branch would have
    (gh refuses that flag on a queue, #801). Already gone (the repo deletes merged branches): fine."""
    if task.get("branch"):
        main = s.loc["folder"]
        # --no-verify: a pre-push hook (a typecheck) checks what is pushed; a deletion has nothing to
        # check, and the hook would hold the task list's lock for minutes (#1007).
        git(main, "push", "--quiet", "--no-verify", remote_of(main), "--delete", task["branch"])


def merge_method(repo):
    """The first enabled merge method in the repository's settings."""
    ok, out, err = gh("api", f"repos/{repo}")
    if not ok:
        raise Fail(f"Couldn't read merge methods for {repo}: {err or 'no answer'}")
    try:
        settings = json.loads(out)
    except ValueError:
        settings = None
    if not isinstance(settings, dict):
        raise Fail(f"Couldn't read merge methods for {repo}: unreadable answer")
    for key, flag in (("allow_squash_merge", "--squash"), ("allow_merge_commit", "--merge"),
                      ("allow_rebase_merge", "--rebase")):
        if settings.get(key) is True:
            return flag
    raise Fail(f"{repo} doesn't allow squash, merge commits or rebase. Enable a merge method in GitHub's repository settings.")


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


# #1558: workflows switched off on GitHub (disabled_manually, disabled_inactivity) never run: their files don't
# count. One lookup per repo, kept this long; None (couldn't ask) keeps every file, as before.
WORKFLOW_STATES_MS = 5 * 60000
_WORKFLOW_STATES = {}


def workflow_states(repo):
    """{".github/workflows/<file>": its state on GitHub ("active", "disabled_manually", ...)} for repo, or None."""
    if not repo:
        return None
    at, found = _WORKFLOW_STATES.get(repo, (0, None))
    if now() - at < WORKFLOW_STATES_MS:
        return found
    ok, out, _ = gh("api", "--paginate", f"repos/{repo}/actions/workflows?per_page=100", "--jq",
                    ".workflows[] | [.path, .state] | @tsv")
    found = dict(ln.split("\t", 1) for ln in out.splitlines() if "\t" in ln) if ok else None
    _WORKFLOW_STATES[repo] = (now(), found)
    return found


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
    states = workflow_states(pr.get("repo")) if ok else None
    for name in out.split() if ok else []:
        if states and states.get(f"{WORKFLOWS}/{name}", "active") != "active":
            continue
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
    if v.get("statusCheckRollup") or v.get("optional_checks"):
        return None  # optional ones it has don't count (merge_checks()): none are missing
    gone = now() - (since or 0)
    if v.get("checks_unknown"):
        # Checks that can't be read here (SHEP-179): a moment for GitHub, then pr_wait() decides.
        return "waiting" if gone < NO_CHECKS_MS else None
    blocked = v.get("mergeStateStatus") == "BLOCKED" and not needs_approval(v)
    if expect == "yes" or blocked:
        return "waiting" if gone < CHECKS_START_MS else "never"
    return "waiting" if gone < (MAYBE_CHECKS_MS if expect == "maybe" else NO_CHECKS_MS) else None


# #1151: GitHub says mergeable UNKNOWN for a moment each time the base branch moves: a head it already called
# MERGEABLE stays Ready through it, and a fresh one waits this long at most.
UNKNOWN_MERGEABLE_MS = 5 * 60000


def pr_wait(v, since, expect=None, mergeable_head=None):
    """SHEP-175: what a Ready task's pull request (v: pr_view's answer) still waits on before the
    person has anything to do, in a few words, or None once its checks are done and GitHub knows it
    can merge. A problem (pr_problem()) goes back to its agent: Working still, never Ready first.
    expect: expected_checks(); since: checks_since(); mergeable_head: the head GitHub last called MERGEABLE."""
    if v.get("state") != "OPEN":
        return None
    if pr_problem(v):
        return BACK_TO_AGENT
    if pr_pending(v):
        return CHECKS_RUNNING
    mergeable = (v.get("mergeable") or "").upper()
    if mergeable != "MERGEABLE":
        # #1049: anything short of a clear answer (UNKNOWN, or none: a conflict went back above) is asked again each
        # look and waits UNKNOWN_MERGEABLE_MS at most, never parks the task as Working for good.
        seen = mergeable_head and mergeable_head == v.get("headRefOid")
        if not (seen or now() - (since or 0) >= UNKNOWN_MERGEABLE_MS):
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


# ---- a branch that collides with its base (SHEP-320) ----------------------------------------
# Tasks run in parallel by default, also on the same files: a collision at merge is the price, so its fix
# round must be quick. Whoever tells the agent names the files and the base's commits (and the tasks that
# merged them) that collided, and the card says it in one line.

TASK_REF = re.compile(r"^([A-Z][A-Z0-9]*-\d+)\b")


def base_tip_ref(s, task, fetch=False):
    """The ref its base branch is newest at: the remote's (fetched first when fetch), else the local one;
    the local one when it is ahead (a repo merging here). None when neither is there."""
    main, base = s.loc["folder"], task.get("base") or "main"
    remote = remote_of(main)
    if fetch and git(main, "remote")[1].split():
        with released(s):
            git(main, "fetch", "-q", remote, base)
    there, here = f"refs/remotes/{remote}/{base}", f"refs/heads/{base}"
    has = [r for r in (there, here) if git(main, "rev-parse", "--verify", "--quiet", r)[0]]
    if there in has and here in has and git(main, "merge-base", "--is-ancestor", there, here)[0]:
        return here
    return has[0] if has else None


def merged_by(s, subject):
    """The task a base commit merged, by its title in quotes (SHEP-322: never its key): its subject's key in front (an
    older merge's "SHEP-4: ..."), else its pull request's number at the end ("Fix login (#945)"); None: no task's."""
    from .store import quoted
    m, pr = TASK_REF.match(subject), re.search(r"\(#(\d+)\)\s*$", subject)
    for t in s.data.get("tasks") or []:
        if (m and s.ref(t) == m.group(1)) or (pr and str((t.get("pr") or {}).get("number")) == pr.group(1)):
            return quoted(t.get("title"))
    return None


def collision(s, task, fetch=False):
    """Its branch's committed work against its base's newest: None when it merges cleanly (or can't be
    told: no branch, an old git), else {base, ref, files, commits: [[sha, subject]], by: [the merged tasks' titles, quoted]}."""
    main, br = s.loc["folder"], task.get("branch")
    ref = base_tip_ref(s, task, fetch) if br else None
    if not ref:
        return None
    ok, tip, _ = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")
    if not (ok and tip) or git(main, "merge-base", "--is-ancestor", ref, tip)[0]:
        return None
    r = run(["git", "-C", main, "merge-tree", "--write-tree", "--name-only", "--no-messages", ref, tip])
    if r.returncode != 1:  # 0: merges cleanly; anything else: this git can't say (merge-tree --write-tree is 2.38+)
        return None
    files = list(dict.fromkeys(f for f in r.stdout.splitlines()[1:] if f.strip()))
    if not files:
        return None
    mb = git(main, "merge-base", ref, tip)[1]
    log = git(main, "log", "--format=%h%x09%s", f"{mb}..{ref}", "--", *files[:50])[1] if mb else ""
    commits = [line.split("\t", 1) for line in log.splitlines() if "\t" in line][:10]
    by = list(dict.fromkeys(x for _, subject in commits if (x := merged_by(s, subject))))
    short = ref.replace("refs/remotes/", "").replace("refs/heads/", "")
    return {"base": task.get("base") or "main", "ref": short, "sha": git(main, "rev-parse", ref)[1], "files": files,
            "commits": commits, "by": by}


def collision_words(c):
    """What its agent is told: the files and the base's commits there, and how to fix it."""
    files = ", ".join(c["files"][:12]) + (f" and {len(c['files']) - 12} more" if len(c["files"]) > 12 else "")
    words = f"Files that collide with {c['ref']}: {files}."
    if c["commits"]:
        words += f" {c['base']}'s commits there since your branch started: " + "; ".join(f"{sha} {subject}" for sha, subject in c["commits"][:6]) + "."
    return words + (f" Fetch, rebase onto {c['ref']} (git fetch, then git rebase {c['ref']}), keep both sides' intent, run the "
                    "checks; your own branch may be force-pushed with lease, never the base.")


def collision_reason(c, told=True):
    """The card's one line (merge_failed, in red). told: its agent was asked to rebase (#1357: only then said)."""
    tail = ": its agent is rebasing" if told else ""
    if c and c["by"]:
        return f"Conflicts with {c['base']} after {', '.join(c['by'][:3])} merged" + tail
    if c:
        return f"Conflicts with {c['base']} in {c['files'][0]}" + (f" and {len(c['files']) - 1} more" if len(c["files"]) > 1 else "") + tail
    return None


def base_moved(s, task):
    """SHEP-320: it merged into its base: the others on that base look at once whether they now collide with it,
    rather than at their own merge. A Ready one's pull request is read at the next tick (GitHub says whether it
    conflicts, and pr_news tells its agent); a Working one is checked here (tick.heads_up)."""
    base = task.get("base") or "main"
    for o in (getattr(s, "data", None) or {}).get("tasks") or []:
        if o is task or o.get("mode") != "worktree" or (o.get("base") or "main") != base:
            continue
        if o["state"] == "ready" and o.get("pr"):
            o["pr"]["checked"] = 0
        elif o["state"] == "running" and o.get("branch"):
            o["base_moved"] = now()


def mid_turn(s, task):
    """Its agent, or a helper of its own, is mid-turn (working, or asking): its folder stays until the
    turn ends (SHEP-188). Even when the merge came from Herdr itself (even_if_busy)."""
    key = s.key(task)
    return bool(mid_turn_agents(live_agents(key) + live_helpers(key), detail))


def finish(s, task, even_if_busy=False, quiet=False):
    """Done, its branch merged: removes the worktree and branch when nothing is left uncommitted
    there and no agent still works in it: none mid-turn (mid_turn()), and (unless the person merged
    from Herdr) none running at all. Else tidy_done() removes them once its agents ended."""
    task["state"], task["done_at"] = "done", now()
    for k in ("attention", "merge_requested", "queue", "queued_at", "merge_queued", "kept_open", "base_hold", "queue_fail",
              "queue_out", "queue_refused", "dequeued", "merge_failed", "merge_failed_at", "merge_asked", "stopped_by", "stopped_why", "stopped_at",
              "stopped_turns"):
        task.pop(k, None)
    s.dirty = True
    if task.get("merged"):
        base_moved(s, task)
    # The space's "When a task is accepted" command, in the background (after_accept.py): never waited on.
    # quiet: a schedule's run that ended with nothing to review (ready --nothing / --told): nothing was accepted.
    if not quiet:
        after_accept(s, task)
    if not task.get("worktree") or mid_turn(s, task) or (not even_if_busy and any(agent_running(k) for k in live_agents(s.key(task)))):
        return
    remove_worktree(s, task)


def remove_worktree(s, task):
    """A finished task's worktree removed when nothing is uncommitted there, then its branch. True
    once the worktree is gone. #1127: what still runs there (a dev server outliving its task) is stopped
    first, and the folder must really be gone: a server writing on made git drop its record while files
    stayed. A folder left over that way is removed on a later try; one that won't go is noted
    (worktree_left) for the health check to say why."""
    from .launch import registered_worktree
    wt, br, main = task.get("worktree"), task.get("branch"), s.loc["folder"]
    if os.path.isdir(wt):
        if os.path.realpath(wt) == os.path.realpath(main):
            return False
        reg = registered_worktree(main, wt)
        if reg:
            ok, out, _ = git(wt, "status", "--porcelain", "--untracked-files=no")
            if not ok or out:
                return False
        elif not (task.get("worktree_removing") or removal_leftover(wt)):
            return False  # a folder git doesn't list, not one of our own removals: never ours to delete
        task["worktree_removing"] = True
        s.dirty = True
        stopped = stop_in(wt)
        if reg:
            git(main, "worktree", "remove", "--force", wt)
        for _ in range(2):
            if not os.path.isdir(wt):
                break
            shutil.rmtree(wt, ignore_errors=True)
            if os.path.isdir(wt):
                stopped += stop_in(wt)
        git(main, "worktree", "prune")
        if os.path.isdir(wt):
            left = procs_in(wt)
            task["worktree_left"] = {"at": now(), "running": [f"{n} (pid {p})" for p, n in left][:5],
                                     "stopped": stopped[:5]}
            return False
        task.pop("worktree_removing", None)
        task.pop("worktree_left", None)
        if stopped:
            task["worktree_stopped"] = stopped[:5]
    if br:
        git(main, "branch", "-D", br)
    return True


def removal_leftover(wt):
    """Whether wt looks like what a removal left (#1127): no .git there, or one naming a worktree git has dropped."""
    dot = os.path.join(wt, ".git")
    if not os.path.lexists(dot):
        return True
    if os.path.isfile(dot):
        try:
            with open(dot) as f:
                m = re.match(r"gitdir:\s*(.+)", f.read().strip())
        except OSError:
            return False
        return bool(m) and not os.path.isdir(m.group(1))
    return False


# ---- what still runs in a worktree (#1127) ---------------------------------------------------
# A task's dev server (next dev, vite) outlives its agent and keeps writing into the worktree, so its removal
# left part of the folder behind, and the server holding GBs ran on for hours. Before a removal everything whose
# folder is inside it is stopped, but never a terminal's own program (its shell or agent: a child of
# herdr-core), an agent CLI, herdr-task itself or what started it.
KEEP_NAMES = re.compile(r"(?:herdr|hc$|claude$|codex$|pi$|opencode$)")
STOP_WAIT = 5.0


def _cwds():
    """[(pid, parent pid, name, folder)] of every process whose folder can be read: /proc on Linux, else lsof
    and ps (macOS)."""
    out = []
    if os.path.isdir("/proc/self"):
        for n in os.listdir("/proc"):
            if not n.isdigit():
                continue
            try:
                cwd = os.readlink(f"/proc/{n}/cwd")
                with open(f"/proc/{n}/stat") as f:
                    st = f.read()
            except OSError:
                continue
            name = st[st.index("(") + 1:st.rindex(")")]
            out.append((int(n), int(st[st.rindex(")") + 2:].split()[1]), name, cwd))
        return out
    if not shutil.which("lsof"):
        return out
    parent = {}
    for line in run(["ps", "-axo", "pid=,ppid=,comm="]).stdout.splitlines():
        w = line.split(None, 2)
        if len(w) == 3 and w[0].isdigit() and w[1].isdigit():
            parent[int(w[0])] = (int(w[1]), os.path.basename(w[2]))
    pid = None
    for line in run(["lsof", "-w", "-d", "cwd", "-Fpn"]).stdout.splitlines():
        if line.startswith("p") and line[1:].isdigit():
            pid = int(line[1:])
        elif line.startswith("n") and pid in parent:
            out.append((pid, parent[pid][0], parent[pid][1], line[1:]))
    return out


def procs_in(folder, table=None):
    """[(pid, name)] of what runs with its folder inside `folder` and may be stopped (see KEEP_NAMES)."""
    table = _cwds() if table is None else table
    real = os.path.realpath(folder) + os.sep
    by = {p: (pp, n) for p, pp, n, _ in table}
    mine, p = set(), os.getpid()
    while p and p not in mine:
        mine.add(p)
        p = by.get(p, (0,))[0]
    out = []
    for pid, ppid, name, cwd in table:
        if not (os.path.realpath(cwd) + os.sep).startswith(real) or pid in mine:
            continue
        if KEEP_NAMES.match(name) or by.get(ppid, (0, ""))[1].startswith("herdr-core"):
            continue
        out.append((pid, name))
    return out


def stop_in(folder):
    """Stops what runs in folder (procs_in): a TERM, then a KILL for what is still there after STOP_WAIT. The
    stopped as ["name (pid N)"]."""
    import signal
    import time
    found = procs_in(folder)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, _ in found:
            try:
                os.kill(pid, sig)
            except OSError:
                pass
        end = time.time() + (STOP_WAIT if sig == signal.SIGTERM else 2)
        while time.time() < end and any(_alive(p) for p, _ in found):
            time.sleep(0.1)
        if not any(_alive(p) for p, _ in found):
            break
    return [f"{n} (pid {p})" for p, n in found]


def _alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"  # a zombie is gone, only not yet reaped
    except OSError:
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
