"""Tick: one pass over the tasks (start queued ones, finish merged ones, note the ones whose agent
stopped: nothing restarts an agent by itself)."""

import fcntl
import json
import os
import secrets
import subprocess
import time

from .base import Fail, git, guard, hc_json, now, PR_EVERY, run, SHELLS, STORE, stop_note
from .settings import machine_name, worker_argv
from .agents import (
    agent_log, agent_running, busy_again, carried_on, clear_stopped, detail, error_words, GONE, held_ask, last_question, live_agents,
    mid_turn_agents, own_work, ready_turns, starting, status_word,
    task_status,
)
from .provider import provider_cut, provider_error
from .sessions import find_lost_logs, refresh_sessions
from .github import (already_merged, BEHIND, checks_state, collision, collision_reason, collision_words, CHECKS_NEVER, checks_missing, checks_since, drop_branch, merge_checks, expected_checks, finish, github, merged_here, needs_approval, note_checks, pr_for_branch, pr_merged, pr_pending, pr_problem,
                     pr_view, pr_wait, queue_dropped_why, queue_entry, queue_merge, queue_refusal, unqueue, tidy_done, tidy_due, update_main, watch_main)
from .launch import default_space
from .store import locate, read_list, Store, store_files
from .queues import machine_hold, refresh_ext, set_hold, waiting_ext, waiting_for
from .archive import archive_pass
from .browsers import browser_pass
from .output import progress_clock, say
from .commands import back_to_work, begin, merge_failed, merge_now, merge_waits, MERGE_FAILED, workers
from .news import news_pass
from .ghnews import held_by_base, main_pass, pr_deliver, pr_news, resting
from .systemic import dropped, systemic_pass
from .scheduler import SCHEDULER
from .revive import record_pass


PR_WAIT_EVERY = 20000  # how often a pull request whose checks still run is read again (ms)


def at_work(s, t):
    """Its agent is mid-turn (working, or asking): a task is never marked merged under it (SHEP-23);
    a later tick looks again."""
    return bool(mid_turn_agents(live_agents(s.key(t)), detail))


def holds_open(s, t):
    """A merge GitHub reports never closes the task under it (#802, #844): reopened after its pull
    request merged (until its agent says ready), or Working with its agent still there (its brief
    may go on after the merge: it says ready, or ends, and is done then)."""
    return bool(t.get("kept_open")) or (t["state"] == "running" and any(agent_running(k) for k in live_agents(s.key(t))))


def merge_held(s, t):
    """Whether its pull request's merge waits to close the task (at_work(), holds_open()). #1124: once the task said
    ready on this pull request, its merge outranks an agent that only waits (idle, or asking the person): done, its
    running slot freed; only an agent mid-work still holds it, and a reopened task (kept_open) until it says ready."""
    if t.get("kept_open"):
        return True
    if t.get("ready_at"):
        return any(status_word(k) == "working" for k in mid_turn_agents(live_agents(s.key(t)), detail))
    return at_work(s, t) or holds_open(s, t)


QUEUE_GRACE = 2 * 60000  # a pull request just queued may take a moment to show in GitHub's queue


QUEUE_REMOVED = "GitHub's merge queue removed it"


def queue_pass(s, t, v, report):
    """A pull request Herdr put in GitHub's merge queue that is still open: still in the queue (or set
    to join it), it stays Merging; the queue removed it (a check failed there, a conflict), it
    needs attention, with the queue's reason (#742, #802). Removed only because its checks there
    timed out (busy runners: #1041), it is queued again once by itself, at the same commit."""
    if v.get("state") != "OPEN":
        t.pop("merge_queued", None)
        return
    if now() - t["merge_queued"] < QUEUE_GRACE:
        return
    q = queue_entry(t)
    if not q or q["in"] or q["auto"] or q.get("state") == "MERGED":
        return
    since = t.pop("merge_queued")
    why = (q.get("reason") or "").strip().rstrip(".")
    head = v.get("headRefOid")
    # SHEP-270: dropped because its group failed (another pull request's doing: queued again once), or
    # because its base fails the same check (held until it is green again, the Assistant told once).
    if "failed_checks" in why.lower().replace(" ", "_") and dropped(s, t, v, since, report):
        return
    if "timed_out" in why.lower().replace(" ", "_") and head and t.get("requeued") != head and not pr_problem(v):
        ok, err = queue_merge(t, head)
        if ok:
            t["requeued"], t["merge_queued"] = head, now()
            report.setdefault("requeued", []).append(s.ref(t))
            return
        why += f"; queuing it again failed: {err}"
    if queue_dropped_why(q.get("reason")) and head:
        # #1174: its own merge group failed (or conflicted) at this commit: never queued again as it is
        # (queue_refusal()); its agent hears to merge the base in (pr_news()).
        t["queue_out"] = {"head": head, "why": why, "at": now()}
    t["attention"], t["attention_at"] = QUEUE_REMOVED + (f": {why}." if why else "."), now()
    report["attention"].append(t["id"])


