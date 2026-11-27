"""A task's proof and what its Accept card shows (as Shepherdr's merge card): the proof artifact
its agent made, and the evidence from Git, GitHub and that artifact, never the agent's own words
(only its summary)."""

import json
import os
import re

from .base import Fail, git, WHERE
from .store import folder_store_path, read_list
from .github import BAD, CANT_READ_CHECKS, PENDING, pr_view

ARTIFACTS = WHERE.path("artifacts")
# Files named on the card, and commits.
FEW = 3
# Its Markdown documents shown in full on the card (SHEP-273, #1150): at most this many, each cut at this many characters.
DOCS = 5
DOC_MAX = 60000
MARKDOWN = re.compile(r"\.(md|markdown)$", re.I)


def artifacts_of(folder):
    """This folder's artifacts, newest first (herdr-artifact's list for it; the same slug rule)."""
    d = read_list(folder_store_path(folder, ARTIFACTS)[1])
    return (d.get("artifacts") or []) if isinstance(d, dict) and d.get("folder") in (None, folder) else []


def artifact_anywhere(ref):
    """An artifact by id from any folder's list on this machine, or None: a proof an older herdr-artifact filed under
    the folder it was published from (a scratch folder), not its task's."""
    for f in sorted(os.listdir(ARTIFACTS)) if os.path.isdir(ARTIFACTS) else []:
        if not f.endswith(".json"):
            continue
        try:
            with open(os.path.join(ARTIFACTS, f)) as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        for a in (d.get("artifacts") or []) if isinstance(d, dict) else []:
            if isinstance(a, dict) and a.get("id") == ref:
                return a
    return None


def find_proof(s, t, given=None):
    """The task's proof artifact, {id, title}: the one given (ready --proof <id>), else, of the pages it
    published since it started, the newest marked as its proof (herdr-artifact publish --proof), else the
    newest titled as one ("HAT-2: ... · Proof"). None: it made none. From 3.2 an artifact is one kind only,
    a page (its files include index.html), so any of them can be a proof."""
    arts = artifacts_of(s.loc["folder"])
    if given:
        a = next((a for a in arts if a.get("id") == given.strip()), None) or artifact_anywhere(given.strip())
        if not a:
            raise Fail(f"No artifact {given} on this machine (herdr-artifact list --all shows them).")
    else:
        ref, since = s.ref(t).upper(), t.get("started") or 0
        mine = [a for a in arts if (a.get("task") or "").upper() == ref and (a.get("at") or 0) >= since
                and "index.html" in (a.get("files") or [])]
        a = next((a for a in mine if a.get("proof")), None) or \
            next((a for a in mine if re.search(r"\bproof\b", a.get("title") or "", re.I)), None)
    if not a:
        return None
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


def name_status(out, seen):
    """git --name-status lines into seen {path: "A" | "M"}, oldest first (a file added, then changed, stays new);
    a deleted one goes (it may come back, as new)."""
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        kind, path = parts[0][:1], parts[1]
        if kind == "D":
            seen.pop(path, None)
        elif kind in ("A", "M"):
            seen.setdefault(path, kind)


def docs_of(main, rev, changed, only):
    """Its new and changed Markdown files as they are at rev, for the card to render (SHEP-273, #1150):
    {count, only (every file it changed is Markdown: a plan's, an email draft's task), list: [{path, new, text,
    cut}]}, new ones first; None when it changed none. changed is {path: "A" | "M"}, any file."""
    paths = sorted((p for p in changed if MARKDOWN.search(p)), key=lambda p: (changed[p] != "A", p))
    if not paths:
        return None
    out = []
    for p in paths[:DOCS]:
        try:
            ok, text, _ = git(main, "show", f"{rev}:{p}")
        except (UnicodeDecodeError, ValueError):
            ok, text = False, ""
        if not ok:
            continue
        cut = len(text) > DOC_MAX
        if cut:
            text = text[:DOC_MAX]
            text = text[:text.rfind("\n")] if "\n" in text else text
        out.append({"path": p, "new": changed[p] == "A", "text": text, "cut": cut})
    return {"count": len(paths), "only": only, "list": out} if out else None


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
    list} or None, docs (its Markdown files to read: docs_of) or None, git (False: not a git folder), scope, checks,
    proof, artifacts (its others), merges (Accept merges its branch first: an open pull request or commits past its
    base; the button says so)}."""
    main, out = s.loc["folder"], {"summary": t.get("summary"), "details": t.get("details"), "proof": t.get("proof") or find_proof(s, t)}
    out["artifacts"] = task_artifacts(s, t, out["proof"])
    commits, files, changed, rev = [], {}, {}, None
    fmt = "--format=%h%x09%s"
    if s.loc["kind"] != "repo":
        out.update(git=False, commits={"count": 0, "list": []}, diff=None, checks=checks_of(t), merges=False)
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
            ok, names, _ = git(main, "diff", "--name-status", "--no-renames", f"{since}...{tip}")
            if ok:
                name_status(names, changed)
            rev = tip
        out["scope"] = f"{t['branch']} into {base}"
    else:
        # In the folder itself: the commits made here while it worked (other work committed here
        # meanwhile counts too, so the card says "while it worked").
        # not ready yet: no end (a missing ready_at once read as "until 60 s after 1970": a flaky empty card)
        start, end = (t.get("started") or 0) // 1000, (t["ready_at"] // 1000 + 60) if t.get("ready_at") else None
        # git reads --since=@0 as now (nothing): no start known, no lower bound
        rng = ([f"--since=@{start}"] if start else []) + ([f"--until=@{end}"] if end else [])
        ok, log, _ = git(main, "log", fmt, *rng)
        commits = [line.split("\t", 1) for line in log.splitlines() if "\t" in line] if ok else []
        ok, diff, _ = git(main, "log", "--numstat", "--format=", *rng)
        if ok:
            numstat(diff, files)
        else:
            files = None
        ok, names, _ = git(main, "log", "--reverse", "--name-status", "--no-renames", "--format=", *rng)
        if ok:
            name_status(names, changed)
        rev = "HEAD"
        out["scope"] = "committed here while it worked"
    out["git"] = True
    out["commits"] = {"count": len(commits), "list": [{"sha": c[0], "subject": c[1]} for c in commits[:FEW]]}
    out["diff"] = None if files is None else {
        "files": len(files), "added": sum(v[0] for v in files.values()), "removed": sum(v[1] for v in files.values()),
        "list": [{"path": p, "added": v[0], "removed": v[1]} for p, v in sorted(files.items(), key=lambda x: -(x[1][0] + x[1][1]))[:FEW]]}
    out["docs"] = docs_of(main, rev, changed, bool(changed) and all(MARKDOWN.search(p) for p in changed)) if rev else None
    out["checks"] = checks_of(t)
    # What Accept does (cmd_accept): a worktree task's branch with work of its own is merged first; else only done.
    out["merges"] = bool(t.get("mode") == "worktree" and t.get("branch") and (t.get("pr") or commits)
                         and not (t.get("pr") or {}).get("closed"))  # #1106: closed on GitHub, Accept merges nothing
    return out
