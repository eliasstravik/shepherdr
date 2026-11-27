"""The task commands: add, start, status, ready, accept, merge and the rest."""

import argparse
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import time

from . import sandbox, stack
from .base import Fail, git, guard, now, own_core_check, run, STORE, stop_note, VERSION
from .settings import (
    agent_argv, agent_key, bare, check_automatic_agent, merge_policy, review_limits, set_opts, set_task, settings_block, settings_for, space_base,
    require_task_cli, reviewer_pick, task_settings, worker_argv, worktrees_on, setting_sources, SET_BY,
)
from .agents import (
    agent_log, agent_running, background_jobs, busy_again, BY_YOU, NOT_TRUSTED, clear_stopped, job_names, own_jobs, detail, fit, LINE_MAX, live_agents, ready_turns,
    status_word, STATUSES, SUMMARY_MAX, WORKING_AGAIN,
)
from .sessions import refresh_sessions
from .github import (already_merged, checks_missing, collision, collision_reason, collision_words, github_unreachable, pr_for_branch, checks_since, drop_branch, expected_checks, finish, gh, github, landed, merged_here, needs_approval, note_checks, own_work, pr_adopt, pr_open,
                     merge_checks, merge_method, mid_turn, pr_pending, pr_problem, pr_view, queue_refusal, remote_of, update_main, watch_main)
from .github import CHECKS_RUNNING as PR_CHECKS_RUNNING
from .launch import (
    base_ref, brief, caller_labels, DETACHED, caller_space, current_base, default_branch, default_space, folder_for, handoff, launch,
    name_tabs, worktree_list,
    own_path, parent_for, resume_argv, set_branch, setup_for, space_for_folder, tab_title, task_tabs,
)
from .store import bare_by_mistake, Busy, is_task_list, locate, open_store, queue_progress, quoted, read_list, Store, store_files
from .queues import after_refs, parse_after, queue_reason, set_after
from .archive import unarchive
from .output import line, minutes, say, view
from .scheduler import ensure_scheduler
from .proof import evidence, find_proof
from .when import when_from


# ---- commands -------------------------------------------------------------------------------

def cmd_where(args):
    loc = locate(args.folder)
    with Store(loc, write="try") as st:  # makes ~/.herdr/tasks and moves old lists in, where it can (#900)
        pass
    slug, path = st.slug, st.path
    say(args, {**loc, "slug": slug, "store": path, "prefix": st.prefix, "version": VERSION}, f"{loc['folder']}\n{path}")


def cmd_list(args):
    if args.all:
        folders = [d["folder"] for d in map(read_list, store_files()) if is_task_list(d)]
        if any(not os.path.isdir(folder) for folder in folders):
            here = locate(args.folder)["folder"]
            if here not in folders and any(os.path.isfile(path) for path in store_files(here)):
                folders.append(here)
        folders = list(dict.fromkeys(folders))
    else:
        folders = [locate(args.folder)["folder"]]
    groups = []
    for folder in folders:
        if not os.path.isdir(folder):
            continue
        with Store(locate(folder), write="try") as s:
            out = []
            archived = sum(1 for t in s.data["tasks"] if t.get("archived"))
            for t in s.data["tasks"]:
                if bool(t.get("archived")) != args.archived:
                    continue
                mine = live_agents(s.key(t)) if t["state"] in ("running", "ready") else []
                if mine:
                    refresh_sessions(s, t, mine)
                v = view(s, t, [detail(k) for k in mine] if mine else [])
                if t["state"] == "queued":
                    v["reason"] = queue_reason(s, t)
                out.append(v)
            if args.archived:
                out.sort(key=lambda v: -(v.get("archived") or 0))
            groups.append({"folder": s.loc["folder"], "name": s.loc["name"], "kind": s.loc["kind"], "tasks": out,
                           **({} if args.archived else {"archived": archived})})
    if args.json:
        print(json.dumps(groups if args.all else groups[0]))
        return
    for g in groups:
        if args.all:
            print(f"{g['name']}  {g['folder']}")
        for v in g["tasks"]:
            if v["state"] != "done" or args.all or args.archived:
                print(("  " if args.all else "") + line(v))
        hidden = sum(1 for v in g["tasks"] if v["state"] == "done") if not args.archived else 0
        more = [f"{hidden} done"] if hidden and not args.all else []
        if g.get("archived") and not args.all:
            more.append(f"{g['archived']} archived: --archived lists them")
        if more:
            print(f"({'; '.join(more)})")
        elif not g["tasks"] and not args.all:
            print("No archived tasks." if args.archived else "No tasks.")


def cmd_add(args):
    prompt = args.prompt or ""
    if args.prompt_file:
        with open(args.prompt_file) as f:
            prompt = f.read()
    at = scheduled_at(args)  # refused before anything is added
    with open_store(args) as s:
        repo = s.loc["kind"] == "repo"
        wrong = None if repo else bare_by_mistake(s.loc["folder"])
        if wrong:
            raise Fail(wrong)
        if args.worktree and not repo:
            raise Fail("Worktrees need a git repo; this folder isn't one.")
        # The person's setting wins: worktrees off for this repo means in the folder, --worktree or not.
        mode = "here" if args.here or not worktrees_on(s) else "worktree"
        t = s.new(args.title.strip(), prompt, mode)
        space = bare(args.space) if args.space else (space_for_folder(s.loc["folder"], caller_space()) or caller_space())
        if space:
            # the space it is for, from the start (3.2: a task not started yet shows there, and `edit --space` moves it)
            t["space"] = bare(space)
        set_opts(t, args, s, space)
        set_base(s, t, args.base, space, new=True)
        set_branch(s, t, getattr(args, "branch", None))
        take_pr(s, t, getattr(args, "pr", None))
        detached_refusal(s, t)
        set_notes(t, args)
        if args.after:
            set_after(s, t, *parse_after(s, args.after))
        if at:
            # Started later by the scheduler, with no caller to ask: its space is kept now.
            schedule(s, t, at, {"space": space or default_space()})
        v = view(s, t)
        warn = shared_branch_warning(s, t)
        if warn:
            v["warning"] = warn
        # SHEP-335: what it got from its repo's settings (or Everywhere's), so the Assistant knows the repo's, not its own
        got = [x for x in task_settings(s, t) if x["by"] and x["by"] != "task" and x["label"] in ("Review", "Merge", "Proof", "Agent")]
    if at:
        ensure_scheduler_quietly()
    said = "; ".join(f"{x['label']} {x['text'].split(':')[0]} ({SET_BY[x['by']]})" for x in got)
    say(args, v, f"{s.name(t)} added (its key, for commands only: {s.ref(t)})" + (f": {v['why']}" if at else "")
        + (f"\nIts settings: {said}." if said else "") + (f"\nHeads-up: {v['warning']}" if v.get("warning") else ""))


def detached_refusal(s, t):
    """#1533: a worktree task with no base of its own takes the folder's checked-out branch; on a detached commit
    there is none to merge into (its pull request can't open), so it's refused at add."""
    if t.get("mode") != "worktree" or t.get("base") or t.get("pr") or s.loc["kind"] != "repo":
        return
    if not git(s.loc["folder"], "symbolic-ref", "--quiet", "HEAD")[0]:
        raise Fail(DETACHED.format(folder=s.loc["folder"]))


def shared_branch_warning(s, t):
    """#1443: a task added to work in the folder itself while the folder is on another branch than the repo's main line:
    its reviews and ready check the folder's branch, so work it does on a branch of its own goes unseen. Said at add."""
    if t.get("mode") == "worktree" or s.loc["kind"] != "repo":
        return None
    main = s.loc["folder"]
    ok, here, _ = git(main, "symbolic-ref", "--quiet", "--short", "HEAD")
    line_ = default_branch(main)
    if not line_ or (ok and here == line_):
        return None
    on = here if ok else "a detached commit"
    return (f"{main} is on {on}, not {line_}, and this task works in the folder itself, so its reviews and ready check "
            f"{on}. For a branch of its own, add it with --worktree; if its agent makes its own branch, point the task at it "
            f"once started: herdr-task edit {s.ref(t)} --branch <that branch>.")


# ---- scheduled (SHEP-38) -----------------------------------------------------------------------
# A task that starts by itself at a time (--at "fri 9:00", --in 6h): state "scheduled" with
# scheduled_for (ms) and what start would use (queue: argv, space, parent). The scheduler's tick
# (tick.py's due_pass) queues it once that time comes, also a time passed while the machine was
# off, and the queue starts it as any queued task (after its --after tasks).

def scheduled_at(args):
    """--at / --in as a moment (ms), or None when neither was given."""
    at, within = getattr(args, "at", None), getattr(args, "in_", None)
    if at is None and within is None:
        return None
    return when_from(at, within)


def schedule(s, t, at, plan=None):
    if t["state"] not in ("todo", "scheduled", "queued"):
        raise Fail(f"{s.name(t)} has already started ({STATUSES.get(t['state'], t['state'])}); only a task not started yet can be scheduled.")
    q = plan or t.get("queue") or {}
    check_automatic_agent(q.get("argv") or worker_argv(s, t, q.get("space") or t.get("space")))
    t["state"], t["scheduled_for"] = "scheduled", at
    if plan is not None:
        t["queue"] = plan
    for k in ("queued_at", "held"):
        t.pop(k, None)
    s.dirty = True


def unschedule(t):
    """Back to To do, as if never scheduled (a task that isn't scheduled is left as it is)."""
    if t["state"] != "scheduled":
        return
    t["state"] = "todo"
    for k in ("scheduled_for", "queue", "queued_at", "held"):
        t.pop(k, None)


def ensure_scheduler_quietly():
    try:
        ensure_scheduler(quiet=True)
    except Exception:
        pass


def set_base(s, t, base, space=None, new=False, args=None):
    """--base: the branch a worktree task branches from and merges into (its pull request's base).
    Without it a new task takes its space's base branch (Shepherdr settings > Tasks > Base branch,
    as Shepherdr's space.base: captured when added, so a later change only touches new tasks);
    unset, the folder's current branch, kept unmarked. "" goes back to the folder's. A started task moves onto it
    (restack(): what it did is returned)."""
    if base is None:
        own = space_base(s, space) if new and t.get("mode") == "worktree" else ""
        main = s.loc["folder"]
        if own and own != current_base(main):
            try:
                base_ref(main, own)
            except Fail as e:
                raise Fail(f"This repo's base branch is {own} (Shepherdr settings > Tasks > Base branch), but: {e} "
                           "Change the setting, or pass --base.")
            t["base"], t["base_set"], t["base_by"] = own, True, "space"
        return
    base = base.strip()
    if t.get("worktree"):
        # #1403: a started task moves: its pull request retargeted, its own commits rebased onto the new base
        if t.get("mode") != "worktree":
            raise Fail("--base is for tasks in a worktree; this one works in the folder itself.")
        if t["state"] == "done":
            raise Fail(f"{s.name(t)} is done; its base can't change now.")
        main = s.loc["folder"]
        base = base or current_base(main)
        if base == t.get("base"):
            return None
        base_ref(main, base)
        return restack(s, t, base, args=args)
    t.pop("base_by", None)
    if not base:
        t.pop("base", None)
        t.pop("base_set", None)
        return
    if t.get("mode") != "worktree":
        raise Fail("--base is for tasks in a worktree; this one works in the folder itself.")
    main = s.loc["folder"]
    base_ref(main, base)
    if base == current_base(main):
        t.pop("base", None)
        t.pop("base_set", None)
    else:
        t["base"], t["base_set"] = base, True


def restack(s, t, into, tip=None, how=None, args=None):
    """#1403: moves a task onto base `into` (stack.move): its record and pull request, and its branch rebased when
    nobody works there now (its own agent asking is fine). What is left (a conflict, uncommitted work, an agent
    mid-turn) goes to its agent: a Ready one back to work with it. Returns what stack.move() did."""
    me = os.environ.get("HC_TERMINAL_ID")
    me = bool(me and any(a.get("address") == me for a in t.get("agents") or []))
    busy = bool(t.get("worktree")) and not me and mid_turn(s, t)
    res = stack.move(s, t, into, tip, rebase=not busy)
    res["how"] = how
    left = res.get("conflict") or res.get("todo")
    if not res.get("command") or me or not (left or res.get("rebased")):
        return res
    msg = stack.words(s, t, res, how)
    if left and t["state"] == "ready":
        t["fix_requested"] = t["handed_at"] = now()
        try:
            tell(s, t, msg, args)
        except Fail as e:
            t["attention"], t["attention_at"] = f"Its base moved to {into}, and its agent couldn't be told: {e}", now()
            return res
        back_to_work(s, t, f"its base moved to {into}", f"Moving onto {into}")
        res["told"] = True
    elif t["state"] == "running":  # a resting Ready one's agent isn't woken for a move that went through
        live = workers(s, t)
        if live:
            from .news import send_or_hold
            res["told"] = bool(send_or_hold(live[-1]["address"], msg))
    return res


def moved_words(s, t, res):
    """edit's line about a started task's move."""
    if not res:
        return ""
    line = f" It now merges into {res['to']}"
    if res.get("rebased"):
        line += f"; its branch was rebased onto {res['to']} (only its own commits)"
    elif res.get("conflict") or res.get("todo"):
        why = f"conflicts in {', '.join(res['conflict'][:5])}" if res.get("conflict") else res["todo"]
        line += (f"; its branch wasn't rebased ({why}): in {t.get('worktree')}, run `git fetch` and `{res['command']}`"
                 + (" (its agent was told)" if res.get("told") else ""))
    if res.get("pr_error"):
        line += f"; its pull request couldn't be retargeted: {res['pr_error']}"
    return line + "."


PR_FIELDS = "number,url,state,isCrossRepository,headRefName,headRefOid,baseRefName,mergeCommit"