def refuse_queue(s, t, v, report):
    """#1174: a pull request put back in GitHub's merge queue from outside Herdr (an agent's or the
    Assistant's gh pr merge, GitHub's button) while it conflicts with its base, or at the commit whose
    merge group just failed, comes out again: each such try fails a merge group and costs every pull
    request behind it a new one. A failed group's commit is refused once (queued again after that, it
    is the person's call); a conflict always (the queue can't merge it). True when it took it out."""
    why = queue_refusal(t, v)
    head = v.get("headRefOid")
    if not why or (v.get("mergeable") != "CONFLICTING" and t.get("queue_refused") == head):
        return False
    q = queue_entry(t)
    if not q or not (q["in"] or q["auto"]):
        return False
    ok, err = unqueue(q)
    if not ok:
        report.setdefault("github_error", []).append(f"{s.ref(t)}: couldn't take it out of the merge queue: {err}")
        return False
    t["queue_refused"] = head
    s.dirty = True
    report.setdefault("unqueued", []).append(s.ref(t))
    return True


def back_in_queue(s, t, report):
    """#1041: a pull request the merge queue removed, queued again by hand (gh pr merge --auto, GitHub's
    button): Merging again, its "removed" attention gone, once GitHub shows it in the queue."""
    if t.get("merge_queued") or not (t.get("attention") or "").startswith(QUEUE_REMOVED):
        return
    q = queue_entry(t)
    if q and (q["in"] or q["auto"]):
        t.pop("attention", None)
        t.pop("attention_at", None)
        t["merge_queued"] = now()
        s.dirty = True
        report.setdefault("requeued", []).append(s.ref(t))


