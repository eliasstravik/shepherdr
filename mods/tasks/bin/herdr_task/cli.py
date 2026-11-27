"""The command line, and running herdr-task on another machine (--on)."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

from . import analytics, link
from .base import bundle, ENTRY, Fail, guard, run, STORE, sync_held, VERSION
from .agents import LINE_MAX, ROW_MAX, SUMMARY_MAX
from .launch import cmd_allow, name_tabs
from .commands import (
    cmd_accept, cmd_add, cmd_alert, cmd_archive, cmd_config, cmd_edit, cmd_fix, cmd_list, cmd_merge, cmd_ready, cmd_reply,
    cmd_resume, cmd_review, cmd_review_more, cmd_reviewed, cmd_rm, cmd_show, cmd_start, cmd_state, cmd_status,
    cmd_setup_failed, cmd_stop, cmd_switch, cmd_unarchive, cmd_where,
)
from .tick import cmd_tick
from .automations import auto_list, cmd_auto, cmd_scheduler, cmd_track, EVENTS, HOW
from .machines import cmd_assistants, cmd_machines, cmd_outbox, cmd_sync_auto, cmd_tell
from .flags import cmd_flags
from .home import cmd_home
from .assistant_settings import cmd_session_note
from .feedback import cmd_feedback
from .sandbox import cmd_sandbox

# SHEP-370: a title a phone's task row shows uncut (only asked, never refused)
TITLE_HELP = (f"at most {ROW_MAX} characters, so a phone's task row shows it uncut: the thing and the change in a few plain "
              f"words, no colon-and-list, no \"and\" (\"Call button in the message box\"); details go in the prompt")


# ---- another machine ------------------------------------------------------------------------

# Run there (sh -c): whether that machine holds herdr-task's source (machines.py INSTALL has the same rule).
HAS_SOURCE = ('test -d "$HOME/.local/share/shepherdr/mods/tasks/bin/herdr_task" || '
              'test -d "$HOME/.config/herdr-app/mods/tasks/bin/herdr_task"')

def install_secret(machine):
    """herdr-secret goes along to another machine (its `install --on`: no values, only the
    command), so agents there can ask for and use secrets. Best effort, again when it changed."""
    path = shutil.which("herdr-secret")
    if not path or sync_held():
        return
    with open(os.path.realpath(path), "rb") as f:
        digest = hashlib.sha1(f.read()).hexdigest()
    mark = os.path.join(STORE, ".remote", f"{machine}.secret")
    try:
        with open(mark) as f:
            if f.read().strip() == digest:
                return
    except OSError:
        pass
    r = subprocess.run([path, "install", "--on", machine], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode == 0:
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        with open(mark, "w") as f:
            f.write(digest)


def remote_run(machine, argv, timeout=None):
    """herdr-task on another machine (installed there first when it isn't this one): its run,
    output kept. timeout: seconds before herdr-core gives up on it."""
    body = bundle()
    digest = hashlib.sha1(body).hexdigest()
    mark = os.path.join(STORE, ".remote", machine)
    target = ".local/bin/herdr-task"
    try:
        with open(mark) as f:
            # "source": it holds herdr-task's source, and runs its own
            installed = f.read().strip() in (digest, "source")
    except OSError:
        installed = False

    def install():
        held = sync_held()
        if held:
            raise Fail(f"herdr-task isn't current on {machine}, and copies to other machines wait: {held}. "
                       "Run `shepherdr doctor` once the install is whole.")
        guard(["hc"])
        # 3.2: its link must lead to Shepherdr's own session there (hc machine add --session), or agents started
        # there by herdr-task couldn't be reached through it. Asked once per install.
        from .base import SESSION
        try:
            links = json.loads(run(["hc", "machine", "ls", "--json"]).stdout or "{}").get("machines") or []
        except (ValueError, AttributeError):
            links = []
        linked = next((m for m in links if isinstance(m, dict) and m.get("name") == machine), None)
        if linked and (linked.get("session") or "default") != SESSION:
            raise Fail(f"{machine} is linked to herdr-core session {linked.get('session') or 'default'!r} there, not Shepherdr's own "
                       f"({SESSION}): add it again with `hc machine add {linked.get('target') or machine} --name {machine} --session {SESSION}` "
                       "(herdr-task machines adopt does it for the default session's machines).")
        # A machine with Shepherdr's own install (before 3.2: in Herdr's app folder) holds herdr-task's source: copies
        # come from there, it's never written to (machines.py, the same rule). Its link ~/.local/bin/herdr-task leads
        # into that install.
        there = run(["hc", "exec", "--on", machine, "--", "sh", "-c", HAS_SOURCE])
        if link.lost(there):
            raise Fail(f"Can't reach {machine}: its link is down, and nothing was run there. Try again once it's back.")
        if there.returncode == 0:
            os.makedirs(os.path.dirname(mark), exist_ok=True)
            with open(mark, "w") as f:
                f.write("source")
            return
        # Written beside its place, then swapped in with one rename (SHEP-259): a herdr-task running there keeps
        # its whole old file, never a half-written one.
        tmp = f"{target}.herdr-new.{os.getpid()}"
        r = subprocess.run(["hc", "file", "write", "--on", machine, tmp], input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            raise Fail(f"Couldn't install herdr-task on {machine}: {r.stderr.decode().strip()}")
        run(["hc", "exec", "--on", machine, "--", "sh", "-c", 'chmod +x "$1" && mv -f "$1" "$2"', "sh", tmp, target], check=True)
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        with open(mark, "w") as f:
            f.write(digest)

    # Held (base.sync_held): no copy goes; the copy already there runs.
    if not installed and not sync_held():
        install()
    install_secret(machine)
    if argv[:1] == ["_job"]:
        # an action that was still running there (link.PENDING): its result, waiting again
        return link.follow(machine, argv[1] if len(argv) > 1 else "", argv, time.monotonic() + link.wait_s())
    if argv[:1] and argv[0] in link.ACTIONS:
        # the person's action: runs there whole even when the link drops, its result read back (SHEP-227, #1055)
        return link.action(machine, argv, install)
    wait = ["--timeout", str(timeout)] if timeout else []
    call = ["hc", "exec", "--on", machine, *wait, "--", "sh", "-c", 'exec "$HOME/.local/bin/herdr-task" "$@"', "herdr-task", *argv]
    r = link.again(machine, argv, lambda: run(call)) if argv[:1] and argv[0] in link.READS else run(call)
    if r.returncode == 127 or "not found" in r.stderr and not r.stdout:
        install()
        r = run(call)
    return r


def remote(machine, argv):
    """Runs herdr-task on the machine that holds the folder (installing it there first), then
    names a new tab from here, where the window is."""
    if argv[:1] == ["tick"]:
        # Its start limits live in Settings here, where the window is (HERD-40).
        from .settings import machine_limits
        argv = [*argv, "--machine", machine, "--hold", json.dumps(machine_limits(machine))]
    r = remote_run(machine, argv)
    sys.stderr.write(r.stderr)
    out = r.stdout
    if r.returncode == 0 and "--json" in argv:
        try:
            d = json.loads(out)
        except ValueError:
            d = None
        if isinstance(d, dict):
            left = name_tabs([(f"{machine}/{x['tab']}", x["name"]) for x in d.get("rename") or []])
            if d.get("rename"):
                d["rename"], d["named"] = left, not left
            for k in ("tab", "terminal"):
                if isinstance(d.get(k), str) and "/" not in d[k]:
                    d[k] = f"{machine}/{d[k]}"
            out = json.dumps(d) + "\n"
        # An automation's view (auto list, show, add...) is that machine's: it says so (SHEP-43).
        if argv[:1] == ["auto"] and argv[1:2] != ["feed"]:
            views = d if isinstance(d, list) else [d] if isinstance(d, dict) else []
            for v in views:
                if isinstance(v, dict) and "ref" in v and v.get("machine") is None:
                    v["machine"] = machine
            if views:
                out = json.dumps(d) + "\n"
    sys.stdout.write(out)
    return r.returncode


# ---- cli ------------------------------------------------------------------------------------

def main():
    argv = sys.argv[1:]
    if argv[:1] == ["--detach"]:
        # #1211: the window's way to run an action that may outlast its 30 s (an Accept waiting on GitHub's merge)
        argv = argv[1:]
        if argv[:1] and argv[0] in link.ACTIONS:
            r = link.local_action(argv, ENTRY)
            sys.stdout.write(r.stdout or "")
            sys.stderr.write(r.stderr or "")
            return r.returncode
    if argv[:1] == ["_hold"] and len(argv) == 2:
        # herdr-artifact's note to an agent on a question (#1213): kept, held_pass sends it once that's answered
        from .news import hold
        text = sys.stdin.read()
        if not text.strip():
            return 2
        hold(argv[1], text, "send")
        return 0
    if argv[:1] == ["_job"]:
        # an action here that was still running (link.PENDING, machine ""): its result, waiting again
        r = link.local_follow(argv[1] if len(argv) > 1 else "", argv, time.monotonic() + link.wait_s(), started=False)
        sys.stdout.write(r.stdout or "")
        sys.stderr.write(r.stderr or "")
        return r.returncode
    if argv[:1] == ["--on"] and len(argv) > 1:
        try:
            return remote(argv[1], argv[2:])
        except Fail as e:
            if "--json" in argv:
                print(json.dumps({"error": str(e)}))
            else:
                print(f"herdr-task: {e}", file=sys.stderr)
            return 1
    if argv[:1] == ["--version"]:
        print(VERSION)
        return 0

    p = argparse.ArgumentParser(prog="herdr-task", description="Herdr's tasks: add, start and finish work for a folder.",
                                epilog="Run on another machine's folder: herdr-task --on <machine> <command> ...")
    sub = p.add_subparsers(dest="cmd")

    def cmd(name, fn, help, id=True):
        c = sub.add_parser(name, help=help)
        if id:
            c.add_argument("id", help="task id (4, #4 or its key)")
        c.add_argument("--folder", help="the task folder (default: here)")
        c.add_argument("--json", action="store_true")
        c.set_defaults(fn=fn)
        return c

    def notes_opts(c):
        c.add_argument("--start-notes", help="this task's own \"When a task starts\" notes, replacing the folder's (\"\": the folder's)")
        c.add_argument("--finish-notes", help="this task's own \"When a task finishes\" notes, replacing the folder's (\"\": the folder's)")

    def task_opts(c):
        c.add_argument("--agent", help="the CLI its agent runs (claude, codex, ...; default: Settings' Workers)")
        c.add_argument("--model", help="its agent's model, an id or alias (default: Settings'; \"default\": the CLI's own)")
        c.add_argument("--effort", help="its agent's effort: low, medium, high, xhigh, max... (default: Settings')")
        pick_opts(c)
        c.add_argument("--flags", help="extra flags for its agent's CLI, as you'd type them, e.g. --flags=\"--advisor opus\": only real Claude Code or "
                                       "Codex flags, none Shepherdr sets itself (default: its space's Settings › Tasks; \"none\": none; \"default\": the space's again)")
        c.add_argument("--reviewer", help="the CLI its agent's review uses (default: Settings' Reviewer, else the other CLI)")
        c.add_argument("--reviewer-model", help="the reviewer's model")
        c.add_argument("--reviewer-effort", help="the reviewer's effort")
        c.add_argument("--reviewer-speed", help="the reviewer's service tier: standard, fast or ultrafast, where supported")
        c.add_argument("--set", action="append", metavar="KEY=VALUE",
                       help="one task's setting, a line of its brief's Settings block: review=on|off, review.rounds=1..10, "
                            "review.mustFix=blocker|major|minor, proof=on|off, flags=\"--advisor opus\", merge=\"on its own\"|\"after checks\"|\"ask me first\" (\"\": Settings' again)")
        c.add_argument("--base", help="the branch its worktree branches from and merges into (default: its space's Base branch "
                                      "setting, else the folder's current branch); on a started task, edit moves it there: its pull request "
                                      "retargeted and its own commits rebased (a task on another task's branch moves by itself once that merges)")
        c.add_argument("--branch", help="its branch's exact name, e.g. a ticket's ABC-2137 (default: the folder's Branch names "
                                        "setting, else task/<n>-<title words>); refused when that branch exists already (\"\": the pattern's). "
                                        "Once started, edit takes the existing branch its work is on (in the worktree it's checked out in)")
        c.add_argument("--pr", help="take a pull request already open, by its number (#1155): its review, checks and Accept go there "
                                "instead of a new one, and ready pushes to its branch (\"\" lets go)")

    def pick_opts(c):
        c.add_argument("--speed", help="its agent's service tier: standard, fast or ultrafast, where supported (default: Settings')")
        c.add_argument("--permission", help="its agent's permission mode, in its CLI's words: Claude Code's default, acceptEdits, plan, "
                                            "auto, bypassPermissions; Codex's read-only, auto, approve (Approve for me), full (\"\": Settings' again)")

    def agent_opts(c):
        c.add_argument("--agent", help="agent key (claude, codex, ...)")
        c.add_argument("--argv", help="how to start it, as a JSON list (default from --agent)")

    def when_opts(c, edit=False):
        # SHEP-38: Scheduled, a one-off start at a time (a repeating one is an automation: auto add --every).
        g = c.add_mutually_exclusive_group()
        g.add_argument("--at", help="start it by itself at this time, this machine's time zone: \"2026-11-06 09:00\", "
                                    "\"tomorrow 9:00\", \"fri 8:15\", \"18:00\"" + (" (\"\" unschedules: back to To do)" if edit else ""))
        g.add_argument("--in", dest="in_", metavar="SPAN", help="start it by itself this long from now: \"6h\", \"90m\", \"2 days\"")

    cmd("where", cmd_where, "the task folder and store for a folder", id=False)
    c = cmd("list", cmd_list, "list tasks", id=False)
    c.add_argument("--all", action="store_true", help="every folder's tasks on this machine")
    c.add_argument("--archived", action="store_true", help="the archived tasks instead (Done ones archive themselves after a week), latest first")
    c = cmd("add", cmd_add, "add a task; prints its id", id=False)
    c.add_argument("title", help=TITLE_HELP)
    c.add_argument("--prompt")
    c.add_argument("--prompt-file")
    task_opts(c)
    notes_opts(c)
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true", help="work in the folder itself")
    g.add_argument("--worktree", action="store_true", help="work in a git worktree (default in repos)")
    c.add_argument("--after", help="start only once these tasks are done: 3,5; another folder's by its id (WEB-2), another "
                                   "machine's with the machine first (vm-b:HAT-12). Only for a task that needs their result "
                                   "(or a release): with worktrees, tasks on the same files still run in parallel")
    c.add_argument("--space", help="the space it's for, whose settings it takes (default: yours)")
    when_opts(c)
    c = cmd("show", cmd_show, "one task")
    c.add_argument("--evidence", action="store_true", help="with what its Accept card shows: commits, changed files, checks and its proof")
    c = cmd("start", cmd_start, "start a task's agent (no tab: an hc child of the space's coordinator)")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--parent", help="a coordinator's terminal: the agent's hc parent (default: the space's coordinator)")
    c.add_argument("--now", action="store_true", help="skip the queue (a scheduled task: start it now)")
    c.add_argument("--model", help="its agent's model for this start and after (as edit --model)")
    c.add_argument("--effort", help="its agent's effort (as edit --effort)")
    pick_opts(c)
    c.add_argument("--branch", help="its branch's exact name (as add --branch), before its worktree is made")
    c.add_argument("--pr", help="take a pull request already open, by its number (#1155): its review, checks and Accept go there "
                                "instead of a new one, and ready pushes to its branch (\"\" lets go)")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true")
    g.add_argument("--worktree", action="store_true")
    when_opts(c)
    c = cmd("ready", cmd_ready, "a worker's task is finished (worktree tasks: committed): it waits in Ready for the person's Accept (opens a pull request on GitHub)")
    c.add_argument("--summary", help=f"what the person now sees or can do, in plain words, at most {SUMMARY_MAX} characters "
                                     "(no file names, flags or jargon); longer is refused")
    c.add_argument("--details", help="optional: a few short bullets in plain words (one \"- \" per line): what changed for the "
                                     "person first, then how it was checked; file names only where they help; never one dense "
                                     "paragraph. Folded under Details in the Accept card")
    c.add_argument("--proof", help="its proof artifact's id (herdr-artifact publish prints it); default: its newest artifact titled \"... · Proof\"")
    c.add_argument("--agents-md", help="\"For AGENTS.md\": one line about setting up or testing this repo that the next agent "
                                       "would need and AGENTS.md lacks; the Assistant decides whether to add it")
    c.add_argument("--pr", help="take a pull request already open, by its number (#1155): its review, checks and Accept go there "
                                "instead of a new one, and ready pushes to its branch (\"\" lets go)")
    c.add_argument("--pr-title", help="the pull request's title, when the repo wants its own form (#1087; default: "
                                      "\"<task ref>: <task title>\"); a later ready with it renames the open one")
    c.add_argument("--pr-body", help="the pull request's description, as written (#1087; default: Shepherdr's summary, "
                                     "details and proof); a later ready with it replaces the open one's")
    c.add_argument("--draft", action="store_true", help="open its pull request as a draft (#1155); Accept marks it ready "
                                                        "for review before merging")
    c.add_argument("--nothing", action="store_true", help="a schedule's run that found nothing to do: Done at once, no review, "
                                                          "no alert, no message (refused when it changed anything)")
    c.add_argument("--told", metavar="TEXT", help="a schedule's run that only has something to say (a brief, a reminder): the "
                                                  "text goes to its space's chat as written and the task is Done, no review "
                                                  "(refused when it changed anything)")
    c = cmd("reviewed", cmd_reviewed, "a task's agent records one review round of its current commit (Review: on): ready then "
                                      "accepts that commit; uses one of its Review rounds")
    c.add_argument("--report", help="the round's findings in a line (levels, what was fixed)")
    c.add_argument("--commit", help="the commit the round reviewed, when fixes were committed since (default: the newest commit of "
                                         "the task's branch, wherever it is checked out)")
    cmd("review-more", cmd_review_more, "the Assistant gives a task one more review round, once all are used (never its own agent)")
    c = cmd("status", cmd_status, "a task's agent says what it's doing now, at the start, each natural step and at least every 5 minutes: status 4 \"Fixing the two failing tests\" --done 40 --left 5m")
    c.add_argument("text", help=f"what it is doing, at most {ROW_MAX} characters to show uncut on a phone, a few plain words "
                                    f"(longer than {LINE_MAX} is cut at a word)")
    c.add_argument("--done", type=int, help="how far through the whole task, 0-100 (%%)")
    c.add_argument("--left", help="your best guess of how long is left: 5m, 90s, 1h30m; on every status, the first too (a rough guess beats none)")
    c = cmd("alert", cmd_alert, "tell the person something that can't wait: a toast and a sound (an Assistant's follow its space's Notify): alert \"Deploy is down\" --body \"why\"", id=False)
    c.add_argument("title", help="what can't wait, a few words")
    c.add_argument("--body", help="why, a line or two")
    c.add_argument("--task", help="the task it's about (an Assistant's alert about one of its tasks always reaches the person)")
    c = cmd("feedback", cmd_feedback, "a problem in Shepherdr itself (not the project's): feedback \"<one line>\" --details \"goal, what "
            "was tried, what went wrong, expected, suggested fix\" returns at once and your Assistant offers the person to file it "
            "on GitHub; an Assistant gets whether to offer, and files it only on the person's yes (--file)", id=False)
    c.add_argument("line", nargs="?", default="", help="the problem in one line")
    c.add_argument("--details", help="goal, what was tried, what went wrong, expected, suggested fix (no secrets, no logs whole)")
    c.add_argument("--key", help="the problem's key, as its news line or an earlier answer gave it")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--file", action="store_true", help="Assistant, after the person's yes: search open issues for a duplicate, then file it")
    g.add_argument("--no", action="store_true", help="Assistant: the person said no; never offered again")
    g.add_argument("--list", action="store_true", help="what waits to be offered in this space")
    for f, words in (("goal", "what they were trying to do"), ("happened", "what went wrong"), ("tried", "what was tried"),
                     ("expected", "what should have happened"), ("fix", "a suggested fix"), ("repro", "minimal steps to reproduce")):
        c.add_argument(f"--{f}", help=f"--file: {words}")
    c.add_argument("--title", help="--file: the issue's title (default: the one line)")
    c.add_argument("--surface", choices=["web", "window", "both"], help="--file: where the person used Shepherdr")
    c.add_argument("--repo", help=argparse.SUPPRESS)  # a test's throwaway repo; Settings' otherwise
    h = c.add_mutually_exclusive_group()
    h.add_argument("--new", action="store_true", help="--file: file it even though duplicates are open")
    h.add_argument("--comment", type=int, metavar="N", help="--file: add it as a comment on open issue N instead")
    c.add_argument("--dry-run", action="store_true", help="--file: show the redacted draft and duplicates, file nothing")
    cmd("done", lambda a: cmd_state(a, "done"), "mark done without merging (the person's call: only when they ask; agents finish "
                                                "with ready): a task on its own branch is closed unmerged, its branch and pull request left as they are")
    c = cmd("stop", cmd_stop, "the person's Stop: pause its agent like pressing Esc (it drops what it was doing and waits); the next "
                              "message to it carries on")
    c.add_argument("--untrusted", action="store_true", help="the person said No to its CLI's folder-trust screen (its agent "
                                                            "exited): stopped, saying so; the next message starts it again")
    c = cmd("reply", cmd_reply, "the person's message to a task: to its agent, or (none left, or the task is Done) its agent starts "
                                "again on its own session with it")
    c.add_argument("text", nargs="?", help="the message (default: what is piped in)")
    agent_opts(c)
    c.add_argument("--space")
    cmd("archive", cmd_archive, "take a task out of its list without deleting it (the person's call; unarchive brings it back)")
    c = cmd("accept", cmd_accept, "the person's Accept on a Ready task: merges first when there is something to merge, then done")
    agent_opts(c)
    c.add_argument("--space")
    cmd("reopen", lambda a: cmd_state(a, "reopen"), "undo done or ready; a queued or scheduled task goes back to to do")
    cmd("unarchive", cmd_unarchive, "bring an archived task back into its list (only when the person asks; writing to it does too)")
    c = cmd("edit", cmd_edit, "change a task")
    c.add_argument("--title", help=TITLE_HELP)
    c.add_argument("--space", help="move it to another space, by its id (only before it has started)")
    c.add_argument("--move-to", metavar="FOLDER", help="with --space, when that space is another folder on this machine: the task "
                                                       "moves to that folder's list and gets a new id there (only before it has started)")
    c.add_argument("--prompt")
    c.add_argument("--prompt-file")
    task_opts(c)
    notes_opts(c)
    c.add_argument("--after", help="start only once these tasks are done: 3,5, WEB-2, vm-b:HAT-12 (\"\" clears)")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true")
    g.add_argument("--worktree", action="store_true")
    when_opts(c, edit=True)
    cmd("rm", cmd_rm, "remove a task")
    c = cmd("config", cmd_config, "this folder's settings", id=False)
    c.add_argument("--prefix", help=argparse.SUPPRESS)  # SHEP-322: tasks are named by title; taken and left alone
    c = cmd("tick", cmd_tick, "start queued tasks that can go; mark merged ones done (Herdr runs this)", id=False)
    c.add_argument("--machine", help=argparse.SUPPRESS)  # this machine's name, from Herdr's window (HERD-40)
    c.add_argument("--hold", help=argparse.SUPPRESS)  # its start limits as JSON, from Settings > Machines
    c = sub.add_parser("review")  # reviewers herdr-task started before agents reviewed their own work
    c.add_argument("id")
    c.add_argument("--folder")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_review)
    c.add_argument("--pass", dest="passed", action="store_true", help="nothing that must be fixed")
    c.add_argument("--changes", help="what must be fixed, for the worker")
    c.add_argument("--changes-file")
    c.add_argument("--notes", help="suggestions with a pass")
    c = cmd("scheduler", cmd_scheduler, "run automations and the queue (herdr-core keeps one as herdr-automations)", id=False)
    c.add_argument("--ensure", action="store_true", help="start it if automations need it and it isn't running")
    c.add_argument("--once", action="store_true", help="one round, then exit")
    au = sub.add_parser("auto", help="automations: a saved task that a time or an event adds again").add_subparsers(dest="auto")

    def auto_cmd(name, help, id=True, fields=False):
        c = au.add_parser(name, help=help)
        if id == "maybe":
            c.add_argument("id", nargs="?", help="automation id (HAT-A1, A1 or 1); or --space <id> --all")
            c.add_argument("--space", help="with --all: every schedule of this space on this machine")
            c.add_argument("--all", action="store_true", help="with --space: all of that space's schedules (an archived space's stop)")
        elif id:
            c.add_argument("id", help="automation id (HAT-A1, A1 or 1)")
        c.add_argument("--folder")
        c.add_argument("--json", action="store_true")
        c.set_defaults(fn=cmd_auto)
        if fields:
            c.add_argument("--prompt")
            c.add_argument("--prompt-file")
            c.add_argument("--when", help="when it runs, in one line of plain words: a time (\"Mondays 9:00\", \"every 30 minutes\", "
                                          "\"once fri 9:00\"), an event (\"when a task is merged\", \"when checks fail\") or both; "
                                          "replaces --every and --on")
            c.add_argument("--every", help=HOW)
            c.add_argument("--on", help="events, comma-separated: " + ", ".join(EVENTS))
            c.add_argument("--match", help="only tasks whose title has these words, or branch:<glob>")
            c.add_argument("--from", dest="from_", help="hear another folder's task events instead of this one's: "
                           "vm-b:~/dev/app (another machine linked to this one) or a folder here (\"\" clears)")
            c.add_argument("--agent")
            c.add_argument("--space", help="the space its tasks start in (default: yours)")
            c.add_argument("--parent", help="its tasks' agents' parent (default: you)")
            c.add_argument("--may-update-shepherdr", dest="may_update", metavar="on|off",
                           help="its runs may update Shepherdr here (`herdr-task update-shepherdr`): only the person sets it, "
                                "never from a task's terminal")
            c.add_argument("--set", action="append", metavar="KEY=VALUE",
                           help="a setting for each task it adds, as add --set: review=on|off, review.rounds=1..10, proof=on|off, "
                                "merge=..., ... (\"\": Settings' again)")
            g = c.add_mutually_exclusive_group()
            g.add_argument("--here", action="store_true")
            g.add_argument("--worktree", action="store_true")
        return c
    c = auto_cmd("add", "add an automation", id=False, fields=True)
    c.add_argument("title", help=TITLE_HELP)
    c = auto_cmd("edit", "change an automation", fields=True)
    c.add_argument("--title", help=TITLE_HELP)
    c = auto_cmd("list", "this folder's automations", id=False)
    c.add_argument("--all", action="store_true", help="every folder's on this machine")
    c.set_defaults(fn=auto_list)
    auto_cmd("show", "one automation: when, what, space, agent, next and last run, its last 50 runs and how each ended")
    auto_cmd("feed", "this folder's tasks as events read them, as JSON (asked by another machine's --from)", id=False)
    auto_cmd("pause", "stop it firing (--space <id> --all: every schedule of a space, as when the space is archived)", id="maybe")
    auto_cmd("resume", "let it fire again (--space <id> --all: every schedule of a space)", id="maybe")
    c = sub.add_parser("flags", help="check extra flags for a task's agent (#1222) and print them as Shepherdr keeps them: "
                       "only real Claude Code or Codex flags, none Shepherdr sets itself")
    c.add_argument("--agent", default="claude", choices=["claude", "codex"], help="the CLI they're for (default: claude)")
    c.add_argument("--json", action="store_true")
    c.add_argument("words", nargs=argparse.REMAINDER, help="the flags, after -- (e.g. -- --advisor opus), or as one quoted line")
    c.set_defaults(fn=cmd_flags)
    auto_cmd("rm", "remove it")
    auto_cmd("run-now", "add and start its task now")
    ma = sub.add_parser("machines", help="other machines: keep the task tools in step there (sync), and what each machine reaches (reach)").add_subparsers(dest="machines")
    c = ma.add_parser("sync", help="install or update herdr-task, its helpers and the role templates on every connected machine (current ones are skipped)")
    c.add_argument("machine", nargs="*", help="only these machines (default: every connected one)")
    c.add_argument("--check", action="store_true", help="only report each machine: current, out of date (and what), or can't reach; exits 1 unless all are current")
    c.add_argument("--force", action="store_true", help="also replace a template someone changed there, or a newer copy")
    c.add_argument("--auto", action="store_true", help=argparse.SUPPRESS)
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=lambda a: cmd_sync_auto(a.machine) if a.auto else cmd_machines(a))
    c = ma.add_parser("adopt", help="3.2: add the machines the default herdr-core session (the Herdr app's) links to to Shepherdr's "
                                    "own session, each leading to Shepherdr's session there; the default session is only read")
    c.add_argument("--dry-run", action="store_true", help="only say which would be added")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_machines)
    c = sub.add_parser("carry-over", help="3.2's switch, safe to run again: what Shepherdr kept in the default herdr-core session (its documents, "
                                          "its machines, its idle agents) into its own session, and 3.1's scheduler there removed")
    c.add_argument("--dry-run", action="store_true", help="only say what it would do")
    c.add_argument("--wait", type=int, default=20, help="seconds to wait for the machines just added to connect (default 20)")
    c.add_argument("--agents", action="store_true", help="only Shepherdr's agents still in the default session (with --dry-run: which are left, as doctor asks)")
    c.add_argument("--records", action="store_true", help="only the records naming a machine by id (who keeps the secrets, Serve from): one naming an id "
                                                          "from the default session is changed to that machine's id now (with --dry-run: which, as doctor asks)")
    c.add_argument("--links", action="store_true", help="only the links another herdr-core answers on now (\"a different core answers there\"): each "
                                                        "linked again where that is safe, and the records naming it follow (with --dry-run: which)")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=lambda a: __import__("herdr_task.carry_over", fromlist=["cmd_carry_over"]).cmd_carry_over(a))
    c = ma.add_parser("reach", help="the reach map: the machines this one links to over herdr-core, and through each, what that one links to (contacts nothing else)")
    c.add_argument("--refresh", action="store_true", help="check every link now, and make each unreachable one try to connect again first (default: the scheduler's map, at most 10 minutes old)")
    c.add_argument("--quiet", action="store_true", help=argparse.SUPPRESS)
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_machines)
    c = ma.add_parser("find", help="Find machines: list the ssh config's hosts and online Tailscale peers not linked yet (contacts none); --go tries each once")
    c.add_argument("--go", action="store_true", help="try each listed host once now (ssh, batch mode); at most once every 10 minutes")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_machines)
    ho = sub.add_parser("home", help="a machine's home Assistant: show (default) says whether you are one and how the machine is now")
    ho.set_defaults(fn=cmd_home, home=None, json=False)
    hs = ho.add_subparsers(dest="home")
    c = hs.add_parser("show", help="whether you are this machine's home Assistant (or the main machine's), its health, stuck processes and leftover worktrees")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_home)
    c = hs.add_parser("report")  # the main machine's round reads another machine with it
    c.add_argument("--spaces")
    c.add_argument("--since", type=int)
    c.add_argument("--news-only", action="store_true")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_home)
    c = hs.add_parser("pass", help="one home round now (the scheduler runs one every minute)")
    c.add_argument("--only", help="just this machine (local or its name)")
    c.add_argument("--to", help="send everything to this Assistant instead (a test's own)")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_home)
    c = sub.add_parser("assistants", help="every live Assistant on every machine reachable from here: its address (machine/terminal), space and folder")
    c.add_argument("--refresh", action="store_true", help="look again now")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_assistants)
    c = sub.add_parser("tell-assistant", help="message an Assistant or reply to a task terminal: tell-assistant vm-demo/t3 \"...\" (or name an Assistant's space)")
    c.add_argument("target", help="an Assistant's space or address, or a task message's from address (t3, vm-demo/t3, laptop>vm-x/t3)")
    c.add_argument("text")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_tell)
    c = cmd("fix", cmd_fix, "ask the task's agent to fix what keeps its pull request from merging")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--reason", help="what to fix (default: what Herdr found)")
    c.add_argument("--withdraw", action="store_true", help="take back a fix request that no longer applies (its agent stood "
                   "down, or it was fixed elsewhere): the task goes back to Ready and that problem isn't raised again at the same commit")
    c = cmd("merge", cmd_merge, "ask the task's agent to merge it (the Merge button)")
    agent_opts(c)
    c.add_argument("--space")
    c = cmd("resume", cmd_resume, "continue a stopped task")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--parent")
    c = cmd("switch", cmd_switch, "replace the task's agent (no --agent: restart it)")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--parent")
    c.add_argument("--keep", action="store_true", help="add the agent beside the old one")
    c.add_argument("--when-idle", action="store_true", help="leave an active turn alone and resume without a new message")
    c = sub.add_parser("_allow")  # Codex's PermissionRequest hook (own_argv)
    c.add_argument("--command", required=True)
    c.add_argument("--sandboxed", action="store_true")  # Codex's: its proof and commits run escalated (#866)
    c.add_argument("--auto-review", action="store_true")  # Codex's Approve for me: its own review answers the rest (#1464)
    c.set_defaults(fn=cmd_allow, json=False)
    c = sub.add_parser("_outbox")  # another machine fetching the Assistants' answers left here for it (machines.replies_pass)
    c.add_argument("--for", dest="for_", required=True)
    c.set_defaults(fn=cmd_outbox, json=False)
    c = sub.add_parser("_session-note")  # the chat's SessionStart hook (mods/chat/session-note.sh): an Assistant's extra words
    c.add_argument("terminal")
    c.set_defaults(fn=cmd_session_note, json=False)
    c = sub.add_parser("_hold-news")  # feedback's report, queued for its Assistant in the background (feedback.queue_news)
    c.add_argument("to")
    c.add_argument("text")
    c.set_defaults(fn=lambda a: __import__("herdr_task.news", fromlist=["hold"]).hold(a.to, a.text, "news"), json=False)
    c = cmd("sandbox", cmd_sandbox, "whether Codex's sandbox (bwrap) can start on this machine, and the fix for it when it can't "
            "(asked once and kept; --check asks again)", id=False)
    c.add_argument("--check", action="store_true", help="ask again now")
    c = sub.add_parser("_setup-failed")  # a task's setup before its agent failed in its terminal (launch.SETUP_SH)
    c.add_argument("id")
    c.add_argument("--folder")
    c.add_argument("--code", type=int, default=1)
    c.add_argument("--log", default="")
    c.set_defaults(fn=cmd_setup_failed, json=False)
    c = sub.add_parser("_after-accept")  # a Done task's "When a task is accepted" command, run in the background (after_accept.py)
    c.add_argument("id")
    c.add_argument("--folder")
    c.set_defaults(fn=lambda a: __import__("herdr_task.after_accept", fromlist=["cmd_after_accept"]).cmd_after_accept(a), json=False)
    c = cmd("update-shepherdr", lambda a: __import__("herdr_task.self_update", fromlist=["x"]).cmd_update_shepherdr(a),
            "a schedule's run updates Shepherdr on this machine, outside its terminal, if the person let that schedule; "
            "waits and says how it went (exit 0: updated, 1: failed, 75: still running)")
    c.add_argument("--status", action="store_true", help="only how its last update went")
    c.add_argument("--no-wait", action="store_true", help="start it and don't wait")
    c.add_argument("--root", help=argparse.SUPPRESS)
    c = sub.add_parser("_update-shepherdr")  # the update a schedule's run asked for, in its own process session (self_update.py)
    c.add_argument("id")
    c.add_argument("--folder")
    c.add_argument("--root")
    c.set_defaults(fn=lambda a: __import__("herdr_task.self_update", fromlist=["x"]).cmd_run(a), json=False)
    c = sub.add_parser("_disk-top")  # what fills a disk that holds new tasks, found in the background (queues.disk_top)
    c.add_argument("path")
    c.set_defaults(fn=lambda a: __import__("herdr_task.queues", fromlist=["cmd_disk_top"]).cmd_disk_top(a), json=False)
    c = sub.add_parser("analytics", help="personal analytics, kept only on your own machines: how you use Shepherdr, as numbers "
                       "(show: a summary; raw: every event; export: all of it as one JSON; delete: everything, on every machine; on/off)")
    c.add_argument("what", nargs="?", choices=["show", "raw", "export", "delete", "on", "off"], default="show")
    c.add_argument("--period", choices=["day", "week", "month"], help="the last day, week or month (default: week)")
    c.add_argument("--days", type=int, help="the last N days instead")
    c.add_argument("--here", action="store_true", help="this machine only, not your other machines too")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=analytics.cmd_analytics)
    c = sub.add_parser("_track")
    c.add_argument("id")
    c.add_argument("address")
    c.add_argument("--folder")
    c.set_defaults(fn=cmd_track, json=False)

    args = p.parse_args(argv)
    if not getattr(args, "fn", None):
        p.print_help()
        return 1
    try:
        rc = args.fn(args)
    except Fail as e:
        return _refused(args, str(e))
    except OSError as e:
        # #1057: a program it runs (hc, git, gh) that couldn't be started (the system refusing a new process
        # under memory pressure, hc missing or broken) ended Accept with a traceback at its first hc call
        # (busy_again's). Said plainly instead (a store open when it failed is left as it was).
        what = os.path.basename(str(e.filename)) if e.filename else "a program it needs"
        return _refused(args, f"couldn't start {what} ({e.strerror or e}). Try again in a moment.")
    return rc if type(rc) is int else 0


def _refused(args, why):
    if getattr(args, "json", False):
        print(json.dumps({"error": why}))
    else:
        print(f"herdr-task: {why}", file=sys.stderr)
    return 1
