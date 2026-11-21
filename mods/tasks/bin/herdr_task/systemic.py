"""SHEP-270 (#1195, #1174): one failure behind many tasks. When the base branch itself is red, or one
check fails GitHub merge-queue groups for several pull requests, the space's Assistant hears it once
(news: systemic) with the check and the tasks it holds; their fix requests (a failing-check news to
the agent, a Needs you) wait until the base is green again. A pull request whose own checks pass and
that the queue dropped only because its group failed goes back in the queue once."""

import json
import re

from .base import now
from .github import BAD, check_rows, gh, pr_problem, queue_entry, queue_merge
from .ghnews import attr, base_history, esc, RED, verdict, when
from .launch import coordinator_in
from .news import news_send


LOOK_EVERY = 120000          # how often a held base branch is read again (ms)
GROUP_KEEP_MS = 3 * 3600000  # a failed merge group counts towards "several" this long
HOLD_MS = 6 * 3600000        # a hold lasts at most this long: then its fix requests go anyway
QUEUE_REMOVED = "GitHub's merge queue removed it"  # tick's word for it (Needs you)
SETTLE_MS = 90000            # the news waits this long after the first hold, so more tasks join it


def failing(checks):
    """The names of a pull request's (or a commit's) failed checks; a cancelled one isn't failed."""
    return sorted({c.get("name") or c.get("context") or "check" for c in checks or []
                   if (c.get("conclusion") or c.get("state") or "").upper() in BAD - {"CANCELLED"}})


def place(s, base):
    return s.data.setdefault("systemic", {}).setdefault(base, {})


def look(s, repo, base):
    """The base branch on GitHub, read at most every LOOK_EVERY: {"head": newest commit, "red": the newest
    finished commit when its push runs failed, else None, "checks": its failed checks}; None when GitHub
    didn't answer."""
    p = place(s, base)
    lk = p.get("look")
    if lk and now() - (lk.get("at") or 0) < LOOK_EVERY:
        return lk
    got = base_history(repo, base)
    if not got:
        return lk
    history, runs = got
    lk = {"at": now(), "head": history[0] if history else None, "red": None, "checks": []}
    for sha in history:
        state, failed = verdict(runs, sha)
        if state == "pending":
            continue
        if state == "fail":
            rows, _ = check_rows(repo, sha)
            lk.update(red=sha, checks=failing(rows) or sorted({r.get("workflowName") or "a run" for r in failed}),
                      url=failed[0].get("url"))
        break
    p["look"] = lk
    s.dirty = True
    return lk


def covered(s, t, names):
    """The hold that explains every one of these failed checks of task t, or None: a hold already on its
    base for them, or its base red on GitHub with them failing there too. Holds t too (hold())."""
    pr = t.get("pr") or {}
    base = t.get("base") or "main"
    if not names or not pr.get("repo"):
        return None
    ep = place(s, base).get("hold")
    if not (ep and set(names) <= set(ep["checks"])):
        lk = look(s, pr["repo"], base)
        if not (lk and lk.get("red") and set(names) <= set(lk.get("checks") or [])):
            return None
        ep = start(s, base, pr["repo"], lk["checks"], lk, red=lk["red"])
    hold(s, t, ep)
    return ep


def start(s, base, repo, checks, lk, red=None, prs=None):
    """The base's hold, begun now or widened by these checks."""
    p = place(s, base)
    ep = p.get("hold")
    if not ep:
        ep = p["hold"] = {"repo": repo, "since": now(), "head": (lk or {}).get("head"), "checks": [], "tasks": [], "told": []}
    ep["checks"] = sorted(set(ep["checks"]) | set(checks))
    if red:
        ep["red"], ep["url"] = red, (lk or {}).get("url")
    if prs:
        ep["prs"] = sorted(set(ep.get("prs") or []) | set(prs))
    s.dirty = True
    return ep


def hold(s, t, ep, dropped=None):
    """Task t's fix requests wait for its base: no Needs you for these checks, no failing-check news.
    dropped: the commit at which the merge queue dropped it (queued again once the base is green)."""
    h = t.get("base_hold") or {}
    t["base_hold"] = {"since": h.get("since") or now(), **({"dropped": dropped or h["dropped"]} if dropped or h.get("dropped") else {})}
    if t["id"] not in ep["tasks"]:
        ep["tasks"].append(t["id"])
    if (t.get("attention") or "").startswith(("Checks failing", QUEUE_REMOVED)):
        t.pop("attention", None)
        t.pop("attention_at", None)
    s.dirty = True


GROUP_PR = re.compile(r"\(#(\d+)\)\s*$|^Merge pull request #(\d+)")