def facts(s, t, report):
    """A worktree task whose own work merged anywhere is done (once its agent is between turns, and
    a Working one once its agent is gone or says ready); a pull request's problems need the person."""
    seen_pr(s, t)
    if t.get("pr"):
        pr = t["pr"]
        if now() - pr.get("checked", 0) < PR_EVERY:
            return
        pr["checked"] = now()
        s.dirty = True
        v = pr_view(t)
        if not v:
            return
        note_checks(s, t, v)
        # #1106: its Accept card then says Accept, not "Accept and merge" (proof.evidence)
        if v.get("state") == "CLOSED":
            pr["closed"] = True
        else:
            pr.pop("closed", None)
        if v.get("state") == "MERGED":
            if merge_held(s, t):
                return
            t["merged"] = True
            watch_main(s, t, (v.get("mergeCommit") or {}).get("oid"))
            if t.get("merge_queued"):
                # Herdr queued it: its base here catches up and its branch on GitHub goes, as a merge
                # Herdr made itself would (merge_now()).
                update_main(s, t)
                drop_branch(s, t)
            finish(s, t)
            report["done"].append(t["id"])
            return
        # merging by itself: only the base branch's required checks count (#1221), for its news too (a red optional
        # check sent to its agent would take it out of Ready, and the merge with it)
        if t.get("auto_merge"):
            v = merge_checks(t, v, now_=t["auto_merge"] == "auto")
        problem = pr_problem(v)
        if t.get("merge_queued"):
            queue_pass(s, t, v, report)
        elif not refuse_queue(s, t, v, report):
            back_in_queue(s, t, report)
        if needs_approval(v):
            pr["needs_approval"] = True
        else:
            pr.pop("needs_approval", None)
        since, expect = checks_since(s, t, v), expected_checks(s, t, v.get("headRefOid"))
        # #1044, #1018: no checks yet (at its newest commit) while some will come is never "all passed".
        missing = checks_missing(v, since, expect)
        # SHEP-348: the mark on its row (running, failed, passed)
        word = checks_state(v, missing)
        if word != pr.get("checks"):
            if word:
                pr["checks"] = word
            else:
                pr.pop("checks", None)
        t["_pr_fresh"] = not problem and not pr_pending(v) and not needs_approval(v) and not missing
        # Ready only once its checks are done and GitHub knows it can merge (SHEP-175): Working till then.
        if (v.get("mergeable") or "").upper() == "MERGEABLE" and v.get("headRefOid"):
            pr["mergeable_head"] = v["headRefOid"]  # #1151: its later brief UNKNOWNs are no wait
        if t["state"] == "ready":
            wait = pr_wait(v, since, expect, pr.get("mergeable_head"))
            if wait != pr.get("wait"):
                if wait:
                    pr["wait"] = wait
                else:
                    pr.pop("wait", None)
            if wait:
                pr["checked"] = now() - PR_EVERY + PR_WAIT_EVERY
        try:
            pr_news(s, t, v, report)
        except Exception as e:  # never stops the tick
            report.setdefault("github_error", []).append(f"{s.ref(t)}: {e}")
        # Kept up to date while it is back at work too (a fix pushed: the problem goes away), so its
        # agent going quiet with the problem still there reads Needs you (on_it()).
        if problem and problem.startswith("Checks failing") and held_by_base(s, t, v):
            problem = None  # SHEP-270: its base fails the same checks: no Needs you till it is green again
        w = t.get("fix_withdrawn")
        if w and problem == w.get("attention") and (v.get("headRefOid") or None) == w.get("head"):
            problem = None  # #1086: its fix was withdrawn: the same problem at the same commit isn't raised again
        elif w:
            t.pop("fix_withdrawn")
            s.dirty = True
        if problem and problem.startswith("It conflicts") and t["state"] == "ready":
            if resting(s, t):
                # #1357: a Ready task that conflicts with its base goes back to its resting agent at once (as
                # herdr-task fix does by hand): Working again, its card saying it rebases only now it was asked.
                report.setdefault("merge_failed", []).append({"task": s.ref(t), "why": problem, "to": merge_failed(s, t, problem)})
                return
            pr["checked"] = now() - PR_EVERY + PR_WAIT_EVERY  # its agent mid-turn or asking: looked at again soon
        if t["state"] in ("ready", "running") and problem != t.get("attention"):
            if problem:
                t["attention"], t["attention_at"] = problem, now()
                # its pull request's commit then: one failed event per commit (automations.same_failure)
                if v.get("headRefOid"):
                    t["attention_head"] = v["headRefOid"]
                else:
                    t.pop("attention_head", None)
                t.pop("merge_queued", None)
                # SHEP-320: a conflict says on its card what it collided with, whatever the merge setting (pr_news
                # hands its agent the files)
                # #1357: never "its agent is rebasing" here: only merge_failed() (above) says so, once it was asked
                why = (collision_reason(collision(s, t, fetch=True), told=False) or
                       f"Conflicts with {t.get('base') or 'main'}") if problem.startswith("It conflicts") else None
                if why or t.get("auto_merge"):
                    # it was to merge by itself (or the person marked it as done): a failed merge, its agent's to
                    # fix (pr_news hands it the conflict or the failed check)
                    t["merge_failed"], t["merge_failed_at"] = why or problem, now()
                report["attention"].append(t["id"])
            elif t.get("attention", "").startswith(("Checks failing", "It conflicts", "The pull request was closed", MERGE_FAILED, BEHIND)) \
                    or (t.get("attention") == CHECKS_NEVER and missing != "never"):
                t.pop("attention")
                t.pop("attention_head", None)
                t.pop("merge_failed", None)
                t.pop("merge_failed_at", None)
        if t["state"] == "ready" and t.get("auto_merge") and missing == "never" and not t.get("attention"):
            # Checks that should have started never did: it doesn't merge by itself (the person's Accept still can).
            t["attention"], t["attention_at"] = CHECKS_NEVER, now()
            report["attention"].append(t["id"])
    elif merged_here(s, t) and not at_work(s, t) and not t.get("kept_open"):
        # #989: reopened after its work merged (kept_open, until its agent says ready): its fix goes on.
        t["merged"] = True
        finish(s, t)
        report["done"].append(t["id"])
    elif t.get("own") and not at_work(s, t) and not holds_open(s, t) and now() - t.get("gh_checked", 0) >= PR_EVERY:
        # SHEP-59: its pull request squash-merged without the task knowing (opened by its agent), or a
        # Ready one whose work is already in its base: done, as ready would.
        t["gh_checked"] = now()
        s.dirty = True
        gone = already_merged(s, t) if t["state"] == "ready" else squash_merged(s, t)
        if gone is not None:
            t["merged"] = True
            if gone:
                watch_main(s, t, (gone.get("mergeCommit") or {}).get("oid"))
            finish(s, t)
            report["done"].append(t["id"])


PR_OPEN_EVERY = 3 * 60000  # how often a Working task's branch is looked up for a pull request its agent opened