def take_pr(s, t, number, *, ready=False):
    """--pr <n> (#1155, #1195): the task takes a pull request that is already open (a person's, a bot's,
    one its agent opened on another branch) instead of opening its own. Its review, checks news and
    Accept work on that one; ready pushes to the branch it took, protected by a lease, and leaves its
    description as it is (pr["branch"], as #828's). Before its worktree is made, the worktree starts from
    that branch and takes its base; after, the task's branch must already hold its latest commit.
    "" lets go of a pull request taken this way (ready opens the task's own again)."""
    if number is None:
        return
    number = str(number).strip().lstrip("#")
    if not number:
        if (t.get("pr") or {}).get("taken"):
            t.pop("pr")
        return
    if not number.isdigit():
        raise Fail(f"--pr takes a pull request's number, like 42; not {number!r}.")
    if t.get("mode") != "worktree":
        raise Fail("--pr is for tasks in a worktree; this one works in the folder itself.")
    repo = github(s)
    if not repo:
        raise Fail(github_unreachable(s) or "--pr needs a folder whose remote is on GitHub.")
    ok, out, err = gh("pr", "view", number, "--repo", repo, "--json", PR_FIELDS)
    try:
        v = json.loads(out) if ok else None
    except ValueError:
        v = None
    if not isinstance(v, dict) or not v.get("number"):
        raise Fail(f"Couldn't find pull request #{number} in {repo}: {err or out or 'no answer'}")
    n, head, into = v["number"], v.get("headRefName") or "", v.get("baseRefName") or "main"
    merged = ready and v.get("state") == "MERGED" and head == t.get("branch")
    if v.get("state") != "OPEN" and not merged:
        raise Fail(f"Pull request #{n} is {str(v.get('state') or 'not open').lower()}: only an open one can be taken.")
    if v.get("isCrossRepository"):
        raise Fail(f"Pull request #{n} comes from a fork: Herdr can't push to its branch. Leave --pr out, so ready "
                   "opens the task's own.")
    if head == (t.get("base") or "main"):
        raise Fail(f"Pull request #{n} is from this task's base branch. Use the task's own branch.")
    mine = t.get("pr") or {}
    if not merged and mine.get("number") == n and mine.get("repo") == repo:
        return
    other = next((o for o in s.data["tasks"] if o is not t and o.get("state") != "done"
                  and (o.get("pr") or {}).get("number") == n and (o.get("pr") or {}).get("repo") == repo), None)
    if other:
        raise Fail(f"Pull request #{n} is already {s.ref(other)}'s.")
    main, wt = s.loc["folder"], t.get("worktree")
    if wt or merged:
        if into != (t.get("base") or "main"):
            raise Fail(f"Pull request #{n} merges into {into}, and {s.name(t)} into {t.get('base') or 'main'}: its "
                       "worktree's base can't change now. Take it in a new task (add --pr).")
        if merged:
            tip = branch_tip(s, t)
            if tip and not git(main, "merge-base", "--is-ancestor", tip, v.get("headRefOid") or "-")[0]:
                remote = remote_of(main)
                git(main, "fetch", "--quiet", remote, into)
                if not in_base(s, t) and not landed(s, t):
                    raise Fail(f"Pull request #{n} is merged, but this branch still has work outside {into}.")
        elif head != t.get("branch"):
            remote = remote_of(main)
            git(main, "fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{head}:refs/remotes/{remote}/{head}")
            if not git(main, "merge-base", "--is-ancestor", v.get("headRefOid") or "-", t["branch"])[0]:
                raise Fail(f"{t['branch']} doesn't hold pull request #{n}'s latest commit, so its commits can't go on {head}. "
                           f"Merge it in first (git fetch {remote} {head}, then git merge FETCH_HEAD), commit, and run "
                           "this again.")
    else:
        if (t.get("base") or into) != into and t.get("base_by") != "space":
            raise Fail(f"Pull request #{n} merges into {into}, not {t['base']}: leave --base out.")
        set_base(s, t, into)
    t["pr"] = {"number": n, "url": v.get("url"), "repo": repo, "taken": True,
               **({"branch": head, "lease": v.get("headRefOid")} if head and head != t.get("branch") else {})}
    for k in ("pr_note", "merge_queued"):
        t.pop(k, None)
    s.dirty = True
    return v if merged else None


def set_notes(t, args):
    """--start-notes / --finish-notes: this task's own, replacing its folder's ("" goes back to the folder's)."""
    for which in ("start", "finish"):
        v = getattr(args, f"{which}_notes", None)
        if v is not None and v.strip():
            t[f"{which}_notes"] = v.strip()
        elif v is not None:
            t.pop(f"{which}_notes", None)


def cmd_show(args):
    with open_store(args, write="try") as s:
        t = s.find(args.id)
        live = [detail(k) for k in live_agents(s.key(t))]
        refresh_sessions(s, t, live)
        # Back at work since it said ready: saved at once, so the Accept card (which reads this)
        # says it's Working, not Ready.
        if busy_again(t, live):
            # #1489: its agent's own turn, as tick's back_pass() says it: Ready again once that turn changes nothing
            back_to_work(s, t, "its agent is at work again", auto=True)
        v = view(s, t, live)
        if t["state"] == "queued":
            v["reason"] = queue_reason(s, t)
        v["settings"] = task_settings(s, t)
        on, rounds = review_limits(s, t)
        if on:
            v["review_rounds"] = {"used": rounds_used(t), "of": rounds, "added": int(t.get("review_rounds_added") or 0)}
            # #1116: what the last round found, so the Assistant grants or declines another round on evidence
            last = next((x for x in reversed(t.get("reviews") or []) if x.get("result") in REVIEWED), None)
            if last:
                v["review_rounds"]["last"] = {"head": last.get("head"), "text": last.get("text") or ""}
        v["after_refs"] = after_refs(s, t)
        # SHEP-322: what it comes after, by title (its keys stay in after_refs, for commands)
        known = {o["id"]: o for o in s.data["tasks"]}
        after_names = [s.name(known[i]) for i in t.get("after") or [] if i in known] + [
            quoted(x["title"]) if x.get("title") else x["ref"] for x in t.get("after_ext") or []]
        block = settings_block(s, t, sources=True)
        if getattr(args, "evidence", False):
            # What the Accept card shows: commits, files, checks and the proof (proof.py).
            v["evidence"] = evidence(s, t)
    text = [line(v), f"folder: {v['folder']}"]
    if v.get("worktree"):
        text.append(f"worktree: {v['worktree']} (branch {v['branch']}, base {v.get('base')})")
    elif v.get("branch") and v.get("mode") == "worktree":
        text.append(f"branch: {v['branch']} (set for this task)")
    if v.get("base_set"):
        text.append(f"merges into: {v['base']} (" + ("its repo's base branch" if v.get("base_by") == "space" else "set for this task") + ")")
    if v.get("after_refs"):
        text.append("comes after: " + ", ".join(after_names))
    if v.get("review_rounds"):
        r = v["review_rounds"]
        text.append(f"review rounds: {r['used']} of {r['of']} used" + (f" ({r['added']} added by the assistant)" if r["added"] else "")
                    + (" (ready refused: out of rounds)" if v.get("review_out") else ""))
        last = r.get("last")
        if last and v.get("review_out"):
            text.append(f"last round ({(last.get('head') or '')[:7] or 'no commit'}): {last.get('text') or 'no findings given'}")
    if v.get("agents_md"):
        text.append(f"for AGENTS.md: {v['agents_md']}")
    if v.get("pr"):
        text.append(f"pull request: #{v['pr']['number']} {v['pr']['url']}")
    if v.get("why") and v["status"] == "needs":
        text.append(f"needs the person: {v['why']}")
    if v.get("proof"):
        text.append(f"proof: {v['proof']['title']} ({v['proof']['id']})")
    if v.get("after_accept"):
        from .after_accept import describe
        text.append(f"when accepted: {describe(v['after_accept'])}")
    if v.get("archived"):
        text.append(f"archived: {time.strftime('%Y-%m-%d %H:%M', time.localtime(v['archived'] / 1000))} (still kept; writing to it brings it back)")
    for k in v["live"]:
        text.append(f"agent: {k['address']} {k['status'] or ''}")
    if v.get("prompt"):
        text.append("\n" + v["prompt"].strip())
    text.append("\n" + block)
    say(args, v, "\n".join(text))


def begin(s, t, argv, space, parent=None):
    """Starts the task's first agent. Returns its record."""
    reviewer_pick(s, t, space)
    t["state"], t["started"] = "running", now()
    # Its brief teaches `reviewed`: ready waits for a review of its final commit (review_refusal).
    t["review_gate"] = True
    for k in ("queue", "queued_at", "attention", "held", "scheduled_for"):
        t.pop(k, None)
    if t.get("mode") == "worktree" and not t.get("worktree") and not worktrees_on(s, space):
        t["mode"] = "here"
    had = bool(t.get("mode") == "worktree" and t.get("worktree") and os.path.isdir(t["worktree"]))
    folder_for(s, t)
    # Settings > Tasks > Before the agent starts: run first in a new worktree, in the agent's terminal (launch.py).
    setup = setup_for(s, t, space, had)
    if t.get("mode") != "worktree" and s.loc["kind"] == "repo":
        # The folder's commit as it starts: still there, and nothing tracked changed, at ready means
        # it changed nothing, so there is nothing to review (review_refusal, #744).
        t["folder_start"] = git(s.loc["folder"], "rev-parse", "HEAD")[1] or None
    parent = parent_for(parent, space)
    return launch(s, t, argv, space, brief(s, t, parent, space, argv), parent=parent, setup=setup)


def tilde(p):
    home = os.path.expanduser("~")
    return "~" + p[len(home):] if p.startswith(home + os.sep) else p


def cmd_setup_failed(args):
    """A task's setup command (Settings > Tasks > Before the agent starts) failed in its terminal, so its agent
    didn't start (launch.SETUP_SH): the task waits for the person with why, its output's last line and where
    the rest is. Starting it again runs the setup again."""
    tail = ""
    try:
        with open(args.log, errors="replace") as f:
            lines = [ln.strip() for ln in f.read()[-20000:].splitlines() if ln.strip()]
        tail = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", lines[-1])[:160] if lines else ""
    except OSError:
        pass
    with open_store(args) as s:
        t = s.find(args.id)
        t["setup_failed"] = {"code": args.code, "log": args.log, "at": now()}
        # Its agent never started: never "already running" (just_started) when it's started again at once.
        for ag in (t.get("agents") or [])[-1:]:
            ag.setdefault("ended", now())
        t["attention"] = (f"Its setup before the agent failed (exit {args.code})" + (f": {tail}" if tail else "") +
                          f". The agent didn't start. Full output: {tilde(args.log)}. Fix the setup in Settings › Tasks "
                          f"› Before the agent starts (or the worktree), then start it again.")
        t.pop("attention_at", None)
        s.dirty = True


# #1053: an agent just launched still shows its shell for a moment (agent_running() says no): a task
# whose agent started this recently is starting, never started a second time.
STARTING_MS = 120000


def just_started(t):
    """The agent its queue or a start launched moments ago, while it is Working: its record, or None."""
    fresh = [a for a in t.get("agents") or [] if now() - (a.get("at") or 0) < STARTING_MS and not a.get("ended")]
    return fresh[-1] if t.get("state") == "running" and fresh else None


def other_worktree(s, folder):
    """#1210: the work tree `folder` is in, when that is another worktree of this repo than its own folder (a start
    there --here would run in the repo's folder instead), else None."""
    if not folder or s.loc.get("kind") != "repo":
        return None
    ok, top, _ = git(os.path.realpath(os.path.expanduser(folder)), "rev-parse", "--show-toplevel")
    top = os.path.realpath(top) if ok and top else None
    return top if top and top != os.path.realpath(s.loc["folder"]) else None


def cmd_start(args):
    with open_store(args) as s:
        t = s.find(args.id)
        live = [k for k in map(detail, live_agents(s.key(t))) if agent_running(k)] or [a for a in [just_started(t)] if a]
        if live:
            raise Fail(f"{s.name(t)} is already running ({live[0]['address']}). Use switch or resume.")
        if t["state"] == "done":
            raise Fail(f"{s.name(t)} is done. Reopen it first.")
        if args.here:
            t["mode"] = "here"
        elif args.worktree and worktrees_on(s):
            t["mode"] = "worktree"
        if t.get("mode") != "worktree":
            other = other_worktree(s, getattr(args, "folder", None))
            if other:
                raise Fail(f"{other} is another worktree of {s.loc['folder']}: a start in the folder itself (--here) runs in "
                           f"{s.loc['folder']}, never there. Start it without --here to give it a worktree of its own.")
        set_branch(s, t, getattr(args, "branch", None))
        take_pr(s, t, getattr(args, "pr", None))
        q = t.get("queue") or {}
        # --space, the one it was queued with or added for, its repo's own space (#1209: its news go to that space's Assistant), the caller's
        space = bare(args.space) if args.space else (q.get("space") or t.get("space") or space_for_folder(s.loc["folder"], caller_space()) or default_space())
        # 3.2: started on any pick: its model, effort, speed and permission mode are kept on the task (as edit's)
        picked = False
        for flag in ("model", "effort", "speed", "permission"):
            if getattr(args, flag, None) is not None:
                set_task(t, flag, getattr(args, flag))
                picked = True
        if picked:
            t["pick_at"] = now()
            if q.get("argv") and not q.get("custom"):
                q.pop("argv")
        argv = agent_argv(None, args.argv) if args.argv else worker_argv(s, t, space, args.agent) if args.agent else \
            (q.get("argv") or worker_argv(s, t, space))
        if not args.argv and not q.get("custom"):
            require_task_cli(agent_key(argv))
        parent = args.parent or q.get("parent")
        plan = {"argv": argv, "space": space, "parent": parent, **({"custom": True} if args.argv else {})}
        at = scheduled_at(args)
        if not at and t["state"] == "scheduled" and not args.now:
            at = t.get("scheduled_for")
        if at:
            # start --at / --in: it starts by itself then, as this start would now.
            schedule(s, t, at, plan)
            v = view(s, t)
            reason = "scheduled"
        # A queued task started again goes now; other tasks wait their turn unless --now was given.
        elif (reason := None if (t["state"] == "queued" or args.now) else queue_reason(s, t)):
            t["state"], t["queued_at"] = "queued", now()
            t.pop("scheduled_for", None)
            t["queue"] = plan
            s.dirty = True
            v = view(s, t)
        else:
            a = begin(s, t, argv, space, parent)
            v = view(s, t)
    # The scheduler starts queued tasks and tells the Assistant its tasks' news.
    try:
        ensure_scheduler(quiet=True)
    except Exception:
        pass
    if reason == "scheduled":
        say(args, v, f"{s.name(t)} is scheduled: {v['why']}. It starts by itself then.")
        return
    if reason:
        say(args, {**v, "queued": True, "reason": reason}, f"{s.name(t)} is queued ({reason}). It starts by itself when it can.")
        return
    out = {**v, "terminal": a["address"], "space": space, "parent": a.get("parent")}
    text = f"{s.name(t)} started: {a['address']} in {folder_desc(t, s)}"
    # Codex's sandbox can't start here (SHEP-227, #998): whoever started it hears why and the fix, once per start.
    from .launch import dont_ask_default, folder_for
    if dont_ask_default(argv, folder_for(s, t)):
        # #1110: the person's defaultMode, dontAsk, refuses a worker everything instead of asking
        out["mode"] = ("Claude Code's settings start new sessions in don't-ask mode, which refuses instead of asking: "
                       "this worker starts in the default mode, asking on its card.")
        text += "\n\n" + out["mode"]
    broken = sandbox.check() if sandbox.sandboxed(argv) else None
    if broken:
        out["sandbox"] = sandbox.notice(broken)
        text += "\n\n" + out["sandbox"]
    say(args, out, text)


