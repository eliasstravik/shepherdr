"""#1403: stacked tasks. A task whose base is another task's branch (--base <its branch>) moves onto that branch's own
base once it merges (squash too, its branch deleted on the remote too): its record, its pull request's base, and its
branch, rebased with only its own commits (git rebase --onto: a squash merge left the base's commits out of the new
base, so they are never replayed). edit --base on a started task moves it the same way. What a rebase can't do by
itself (a conflict, uncommitted work, an agent mid-turn in its folder) the caller hands to the task's agent."""

import json
import os
import shlex

from .base import git, now
from .github import base_tip_ref, gh, github, pr_push, released, remote_of
from .launch import current_base, git_quick

GH_EVERY = 5 * 60000  # how often a stacked task's base branch is looked up on GitHub (the tick)


def parent(s, t):
    """The task here whose branch is t's base, or None."""
    base = t.get("base")
    return next((o for o in s.data.get("tasks") or [] if o is not t and base and o.get("branch") == base
                 and o.get("mode") == "worktree"), None) if base else None


def stacked(t):
    """t works on a branch of its own choosing (--base), not its repo's base branch: it may have to move."""
    return bool(t.get("mode") == "worktree" and t.get("base") and t.get("base_set") and t.get("base_by") != "space"
                and t.get("state") != "done" and not (t.get("pr") or {}).get("from_base"))


def merged_base(s, t, ask_github=True):
    """Where t's base branch went once it merged into another: {into, tip (its last commit, when known), how}, else
    None (not merged, still open, or it went on with new work). Its task here says it first (merged by Herdr, locally
    too); else GitHub's newest pull request from it, merged, its branch deleted on the remote (a long-lived branch,
    a develop whose release pull request merged, stays a base)."""
    base = t.get("base")
    if not base:
        return None
    p = parent(s, t)
    if p:
        if p.get("state") != "done" or not p.get("merged"):
            return None
        into = p.get("base") or current_base(s.loc["folder"])
        if not into or into == base:
            return None
        return {"into": into, "tip": p.get("own") or p.get("head"), "how": f"{s.name(p)} merged"}
    repo = github(s) if ask_github else None
    if not repo:
        return None
    with released(s):  # #1490: never the task list held while GitHub answers
        ok, out, _ = gh("pr", "list", "--repo", repo, "--head", base, "--state", "all", "--limit", "10",
                        "--json", "number,state,isCrossRepository,baseRefName,headRefOid")
    try:
        mine = [x for x in json.loads(out) if not x.get("isCrossRepository")] if ok and out else []
    except (ValueError, TypeError, AttributeError):
        return None
    if any(x.get("state") == "OPEN" for x in mine):
        return None
    done = next((x for x in mine if x.get("state") == "MERGED"), None)
    if not done or not done.get("baseRefName") or done["baseRefName"] == base:
        return None
    main = s.loc["folder"]
    with released(s):
        ok, there, _ = git_quick(main, "ls-remote", "--heads", remote_of(main), f"refs/heads/{base}", timeout=10)
    if not ok or there:
        return None  # still there (a develop its release pull request merged from), or the remote couldn't say
    return {"into": done["baseRefName"], "tip": done.get("headRefOid"),
            "how": f"pull request #{done['number']}"}