def seen_pr(s, t):
    """#1176: a Working task's pull request its agent opened before ready: kept as pr_seen ({number, url, repo}), so
    the task page shows its number and its Pull request tab from then on (ready adopts it as the task's own pr)."""
    if t.get("pr") or t["state"] != "running" or t.get("mode") != "worktree" or not t.get("branch"):
        if t.pop("pr_seen", None):
            s.dirty = True
        return
    if now() - t.get("pr_looked", 0) < PR_OPEN_EVERY:
        return
    t["pr_looked"] = now()
    s.dirty = True
    repo = github(s)
    found = pr_for_branch(t, repo) if repo else None
    if found:
        t["pr_seen"] = {"number": found["number"], "url": found["url"], "repo": repo}
    elif repo:
        t.pop("pr_seen", None)


def squash_merged(s, t):
    """A Working task's branch whose pull request (opened by its agent) merged at its tip: that
    pull request, recorded on the task, or None."""
    repo = github(s)
    found = pr_merged(t, repo, any_base=True) if repo else None
    if not found or found.get("headRefOid") != (t.get("own") or t.get("head")):
        return None
    t["pr"] = {"number": found["number"], "url": found["url"], "repo": repo}
    return {**t["pr"], "mergeCommit": found.get("mergeCommit")}


def back_pass(s, t, report):
    """A Ready task whose agent took up work again (a message from anyone in its chat) is Working
    again until its next ready (busy_again()); its Assistant hears it (news: working-again)."""
    live = live_agents(s.key(t))
    # Cheap while nothing works: hc ls alone; its records in full (roles) only then.
    if any(status_word(k) == "working" for k in live) and busy_again(t, mid_turn_agents(live, detail)):
        back_to_work(s, t, "its agent is at work again", auto=True)
        report.setdefault("working_again", []).append(s.ref(t))
        return
    # #1000: a whole turn between two passes (GitHub news woke it, it listed options and asked "pick
    # one" in its own terminal): never seen working, so the task stayed Ready and nobody heard. A
    # turn that asked or changed its branch takes it back to work: Needs you once it stays quiet
    # (settle_back() keeps it there). One that left nothing behind only moves its turns on.
    seen = t.get("ready_turns")
    if not isinstance(seen, dict) or t.get("merge_requested"):
        return
    turned = [k for k in live if status_word(k) in ("idle", "done") and k.get("address") in seen
              and (k.get("labels") or {}).get("herdr.role") != "reviewer" and (k.get("turn") or 0) > seen[k["address"]]]
    if not turned:
        return
    wt = t.get("worktree") if t.get("mode") == "worktree" else None
    moved = bool(wt and t.get("head") and os.path.isdir(wt)
                 and (git(wt, "rev-parse", "HEAD")[1] != t["head"] or git(wt, "status", "--porcelain", "--untracked-files=no")[1]))
    if moved or any(last_question(t, k["address"]) for k in turned):
        back_to_work(s, t, "its agent asked something" if not moved else "its agent changed its work", auto=True)
        report.setdefault("working_again", []).append(s.ref(t))
        return
    # #1108: a turn that left its own work running (a background job) isn't over yet: kept unrecorded, so a change
    # that work makes later is still this turn's and takes the task back to work
    if own_work(t, [detail(k) for k in turned], ready=True):
        return
    t["ready_turns"] = {**seen, **{k["address"]: k.get("turn") or 0 for k in turned}}
    s.dirty = True


def settle_back(s, t, report):
    """A Ready task its agent's own turn took back to work (back_pass(): a message in its chat,
    a background job's notice waking it) is Ready again once that turn ended with nothing new: its
    branch where it said ready, nothing uncommitted, no question asked, no work of its own left
    running (SHEP-133). Else it stays Working, and Needs you once its agent stays quiet."""
    b = t.get("back") or {}
    if t["state"] != "running" or not b.get("auto") or t.get("attention") or t.get("stopped_by"):
        return False
    wt = t.get("worktree") if t.get("mode") == "worktree" else None
    if not wt or not t.get("head") or not os.path.isdir(wt):
        return False
    live = [k for k in map(detail, live_agents(s.key(t))) if agent_running(k)]
    if not live or any(status_word(k) not in ("idle", "done") for k in live):
        return False
    ok, head, _ = git(wt, "rev-parse", "HEAD")
    if not ok or head != t["head"] or git(wt, "status", "--porcelain", "--untracked-files=no")[1]:
        return False
    if any(last_question(t, k.get("address")) for k in live) or own_work(t, live):
        return False
    t["state"], t["ready_turns"] = "ready", ready_turns(live)
    if b.get("progress"):
        t["progress"] = b["progress"]
    else:
        t.pop("progress", None)
    t.pop("back", None)
    s.dirty = True
    report.setdefault("ready_again", []).append(s.ref(t))
    return True