def folder_desc(t, s):
    return f"{t['worktree']} ({t['branch']})" if t.get("worktree") else s.loc["folder"]


def ready_words(args):
    """The ready summary in one line, refused past SUMMARY_MAX (as Shepherdr's) before anything
    changes; --details, any length, as written."""
    said = " ".join(str(args.summary or "").split())
    if len(said) > SUMMARY_MAX:
        raise Fail(f"That summary is {len(said)} characters: write a shorter one, {SUMMARY_MAX} at most, in plain words on "
                   f"what the person now sees or can do (no file names, flags or jargon). Put the detail in --details \"…\" "
                   f"(a few short bullets in plain words, folded on its review card) or in your proof, then run ready again.")
    return said, str(args.details or "").strip()


def on_branch(t, wt):
    """#1194: ready works on the task's branch. HEAD on another branch (a part 2 made in the same worktree) would be
    neither pushed nor opened: the task's pull request is its branch's, so refused, saying which and how."""
    br = t.get("branch")
    ok, here, _ = git(wt, "symbolic-ref", "--quiet", "--short", "HEAD")
    if not br or (ok and here == br):
        return
    if not ok:
        # detached: fine at the branch's own tip (a check run), else work the branch doesn't hold
        if git(wt, "rev-parse", "HEAD")[1] == git(wt, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")[1]:
            return
        here = f"a detached commit ({git(wt, 'rev-parse', '--short', 'HEAD')[1]})"
    pr = t.get("pr") or {}
    has = f" (its pull request is #{pr['number']})" if pr.get("number") else ""
    raise Fail(f"HEAD is on {here}, not on this task's branch {br}{has}: ready pushes and opens only {br}. Put the work "
               f"on {br} (git switch {br}, then merge or cherry-pick it), or, for a second pull request, open it yourself "
               "and ask your Assistant for a task to track it (add --pr <its number>).")


def pr_words(t, args):
    """--pr-title / --pr-body / --draft (#1087, #1155): kept on the task; the pull request opens with them, and a later
    ready that gives them again changes the open one (github.pr_open). "" goes back to Shepherdr's own."""
    for k in ("pr_title", "pr_body"):
        v = getattr(args, k, None)
        if v is None:
            continue
        v = v.strip() if k == "pr_body" else " ".join(v.split())
        if v:
            t[k] = v
            t[f"{k}_new"] = True
        else:
            t.pop(k, None)
    if getattr(args, "draft", False):
        t["pr_draft"] = True


TOLD_MAX = 4000


def quiet_ready(args):
    """ready --nothing / --told "<text>" (3.2, steps 42 and 45): a schedule's run that changed nothing ends without
    review. --nothing: there was nothing to do; Done at once, no alert, no message (quiet: "nothing"). --told: it only
    had something to say; the same text goes to its space's chat and it is Done (quiet: "told", the text kept as told).
    A run that changed things is refused here: it goes through review and merging like any task."""
    told = " ".join(str(args.told).split()) if getattr(args, "told", None) is not None else None
    if getattr(args, "nothing", False) and told is not None:
        raise Fail("Say --nothing or --told, not both.")
    if told is not None and not told:
        raise Fail("--told takes what you have to say: ready --told \"<the text, as the person should read it>\".")
    if told and len(told) > TOLD_MAX:
        raise Fail(f"That is {len(told)} characters: say it in {TOLD_MAX} at most (the rest belongs in an artifact).")
    with open_store(args) as s:
        t = s.find(args.id)
        ref = s.ref(t)
        if t["state"] == "done":
            raise Fail(f"{s.name(t)} is already done.")
        if not t.get("automation"):
            raise Fail(f"{s.name(t)} wasn't started by a schedule: --nothing and --told are for a schedule's run. Hand it in "
                       "with ready --summary \"…\".")
        wt = t.get("worktree") if t.get("mode") == "worktree" else None
        changed = None
        if wt and os.path.isdir(wt):
            if git(wt, "status", "--porcelain", "--untracked-files=no")[1]:
                changed = f"{wt} has uncommitted changes"
            elif t.get("start") and not in_base(s, t):
                changed = f"its branch {t.get('branch')} has commits of its own"
        elif not wt and t.get("folder_start") and not unchanged_folder(s, t):
            changed = f"{s.loc['folder']} changed since it started"
        if changed:
            raise Fail(f"{s.name(t)} changed things ({changed}): a run that changed things is reviewed like any task. Hand it in "
                       "with ready --summary \"…\" (or undo the changes first).")
        t["quiet"] = "told" if told else "nothing"
        if told:
            t["told"] = told
            t["summary"] = fit(told, SUMMARY_MAX)
        else:
            t.pop("told", None)
            t["summary"] = "Nothing to do"
        for k in ("attention", "attention_at", "handed_at", "fix_requested", "progress", "review_out", "back", "merge_failed"):
            t.pop(k, None)
        clear_stopped(t)
        t["nothing_to_merge"] = True
        finish(s, t, even_if_busy=True, quiet=True)
        v = view(s, t)
    say(args, v, f"{s.name(t)} is done: " + ("told the person in its space's chat." if told else "nothing to do.") + " End your turn.")


def cmd_ready(args):
    own_core_check()
    if getattr(args, "nothing", False) or getattr(args, "told", None) is not None:
        return quiet_ready(args)
    said, details = ready_words(args)
    with open_store(args) as s:
        t = s.find(args.id)
        me = os.environ.get("HC_TERMINAL_ID")
        if me and any(a["address"] == me for a in t["agents"]):
            refresh_sessions(s, t, [k for k in live_agents(s.key(t)) if k["address"] == me])
        if t["state"] == "done":
            raise Fail(f"{s.name(t)} is already done.")
        wt = t.get("worktree") if t.get("mode") == "worktree" else None
        pr = t.get("pr") or {}
        if pr.get("from_base") or (pr.get("branch") and (not pr.get("taken") or pr["branch"] == t.get("base"))):
            t.pop("pr")  # Older versions took another branch's PR without being asked.
            for k in ("pr_note", "merge_queued"):
                t.pop(k, None)
        merged_pr = None
        if wt and os.path.isdir(wt):
            if git(wt, "status", "--porcelain", "--untracked-files=no")[1]:
                raise Fail(f"{wt} has uncommitted changes. Commit them, then run ready again.")
            on_branch(t, wt)
            t["head"] = git(wt, "rev-parse", "HEAD")[1]
            # #1403: its base, another task's branch, merged (squash too, its branch maybe deleted): it moves onto that
            # branch's base first, only its own commits rebased there, rather than a pull request into a branch that's gone
            gone = stack.merged_base(s, t) if stack.stacked(t) and not (t.get("pr") or {}).get("number") else None
            moved = restack(s, t, gone["into"], gone["tip"], gone["how"], args) if gone else {}
            if moved.get("rebased"):
                t["head"] = moved["rebased"]
            unmoved = (stack.lead(s, t, moved, gone["how"]).capitalize()[:1] + stack.lead(s, t, moved, gone["how"])[1:] + ", but its branch couldn't be rebased there by "
                       f"Herdr (" + (f"conflicts in {', '.join(moved['conflict'][:8])}" if moved.get("conflict") else moved["todo"]) +
                       f"). In {wt}: `git fetch`, then `{moved['command']}` (it replays only your own commits), resolve any "
                       "conflicts, run the checks, commit, and run ready again.") \
                if moved.get("conflict") or moved.get("todo") else None
            number = getattr(args, "pr", None)
            if number is not None:
                merged_pr = take_pr(s, t, number, ready=True)
            pr_words(t, args)
            own_work(s, t)
            # SHEP-320: other tasks run in parallel and may have merged meanwhile: a branch that conflicts with its
            # base's newest is refused here, with what collided, rather than at its merge. Behind but clean passes.
            c = collision(s, t, fetch=True) if t.get("start") and not unmoved and not merged_pr else None
            collides = (f"{s.name(t)}'s branch conflicts with {c['ref']}, which moved on since it started"
                        + (f" ({', '.join(c['by'][:3])} merged)" if c["by"] else "") + f". {collision_words(c)} "
                        "Then commit and run ready again.") if c else None
        else:
            collides = unmoved = None
            if getattr(args, "pr", None):
                if not wt:
                    raise Fail("--pr is for tasks in a worktree; this one works in the folder itself.")
                merged_pr = take_pr(s, t, args.pr, ready=True)
                if not merged_pr:
                    raise Fail("The worktree is gone. Restore it before saying ready with an open pull request.")
        refused = unmoved or collides or review_refusal(s, t, wt)
        if refused:
            # Kept (the task's line says why it waits); refused after the store is saved.
            s.dirty = True
        else:
            if said:
                t["summary"] = said
                # A new summary brings its own details (or none): an older one's would be stale.
                if details:
                    t["details"] = details
                else:
                    t.pop("details", None)
            elif details:
                t["details"] = details
            # Its proof artifact (--proof <id>, else its newest one titled "... · Proof"), linked from
            # the person's Accept card.
            proof = find_proof(s, t, getattr(args, "proof", None))
            if proof:
                t["proof"] = proof
            else:
                t.pop("proof", None)
            asked = next((x["value"] for x in task_settings(s, t) if x["label"] == "Proof"), False)
            note = " ".join(str(args.agents_md or "").split())
            if note:
                # "For AGENTS.md": what the next agent would need about setting up or testing this
                # repo; the Assistant decides whether it goes into the repo's AGENTS.md.
                t["agents_md"] = note[:300]
            for k in ("attention", "attention_at", "handed_at", "fix_requested", "progress", "retry", "review_out", "back", "merge_failed",
                      "merge_failed_at"):
                t.pop(k, None)
            clear_stopped(t)
            # Its agents' turns now: a later turn of theirs takes it back to work (busy_again()).
            t["ready_turns"] = ready_turns(live_agents(s.key(t)))
            s.dirty = True
    if refused:
        raise Fail(refused)
    with open_store(args) as s:
        t = s.find(args.id)
        # Its review is the agent's own, as its brief's Settings block says (herdr-task starts no
        # reviewers). A worktree branch with nothing beyond its base (none of its own, or only its
        # base caught up with: a research or artifact-only task) still waits in Ready for the
        # person's Accept, its summary, details and artifacts on the card (SHEP-96); no pull request,
        # and Accept just marks it done and cleans up its worktree.
        if wt and t.get("start") and not merged_pr and in_base(s, t) and not merged_here(s, t):
            t["nothing_to_merge"] = True
        else:
            t.pop("nothing_to_merge", None)
        # Its work already in its base (SHEP-59: its pull request squash-merged, or nothing left to
        # merge): done at once, never a second pull request.
        gone = merged_pr
        if gone is None and wt and t.get("start") and not t.get("nothing_to_merge"):
            gone = already_merged(s, t)
        if gone is not None:
            t["merged"] = True
            if gone:
                watch_main(s, t, (gone.get("mergeCommit") or {}).get("oid"))
                update_main(s, t)
            finish(s, t, even_if_busy=True)
            v = view(s, t)
            how = f"pull request #{gone['number']} is merged" if gone else f"its work is already in {t.get('base') or 'main'}"
            say(args, v, f"{s.name(t)}: {how}; done.")
            return
        if wt and not os.path.isdir(wt) and not t.get("nothing_to_merge"):
            # #1426: its worktree removed (after a merge, say) and its work not in its base: said, never a pull request
            # or a merge from a folder that isn't there.
            main, br, base = s.loc["folder"], t.get("branch"), t.get("base") or "main"
            q = shlex.quote
            has = br and git(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")[0]
            raise Fail(f"{s.name(t)}'s worktree {wt} is gone, and its work isn't in {base}. "
                       + (f"Bring it back (git -C {q(main)} worktree add {q(wt)} {br}), then run ready again." if has else
                          f"Its branch {br} is gone too: nothing is left here to merge. Tell the person."))
        msg = finalize(s, t)
        # Its own background work still running (SHEP-148): the task shows Working until it ends.
        # #1093: named, and Codex's only while something of its own really runs (ended ones never listed)
        mine = next((k for k in live_agents(s.key(t)) if k.get("address") == me), None) if me else None
        jobs, log = own_jobs(t, mine) if mine else ({}, None)
        if jobs and t["state"] == "ready":
            names = job_names(log, sorted(jobs, key=jobs.get))
            msg += (f" {len(jobs)} background job{'s' if len(jobs) > 1 else ''} of yours still run{'' if len(jobs) > 1 else 's'} "
                    f"({', '.join(names[:6])}{', …' if len(names) > 6 else ''}): the task shows Working until they end, then Ready. "
                    "Stop any you don't need (a server, a watcher).")
        if proof:
            msg += f" Proof: {proof['title']}."
        elif asked:
            msg += (" No proof artifact found, and your Settings block asks for one: publish it (herdr-artifact), "
                    "then run ready again with --proof <its id>.")
        v = view(s, t)
    say(args, v, msg)
    if msg.startswith(f"{s.name(t)} {READY_BUT}"):
        sys.exit(1)  # its push or pull request failed: not ready the way it meant (#795)


REVIEWED = ("report", "pass", "changes")  # a recorded review round (report: the agent's own reviewed)


def rounds_used(t):
    return sum(1 for r in t.get("reviews") or [] if r.get("result") in REVIEWED)


def review_refusal(s, t, wt):
    """Why ready is refused for review (as Shepherdr's: `ready` waits for a review of the final
    commit), or None. Only tasks whose brief taught `reviewed` (review_gate) and whose Settings
    block says Review: on. A worktree task's final commit must be one a round was recorded on; a
    task in the folder itself needs a round recorded since it started. #1557: once all its rounds are used, ready takes
    the final commit unreviewed (the fix of the last findings): the number of rounds is what the person asked for, and
    its agent says on the card that the last fix wasn't reviewed again. Only the person adds a round (review-more)."""
    on, rounds = review_limits(s, t)
    if not on or not t.get("review_gate"):
        return None
    if wt and t.get("start") and in_base(s, t):
        return None  # no commits of its own: nothing to review (nothing to merge)
    if not wt and t.get("folder_start") and unchanged_folder(s, t):
        return None  # in the folder itself, and it changed nothing (#744: a run that only reads)
    if rounds_used(t) >= rounds:
        return None  # #1557: all rounds used: ready takes it, the last fix unreviewed (its agent says so on the card)
    revs = rounds_this_run(t)
    head = t.get("head") if wt else None
    if (any(r.get("head") == head for r in revs) if wt else bool(revs)):
        return None
    if wt and head and carried_over(s, t, wt, {r.get("head") for r in revs if r.get("head")}, head):
        return None
    ref, ht, folder = s.ref(t), own_path(), shlex.quote(s.loc["folder"])
    what = f"your final commit {head[:7]}" if head else "this task's work"
    seen = sorted({r["head"][:7] for r in revs if r.get("head")}) if wt else []
    if seen:
        what += f" (rounds are recorded on {', '.join(seen)})"
    # #1116: a round after an earlier one reviews what changed since the newest reviewed commit still on this branch,
    # never the whole task again (its reviewer found fresh nits in code it had passed)
    last = next((r["head"] for r in reversed(revs) if wt and r.get("head")
                 and git(wt, "merge-base", "--is-ancestor", r["head"], head or "HEAD")[0]), None)
    delta = (f" Since round on {last[:7]}, have only what changed reviewed (git diff {last[:7]}..HEAD, and any merge's "
             "conflict resolutions), with that round's findings.") if last else ""
    return (f"Review is on and {what} isn't reviewed. Have it reviewed as your brief says, fix what must be fixed, record the "
            f"round with `{ht} reviewed {ref} --folder {folder} --report \"<findings, a line>\"` (on the commit you'd say "
            f"ready at), then run ready again.{delta} {rounds - rounds_used(t)} of {rounds} rounds left.")


def work_tree(s, t, folder=None):
    """#1443: where a task's work is, and the ref of its newest commit there: (path, ref). A worktree task's own
    worktree; else the worktree its branch is checked out in (or the branch itself, checked out nowhere); else, for a
    task in the folder itself, the worktree of this repo the caller works in (its --folder or current folder: a worker
    that made its own worktree and branch), else the folder. (None, None) outside a git repo."""
    wt = t.get("worktree") if t.get("mode") == "worktree" else None
    if wt and os.path.isdir(wt):
        return wt, "HEAD"
    if s.loc["kind"] != "repo":
        return None, None
    main = s.loc["folder"]
    trees = worktree_list(main)
    br = t.get("branch") if t.get("mode") == "worktree" else None
    if br:
        tree = next((w for w in trees if w["branch"] == br), None)
        if tree:
            return tree["path"], "HEAD"
        if git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{br}")[0]:
            return main, f"refs/heads/{br}"
    if not br:
        others = [os.path.realpath(w["path"]) for w in trees if os.path.realpath(w["path"]) != os.path.realpath(main)]
        for p in (folder, os.getcwd()):
            if not p:
                continue
            p = os.path.realpath(os.path.expanduser(p))
            inside = [w for w in others if p == w or p.startswith(w.rstrip(os.sep) + os.sep)]
            if inside:
                return max(inside, key=len), "HEAD"
    return main, "HEAD"


def work_words(s, where, ref):
    """The branch (or commit) a work_tree is on, and where, for what reviewed says."""
    if ref != "HEAD":
        return f"{ref[len('refs/heads/'):] if ref.startswith('refs/heads/') else ref}, not checked out"
    ok, br, _ = git(where, "symbolic-ref", "--quiet", "--short", "HEAD")
    on = br if ok else f"a detached commit ({git(where, 'rev-parse', '--short', 'HEAD')[1]})"
    return on if where == s.loc["folder"] else f"{on} in {where}"


def unchanged_folder(s, t):
    """A task in the folder itself left it as it started: on the same commit, nothing tracked changed. #1443: never
    when its work is in another worktree (a worker that made its own): the folder is unchanged, its work isn't."""
    folder = s.loc["folder"]
    if work_tree(s, t)[0] != folder:
        return False
    ok, head, _ = git(folder, "rev-parse", "HEAD")
    clean, changed, _ = git(folder, "status", "--porcelain", "--untracked-files=no")
    return ok and head == t["folder_start"] and clean and not changed


def rounds_this_run(t):
    return [r for r in t.get("reviews") or [] if r.get("result") in REVIEWED and (r.get("at") or 0) >= (t.get("started") or 0)]


def carried_over(s, t, wt, reviewed, head):
    """A reviewed commit's review still holds for head: only clean merges of the base since (#741), or the same
    changes of its own against the base as a reviewed commit (#1178: a merge or rebase on a newer base that left the
    task's own diff as it was reviewed, whatever git's merge machinery made of it)."""
    return base_merges_only(s, t, wt, reviewed, head) or same_own_changes(s, t, wt, reviewed, head)


def own_diff(wt, base, commit):
    """The commit's own changes against base (from where they part): each file's header and the lines it adds and
    takes away, without line numbers or the unchanged lines around them (a newer base moves those); None when
    unknown."""
    ok, fork, _ = git(wt, "merge-base", base, commit)
    if not ok or not fork:
        return None
    ok, out, _ = git(wt, "diff", "--no-color", "--no-ext-diff", "--no-renames", "--binary", "--full-index", fork, commit)
    if not ok:
        return None
    return "\n".join(ln for ln in out.split("\n") if not ln.startswith(("index ", "@@ ", " ")) and ln != "")


def same_own_changes(s, t, wt, reviewed, head):
    """#1178: head adds and takes away exactly the lines a reviewed commit did, each against the base (here or on its
    remote): the review covers it, also after a merge whose conflicts were resolved keeping both sides. A resolution
    that changed the task's own lines or dropped the base's, or anything of its own since, differs."""
    main, base = s.loc["folder"], t.get("base") or "main"
    for b in (f"refs/remotes/{remote_of(main)}/{base}", base):
        if not git(wt, "rev-parse", "--verify", "--quiet", f"{b}^{{commit}}")[0]:
            continue
        mine = own_diff(wt, b, head)
        if not mine:
            continue   # unknown, or nothing of its own to compare (empty commits say nothing)
        for r in list(reviewed)[-10:]:
            if own_diff(wt, b, r) == mine:
                return True
    return False


def base_merges_only(s, t, wt, reviewed, head):
    """#741: everything after a reviewed commit (along the branch's first parents) is clean merges
    from its base branch (here or on its remote): each merge's other parent is in the base, and its
    tree is exactly what git's own merge of its two parents gives. Nothing of its own to review; a
    merge with conflicts, or with anything changed beyond the plain merge, still needs a round."""
    main, base = s.loc["folder"], t.get("base") or "main"
    bases = [base, f"refs/remotes/{remote_of(main)}/{base}"]
    c = head
    for _ in range(100):
        if c in reviewed:
            return c != head
        ok, line, _ = git(wt, "rev-list", "--parents", "-n", "1", c)
        parts = line.split() if ok else []
        if len(parts) != 3:
            return False  # a commit of its own (or an octopus): reviewed as usual
        _, first, other = parts
        if not any(git(wt, "merge-base", "--is-ancestor", other, b)[0] for b in bases):
            return False
        ok, tree, _ = git(wt, "merge-tree", "--write-tree", first, other)
        if not ok or not tree or tree.split()[0] != git(wt, "rev-parse", f"{c}^{{tree}}")[1]:
            return False
        c = first
    return False


def cmd_reviewed(args):
    """A task's agent records one review round of its current commit (its own review: a helper agent
    it started as its hc child, as its brief says). Uses one of its Review rounds; `ready` then accepts that
    commit. Out of rounds it is refused: ready then takes the fix unreviewed (#1557); only the person adds a round."""
    own_core_check()
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] not in ("running", "ready"):
            raise Fail(f"{s.name(t)} isn't being worked on ({STATUSES.get(t['state'], t['state'])}).")
        on, rounds = review_limits(s, t)
        if not on:
            raise Fail(f"Review is off for {s.name(t)}: there is no round to record.")
        used = rounds_used(t)
        wt = t.get("worktree") if t.get("mode") == "worktree" else None
        head = None
        # #1443: the task's own branch wherever it is checked out, never just the folder's HEAD
        where, ref = work_tree(s, t, getattr(args, "folder", None))
        named = getattr(args, "commit", None)
        if named:
            # The commit the round reviewed (#797), fixes perhaps committed since: one on this branch.
            ok, head, _ = git(where, "rev-parse", "--verify", "--quiet", f"{named}^{{commit}}") if where else (False, "", "")
            if not ok or not head:
                raise Fail(f"--commit {named} isn't a commit here.")
            if not git(where, "merge-base", "--is-ancestor", head, ref)[0]:
                raise Fail(f"--commit {named} isn't on this task's branch ({work_words(s, where, ref)}: its newest commit "
                           f"or before it). If its work is on another branch, point the task at it first: herdr-task edit "
                           f"{s.ref(t)} --branch <that branch>.")
        elif where and ref == "HEAD" and where != s.loc["folder"]:
            if git(where, "status", "--porcelain", "--untracked-files=no")[1]:
                raise Fail(f"{where} has uncommitted changes: a review is of a commit. Commit first, then review it "
                           "(or name the commit it reviewed with --commit).")
            head = git(where, "rev-parse", "HEAD")[1]
        elif where:
            head = git(where, "rev-parse", ref)[1] or None
        heads = {r.get("head") for r in rounds_this_run(t) if r.get("head")}
        if wt and head and head not in heads and os.path.isdir(wt) and carried_over(s, t, wt, heads, head):
            # #1178: a clean merge of the base (or the same changes on a newer base) after a reviewed commit: the review
            # holds, and no round is spent on it (agents out of rounds waited for review-more on every merge of main)
            say(args, {**view(s, t), "round": used, "rounds": rounds, "carried": True},
                f"{s.name(t)}: commit {head[:7]} only adds the base branch to a reviewed commit: its review holds, no round "
                "used. Say ready.")
            return
        if used >= rounds:
            raise Fail(f"All {rounds} review rounds of {s.name(t)} are used: that is the number the person asked for, so no "
                       "more review. Fix what the last round found at or above Must fix, commit, and say ready, writing on "
                       "the card (its details) that the last fix wasn't reviewed again.")
        text = " ".join(str(args.report or "").split())[:2000]
        t.setdefault("reviews", []).append({"round": used + 1, "result": "report", "text": text, "at": now(), "head": head,
                                            "by": os.environ.get("HC_TERMINAL_ID")})
        t.pop("review_out", None)
        s.dirty = True
        v = view(s, t)
    on_what = f" for commit {head[:7]} ({work_words(s, where, ref)})" if head else ""
    say(args, {**v, "round": used + 1, "rounds": rounds}, f"{s.name(t)}: review round {used + 1} of {rounds} recorded{on_what}.")


def cmd_review_more(args):
    """The Assistant gives a task exactly one more review round (as Shepherdr's `task review-more`), when the person
    asks for it (#1557: never on its own): only once all its rounds are used. The limit stops an agent reviewing for
    ever, so the task's own agent can never raise it. Its agent is told."""
    labels = caller_labels()
    with open_store(args) as s:
        t = s.find(args.id)
        if labels.get("herdr.task") == s.key(t) or labels.get("herdr.role") == "reviewer":
            raise Fail("A task's own agent can't add review rounds: say why in your chat and end your turn; your Assistant decides.")
        on, rounds = review_limits(s, t)
        if not on:
            raise Fail(f"Review is off for {s.name(t)}.")
        if t["state"] == "done":
            raise Fail(f"{s.name(t)} is already done; it needs no more review.")
        used = rounds_used(t)
        if used < rounds:
            raise Fail(f"{s.name(t)} has used {used} of {rounds} review rounds; add one only when they are all used.")
        t["review_rounds_added"] = int(t.get("review_rounds_added") or 0) + 1
        t.pop("review_out", None)
        s.dirty = True
        live = workers(s, t)
        told, held, kept = None, False, False
        if live:
            ht, folder = own_path(), shlex.quote(s.loc["folder"])
            from .news import hold, NO_AGENT, send_or_hold
            note = (f"Your Assistant added one review round to {s.name(t)}: {rounds + 1} in all. Have your final commit reviewed "
                    "(what changed since the last reviewed commit: does it fix that round's findings?), "
                    f"record it with `{ht} reviewed {s.ref(t)} --folder {folder} --report \"<findings, a line>\"`, then run ready again.")
            r = send_or_hold(live[-1]["address"], note)
            if r == NO_AGENT:
                # SHEP-324: its agent exited just now: kept for the agent that restarts the task
                hold(live[-1]["address"], note, "send", task=s.key(t))
                kept = True
            told = live[-1]["address"] if r and not kept else None
            held = r == "held"
        v = view(s, t)
    # #1494: read back from the list as saved, so a round that didn't stick is said, never a silent "may now use"
    with open_store(args, write=False) as s:
        now_rounds = review_limits(s, s.find(args.id))[1]
    if now_rounds != rounds + 1:
        raise Fail(f"{s.name(t)} still has {now_rounds} review rounds after adding one (it had {rounds}): the task list "
                   f"of {s.loc['folder']} didn't keep it. Run review-more again; if it says this again, it's a Shepherdr bug.")
    # #1207: "told" only once it went; held (someone writes to that agent) is said, as when it couldn't go
    if kept:
        end = (f"; its agent had stopped, so nothing was typed to it: the message is kept and goes to it once "
               f"{s.name(t)} is restarted.")
    elif told and held:
        end = (f"; the message to {told} is held while its input holds unsent words: it goes once they're sent or "
               "cleared.")
    elif told:
        end = f"; told {told}."
    elif live:
        end = f"; couldn't send it to {live[-1]['address']}: tell it yourself."
    else:
        end = "; no agent is running to tell."
    say(args, {**v, "rounds": rounds + 1, "was": rounds, "used": used, "told": None if held else told, "held": told if held else None,
               **({"kept": True} if kept else {})},
        f"{s.name(t)} may now use {rounds + 1} review rounds (was {rounds}, {used} used)" + end)


def parse_left(text):
    """Time left as an agent writes it: 5m, 90s, 1h, 1h30m, 2 (minutes); in ms."""
    t = str(text).strip().lower().replace(" ", "")
    if re.fullmatch(r"\d+(?:\.\d+)?", t):
        return int(float(t) * 60000)
    parts = re.findall(r"(\d+(?:\.\d+)?)(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)", t)
    if not parts or "".join(a + b for a, b in parts) != t:
        raise Fail(f"--left takes a time like 5m, 90s or 1h30m, not \"{text}\".")
    return int(sum(float(n) * {"h": 3600000, "m": 60000, "s": 1000}[u[0]] for n, u in parts))


STATUS_WAIT = 5


def cmd_status(args):
    """A task agent says what it's doing, how far along it is and the time left, at the start, at
    each natural step and at least every 5 minutes (as Shepherdr's `shepherdr status`). Herdr guesses nothing: it shows
    what the agent said and counts the minutes down while it works."""
    own_core_check()
    text = " ".join(str(args.text or "").split())
    if not text:
        raise Fail("Say what you're doing: herdr-task status <id> \"Fixing the two failing tests\" --done 40 --left 5m")
    if args.done is not None and not 0 <= args.done <= 100:
        raise Fail("--done is a percentage, 0 to 100.")
    left = parse_left(args.left) if args.left else None
    shown = fit(text)
    # set: when it was said ("at" moves on while it waits, for the minutes left).
    said = now()
    progress = {"text": shown, "at": said, "set": said, **({"done": args.done} if args.done is not None else {}),
                **({"left": left} if left is not None else {})}

    def put(s):
        t = s.find(args.id)
        if t["state"] not in ("running", "ready"):
            raise Fail(f"{s.name(t)} isn't being worked on ({STATUSES.get(t['state'], t['state'])}); nothing to report.")
        t["progress"] = dict(progress)
        s.dirty = True
        return t, view(s, t, [detail(k) for k in live_agents(s.key(t))])

    queued = False
    try:
        # #1130: a status line never waits minutes behind a busy list
        with open_store(args, wait=STATUS_WAIT) as s:
            t, v = put(s)
    except Busy:
        # #1490: nor is it dropped: kept aside, the list's next holder puts it on its task (Store.take_progress())
        with open_store(args, write=False) as s:
            t, v = put(s)
            queue_progress(s.path, t["id"], progress)
        queued = True
    note = f" Cut to {LINE_MAX} characters: \"{shown}\". Keep it shorter next time." if shown != text else ""
    if queued:
        note += " The task list is busy right now: it shows once it's free, within a minute."
    # Every status gives the time left, a rough guess beats none (SHEP-13): one without it asks for it.
    if left is None:
        note += " Add --left with your best guess of the time left (like 20m) to every status."
    say(args, {**v, "cut": shown != text, **({"queued": True} if queued else {})}, f"{s.name(t)}: {shown}"
        + (f" · {args.done}%" if args.done is not None else "")
        + (f" · ~{minutes(round(left / 60000))} left" if left is not None else "") + "." + note)


ALERT = "herdr.alert"


def cmd_alert(args):
    """An agent tells the person something that can't wait (as Shepherdr's `shepherdr alert`): a
    toast and a sound in every Herdr window. Never asks permission. A task's agent (or an alert
    --task names) always reaches the person; an Assistant's follows its space's Notify (Off:
    nothing). It sets the core label herdr.alert on the caller's own terminal, which every Herdr
    client sees at once, here or on another machine; Herdr shows each new one once (inbox.js)."""
    title, body = " ".join(str(args.title or "").split()), " ".join(str(args.body or "").split())
    if not title:
        raise Fail("Say what can't wait: herdr-task alert \"Deploy is down\" --body \"Checks fail on main since 12:40\"")
    if len(title) > 240 or len(body) > 4000:
        raise Fail("Keep an alert short: a title and a line or two of why.")
    me = os.environ.get("HC_TERMINAL_ID")
    if not me:
        raise Fail("Run it from an agent's own terminal (there's no HC_TERMINAL_ID here).")
    labels = caller_labels()
    ref = None
    if args.task:
        with open_store(argparse.Namespace(folder=args.folder, id=args.task), write=False) as s:
            ref = s.ref(s.find(args.task))
    elif labels.get("herdr.task"):
        # Its own task: "<slug>#<n>" -> HERD-44, from that list's prefix.
        slug, _, n = labels["herdr.task"].rpartition("#")
        try:
            with open(os.path.join(STORE, f"{slug}.json")) as f:
                pre = json.load(f).get("prefix")
        except (OSError, ValueError):
            pre = None
        ref = f"{pre}-{n}" if pre else None
    # The label holds what a toast shows (inbox.js cuts it again to fit).
    alert = {"id": secrets.token_hex(4), "at": now(), "title": title[:120], "body": body[:300],
             **({"task": ref} if ref else {}), **({"about": True} if args.task else {})}
    r = run(["hc", "label", me, f"{ALERT}={json.dumps(alert, ensure_ascii=False, separators=(',', ':'))}"])
    if r.returncode != 0:
        raise Fail((r.stderr or r.stdout).strip() or "hc label failed")
    say(args, alert, "Alert sent.")


def back_to_work(s, t, why, said=WORKING_AGAIN, auto=False):
    """A Ready task taken back to work (herdr-task fix or resume, or its agent at work again):
    Working, its status line saying so until its agent reports, and no Accept until its next
    ready. why: what took it back, for its Assistant's news ("SHEP-7 is working again: why").
    auto: only its agent's own turn took it back (a message, a background job's notice), not a
    fix asked for: Ready again when that turn changed nothing (tick's settle_back())."""
    if t["state"] != "ready":
        return False
    t["state"] = "running"
    for k in ("ready_turns", "merge_requested"):
        t.pop(k, None)
    t["back"] = {"at": now(), "why": why, **({"auto": True, "progress": t.get("progress")} if auto else {})}
    # by: Herdr's words, not its agent's (on_it() counts only an agent's own line).
    t["progress"] = {"text": fit(said), "at": now(), "set": now(), "by": "herdr"}
    s.dirty = True
    return True


READY_BUT = "is ready, but:"  # finalize() couldn't push or open its pull request


def finalize(s, t):
    """Ready: on GitHub its pull request opens; then the merge policy in Settings decides who
    merges: auto (now), checks (once its checks pass) or ask (the person). Returns what to say."""
    wt = t.get("worktree")
    local = t.get("mode") != "worktree" or not wt or t.get("nothing_to_merge")
    repo = github(s) if not local and os.path.isdir(wt) else None
    failed = None
    if repo:
        # Pushed and opened before it shows Ready: the push lets the task list go while its hooks run
        # (#1007), and a Ready task without its pull request yet could be accepted (merged here) meanwhile.
        try:
            pr = pr_open(s, t, repo, t.get("summary"))
        except Fail as e:
            failed = str(e)
    elif not local and os.path.isdir(wt) and github_unreachable(s):
        # #988: a GitHub repo gh couldn't reach just now: never on as if it had no GitHub (Accept would
        # merge it here while a pull request, its agent's, stays open there).
        failed = f"Couldn't reach GitHub to open its pull request: {github_unreachable(s)}"
    t["state"], t["ready_at"] = "ready", now()
    for k in ("attention", "merge_requested", "review"):
        t.pop(k, None)
    (t.get("pr") or {}).pop("wait", None)
    s.dirty = True
    msg = f"{s.name(t)} is ready."
    if local:
        # Nothing to merge (in the folder itself, or no commits beyond its base): it waits in Ready
        # for the person's Accept, whatever the merge setting; no pull request.
        t.pop("auto_merge", None)
        return msg + (" Nothing to merge (no commits beyond its base)." if t.get("nothing_to_merge") else "") + \
            " The person marks it as done on its card."
    if failed:
        t["attention"] = failed
        return f"{s.name(t)} {READY_BUT} {failed} Tell the person."
    if repo:
        pr["checked"] = 0
        # Working until its checks are done and GitHub knows it can merge (the tick: pr_wait()).
        pr["wait"] = PR_CHECKS_RUNNING
        msg = (f"{s.name(t)} is ready: pull request #{pr['number']}, {pr['url']}. It shows Working until its checks "
               "pass and GitHub says it can merge; a failing check or a conflict comes back to you to fix.")
    policy = merge_policy(s, t)
    if t.pop("dequeued", None) and t.get("pr") and policy not in ("auto", "checks"):
        # #1215: its push took it out of GitHub's merge queue, where an Accept had put it: back in once
        # its checks pass and GitHub says it can merge (never while it conflicts: merge_now()).
        t["auto_merge"] = "checks"
        return msg + (" It was in GitHub's merge queue: Herdr took it out to push, and it goes back in once its "
                      "checks pass.")
    if policy not in ("auto", "checks") and t.get("merge_asked") and t.get("pr"):
        # SHEP-320: the person already asked to merge it (Mark as done, merge) and the try failed (a conflict, a
        # check): its agent's fix merges once its checks pass, never asked for again.
        t["auto_merge"] = "checks"
        return msg + " The person already asked to merge it: it merges by itself once its checks pass."
    if policy in ("auto", "checks"):
        t["auto_merge"] = policy
        if t.get("pr"):
            if policy == "auto":
                err = merge_now(s, t)
                if err and not merge_waits(err):
                    # step 37: a merge that fails is its agent's to fix; it is the one saying ready now
                    note_merge_failed(t, err)
                    back_to_work(s, t, f"its merge failed: {err}", f"Fixing: {err}")
                    return (f"{s.name(t)} {READY_BUT} merging it failed: {err} Fix it (a conflict: rebase onto "
                            f"{t.get('base') or 'main'}; failing checks: find out why), commit, then run ready again.")
                return msg + (f" Merging it waits: {err}" if err else " Merged; done.")
            return msg + " It merges by itself once its checks pass."
        try:
            sent, started = tell(s, t, local_merge_msg(s, t), None)
            t["merge_requested"] = now()
            return msg + " Settings say merge it right away: the next message says how."
        except Fail as e:
            t["attention"] = f"Couldn't ask for the merge: {e}"
    else:
        t.pop("auto_merge", None)
    return msg + " The person marks it as done on its card, which merges it."


def cmd_review(args):
    """A reviewer's verdict: --pass (on to merging) or --changes (back to the worker). Only for
    reviewers herdr-task started before task agents ran their own review: kept so they finish."""
    if bool(args.passed) == bool(args.changes or args.changes_file):
        raise Fail("Say --pass, or --changes with what must be fixed.")
    text = args.changes or ""
    if args.changes_file:
        with open(args.changes_file) as f:
            text = f.read()
    with open_store(args) as s:
        t = s.find(args.id)
        rv = t.pop("review", None) or {}
        cfg = settings_for(s, t.get("space"))["tasks"]
        of = rv.get("of") or int(cfg.get("review_rounds") or 1)
        n = rv.get("round") or len(t.get("reviews") or []) + 1
        rec = {"round": n, "result": "pass" if args.passed else "changes", "text": (text or args.notes or "").strip(),
               "at": now(), "head": t.get("head"), "by": os.environ.get("HC_TERMINAL_ID")}
        t.setdefault("reviews", []).append(rec)
        s.dirty = True
        if args.passed:
            msg = f"{s.name(t)}: review round {n} passed. " + finalize(s, t)
        else:
            last = n >= of
            if t["state"] == "ready":
                t["state"] = "running"
            sent, _ = tell(s, t, (f"Review round {n} of {of} for {s.name(t)} found what must be fixed before it can merge:\n{text.strip()}\n\n"
                                     f"Fix these, commit, then run `herdr-task ready {s.ref(t)} --folder {shlex.quote(s.loc['folder'])}` again"
                                     + (" (that was the last review round)." if last else " for the next round.")), None)
            msg = f"{s.name(t)}: findings sent to {sent}."
        v = view(s, t)
    # This reviewer is finished: it ends a moment after this command returns.
    me = os.environ.get("HC_TERMINAL_ID")
    if me and rv.get("reviewer") == me:
        guard(["hc"])
        subprocess.Popen(["sh", "-c", 'sleep 4; hc kill "$1" >/dev/null 2>&1; sleep 2; hc rm "$1" >/dev/null 2>&1', "x", me],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    say(args, v, msg)


def cmd_state(args, state):
    with open_store(args) as s:
        t = s.find(args.id)
        if state == "reopen":
            state = "running" if t.get("started") and t["state"] not in ("queued", "scheduled") else "todo"
            # #844: reopened after its pull request merged: it stays open (the tick would find that
            # pull request merged and close it again at once) until its agent says ready.
            if t["state"] == "done" and t.get("merged"):
                t["kept_open"] = True
                t["was_merged"] = True  # SHEP-423: its merge stays a fact (done again: merged, not "not merged")
            for k in ("reviews", "review", "auto_merge", "merged", "nothing_to_merge", "accepted_at", "merge_asked", "merge_queued", "closed_unmerged",
                      "quiet", "told", "told_sent"):
                t.pop(k, None)
        if state == "done" and (t.get("was_merged") or (t.get("worktree") and (merged_here(s, t) or landed(s, t)))):
            # SHEP-423: reopened after it merged (to tag a release, say), then done again: still merged. Squash-merged on
            # GitHub, merged_here can't tell, and it was filed "Done · not merged": a schedule listening for "merged" missed it.
            t["merged"] = True
        elif state == "done" and t.get("mode") == "worktree" and (t.get("worktree") or t.get("pr")) and not t.get("merged"):
            # 3.2: Mark as done from its menu closes it without merging ("Done · not merged"): its branch and
            # pull request are left as they are.
            t["closed_unmerged"] = True
        t["state"] = state
        t[{"done": "done_at", "running": "reopened_at", "todo": "reopened_at"}[state]] = now()
        if state != "done":
            unarchive(s, t)
        for k in ("merge_requested", "attention", "queue", "queued_at", "progress", "retry", "scheduled_for", "held", "auto_merge",
                  "merge_failed", "merge_failed_at") if state != "running" else ("attention", "scheduled_for"):
            t.pop(k, None)
        if state != "running":
            clear_stopped(t)
        s.dirty = True
        v = view(s, t)
    say(args, v, (f"{s.name(t)} is done" + (", not merged: its branch" + (" and pull request are" if t.get("pr") else " is") + " left as is."
                                          if t.get("closed_unmerged") else ".")) if state == "done" else f"{s.name(t)} is {state}.")


def cmd_archive(args):
    """The person's Archive on a task (3.2): out of its list, nothing deleted (`unarchive` brings it back, and so
    does writing to it). Done tasks still archive themselves after a while (Settings › Tasks › Archive Done after)."""
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] == "running" and any(status_word(k) == "working" for k in workers(s, t)):
            raise Fail(f"{s.name(t)} is working: stop it first (herdr-task stop {s.ref(t)}), then archive it.")
        was = bool(t.get("archived"))
        if not was:
            t["archived"], t["archived_by"] = now(), "you"
            t.pop("unarchived", None)
            s.dirty = True
        v = view(s, t)
    say(args, v, f"{s.name(t)} is archived already." if was else f"{s.name(t)} is archived (herdr-task unarchive {s.ref(t)} brings it back).")


def cmd_unarchive(args):
    with open_store(args) as s:
        t = s.find(args.id)
        was = bool(t.get("archived"))
        unarchive(s, t)
        v = view(s, t)
    say(args, v, f"{s.name(t)} is back in its list." if was else f"{s.name(t)} isn't archived.")


NOT_STARTED = ("todo", "scheduled", "queued")


def move_task(args):
    """edit --move-to <folder> (3.2: Move to, only before it has started): the task leaves this folder's list and is
    added to that folder's on this machine, with a new id there (a task's id is its folder's). What it waits for,
    and what waits for it, follow it by its new ref. Returns the new store and task."""
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] not in NOT_STARTED:
            raise Fail(f"{s.name(t)} has already started ({STATUSES.get(t['state'], t['state'])}); a task can move only before it starts.")
        loc = locate(args.move_to)
        if os.path.realpath(loc["folder"]) == os.path.realpath(s.loc["folder"]):
            raise Fail(f"{s.name(t)} is already in {s.loc['folder']}.")
        old_ref, old_prefix, old_id = s.ref(t), s.prefix, t["id"]
        s.data["tasks"].remove(t)
        s.dirty = True
    with Store(loc) as d:
        n = d.new(t["title"], t.get("prompt") or "", "worktree" if d.loc["kind"] == "repo" and t.get("mode") == "worktree" and worktrees_on(d) else "here")
        for k, v in t.items():
            if k not in ("id", "mode", "after", "after_ext", "base", "base_set", "base_by", "branch", "pr", "agents", "created", "title", "prompt"):
                n[k] = v
        ext = [dict(x) for x in t.get("after_ext") or [] if not (not x.get("machine") and x.get("prefix") == d.prefix)]
        ext += [{"ref": f"{old_prefix}-{i}", "machine": None, "prefix": old_prefix, "id": i, "state": "todo", "checked": 0} for i in t.get("after") or []]
        back = [x["id"] for x in t.get("after_ext") or [] if not x.get("machine") and x.get("prefix") == d.prefix]
        if back:
            n["after"] = [i for i in back if any(o["id"] == i for o in d.data["tasks"])]
        if ext:
            n["after_ext"] = ext
        n["moved_from"] = old_ref
        if n.get("queue") and not n["queue"].get("custom"):
            n["queue"].pop("argv", None)  # its agent as that folder's settings say
        d.dirty = True
        new_ref, new_id = d.ref(n), n["id"]
    with open_store(args) as s:
        # what waited for it here waits for it there
        for o in s.data["tasks"]:
            if old_id in (o.get("after") or []):
                o["after"] = [i for i in o["after"] if i != old_id]
                o.setdefault("after_ext", []).append({"ref": new_ref, "machine": None, "prefix": new_ref.rsplit("-", 1)[0], "id": new_id,
                                                      "state": "todo", "checked": 0})
                s.dirty = True
    args.folder, args.id, args.move_to = loc["folder"], str(new_id), None
    return old_ref


