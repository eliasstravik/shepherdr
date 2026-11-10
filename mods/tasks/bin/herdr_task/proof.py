"""A task's proof and what its Accept card shows (as Shepherdr's merge card): the proof artifact
its agent made, and the evidence from Git, GitHub and that artifact, never the agent's own words
(only its summary)."""

import hashlib
import json
import os
import re

from .base import Fail, HOME, git, WHERE
from .github import BAD, CANT_READ_CHECKS, PENDING, pr_view

ARTIFACTS = WHERE.path("artifacts")
# Files named on the card, and commits.
FEW = 3


def artifacts_of(folder):
    """This folder's artifacts, newest first (herdr-artifact's list for it; the same slug rule)."""
    rel = os.path.relpath(folder, HOME) if folder == HOME or folder.startswith(HOME + "/") else folder
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", "home" if rel == "." else rel.strip("/")).strip("-") or "root"
    for name in (slug, f"{slug}-{hashlib.sha1(folder.encode()).hexdigest()[:6]}"):
        try:
            with open(os.path.join(ARTIFACTS, name + ".json")) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if d.get("folder") in (None, folder):
            return d.get("artifacts") or []
    return []


def find_proof(s, t, given=None):
    """The task's proof artifact, {id, title}: the one given (ready --proof <id>), else its newest
    artifact titled as a proof ("HAT-2: ... · Proof") since it started. None: it made none. A proof
    is always a recipe (the person accepts from their phone too): a custom panel is refused."""
    arts = artifacts_of(s.loc["folder"])
    if given:
        a = next((a for a in arts if a.get("id") == given.strip()), None)
        if not a:
            raise Fail(f"No artifact {given} in {s.loc['folder']} (herdr-artifact list shows them).")
    else:
        ref, since = s.ref(t).upper(), t.get("started") or 0
        mine = [a for a in arts if (a.get("task") or "").upper() == ref and re.search(r"\bproof\b", a.get("title") or "", re.I)
                and (a.get("at") or 0) >= since]
        a = mine[0] if mine else None
    if not a:
        return None
    files = a.get("files") or []
    if "main.js" in files or "recipe.json" not in files:
        raise Fail(f"Your proof {a['id']} is a custom panel, which the person can't open on their phone. Make it a recipe "
                   f"(recipe.json; `herdr-artifact guide`, A task's proof), `herdr-artifact update {a['id']} <dir>`, then run ready again.")
    return {"id": a["id"], "title": a.get("title") or a["id"]}


def task_artifacts(s, t, proof=None):
    """The other artifacts its agent published for it since it started (a research task's report),
    newest first, [{id, title}]: linked on its Accept card beside its proof (SHEP-96)."""
    ref, since, skip = s.ref(t).upper(), t.get("started") or 0, (proof or {}).get("id")
    return [{"id": a["id"], "title": a.get("title") or a["id"]} for a in artifacts_of(s.loc["folder"])
            if a.get("id") and a["id"] != skip and (a.get("task") or "").upper() == ref and (a.get("at") or 0) >= since]


def numstat(out, files):
    """git --numstat lines added into files {path: [added, removed]} (binary files count 0)."""
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            a, r, path = parts
            cur = files.setdefault(path, [0, 0])
            cur[0] += int(a) if a.isdigit() else 0
            cur[1] += int(r) if r.isdigit() else 0


def checks_of(t):
    """GitHub's checks on its pull request, in words: {state, text}; failed and running say so,
    so a green one is never assumed."""
    if not t.get("pr"):
        return {"state": "none", "text": "No GitHub checks here"}
    v = pr_view(t)
    if not v:
        return {"state": "unknown", "text": "Couldn't ask GitHub"}
    rows = v.get("statusCheckRollup") or []
    word = lambda c: (c.get("conclusion") or c.get("state") or "").upper()
    bad = [c.get("name") or c.get("context") or "a check" for c in rows if word(c) in BAD]
    running = [c for c in rows if (c.get("status") or c.get("state") or "").upper() in PENDING and not c.get("conclusion")]
    if bad:
        return {"state": "failed", "text": f"{len(bad)} failing: " + ", ".join(bad[:FEW])}
    if running:
        return {"state": "running", "text": f"{len(running)} of {len(rows)} still running"}
    if v.get("checks_unknown"):
        # SHEP-179: this machine's GitHub token can't read its checks: never said to pass
        return {"state": "unknown", "text": CANT_READ_CHECKS}
    if not rows:
        return {"state": "none", "text": "No checks on its pull request"}
    return {"state": "passed", "text": f"All {len(rows)} passed"}


def evidence(s, t):
    """What an Accept card shows: {summary, details, commits: {count, list}, diff: {files, added, removed,
    list} or None, git (False: not a git folder), scope, checks, proof, artifacts (its others)}."""
    main, out = s.loc["folder"], {"summary": t.get("summary"), "details": t.get("details"), "proof": t.get("proof") or find_proof(s, t)}
    out["artifacts"] = task_artifacts(s, t, out["proof"])
    commits, files = [], {}
    fmt = "--format=%h%x09%s"
    if s.loc["kind"] != "repo":
        out.update(git=False, commits={"count": 0, "list": []}, diff=None, checks=checks_of(t))
        return out
    if t.get("mode") == "worktree" and t.get("branch"):
        # Its branch past where it meets its base: exactly what Accept merges.
        ok, tip, _ = git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{t['branch']}")
        tip = tip if ok and tip else t.get("head")
        base = t.get("base") or "main"
        since = base if git(main, "rev-parse", "--verify", "--quiet", base)[0] else t.get("start")
        if tip and since:
            ok, log, _ = git(main, "log", fmt, f"{since}..{tip}")
            commits = [line.split("\t", 1) for line in log.splitlines() if "\t" in line] if ok else []
            ok, diff, _ = git(main, "diff", "--numstat", f"{since}...{tip}")
            if ok:
                numstat(diff, files)
            else:
                files = None
        out["scope"] = f"{t['branch']} into {base}"
    else:
        # In the folder itself: the commits made here while it worked (other work committed here
        # meanwhile counts too, so the card says "while it worked").
        start, end = (t.get("started") or 0) // 1000, ((t.get("ready_at") or 0) // 1000 + 60) or None
        rng = [f"--since=@{start}"] + ([f"--until=@{end}"] if end else [])
        ok, log, _ = git(main, "log", fmt, *rng)
        commits = [line.split("\t", 1) for line in log.splitlines() if "\t" in line] if ok else []
        ok, diff, _ = git(main, "log", "--numstat", "--format=", *rng)
        if ok:
            numstat(diff, files)
        else:
            files = None
        out["scope"] = "committed here while it worked"
    out["git"] = True
    out["commits"] = {"count": len(commits), "list": [{"sha": c[0], "subject": c[1]} for c in commits[:FEW]]}
    out["diff"] = None if files is None else {
        "files": len(files), "added": sum(v[0] for v in files.values()), "removed": sum(v[1] for v in files.values()),
        "list": [{"path": p, "added": v[0], "removed": v[1]} for p, v in sorted(files.items(), key=lambda x: -(x[1][0] + x[1][1]))[:FEW]]}
    out["checks"] = checks_of(t)
    return out