def due_pass(s, report):
    """Scheduled tasks whose time has come (SHEP-38), a time passed while the machine was off too, join
    the queue in the order they were due: the queue below starts them (after their --after tasks),
    each once."""
    for t in s.data["tasks"]:
        if t["state"] == "scheduled" and (t.get("scheduled_for") or 0) <= now():
            t["state"], t["queued_at"] = "queued", t.get("scheduled_for") or now()
            t.pop("scheduled_for", None)
            s.dirty = True
            report.setdefault("due", []).append(s.ref(t))


def heads_up(s, t, report):
    """SHEP-320: a task merged into its base (finish() marked the others base_moved): a Working task whose committed
    work now conflicts with the base's newest hears at once, with the files, rather than at its own ready or merge.
    Once per base commit and set of files; only to an agent that is there (none is started for it)."""
    if not t.pop("base_moved", None):
        return
    s.dirty = True
    if t["state"] != "running" or t.get("mode") != "worktree":
        return
    c = collision(s, t, fetch=True)
    mark = f"{c['sha']}:{','.join(c['files'])}" if c else None
    if not c or t.get("collides") == mark:
        return
    live = workers(s, t)
    if not live:
        return
    from .news import send_or_hold
    msg = (f"Heads-up from Herdr: {c['base']} moved on" + (f" ({', '.join(c['by'][:3])} merged)" if c["by"] else "") +
           f" and now conflicts with your branch {t.get('branch')}. {collision_words(c)} No need to stop what you're doing: "
           "rebase at a good point, before you say ready (ready refuses a branch that conflicts with its base).")
    if send_or_hold(live[-1]["address"], msg):
        t["collides"] = mark
        report.setdefault("collides", []).append(s.ref(t))


def tick_store(s, report):
    """One folder's turn: Ready tasks back at work are Working again, merged tasks become done,
    auto-merges go when they can, and queued tasks start once what they wait for is done."""
    for t in s.data["tasks"]:
        if t["state"] == "ready":
            back_pass(s, t, report)
        elif t["state"] == "running" and (t.get("back") or {}).get("auto"):
            settle_back(s, t, report)
        if t.get("base_moved"):
            try:
                heads_up(s, t, report)
            except Exception as e:  # never stops the tick
                report.setdefault("github_error", []).append(f"{s.ref(t)}: {e}")
        if t.get("worktree") and t["state"] in ("running", "ready"):
            facts(s, t, report)
            if t["state"] == "ready" and (t.get("pr") or {}).get("news"):
                try:
                    pr_deliver(s, t, report)
                except Exception as e:  # never stops the tick
                    report.setdefault("github_error", []).append(f"{s.ref(t)}: {e}")
            if t["state"] == "ready" and t.get("auto_merge") and t.get("pr") and not t.get("attention") and t.get("_pr_fresh"):
                err = merge_now(s, t)
                if not err:
                    report["done"].append(t["id"])
                elif not merge_waits(err):
                    # 3.2 (step 37): a merge that fails goes back to its agent, in every mode
                    report.setdefault("merge_failed", []).append({"task": s.ref(t), "why": err, "to": merge_failed(s, t, err)})
            t.pop("_pr_fresh", None)
    due_pass(s, report)
    queued = sorted((t for t in s.data["tasks"] if t["state"] == "queued"), key=lambda t: t.get("queued_at") or 0)
    budget = [3]  # other machines asked this pass, at most
    for t in queued:
        waits = bool(waiting_for(s, t))
        if not waits:
            refresh_ext(s, t, budget=budget)
            waits = bool(waiting_ext(t))
        if waits:
            if t.pop("held", None):  # waits for something else now
                s.dirty = True
            continue
        # Its machine too busy (HERD-40): it, and every one after it, waits with why.
        held = machine_hold()
        if (t.get("held") or None) != held:
            t["held"] = held
            if not held:
                t.pop("held")
            s.dirty = True
        if held:
            continue
        q = t.get("queue") or {}
        try:
            sp = q.get("space") or t.get("space") or default_space()
            a = begin(s, t, q.get("argv") or worker_argv(s, t, sp), sp, q.get("parent"))
        except Fail as e:
            t["attention"] = f"Couldn't start: {e}"
            s.dirty = True
            continue
        report["started"].append({"folder": s.loc["folder"], "id": t["id"], "ref": s.ref(t), "terminal": a["address"]})
    if s.data.get("systemic"):
        try:
            systemic_pass(s, report)
        except Exception as e:  # never stops the tick
            report["systemic_error"] = str(e)
    if s.data.get("main_watch"):
        try:
            main_pass(s, report)
        except Exception as e:  # never stops the tick
            report["main_error"] = str(e)


def lost_log(t, a):
    """An agent of task t that ended with no log recorded, not looked for yet (find_lost_logs())."""
    gone = a.get("ended") or (t.get("state") == "done" and (t.get("ended_at") or 0) > (t.get("done_at") or 0))
    return bool(gone and not a.get("log") and not a.get("log_looked"))