def cmd_edit(args):
    moved = move_task(args) if getattr(args, "move_to", None) else None
    with open_store(args) as s:
        t = s.find(args.id)
        old = t["title"]
        if getattr(args, "space", None) is not None:
            # 3.2: Move to another space, only before it has started (its settings and its Assistant's news are that space's)
            if t["state"] not in NOT_STARTED:
                raise Fail(f"{s.name(t)} has already started ({STATUSES.get(t['state'], t['state'])}); a task can move to another space only before it starts.")
            if not bare(args.space):
                raise Fail("--space takes the space's id.")
            t["space"] = bare(args.space)
            if t.get("queue"):
                t["queue"]["space"] = t["space"]
                if not t["queue"].get("custom"):
                    t["queue"].pop("argv", None)
                t["queue"].pop("parent", None)
        if args.title is not None:
            t["title"] = args.title.strip() or t["title"]
        if args.prompt is not None:
            t["prompt"] = args.prompt
        if args.prompt_file:
            with open(args.prompt_file) as f:
                t["prompt"] = f.read()
        pick = [t.get(k) for k in ("agent", "model", "effort", "flags", "speed", "perm")]
        set_opts(t, args, s)
        if [t.get(k) for k in ("agent", "model", "effort", "flags", "speed", "perm")] != pick:
            # The next agent started for it runs on the new choice (start_again), a queued one too.
            t["pick_at"] = now()
            q = t.get("queue") or {}
            if q.get("argv") and not q.get("custom"):
                q["argv"] = worker_argv(s, t, q.get("space"))
        restacked = set_base(s, t, args.base, args=args)
        set_notes(t, args)
        if args.after is not None:
            set_after(s, t, *parse_after(s, args.after))
        at = scheduled_at(args) if (args.at or "").strip() or args.in_ is not None else None
        if at:
            schedule(s, t, at)
        elif args.at is not None:
            unschedule(t)  # --at "": back to To do
        adopt = args.worktree and (getattr(args, "branch", None) or "").strip() and t["state"] not in NOT_STARTED
        if (args.here or args.worktree) and not adopt:  # #1443: --worktree --branch <its branch> adopts it (set_branch)
            if t["state"] not in ("todo", "scheduled", "queued"):
                raise Fail("Where a task works can only change before it starts.")
            if args.worktree and s.loc["kind"] != "repo":
                raise Fail("Worktrees need a git repo.")
            t["mode"] = "here" if args.here else "worktree"
        if t["mode"] != "worktree" and not t.get("worktree"):
            t.pop("branch", None)
        set_branch(s, t, getattr(args, "branch", None))
        take_pr(s, t, getattr(args, "pr", None))
        s.dirty = True
        tabs = task_tabs(s, t) if t["title"] != old else []
        v = view(s, t)
    left = name_tabs([(tab, tab_title(s, t)) for tab in tabs])
    if at:
        ensure_scheduler_quietly()
    say(args, {**v, "rename": left, **({"moved_from": moved} if moved else {})},
        (f"{s.name(t)} moved to {s.loc['folder']} (its key for commands is {s.ref(t)} now)" if moved else f"{s.name(t)} saved")
        + (f": {v['why']}." if v["status"] == "scheduled" else ".") + moved_words(s, t, restacked))