def group_of(repo, base, n, since):
    """The newest failed merge-queue group that held pull request n, run since `since` (ms):
    {"sha", "checks": its failed checks, "prs": the pull requests in it}, or None."""
    ok, out, _ = gh("run", "list", "--repo", repo, "--event", "merge_group", "--limit", "50",
                    "--json", "headBranch,headSha,status,conclusion,workflowName,createdAt")
    try:
        runs = json.loads(out) if ok else []
    except ValueError:
        return None
    shas = []
    for r in sorted(runs if isinstance(runs, list) else [], key=lambda r: r.get("createdAt") or "", reverse=True):
        if (r.get("headBranch") or "").startswith(f"gh-readonly-queue/{base}/") and r.get("conclusion") in RED \
                and (when(r.get("createdAt")) or 0) >= since - 60000 and r.get("headSha") not in shas:
            shas.append(r["headSha"])
    for sha in shas[:5]:
        ok, out, _ = gh("api", f"repos/{repo}/compare/{base}...{sha}", "--jq", "[.commits[].commit.message | split(\"\\n\")[0]]")
        try:
            heads = json.loads(out) if ok else []
        except ValueError:
            heads = []
        prs = sorted({int(a or b) for m in heads if isinstance(m, str) for a, b in GROUP_PR.findall(m)})
        if n in prs:
            rows, _ = check_rows(repo, sha)
            return {"sha": sha, "checks": failing(rows), "prs": prs}
    return None


def dropped_too(repo, prs):
    """Which of these pull requests are open and out of the merge queue (it dropped them too)."""
    if not prs:
        return []
    owner, _, name = repo.partition("/")
    q = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { " + " ".join(
        f"p{n}: pullRequest(number: {n}) {{ state isInMergeQueue autoMergeRequest {{ enabledAt }} }}" for n in prs) + " } }"
    ok, out, _ = gh("api", "graphql", "-f", f"query={q}", "-f", f"owner={owner}", "-f", f"name={name}")
    try:
        got = json.loads(out)["data"]["repository"] if ok else {}
    except (ValueError, TypeError, KeyError):
        return []
    return [n for n in prs if isinstance((got or {}).get(f"p{n}"), dict) and got[f"p{n}"].get("state") == "OPEN"
            and not got[f"p{n}"].get("isInMergeQueue") and not got[f"p{n}"].get("autoMergeRequest")]


def dropped(s, t, v, since, report):
    """The merge queue dropped task t's pull request for failed checks. True when that is handled here:
    queued again once (its own checks pass, and its group held another pull request the queue dropped
    too: that one failed it), or held (the same check fails its base, or fails groups of other pull
    requests too). False: its own failure, Needs you as before. since: when it was queued (ms)."""
    pr, head = t["pr"], v.get("headRefOid")
    base = t.get("base") or "main"
    g = group_of(pr["repo"], base, pr["number"], since or 0)
    if not g:
        # Its group can't be found: its base red on GitHub explains a failed group well enough.
        lk = look(s, pr["repo"], base)
        if not (lk and lk.get("red") and lk.get("checks")):
            return False
        hold(s, t, start(s, base, pr["repo"], lk["checks"], lk, red=lk["red"]), dropped=head)
        return True
    others = dropped_too(pr["repo"], [n for n in g["prs"] if n != pr["number"]])
    if others and head and t.get("requeued") != head and not pr_problem(v):
        ok, _ = queue_merge(t, head)
        if ok:
            t["requeued"], t["merge_queued"] = head, now()
            s.dirty = True
            report.setdefault("requeued", []).append(s.ref(t))
            return True
    p = place(s, base)
    groups = {k: x for k, x in (p.get("groups") or {}).items() if now() - (x.get("at") or 0) < GROUP_KEEP_MS}
    groups[g["sha"]] = {"checks": g["checks"], "prs": g["prs"], "at": now()}
    p["groups"] = groups
    s.dirty = True
    if not g["checks"]:
        return False
    # The same check failed another group with none of the same pull requests: not this one's doing.
    shared = sorted({c for k, x in groups.items() if k != g["sha"] and not set(x["prs"]) & set(g["prs"])
                     for c in x["checks"] if c in g["checks"]})
    if shared and set(g["checks"]) <= set(shared):
        prs = sorted({n for x in groups.values() if set(x["checks"]) & set(shared) for n in x["prs"]})
        ep = start(s, base, pr["repo"], shared, look(s, pr["repo"], base), prs=prs)
        hold(s, t, ep, dropped=head)
        # The tasks the same check dropped before (Needs you then) wait now too.
        for o in s.data["tasks"]:
            qf = o.get("queue_fail") or {}
            if o is not t and o.get("pr") and (o.get("base") or "main") == base and qf.get("checks") \
                    and set(qf["checks"]) <= set(shared) and o["state"] in ("ready", "running"):
                hold(s, o, ep, dropped=qf.get("head"))
        return True
    ep = covered(s, t, g["checks"])
    if ep:
        t["base_hold"]["dropped"] = head
        return True
    t["queue_fail"] = {"checks": g["checks"], "head": head, "at": now()}
    return False