def lost_logs_pass(report, folder=None):
    """Finds the log of every ended task agent here whose session no pass saw (a short run), so its
    chat reads back after its terminal is gone (SHEP-26). Cheap once each was looked for."""
    for p in store_files(folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not any(lost_log(t, a) for t in tasks for a in t.get("agents") or []):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if any(lost_log(t, a) for a in t.get("agents") or []):
                    find_lost_logs(s, t)
                    report.setdefault("logs_found", []).append(s.ref(t))


# ---- Done tasks end their agents (as Shepherdr) -----------------------------------------------
# A Done task's worker and reviewer terminals end (their shells too) once the final news went
# and its agent is quiet; their sessions stay recorded on the task, so `resume` brings one back
# (which makes it running again). Ready tasks keep theirs. Only terminals labelled with that
# task's herdr.task key are touched. "ended_at" says a pass found nothing left of it.

DONE_GRACE_MS = 60000          # the done news and the agent's last words go first
DONE_WORKING_MS = 15 * 60000   # an agent still working this long after Done ends anyway
GUARD_MEMORY = 85              # memory in use (%) past which the guard acts (memory_guard())
GUARD_FILE = os.path.join(STORE, ".memory-guard.json")
GUARD_ALERT_EVERY_MS = 30 * 60000
GUARD_BACK_UNDER = 75          # memory (%) the guard's alert time is forgotten under: dips around GUARD_MEMORY keep it (#1047)


def end_done(s, t, report, pressed=False):
    """Ends what is left of one Done task's agents now, or what may end: a shell at once, an agent
    once it's idle (or working past DONE_WORKING_MS); under memory pressure (pressed) every idle
    one at once. Returns the addresses it ended."""
    done_at = t.get("done_at") or 0
    if not pressed and now() - done_at < DONE_GRACE_MS:
        return []
    me = os.environ.get("HC_TERMINAL_ID")
    live = [detail(k) for k in live_agents(s.key(t))]
    live = [k for k in live if k.get("address") != me and (k.get("labels") or {}).get("herdr.role") != "coordinator"]
    if not live:
        t["ended_at"] = now()
        s.dirty = True
        return []
    refresh_sessions(s, t, live)
    ended = []
    for k in live:
        if agent_running(k) and status_word(k) == "working" and now() - done_at < DONE_WORKING_MS:
            continue
        if quiet_hc("kill", k).returncode == 0:
            stop_note("end-done", task=s.ref(t), terminal=k["address"], status=status_word(k), pressed=pressed)
            ended.append(k)
    if ended:
        report.setdefault("ended", []).append({"task": s.ref(t), "terminals": [k["address"] for k in ended]})
    return ended


def end_done_pass(report, folder=None, pressed=False):
    """Every Done task here with agents left ends them (end_done()), and once none is left its
    worktree goes (tidy_done(), SHEP-161). Cheap when nothing's left: a task is looked at once after
    each time it became Done, and again only while its worktree is still on disk."""
    ending = lambda t: t.get("state") == "done" and (t.get("ended_at") or 0) <= (t.get("done_at") or 1)
    ended = []
    for p in store_files(folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not any(ending(t) or tidy_due(t) for t in tasks):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if ending(t):
                    ended += end_done(s, t, report, pressed)
                if not ending(t) and tidy_due(t):
                    try:
                        tidy_done(s, t, report)
                    except Exception as e:  # never stops ending the others
                        report.setdefault("tidy_error", []).append(f"{s.ref(t)}: {e}")
    if ended:
        # Ended terminals leave hc's list too (a moment after: hc rm takes finished ones only).
        time.sleep(1)
        for k in ended:
            quiet_hc("rm", k)
    return [k["address"] for k in ended]


def quiet_hc(verb, k):
    """hc kill / rm of a Done task's terminal, asked as its parent: a parent that ends its own
    child has seen the news, so no "exited" note is typed into the Assistant (hc's caller)."""
    guard(["hc"])
    env = dict(os.environ)
    env.pop("HC_TERMINAL_ID", None)
    if k.get("parent"):
        env["HC_TERMINAL_ID"] = k["parent"]
    return subprocess.run(["hc", verb, k["address"]], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)


_guard_label_checked = False


def clear_memory_alert():
    """The memory guard's alert label off the scheduler's terminal, if that is what it holds (an agent's own alert
    there is left alone)."""
    k = hc_json("get", SCHEDULER)
    try:
        a = json.loads(((k or {}).get("labels") or {}).get("herdr.alert") or "null")
    except ValueError:
        return
    if isinstance(a, dict) and a.get("about") and str(a.get("title", "")).startswith("Memory at "):
        run(["hc", "label", SCHEDULER, "herdr.alert="])


def memory_guard(report):
    """Past GUARD_MEMORY% memory in use, before oomd ends everything: idle agents of Done tasks
    end first (whatever their grace), then the person is told (an alert from the scheduler's
    terminal, once per 30 min while it stays high). HERD-40's hold keeps new tasks waiting."""
    from .machine import sample
    h = sample()
    try:
        with open(GUARD_FILE) as f:
            g = json.load(f)
    except (OSError, ValueError):
        g = {}
    if h["memory"] <= GUARD_MEMORY:
        # #1047: removed at every dip to 85%, memory hovering at 85-86% alerted each tick (every 15 s); the alert
        # time stays until memory is well under, so one toast per GUARD_ALERT_EVERY_MS while it stays near the limit
        if h["memory"] <= GUARD_BACK_UNDER:
            if g:
                try:
                    os.remove(GUARD_FILE)
                except OSError:
                    pass
            # SHEP-246: its alert is a state that is over now: the label goes too (it stayed for days, and a phone's
            # glance listed it as current); once per scheduler start too, for one left by a version before this
            global _guard_label_checked
            if g or not _guard_label_checked:
                _guard_label_checked = True
                clear_memory_alert()
        return
    ended = end_done_pass(report, pressed=True)
    if ended:
        h = sample()
    report["memory_guard"] = {"memory": h["memory"], "ended": ended}
    if ended:
        stop_note("memory-guard", memory=h["memory"], terminals=ended)
    if h["memory"] <= GUARD_MEMORY or now() - (g.get("alerted") or 0) < GUARD_ALERT_EVERY_MS:
        return
    k = hc_json("get", SCHEDULER)
    if not k or k.get("state") != "live":
        return
    agents = sum(1 for x in (hc_json("ls") or {}).get("terminals", []) if "/" not in x.get("address", "/")
                 and x.get("agent") and x.get("agent") not in SHELLS)
    alert = {"id": secrets.token_hex(4), "at": now(), "title": f"Memory at {h['memory']}%",
             "body": (f"Ended {len(ended)} finished agent{'s' if len(ended) != 1 else ''}. " if ended else "")
             + f"{agents} agents still run here. New tasks wait. Close apps or finish tasks before the system ends them all.",
             "about": True, "task": machine_name() or "This computer"}
    if run(["hc", "label", SCHEDULER, "herdr.alert=" + json.dumps(alert, ensure_ascii=False, separators=(",", ":"))]).returncode == 0:
        g["alerted"] = now()
        report["memory_guard"]["alert"] = alert["title"]
    tmp = f"{GUARD_FILE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(g, f)
    os.replace(tmp, GUARD_FILE)


# ---- stopped, never restarted (3.2, step 38) ----------------------------------------------------
# An agent that crashes, is cut off by its provider or hits its plan's limit is never started again by
# Shepherdr on its own, and a cut turn is never told to carry on. Its task is Stopped instead: the facts
# stopped_by ("error" | "limit"; "you" is the person's own Stop, herdr-task stop) and stopped_why (one
# plain line) are kept on the task, where every list of tasks shows them, and it counts as Needs you.
# A message to its agent, `resume` or `switch` clears them.
YOU_GRACE_MS = 15000  # after the person's Stop, its agent may read working a moment longer


def stopped_now(s, t, mine):
    """(by, why) for a Working task whose agent can't go on by itself, or None: no agent of its own runs
    (crashed, its terminal gone or left a plain shell), it reports an error, or its log ends on a turn its
    provider cut off (out of allowance: its plan's limit)."""
    running = [k for k in mine if agent_running(k)]
    if not running:
        return None if starting(t) else ("error", GONE)
    workers = [k for k in running if (k.get("labels") or {}).get("herdr.role") != "reviewer"]
    if not workers or any(status_word(k) == "working" for k in workers):
        return None
    for k in workers:
        if held_ask(k["address"]):
            continue
        if status_word(k) == "error":
            return "error", error_words([k])
        if not agent_log(t, k["address"]):
            refresh_sessions(s, t, [k])
        log = agent_log(t, k["address"])
        cut = provider_cut(log) if log else None
        if not cut:
            continue
        f = provider_error(cut["text"], cut["code"], cut["status"])
        words = " ".join(str(cut.get("text") or "").split())
        why = f["reason"] + (f": {words[:160]}" if words and words.lower() != f["reason"].lower() else "")
        if status_word(k) == "blocked" and f["passing"]:
            continue  # it asks the person something: theirs to answer
        return ("limit" if f["reason"].startswith("Out of allowance") else "error"), why
    return None


def stopped_pass(report):
    """Keeps stopped_by and stopped_why on every Working task here (see above), and takes them off once its
    agent is at work again. Reviewers are left alone. Also logs the moment a task's agents are all gone."""
    report.setdefault("stopped", [])
    for path in store_files():
        d = read_list(path)
        if not d or not os.path.isdir(d.get("folder") or ""):
            continue
        if not any(t.get("state") == "running" or t.get("stopped_by") or t.get("retry") for t in d.get("tasks") or []):
            continue
        with Store(locate(d["folder"])) as s:
            for t in s.data["tasks"]:
                if t.pop("retry", None) is not None:  # an older version's provider retry: no longer made
                    s.dirty = True
                if t["state"] != "running":
                    if clear_stopped(t):
                        s.dirty = True
                    continue
                mine = [detail(k) for k in live_agents(s.key(t))]
                running = [k for k in mine if agent_running(k)]
                # SHEP-189: a running task whose agents were all running and now are not has gone
                # "stopped". Logged once at the moment it happens: which terminals, what Herdr saw.
                up = any((k.get("labels") or {}).get("herdr.role") != "reviewer" for k in running)
                if t.get("alive") and not up:
                    from .machine import sample
                    h = sample()
                    stop_note("gone", task=s.ref(t), memory=h["memory"], load=h["load"], terminals=[
                        {"address": k["address"], "state": k.get("state"), "status": status_word(k),
                         "foreground": (k.get("foreground") or {}).get("name"), "role": (k.get("labels") or {}).get("herdr.role")}
                        for k in mine if (k.get("labels") or {}).get("herdr.role") != "reviewer"])
                if bool(t.get("alive")) != up:
                    t["alive"] = up
                    s.dirty = True
                if t.get("stopped_by") == "you":
                    # theirs until its agent takes a new turn (their next message carries on)
                    if now() - (t.get("stopped_at") or 0) > YOU_GRACE_MS and carried_on(t, running):
                        clear_stopped(t)
                        s.dirty = True
                else:
                    want = stopped_now(s, t, mine)
                    have = (t.get("stopped_by"), t.get("stopped_why")) if t.get("stopped_by") else None
                    if want != have:
                        if want:
                            t["stopped_by"], t["stopped_why"] = want
                            t.setdefault("stopped_at", now())
                            report["stopped"].append({"task": s.ref(t), "by": want[0], "why": want[1]})
                        else:
                            clear_stopped(t)
                        s.dirty = True
                progress_clock(s, t, task_status(t, running)[0])


def cmd_tick(args):
    """Starts queued tasks that can go now and finds merged ones. Cheap when nothing waits; one
    at a time (a second tick while one runs does nothing)."""
    os.makedirs(STORE, exist_ok=True)
    lock = open(os.path.join(STORE, ".tick.lock"), "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        say(args, {"busy": True}, "Another tick is running.")
        return
    report = {"started": [], "done": [], "attention": [], "fired": []}
    if getattr(args, "machine", None) or getattr(args, "hold", None):
        try:
            set_hold(args.machine, json.loads(args.hold) if args.hold else None)
        except ValueError:
            pass
    try:
        # Each running agent's session noted on its terminal (the chat reads it); nothing is started again.
        record_pass(report)
    except Exception as e:  # never stops the queue
        report["record_error"] = str(e)
    try:
        stopped_pass(report)
    except Exception as e:  # never stops the queue
        report["stopped_error"] = str(e)
    try:
        archive_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["archive_error"] = str(e)
    for p in store_files(args.folder):
        d = read_list(p)
        tasks = (d or {}).get("tasks") or []
        if not d or not os.path.isdir(d.get("folder") or "") or not (d.get("main_watch") or d.get("systemic") or any(
                t.get("state") in ("queued", "scheduled", "ready") or (t.get("worktree") and t.get("state") == "running") for t in tasks)):
            continue
        with Store(locate(d["folder"])) as s:
            tick_store(s, report)
    try:
        news_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["news_error"] = str(e)
    try:
        from .machines import replies_pass
        replies_pass(report)
    except Exception as e:  # never stops the queue
        report["replies_error"] = str(e)
    try:
        end_done_pass(report, args.folder)
        memory_guard(report)
    except Exception as e:  # never stops the queue
        report["ended_error"] = str(e)
    try:
        lost_logs_pass(report, args.folder)
    except Exception as e:  # never stops the queue
        report["logs_error"] = str(e)
    try:
        browser_pass(report)
    except Exception as e:  # never stops the queue
        report["browser_error"] = str(e)
    say(args, report, "; ".join(f"{k}: {v}" for k, v in report.items() if v) or "Nothing to do.")