def cmd_config(args):
    with open_store(args) as s:
        out = {"folder": s.loc["folder"], "settings": settings_for(s), "from": setting_sources(s), "worktrees": worktrees_on(s)}
    where = "a worktree each" if out["worktrees"] else "in the folder itself"
    # SHEP-322: tasks are named by their titles; a task's key is herdr-task's own, so --prefix (an older Assistant's
    # habit) changes nothing.
    if getattr(args, "prefix", None) is not None:
        out["prefix_ignored"] = True
    # SHEP-335: what this repo's tasks get, and where each comes from (Everywhere, this repo, or Herdr's default)
    shown = [f"  {k}: {json.dumps(out['settings'][k.split('.')[0]].get(k.split('.')[1]) if '.' in k else out['settings'][k])} ({v})"
             for k, v in out["from"].items() if k.split(".")[0] in ("tasks", "worker", "reviewer")]
    say(args, out, "\n".join([f"{out['folder']}: tasks work {where}." + (" Tasks are named by their titles now: --prefix changes nothing."
                                                                         if out.get("prefix_ignored") else ""),
                               "Settings for its tasks (a task's own --set wins):", *shown]))


def remove_deleted_worktree(s, t):
    """Use git's clean-worktree check, then delete the branch only if it belongs to this task."""
    wt, branch, folder = t.get("worktree"), t.get("branch"), s.loc["folder"]
    if t.get("mode") != "worktree" or not wt:
        return None
    trees = worktree_list(folder)
    tree = next((w for w in trees if os.path.realpath(w["path"]) == os.path.realpath(wt)), None)
    if not branch or not tree or tree["branch"] != branch or os.path.realpath(wt) == os.path.realpath(folder) or \
            branch in {t.get("base") or "main", default_branch(folder)} or any(
                o is not t and branch in (o.get("branch"), o.get("base")) for o in s.data["tasks"]
                if o.get("state") != "done"):
        return f"Its worktree {wt} and branch were kept."
    if not git(folder, "worktree", "remove", wt)[0]:
        return f"Its worktree {wt} and branch were kept. Check for local changes or files there."
    if not git(folder, "branch", "-D", "--", branch)[0]:
        return f"Its branch {branch} was kept."
    return None