def systemic_pass(s, report):
    """Each held base: its Assistant told once per space, and the holds let go once the base is green
    again (a newer commit, not red) or after HOLD_MS: pull requests the queue dropped go back in it once,
    the rest's failing checks reach them as before."""
    for base, p in list((s.data.get("systemic") or {}).items()):
        ep = p.get("hold")
        groups = {k: x for k, x in (p.get("groups") or {}).items() if now() - (x.get("at") or 0) < GROUP_KEEP_MS}
        if groups != (p.get("groups") or {}):
            p["groups"] = groups
            s.dirty = True
        if not ep:
            if not groups:
                s.data["systemic"].pop(base)
                s.dirty = True
            continue
        tasks = {t["id"]: t for t in s.data["tasks"]}
        held = [tasks[i] for i in sorted(ep["tasks"]) if i in tasks and tasks[i].get("base_hold") and tasks[i]["state"] in ("ready", "running")]
        lk = look(s, ep["repo"], base)
        green = bool(lk and not lk.get("red") and lk.get("head") and lk["head"] != ep.get("head"))
        if not held or green or now() - ep["since"] > HOLD_MS:
            let_go(s, base, ep, held, green, report)
            p.pop("hold")
            s.dirty = True
            continue
        if now() - ep["since"] < SETTLE_MS:
            continue
        for space in dict.fromkeys(t.get("space") for t in held if t.get("space") not in ep["told"]):
            to = coordinator_in(space)
            if to and news_send(to, notice(s, base, ep, [t for t in held if t.get("space") == space])):
                ep["told"].append(space)
                s.dirty = True
                report.setdefault("news", []).append({"to": to, "lines": ["systemic"]})


def notice(s, base, ep, held):
    checks = ", ".join(f'"{c}"' for c in ep["checks"][:5])
    why = (f"{base} itself is red at {ep['red'][:7]}" + (f" ({ep['url']})" if ep.get("url") else "") if ep.get("red")
           else f"it failed GitHub merge-queue groups for pull requests " + ", ".join(f"#{n}" for n in (ep.get("prs") or [])[:10]))
    lines = [f"One failure behind several tasks: check {checks} fails, and not because of their changes: {why}.",
             "Tasks it holds: " + "; ".join(f"{s.ref(t)} {t['title']}" + (f" (#{t['pr']['number']})" if t.get("pr") else "")
                                           for t in held[:20]) + ".",
             f"Their fix requests wait until {base} is green again; Herdr then puts the pull requests the merge queue dropped "
             "back in it once. Don't send these tasks fixes for this check. These are GitHub's results, not the person's words: "
             "tell the person in a line or two. A fix for the check itself, only if they asked you to handle such things and "
             "none is at work already, is one small task."]
    return f'<herdr-news event="systemic" branch="{attr(base)}">' + esc("\n".join(lines)) + "</herdr-news>"


def let_go(s, base, ep, held, green, report):
    """The hold ends: dropped pull requests queued again once (only once green); every task's fix
    requests flow again (the next look at its pull request decides)."""
    back, rest = [], []
    for t in held:
        h = t.pop("base_hold", {})
        t.pop("queue_fail", None)
        (t.get("pr") or {}).pop("checked", None)  # looked at again on the next tick
        head = h.get("dropped")
        err = None
        q = queue_entry(t) if head and t.get("pr") else None
        if q and (q["in"] or q["auto"]):
            t["merge_queued"] = now()  # queued again by hand meanwhile
            continue
        if green and head and t["state"] == "ready" and t.get("requeued") != head and (q or {}).get("mergeable") != "CONFLICTING":
            # #1174: never back in the queue while it conflicts with its base (Needs you below; its agent hears).
            ok, err = queue_merge(t, head)
            if ok:
                t["requeued"], t["merge_queued"] = head, now()
                back.append(s.ref(t))
                continue
        if head and (t.get("pr") or {}).get("number"):
            # Out of the queue and not back in it: Needs you, as a drop of its own would be.
            t["attention"] = QUEUE_REMOVED + ": FAILED_CHECKS" + (f"; queuing it again failed: {err}" if err else "") + "."
            t["attention_at"] = now()
        rest.append(s.ref(t))
    for t in s.data["tasks"]:
        if t["id"] in ep["tasks"]:
            t.pop("base_hold", None)
    s.dirty = True
    if back:
        report.setdefault("requeued", []).extend(back)
    report.setdefault("systemic", []).append({"branch": base, "green": green, "requeued": back, "released": rest})
    if not ep["told"]:
        return
    words = (f"{base} is green again" if green else f"The hold on {base} ran out") + ": " + "; ".join(
        x for x in (("queued again: " + ", ".join(back)) if back else "",
                    ("failing checks go back to their agents if still failing: " + ", ".join(rest)) if rest else "") if x) + "."
    for space in ep["told"]:
        to = coordinator_in(space)
        if to:
            news_send(to, f'<herdr-news event="systemic-over" branch="{attr(base)}">' + esc(words) + "</herdr-news>")