def fork_point(s, t, tip, old):
    """The last commit t's branch took from its old base: from there on its commits are its own."""
    main, br = s.loc["folder"], t.get("branch")
    for ref in (tip, f"refs/heads/{old}" if old else None, f"refs/remotes/{remote_of(main)}/{old}" if old else None):
        if ref and git(main, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")[0]:
            ok, mb, _ = git(main, "merge-base", br, ref)
            if ok and mb:
                return mb
    return t.get("start")


def command(target, fork):
    return f"git rebase --onto {shlex.quote(target)} {fork}" if fork else f"git rebase {shlex.quote(target)}"


def move(s, t, into, tip=None, rebase=True):
    """Moves t onto base `into`: its record and its pull request's base, then (a started one, rebase allowed, nothing
    uncommitted) its branch, rebased with only its own commits and pushed when its pull request is open. Returns
    {from, to, fork, command, rebased (its new tip) | conflict (files) | todo (why it wasn't rebased), pr_error}."""
    main, old = s.loc["folder"], t.get("base")
    wt = t.get("worktree") if t.get("mode") == "worktree" else None
    started = bool(wt and t.get("branch"))
    fork = fork_point(s, t, tip, old) if started else None
    t.pop("base_by", None)
    if started:
        t["base"] = into
        if into == current_base(main):
            t.pop("base_set", None)
        else:
            t["base_set"] = True
    elif into == current_base(main):
        t.pop("base", None)
        t.pop("base_set", None)
    else:
        t["base"], t["base_set"] = into, True
    t["base_was"] = {"base": old, "at": now(), **({"fork": fork} if fork else {})}
    s.dirty = True
    res = {"from": old, "to": into, "fork": fork}
    pr = t.get("pr") or t.get("pr_seen") or {}
    if pr.get("number") and pr.get("repo") and not pr.get("closed") and not t.get("merged"):
        ok, _, err = gh("pr", "edit", str(pr["number"]), "--repo", pr["repo"], "--base", into)
        if not ok:
            res["pr_error"] = err or "gh pr edit failed"
    if not started or not os.path.isdir(wt):
        return res
    ref = base_tip_ref(s, t, fetch=True) or into
    target = ref.replace("refs/remotes/", "").replace("refs/heads/", "")
    res["command"] = command(target, fork)
    if not rebase:
        res["todo"] = "its agent is at work there"
        return res
    if git(wt, "status", "--porcelain", "--untracked-files=no")[1]:
        res["todo"] = "it has uncommitted changes"
        return res
    if any(os.path.isdir(os.path.join(wt, git(wt, "rev-parse", "--git-path", d)[1] or d)) for d in ("rebase-merge", "rebase-apply")):
        res["todo"] = "a rebase is already under way there"
        return res
    before = git(wt, "rev-parse", "HEAD")[1]
    with released(s):
        ok, _, err = git(wt, "rebase", "--onto", ref, fork) if fork else git(wt, "rebase", ref)
    if not ok:
        files = [f for f in git(wt, "diff", "--name-only", "--diff-filter=U")[1].splitlines() if f.strip()]
        git(wt, "rebase", "--abort")
        res["conflict"] = files or [err.splitlines()[-1] if err else "git rebase failed"]
        return res
    head = git(wt, "rev-parse", "HEAD")[1]
    res["rebased"] = head
    t["start"] = git(wt, "merge-base", "HEAD", ref)[1] or t.get("start")
    if t.get("head") == before:
        t["head"] = head  # where it said ready: the same work, on its new base
    if head != before and pr.get("number") and pr.get("repo") and not pr.get("branch") and t.get("pr") is pr:
        try:
            pr_push(s, t, pr["repo"])
        except Exception as e:
            res["pr_error"] = str(e)
    return res


def lead(s, t, res, how=None):
    """What happened, in a few words: its base merged (how), or someone changed it."""
    pr = ", and its pull request was retargeted" if (t.get("pr") or t.get("pr_seen") or {}).get("number") else ""
    if how:
        return f"your base branch {res['from']} merged into {res['to']} ({how}), so {s.name(t)} now merges into {res['to']}{pr}"
    return f"{s.name(t)}'s base changed from {res['from']} to {res['to']}{pr}"


def words(s, t, res, how=None):
    """What its agent is told about the move: what Herdr did, or the rebase it left to do."""
    wt, br = t.get("worktree"), t.get("branch")
    if res.get("rebased"):
        return (f"Heads-up from Herdr: {lead(s, t, res, how)}. Herdr rebased your branch {br} onto {res['to']} (only your "
                "own commits), so look at `git log` before you go on.")
    why = (f"conflicts in {', '.join(res['conflict'][:8])}" if res.get("conflict") else res.get("todo") or "")
    return (f"Heads-up from Herdr: {lead(s, t, res, how)}. Herdr couldn't move your branch {br} by itself ({why}). "
            f"In {wt}: commit or finish what you're on, then "
            f"`git fetch` and `{res['command']}` (it replays only your own commits), resolve any conflicts keeping both "
            "sides' intent, run the checks, then run ready again. Your own branch may be force-pushed with lease, never the base.")


def due(t):
    """The tick looks up this stacked task's base on GitHub now (its task here is looked at every pass)."""
    return now() - (t.get("base_looked") or 0) >= GH_EVERY