def cmd_rm(args):
    with open_store(args) as s:
        t = s.find(args.id)
        # Stop the task before asking git to remove its worktree.
        ended, busy = [], False
        if t["state"] in ("running", "ready") or t.get("agents"):
            for k in live_agents(s.key(t)):
                stop_note("rm-kill", task=s.ref(t), terminal=k["address"], by="rm")
                if run(["hc", "kill", k["address"]]).returncode == 0:
                    ended.append(k["address"])
                else:
                    busy = True
        kept = "Its worktree was kept because its agent is still running." if busy and t.get("worktree") else None
        if not busy:
            kept = remove_deleted_worktree(s, t)
        s.data["tasks"].remove(t)
        for o in s.data["tasks"]:
            if t["id"] in (o.get("after") or []):
                o["after"] = [i for i in o["after"] if i != t["id"]]
        s.dirty = True
    note = f" {kept}" if kept else ""
    say(args, {"id": t["id"], "removed": True, "ended": ended}, f"{s.name(t)} removed.{note}")


def last_agent(t):
    return t["agents"][-1] if t["agents"] else None


def start_again(s, t, space, key=None, argv_json=None, message=None, parent=None, nudge=None):
    """Starts an agent for the task: the last agent's own session when it's the same kind of agent
    and the session is known; else a fresh one with a handoff. `message` goes after either; `nudge`
    is a resumed session's first message when no `message` is given (a handoff needs none)."""
    unarchive(s, t)
    if clear_stopped(t):  # a restart: no longer stopped
        s.dirty = True
    # SHEP-324: messages that came while its agent was stopped (never typed into its shell) go with its first message
    from .news import hold, take_kept
    kept = take_kept(s.key(t), [k["address"] for k in live_agents(s.key(t))])
    try:
        first = message or (nudge if kept else None)
        return _start_again(s, t, space, key, argv_json, "\n\n".join(x for x in (first, kept) if x) or None, parent, nudge)
    except BaseException:
        if kept:
            hold("", kept, "send", task=s.key(t))  # kept again for the next start
        raise


def restart_argv(s, t, space, key, argv_json):
    prev = last_agent(t)
    # The last agent's argv again, unless the task's agent, model, effort or flags changed since (edit).
    keep = prev and prev.get("argv") and (t.get("pick_at") or 0) <= (prev.get("at") or 0)
    argv = agent_argv(None, argv_json) if argv_json else worker_argv(s, t, space, key) if key else \
        (prev["argv"] if keep else worker_argv(s, t, space))
    if not argv_json:
        require_task_cli(agent_key(argv))
    reviewer_pick(s, t, space)
    return argv


def _start_again(s, t, space, key, argv_json, message, parent, nudge):
    prev = last_agent(t)
    parent = parent_for(parent or (prev or {}).get("parent"), space)
    argv = restart_argv(s, t, space, key, argv_json)
    same = prev and agent_key(argv) == prev.get("agent")
    res = resume_argv(argv, prev["session"], folder_for(s, t)) if same and prev.get("session") else None
    if res:
        return launch(s, t, argv, space, message or nudge, parent=parent, resume=res), True
    text = handoff(s, t, prev, parent, argv) + (("\n\n" + message) if message else "")
    t["review_gate"] = True
    return launch(s, t, argv, space, text, parent=parent), False


# SHEP-189: what a resumed agent hears first. Its session comes back with no message, so without this
# it sat idle until someone wrote to it.
RESUME_NUDGE = ("Shepherdr resumed your session because your agent had stopped. Carry on where you left off: check "
                "what is already done with `herdr-task show`, then keep going with the task.")


def cmd_resume(args):
    with open_store(args) as s:
        t = s.find(args.id)
        live = [k for k in map(detail, live_agents(s.key(t))) if agent_running(k)] or [a for a in [just_started(t)] if a]
        if live:
            raise Fail(f"{s.name(t)} still has an agent ({live[0]['address']}). Use switch to replace it.")
        if t["state"] in ("todo", "scheduled", "queued"):
            raise Fail(f"{s.name(t)} hasn't started. Use start.")
        space = bare(args.space) if args.space else (t.get("space") or default_space())
        if t["state"] == "done":
            t["state"] = "running"
        gone = [k["address"] for k in live_agents(s.key(t))]  # its agents' terminals, none running an agent
        back_to_work(s, t, "resumed")
        a, resumed = start_again(s, t, space, args.agent, args.argv, parent=args.parent, message=RESUME_NUDGE)
        # #1022: the old agent's terminal, its plain shell left (with the status it last reported when
        # it died mid-turn), kept counting as the task's agent: it goes, as switch ends the one it replaces.
        for address in gone:
            if address != a["address"]:
                stop_note("resume-retire", task=s.ref(t), terminal=address, by="resume")
                run(["hc", "kill", address])
        v = view(s, t)
    say(args, {**v, "terminal": a["address"], "space": space, "parent": a.get("parent"), "resumed": resumed},
        f"{s.name(t)} {'resumed its session' if resumed else 'started with a handoff'}: {a['address']}")


# SHEP-211: what a session resumed by switch hears first. Without it the new agent sat idle on the old one's
# interrupted turn ("Interrupted · What should Claude do instead?") and the task showed a false "needs you".
SWITCH_NUDGE = ("Shepherdr restarted your session on a new agent (the task's agent, model or settings changed), "
                "which stopped your last turn part-way. Nothing is wrong and nobody is waiting on you: carry on "
                "where you left off (check what is already done with `herdr-task show` and git), then keep going "
                "with the task.")


def end_agent(s, t, address):
    """Ends a task's agent (its terminal, shell and all); hc kill returns once it's gone."""
    stop_note("switch-kill", task=s.ref(t), terminal=address, by="switch")
    run(["hc", "kill", address])


def cmd_switch(args):
    with open_store(args) as s:
        t = s.find(args.id)
        live = [k for k in map(detail, live_agents(s.key(t))) if agent_running(k)]
        refresh_sessions(s, t, live)
        old = live[-1] if live else None
        when_idle = getattr(args, "when_idle", False)
        if when_idle and ((old or {}).get("status") or {}).get("state") in ("working", "blocked"):
            raise Fail("Wait for this turn to finish, then update.")
        labels = (old or {}).get("labels") or {}
        # A given --space wins: the task moves there (#837); else the old agent's own space.
        space = ((bare(args.space) if args.space else None) or labels.get("herdr.task.space") or labels.get("herdr.space")
                 or t.get("space") or default_space())
        if t["state"] in ("todo", "scheduled", "queued", "done"):
            t["state"] = "running"
            t.setdefault("started", now())
            t.pop("queue", None)
            t.pop("scheduled_for", None)
        ended = []
        # An agent switching itself can't end first: that would end this command too.
        me = os.environ.get("HC_TERMINAL_ID")
        own = bool(old and me and old["address"].split("/")[-1] == me)
        if old and not args.keep and not own:
            restart_argv(s, t, space, args.agent, args.argv)
            # The old agent ends before the new one starts (SHEP-211): the new one may resume the same session,
            # and killing the old one after that cut the session's turn short under the new agent, which then
            # sat on "Interrupted" with nothing to do. Its worktree and session stay for the new agent.
            end_agent(s, t, old["address"])
            ended.append(old["address"])
        try:
            a, resumed = start_again(s, t, space, args.agent, args.argv, parent=args.parent,
                                     nudge=None if when_idle else SWITCH_NUDGE)
        except Fail as e:
            if ended:
                raise Fail(f"{e} The old agent {ended[0]} already ended: its work is kept, `herdr-task resume "
                           f"{s.ref(t)}` starts it again.")
            raise
        v = view(s, t)
    if own and not args.keep:
        end_agent(s, t, old["address"])
        ended.append(old["address"])
    say(args, {**v, "terminal": a["address"], "space": space, "parent": a.get("parent"), "resumed": resumed, "ended": ended},
        f"{s.name(t)}: {a['agent']} {a['address']} {'resumed its session' if resumed else 'took over'}" + (f", {old['address']} ended" if ended else ""))


def workers(s, t):
    """The task's agents at work, reviewers left out (hc get's records, oldest first)."""
    return [k for k in map(detail, live_agents(s.key(t)))
            if agent_running(k) and (k.get("labels") or {}).get("herdr.role") != "reviewer"]


def tell(s, t, msg, args, person=False):
    """Sends the task's worker a message, or starts one with it when none is left. person: the person's own words
    (herdr-task reply), in at once even while it works (news.person_send). Returns (terminal, started)."""
    unarchive(s, t)
    live = workers(s, t)
    fresh = None if live else just_started(t)
    if fresh:
        # #1053: its agent is still starting (its brief on the way): never a second one beside it.
        raise Fail(f"{s.name(t)} started its agent moments ago ({fresh['address']}); send this again once it is up.")
    if live:
        # While the person writes to it, the message waits for them (news.py's held_pass).
        from .news import NO_AGENT, person_send, send_or_hold
        r = (person_send if person else send_or_hold)(live[-1]["address"], msg)
        if not r:
            raise Fail(f"hc send to {live[-1]['address']} failed")
        if r != NO_AGENT:
            if clear_stopped(t):  # a message to it carries on
                s.dirty = True
            return live[-1]["address"], False
        # SHEP-324: its agent exited just now (a plain shell in front): never typed there; it starts again with it
    space = bare(args.space) if getattr(args, "space", None) else (t.get("space") or default_space())
    a, _ = start_again(s, t, space, getattr(args, "agent", None), getattr(args, "argv", None), message=msg)
    return a["address"], True


def cmd_stop(args):
    """The person's Stop (3.2, step 39): a pause, like pressing Esc. Its agent drops what it was doing (hc interrupt)
    and waits; the task and its agent stay as they are, the task says it was stopped by the person (stopped_by:
    "you") under Needs you, and the next message to it carries on from there."""
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] not in ("running", "ready"):
            raise Fail(f"{s.name(t)} isn't being worked on ({STATUSES.get(t['state'], t['state'])}); there is nothing to stop.")
        if getattr(args, "untrusted", False):
            # #1441: No on its CLI's folder-trust screen, which exits its agent: nothing to interrupt
            if t["state"] == "running":
                t["stopped_by"], t["stopped_why"], t["stopped_at"], t["stopped_turns"] = "you", NOT_TRUSTED, now(), {}
                t.pop("trust_ask", None)
                t.pop("retry", None)
                s.dirty = True
            v = view(s, t, [detail(k) for k in live_agents(s.key(t))])
            say(args, v, f"{s.name(t)} stopped: {NOT_TRUSTED} The next message to it starts it again.")
            return
        live = workers(s, t)
        if not live:
            raise Fail(f"{s.name(t)} has no agent at work; there is nothing to stop. `herdr-task resume {s.ref(t)}` starts it again.")
        out = []
        for k in live:
            r = run(["hc", "interrupt", k["address"], "--json"])
            try:
                got = json.loads(r.stdout) if r.stdout.strip() else {}
            except ValueError:
                got = {}
            out.append({"address": k["address"], "ok": r.returncode == 0, **({"outcome": got.get("outcome")} if isinstance(got, dict) and got.get("outcome") else {})})
        if not any(x["ok"] for x in out):
            raise Fail(f"Couldn't stop {s.name(t)}'s agent ({live[-1]['address']}): {(r.stderr or r.stdout).strip() or 'hc interrupt failed'}")
        if t["state"] == "running":
            t["stopped_by"], t["stopped_why"], t["stopped_at"] = "you", BY_YOU, now()
            # its agents' turns now: a later one is the person's next message, and it carries on (agents.carried_on)
            t["stopped_turns"] = {k["address"]: k.get("turn") or 0 for k in map(detail, live_agents(s.key(t))) if k.get("address")}
            t.pop("retry", None)
        s.dirty = True
        v = view(s, t, [detail(k) for k in live_agents(s.key(t))])
    say(args, {**v, "stopped": out}, f"{s.name(t)} stopped: its agent waits. The next message to it carries on.")


def cmd_reply(args):
    """The person's message to a task (3.2: its reply box). To its agent when one runs. A stopped task carries on.
    With no agent left (it ended, crashed, or the task is Done) its agent starts again on its own session with the
    message: the same thread, and a Done task is Working again."""
    text = args.text if args.text is not None else sys.stdin.read()
    if not str(text).strip():
        raise Fail("Say what to tell it: herdr-task reply <id> \"<the message>\" (or pipe it in).")
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] in NOT_STARTED:
            raise Fail(f"{s.name(t)} hasn't started: change what it will do (herdr-task edit {s.ref(t)} --prompt \"…\") or start it.")
        was = t["state"]
        if was == "done":
            # as reopen: Working again, kept open though its work merged (until its agent says ready)
            if t.get("merged"):
                t["kept_open"] = True
                t["was_merged"] = True  # SHEP-423, as reopen
            for k in ("reviews", "review", "auto_merge", "merged", "nothing_to_merge", "accepted_at", "merge_asked", "merge_queued", "closed_unmerged",
                      "quiet", "told", "told_sent", "attention"):
                t.pop(k, None)
            t["state"], t["reopened_at"] = "running", now()
            s.dirty = True
        sent, started = tell(s, t, str(text), args, person=True)
        if clear_stopped(t):
            s.dirty = True
        v = view(s, t)
    say(args, {**v, "terminal": sent, "new_agent": started, "reopened": was == "done"},
        f"{s.name(t)}: sent to {sent}" + (" (its agent started again)" if started else "") + (". It is working again." if was == "done" else "."))


# ---- a merge that fails goes back to its agent (3.2, step 37) -------------------------------------
# In every mode (the person's Mark as done, after checks, right away): the task is Working again with the
# reason kept as merge_failed (one plain line, shown in red on its card), its agent is told why and asked to
# fix it and hand in again. The next ready clears it, and so does the merge going through.

def merge_waits(err):
    """A merge that only waits (checks running, an approval, GitHub's queue) or couldn't be asked just now: no failure."""
    return err in (IN_QUEUE, CHECKS_RUNNING, WAITS_APPROVAL) or str(err).startswith("Couldn't reach")


def note_merge_failed(t, why):
    t["merge_failed"], t["merge_failed_at"] = " ".join(str(why).split())[:300], now()
    for k in ("attention", "attention_at", "attention_head", "merge_queued", "merge_requested"):
        t.pop(k, None)


def merge_failed(s, t, why, args=None):
    """Hands a failed merge to the task's agent (see above). Returns the agent told, or None when none could be
    (then it needs the person: its attention says why)."""
    note_merge_failed(t, why)
    main, wt, br, base = s.loc["folder"], t.get("worktree"), t.get("branch"), t.get("base") or "main"
    c = collision(s, t, fetch=True) if str(why).startswith("It conflicts") else None
    if c:
        # SHEP-320: the card says what collided, and its agent gets the files and the base's commits
        t["merge_failed"] = collision_reason(c)
    msg = (f"Task {s.name(t)} couldn't be merged: {why}\n" + (f"{collision_words(c)}\n" if c else "") +
           f"Fix it in {wt}: for conflicts, rebase {br} onto {c['ref'] if c else base} (or merge it in) and resolve them; for failing "
           f"checks, find out why and fix them. Run the checks, commit, then run `herdr-task ready {t['id']} --folder "
           f"{shlex.quote(main)}` to hand it in again" + (": the merge already asked for then goes through by itself." if t.get("merge_asked") else "."))
    t["fix_requested"] = t["handed_at"] = now()
    s.dirty = True
    try:
        sent, _ = tell(s, t, msg, args)
    except Fail as e:
        t["attention"], t["attention_at"] = f"{why} (and its agent couldn't be told: {e})", now()
        return None
    back_to_work(s, t, f"its merge failed: {why}", f"Fixing: {why}")
    return sent


def local_merge_msg(s, t):
    main, wt, br, base = s.loc["folder"], t["worktree"], t["branch"], t.get("base") or "main"
    q = shlex.quote
    return (f"Merge task {s.name(t)} now:\n"
            f"1. In {wt}: commit any remaining work, then rebase {br} onto {base} (git rebase {base}) and resolve conflicts.\n"
            f"2. Run the project's checks (tests, build, lint) and fix what fails.\n"
            f"3. Merge into {base}: git -C {q(main)} merge --ff-only {br} when {main} has {base} checked out, else git -C {q(main)} fetch . {br}:{base}. If {main} has uncommitted changes in the way, or another worktree has {base} checked out, stop and tell the person; don't stash or reset their work.\n"
            f"4. Clean up: git -C {q(main)} worktree remove {q(wt)} && git -C {q(main)} branch -d {br}\n"
            f"5. Run: herdr-task done {s.ref(t)} --folder {q(main)}")


MERGE_FAILED = "GitHub didn't merge it"  # a merge that failed: never in the way of the next try
CHECKS_RUNNING = "Checks are still running."
WAITS_APPROVAL = "It waits for an approving review."  # #743: not a problem, it merges once approved
IN_QUEUE = "It is in GitHub's merge queue."  # #802: merging, done once GitHub merged it


def merge_now(s, t, accept=False):
    """Merges the task's pull request on GitHub and tidies up here. Returns why it
    couldn't, or None when it's merged (and the task done). A base branch with GitHub's merge
    queue (#742, #801, #802): the pull request joins the queue and the task stays Merging until
    GitHub merged it (the tick finishes it then, and deletes its branch there)."""
    n, repo = str(t["pr"]["number"]), t["pr"]["repo"]
    v = pr_view(t)
    s.dirty = True
    if not v:
        return f"Couldn't reach pull request #{n} on GitHub."
    note_checks(s, t, v)
    if v.get("state") == "CLOSED" and accept:
        # #1106: closed on GitHub, on purpose: the person's Accept closes the task, nothing merged (its branch stays on
        # GitHub with the closed pull request).
        t["closed_unmerged"] = True
        finish(s, t, even_if_busy=True)
        return None
    if v.get("state") != "MERGED":
        # only the base branch's required checks hold a merge (#1221); merge "on its own" (also a merge by hand) none
        # beyond them
        v = merge_checks(t, v, now_=(t.get("auto_merge") or merge_policy(s, t)) == "auto")
        problem = pr_problem(v) or queue_refusal(t, v)
        if problem:
            # #1174: never into GitHub's merge queue while it conflicts, nor again at the commit whose
            # merge group just failed there.
            t["attention"], t["attention_at"] = problem, now()
            t.pop("merge_queued", None)
            return problem
        if t.get("merge_queued"):
            return IN_QUEUE
        # #1044: no checks yet while some will come is never "none set up": it merges once they ran.
        if pr_pending(v) or checks_missing(v, checks_since(s, t, v), expected_checks(s, t, v.get("headRefOid"))) == "waiting":
            return CHECKS_RUNNING
        if needs_approval(v):
            t["pr"]["needs_approval"] = True
            return WAITS_APPROVAL
        t["pr"].pop("needs_approval", None)
        # #1045: never --delete-branch. gh deletes the branch right after its merge call whenever it
        # doesn't know the base has a merge queue (a ruleset's queue, an older gh): GitHub only queued
        # it, and a pull request whose branch goes is closed and leaves the queue. Its branch on GitHub
        # goes below, once GitHub says it merged (drop_branch()).
        try:
            method = merge_method(repo)
        except Fail as e:
            return str(e)
        if v.get("mergeStateStatus") == "DRAFT" or t.get("pr_draft"):
            # #1155: opened as a draft (ready --draft): the person's Accept takes it out of draft first; GitHub
            # merges no draft.
            gh("pr", "ready", n, "--repo", repo)
        ok, _, err = gh("pr", "merge", n, "--repo", repo, method, "--match-head-commit", v.get("headRefOid") or "")
        # Merged, or only queued (or set to merge by itself)? Asked again; a one-off GitHub error can
        # also come after the merge went through.
        again = pr_view(t)
        if (again or {}).get("state") == "MERGED":
            v = again
        elif ok:
            # Open after gh said yes: GitHub's merge queue has it (merges once the queue's checks pass).
            t["merge_queued"] = now()
            t.pop("attention", None)
            t["pr"]["checked"] = 0
            return IN_QUEUE
        else:
            t["attention"], t["attention_at"] = f"{MERGE_FAILED}: {err}", now()
            # The next tick reads the pull request at once (merged by hand meanwhile: done).
            t["pr"]["checked"] = 0
            return t["attention"]
    watch_main(s, t, ((v.get("mergeCommit") or {}).get("oid")) if v.get("state") == "MERGED" else None)
    update_main(s, t)
    # Its branch on GitHub goes now that it merged (the repo may have deleted it already: fine).
    drop_branch(s, t)
    t["merged"] = True
    finish(s, t, even_if_busy=True)
    return None


def own_open_pr(s, t):
    """#988: a task with no pull request on record, in a GitHub repo: the open one for its branch (its
    agent opened it, ready never knew) is recorded on the task, so it merges there, never here behind
    it. Refused (nothing merged) when GitHub can't be asked, or when that pull request isn't at the
    branch's newest commit here (merging it would leave work out). None when there is none."""
    repo = github(s)
    if not repo:
        why = github_unreachable(s)
        if why:
            raise Fail(f"Couldn't ask GitHub whether {s.name(t)} has a pull request ({why}); nothing merged. Try again.")
        return None
    found = pr_for_branch(t, repo)
    if not found:
        return None
    if found.get("headRefOid") != branch_tip(s, t):
        raise Fail(f"{s.name(t)} has pull request #{found['number']} open on GitHub, but not at its branch's newest commit "
                   f"here; nothing merged. Its agent pushes it (herdr-task ready), then try again.")
    t["pr"] = {"number": found["number"], "url": found["url"], "repo": repo}
    s.dirty = True
    return t["pr"]


def cmd_merge(args):
    error = None
    with open_store(args) as s:
        t = s.find(args.id)
        if t.get("mode") != "worktree" or not t.get("worktree"):
            raise Fail(f"{s.name(t)} works in the folder itself; there is nothing to merge.")
        sent, started, how = None, False, "agent"
        if t.get("pr") or own_open_pr(s, t):
            # On GitHub: Herdr merges the pull request itself (squash), then tidies up here.
            how = "github"
            # SHEP-320: asked once; a failed try fixed by its agent merges at its next ready without a second ask
            t["merge_asked"] = now()
            error = merge_now(s, t)
            if error == IN_QUEUE:
                how, error = "queue", None
            elif error == CHECKS_RUNNING:
                error += " Merge again when they pass."
            elif error == WAITS_APPROVAL:
                error += " Merge again once it's approved."
            elif error and not merge_waits(error):
                sent = merge_failed(s, t, error, args)
                error += f" Its agent ({sent}) was asked to fix it and hand it in again." if sent else ""
        else:
            t["merge_requested"] = now()
            s.dirty = True
            sent, started = tell(s, t, local_merge_msg(s, t), args)
        v = view(s, t)
    if error:
        say(args, {**v, "error": error}, None) if args.json else print(f"herdr-task: {error}", file=sys.stderr)
        sys.exit(1)
    text = f"{s.name(t)}: pull request #{t['pr']['number']} merged; done." if how == "github" else \
        f"{s.name(t)}: pull request #{t['pr']['number']} is in GitHub's merge queue; done once GitHub merges it." if how == "queue" else \
        f"{s.name(t)}: merge asked of {sent}" + (" (a new agent)" if started else "")
    say(args, {**v, "terminal": sent, "new_agent": started, "merged": how == "github", "queued": how == "queue"}, text)


def branch_tip(s, t):
    """The task branch's last commit here (else the one it said ready at), or None."""
    ok, tip, _ = git(s.loc["folder"], "rev-parse", "--verify", "--quiet", f"refs/heads/{t.get('branch')}")
    return (tip if ok and tip else None) or t.get("head") or None


def in_base(s, t):
    """Its branch holds nothing its base branch doesn't, here or on its remote: no commits of its
    own, or it only caught up with its base (`git merge --ff-only main` or `git rebase origin/main`
    while the local main is behind: SHEP-23, #737). Nothing to merge, and never merged."""
    tip, main, base = branch_tip(s, t), s.loc["folder"], t.get("base") or "main"
    return bool(tip) and (tip == t.get("start") or any(
        git(main, "merge-base", "--is-ancestor", tip, ref)[0] for ref in (base, f"refs/remotes/{remote_of(main)}/{base}")))


def ff_merge(s, t):
    """Lands a task's branch in its base branch here when that is a fast-forward (the base is
    checked out in the main folder and the branch already holds it: exactly the tested work, no
    new combination). Returns whether it did; git refuses to touch uncommitted files."""
    main, br, base = s.loc["folder"], t.get("branch"), t.get("base") or "main"
    ok, cur, _ = git(main, "symbolic-ref", "--short", "HEAD")
    if not (br and git(main, "merge-base", "--is-ancestor", base, br)[0]):
        return False
    if ok and cur == base:
        return git(main, "merge", "--ff-only", br)[0]
    # A base not checked out here (a task's own --base): its branch moves forward to the task's
    # (git refuses unless it's a fast-forward, or when another worktree has it checked out).
    return git(main, "fetch", ".", f"{br}:{base}")[0]


def cmd_accept(args):
    """The person's Accept on a Ready task (the one thing they do in the Tasks panel): Done at
    once when there is nothing to merge, else merged first, as the merge settings say how: a pull
    request is squash-merged on GitHub (or merges once its checks pass); a local branch is
    fast-forwarded when it can be, else its agent merges it (rebase, checks) and marks it done."""
    error, how, sent, started, back = None, "done", None, False, False
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] != "ready":
            raise Fail(f"{s.name(t)} isn't ready ({t['state']}); only a Ready task can be accepted.")
        # Its agent at work again since it said ready: never accepted half done. Working again
        # (saved), and refused after the store is.
        if busy_again(t, [detail(k) for k in live_agents(s.key(t))]):
            back = back_to_work(s, t, "its agent is at work again", auto=True)
        # One its agent opened itself, which ready couldn't open again ("already exists"): adopted.
        elif (not t.get("pr") and "already exists" in (t.get("attention") or "")
              and (repo := github(s)) and pr_adopt(t, repo)):
            t.pop("attention", None)
            s.dirty = True
        # A pull request's problems are read fresh (merge_now()): one fixed since, or a merge that
        # failed once, doesn't stand in the way. Without one, only a failed try doesn't.
        elif t.get("attention") and not t.get("pr") and not t["attention"].startswith(("Couldn't ask for the merge", MERGE_FAILED)):
            raise Fail(f"{s.name(t)} needs attention first: {t['attention']}")
    if back:
        raise Fail(f"{s.name(t)} is working again: its agent took up more work after it said ready. Accept it once it says ready again.")
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] != "ready":
            raise Fail(f"{s.name(t)} isn't ready ({t['state']}); only a Ready task can be accepted.")
        t.pop("attention", None)
        wt = t.get("worktree") if t.get("mode") == "worktree" else None
        t["accepted_at"] = now()
        s.dirty = True
        if not wt:
            # Worked in the folder itself: nothing to merge.
            finish(s, t)
        elif t.get("pr") or own_open_pr(s, t):
            how = "github"
            t["merge_asked"] = now()  # SHEP-320: as cmd_merge
            error = merge_now(s, t, accept=True)
            if error == IN_QUEUE:
                how, error = "queue", None
            elif error in (CHECKS_RUNNING, WAITS_APPROVAL):
                # Accepted: it merges by itself once they pass, or once it's approved (Merging).
                t["auto_merge"], how, error = "checks", "checks" if error == CHECKS_RUNNING else "approval", None
            elif error and not merge_waits(error):
                # 3.2: the merge failed: back to its agent, which fixes it and hands it in again
                t.pop("accepted_at", None)
                sent = merge_failed(s, t, error, args)
                error += f" Its agent ({sent}) was asked to fix it and hand it in again." if sent else ""
        elif merged_here(s, t) or in_base(s, t):
            # Its own work already in the base branch, or none of its own: nothing to merge.
            t["merged"] = merged_here(s, t)
            if not t["merged"]:
                t["nothing_to_merge"] = True
            finish(s, t, even_if_busy=True)
        elif ff_merge(s, t):
            how = "merged"
            t["merged"] = True
            finish(s, t, even_if_busy=True)
        else:
            how = "agent"
            t["merge_requested"] = now()
            sent, started = tell(s, t, local_merge_msg(s, t), args)
        v = view(s, t)
    if error:
        say(args, {**v, "error": error}, None) if args.json else print(f"herdr-task: {error}", file=sys.stderr)
        sys.exit(1)
    text = {"done": f"{s.name(t)} accepted: done.",
            "merged": f"{s.name(t)} accepted: merged into {t.get('base') or 'main'}; done.",
            "github": f"{s.name(t)} accepted: pull request #{(t.get('pr') or {}).get('number')} " +
                      ("was closed on GitHub, so nothing merged; done." if t.get("closed_unmerged") else "merged; done."),
            "checks": f"{s.name(t)} accepted: it merges once its checks pass.",
            "approval": f"{s.name(t)} accepted: it merges once it's approved.",
            "queue": f"{s.name(t)} accepted: pull request #{(t.get('pr') or {}).get('number')} is in GitHub's merge queue; done once GitHub merges it.",
            "agent": f"{s.name(t)} accepted: merge asked of {sent}" + (" (a new agent)" if started else "")}[how]
    say(args, {**v, "accepted": how, "terminal": sent, "new_agent": started}, text)


def withdraw_fix(s, t):
    """#1086: a fix asked for that no longer applies (done elsewhere, its agent told to stand down): its
    request goes, the problem it was for isn't raised again at the same commit (tick: fix_withdrawn), and
    a Ready task the fix took back to work is Ready again. Returns the problem it was for, or None."""
    problem = t.get("attention")
    if not (problem or t.get("fix_requested") or (t.get("back") and not t["back"].get("auto"))):
        return None
    if problem:
        t["fix_withdrawn"] = {"attention": problem, **({"head": t["attention_head"]} if t.get("attention_head") else {})}
    for k in ("attention", "attention_at", "attention_head", "handed_at", "fix_requested"):
        t.pop(k, None)
    (t.get("pr") or {}).pop("news", None)
    b = t.get("back")
    if t["state"] == "running" and b and not b.get("auto"):
        t["state"], t["ready_turns"] = "ready", ready_turns([detail(k) for k in live_agents(s.key(t))])
        t.pop("back")
        if (t.get("progress") or {}).get("by") == "herdr":
            t.pop("progress")
    s.dirty = True
    return problem or "its fix"


def cmd_fix(args):
    if getattr(args, "withdraw", False):
        with open_store(args) as s:
            t = s.find(args.id)
            was = withdraw_fix(s, t)
            v = view(s, t)
        say(args, {**v, "withdrawn": was}, f"{s.name(t)}: " + (f"fix request withdrawn ({was})" if was else "no fix request to withdraw"))
        return
    with open_store(args) as s:
        t = s.find(args.id)
        if t.get("mode") != "worktree" or not t.get("worktree"):
            raise Fail(f"{s.name(t)} works in the folder itself; tell its agent what to fix.")
        problem = args.reason or t.get("attention") or "The pull request can't merge yet."
        main, wt, br, base = s.loc["folder"], t["worktree"], t["branch"], t.get("base") or "main"
        c = collision(s, t, fetch=True)
        msg = (f"Task {s.name(t)} can't merge yet: {problem}\n" + (f"{collision_words(c)}\n" if c else "") +
               f"Fix it in {wt}: for conflicts, rebase {br} onto {c['ref'] if c else base}; for failing checks, find out why and fix them. "
               f"Run the checks, commit, then run `herdr-task ready {t['id']} --folder {shlex.quote(main)}` to push the fix.")
        # Handed the problem: someone is on it while its agent starts (on_it()).
        t["fix_requested"] = t["handed_at"] = now()
        s.dirty = True
        sent, started = tell(s, t, msg, args)
        back_to_work(s, t, f"asked to fix: {problem}", f"Fixing: {problem}")
        v = view(s, t)
    say(args, {**v, "terminal": sent, "new_agent": started},
        f"{s.name(t)}: asked {sent} to fix it" + (" (a new agent)" if started else ""))
