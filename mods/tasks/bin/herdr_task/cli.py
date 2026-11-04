"""The command line, and running herdr-task on another machine (--on)."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

from .base import bundle, Fail, guard, run, STORE, sync_held, VERSION
from .agents import LINE_MAX, SUMMARY_MAX
from .launch import cmd_allow, name_tabs
from .commands import (
    cmd_accept, cmd_add, cmd_alert, cmd_config, cmd_edit, cmd_fix, cmd_list, cmd_merge, cmd_ready,
    cmd_resume, cmd_review, cmd_review_more, cmd_reviewed, cmd_rm, cmd_show, cmd_start, cmd_state, cmd_status,
    cmd_switch, cmd_unarchive, cmd_where,
)
from .tick import cmd_tick
from .backups import cmd_backup, cmd_restore_spaces
from .automations import auto_list, cmd_auto, cmd_scheduler, cmd_track, EVENTS, HOW
from .machines import cmd_assistants, cmd_machines, cmd_sync_auto, cmd_tell
from .autopilot import cmd_autopilot, cmd_complete, cmd_progress
from .home import cmd_home


# ---- another machine ------------------------------------------------------------------------

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


def remote(machine, argv):
    """Runs herdr-task on the machine that holds the folder (installing it there first), then
    names a new tab from here, where the window is."""
    body = bundle()
    digest = hashlib.sha1(body).hexdigest()
    mark = os.path.join(STORE, ".remote", machine)
    target = ".local/bin/herdr-task"
    try:
        with open(mark) as f:
            installed = f.read().strip() == digest
    except OSError:
        installed = False

    def install():
        held = sync_held()
        if held:
            raise Fail(f"herdr-task isn't current on {machine}, and copies to other machines wait: {held}. "
                       "Run `shepherdr doctor` once the install is whole.")
        guard(["hc"])
        r = subprocess.run(["hc", "file", "write", "--on", machine, target], input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            raise Fail(f"Couldn't install herdr-task on {machine}: {r.stderr.decode().strip()}")
        run(["hc", "exec", "--on", machine, "--", "chmod", "+x", target], check=True)
        os.makedirs(os.path.dirname(mark), exist_ok=True)
        with open(mark, "w") as f:
            f.write(digest)

    # Held (base.sync_held): no copy goes; the copy already there runs.
    if not installed and not sync_held():
        install()
    install_secret(machine)
    if argv[:1] == ["tick"]:
        # Its start limits live in Settings here, where the window is (HERD-40).
        from .settings import machine_limits
        argv = [*argv, "--machine", machine, "--hold", json.dumps(machine_limits(machine))]
    call = ["hc", "exec", "--on", machine, "--", "sh", "-c", 'exec "$HOME/.local/bin/herdr-task" "$@"', "herdr-task", *argv]
    r = run(call)
    if r.returncode == 127 or "not found" in r.stderr and not r.stdout:
        install()
        r = run(call)
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
    sys.stdout.write(out)
    return r.returncode


# ---- cli ------------------------------------------------------------------------------------

def main():
    argv = sys.argv[1:]
    if argv[:1] == ["--on"] and len(argv) > 1:
        return remote(argv[1], argv[2:])
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
        c.add_argument("--agent", help="the CLI its agent runs (claude, codex, pi, pii, grok, hermes, amp, cursor; default: Settings' Workers)")
        c.add_argument("--model", help="its agent's model, an id or alias (default: Settings'; \"default\": the CLI's own)")
        c.add_argument("--effort", help="its agent's effort: low, medium, high, xhigh, max... (default: Settings')")
        c.add_argument("--reviewer", help="the CLI its agent's review uses (default: Settings' Reviewer, else the other CLI)")
        c.add_argument("--reviewer-model", help="the reviewer's model")
        c.add_argument("--reviewer-effort", help="the reviewer's effort")
        c.add_argument("--set", action="append", metavar="KEY=VALUE",
                       help="one task's setting, a line of its brief's Settings block: review=on|off, review.rounds=1..10, "
                            "review.mustFix=blocker|major|minor, proof=on|off, merge=\"on its own\"|\"after checks\"|\"ask me first\" (\"\": Settings' again)")
        c.add_argument("--base", help="the branch its worktree branches from and merges into (default: its space's Base branch "
                                      "setting, else the folder's current branch)")

    def agent_opts(c):
        c.add_argument("--agent", help="agent key (claude, codex, pi, pii, grok, hermes, amp, cursor, or a program on PATH)")
        c.add_argument("--argv", help="how to start it, as a JSON list (default from --agent)")

    cmd("where", cmd_where, "the task folder and store for a folder", id=False)
    c = cmd("list", cmd_list, "list tasks", id=False)
    c.add_argument("--all", action="store_true", help="every folder's tasks on this machine")
    c.add_argument("--archived", action="store_true", help="the archived tasks instead (Done ones archive themselves after a week), latest first")
    c = cmd("add", cmd_add, "add a task; prints its id", id=False)
    c.add_argument("title")
    c.add_argument("--prompt")
    c.add_argument("--prompt-file")
    task_opts(c)
    notes_opts(c)
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true", help="work in the folder itself")
    g.add_argument("--worktree", action="store_true", help="work in a git worktree (default in repos)")
    c.add_argument("--after", help="start only once these tasks are done: 3,5; another folder's by its id (WEB-2), another "
                                   "machine's with the machine first (vm-b:HAT-12)")
    c.add_argument("--space", help="the space it's for, whose settings it takes (default: yours)")
    c = cmd("show", cmd_show, "one task")
    c.add_argument("--evidence", action="store_true", help="with what its Accept card shows: commits, changed files, checks and its proof")
    c = cmd("start", cmd_start, "start a task's agent (no tab: an hc child of the space's coordinator)")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--parent", help="a coordinator's terminal: the agent's hc parent (default: the space's coordinator)")
    c.add_argument("--now", action="store_true", help="skip the queue")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true")
    g.add_argument("--worktree", action="store_true")
    c = cmd("ready", cmd_ready, "a worker's task is finished (worktree tasks: committed): it waits in Ready for the person's Accept (opens a pull request on GitHub)")
    c.add_argument("--summary", help=f"what the person now sees or can do, in plain words, at most {SUMMARY_MAX} characters "
                                     "(no file names, flags or jargon); longer is refused")
    c.add_argument("--details", help="optional: a few short bullets in plain words (one \"- \" per line): what changed for the "
                                     "person first, then how it was checked; file names only where they help; never one dense "
                                     "paragraph. Folded under Details in the Accept card")
    c.add_argument("--proof", help="its proof artifact's id (herdr-artifact publish prints it); default: its newest artifact titled \"... · Proof\"")
    c.add_argument("--agents-md", help="\"For AGENTS.md\": one line about setting up or testing this repo that the next agent "
                                       "would need and AGENTS.md lacks; the Assistant decides whether to add it")
    c = cmd("reviewed", cmd_reviewed, "a task's agent records one review round of its current commit (Review: on): ready then "
                                      "accepts that commit; uses one of its Review rounds")
    c.add_argument("--report", help="the round's findings in a line (levels, what was fixed)")
    cmd("review-more", cmd_review_more, "the Assistant gives a task one more review round, once all are used (never its own agent)")
    c = cmd("status", cmd_status, "a task's agent says what it's doing now, at the start and each natural step: status 4 \"Fixing the two failing tests\" --done 40 --left 5m")
    c.add_argument("text", help=f"what it is doing, at most {LINE_MAX} characters (longer is cut at a word)")
    c.add_argument("--done", type=int, help="how far through the whole task, 0-100 (%%)")
    c.add_argument("--left", help="your best guess of how long is left: 5m, 90s, 1h30m; on every status, the first too (a rough guess beats none)")
    c = cmd("alert", cmd_alert, "tell the person something that can't wait: a toast and a sound (an Assistant's follow its space's Notify): alert \"Deploy is down\" --body \"why\"", id=False)
    c.add_argument("title", help="what can't wait, a few words")
    c.add_argument("--body", help="why, a line or two")
    c.add_argument("--task", help="the task it's about (an Assistant's alert about one of its tasks always reaches the person)")
    cmd("done", lambda a: cmd_state(a, "done"), "mark done (the person's call: only when they ask; agents finish with ready)")
    c = cmd("accept", cmd_accept, "the person's Accept on a Ready task: merges first when there is something to merge, then done")
    agent_opts(c)
    c.add_argument("--space")
    cmd("reopen", lambda a: cmd_state(a, "reopen"), "undo done or ready; a queued task goes back to to do")
    cmd("unarchive", cmd_unarchive, "bring an archived task back into its list (only when the person asks; writing to it does too)")
    c = cmd("edit", cmd_edit, "change a task")
    c.add_argument("--title")
    c.add_argument("--prompt")
    c.add_argument("--prompt-file")
    task_opts(c)
    notes_opts(c)
    c.add_argument("--after", help="start only once these tasks are done: 3,5, WEB-2, vm-b:HAT-12 (\"\" clears)")
    g = c.add_mutually_exclusive_group()
    g.add_argument("--here", action="store_true")
    g.add_argument("--worktree", action="store_true")
    cmd("rm", cmd_rm, "remove a task")
    c = cmd("config", cmd_config, "this folder's settings", id=False)
    c.add_argument("--prefix", help="task ids' prefix, 2 to 5 letters (HAT -> HAT-4); unique on this machine")
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
    cmd("backup", cmd_backup, "save a backup of every connected machine's spaces and the sidebar now (the scheduler does every 10 minutes)", id=False)
    c = cmd("restore-spaces", cmd_restore_spaces, "dry run: what a backup would recreate (no backup: list them)", id=False)
    c.add_argument("backup", nargs="?", help="a backup's name or folder, or latest")
    au = sub.add_parser("auto", help="automations: a saved task that a time or an event adds again").add_subparsers(dest="auto")

    def auto_cmd(name, help, id=True, fields=False):
        c = au.add_parser(name, help=help)
        if id:
            c.add_argument("id", help="automation id (HAT-A1, A1 or 1)")
        c.add_argument("--folder")
        c.add_argument("--json", action="store_true")
        c.set_defaults(fn=cmd_auto)
        if fields:
            c.add_argument("--prompt")
            c.add_argument("--prompt-file")
            c.add_argument("--every", help=HOW)
            c.add_argument("--on", help="events, comma-separated: " + ", ".join(EVENTS))
            c.add_argument("--match", help="only tasks whose title has these words, or branch:<glob>")
            c.add_argument("--agent")
            c.add_argument("--space", help="the space its tasks start in (default: yours)")
            c.add_argument("--parent", help="its tasks' agents' parent (default: you)")
            g = c.add_mutually_exclusive_group()
            g.add_argument("--here", action="store_true")
            g.add_argument("--worktree", action="store_true")
        return c
    c = auto_cmd("add", "add an automation", id=False, fields=True)
    c.add_argument("title")
    c = auto_cmd("edit", "change an automation", fields=True)
    c.add_argument("--title")
    c = auto_cmd("list", "this folder's automations", id=False)
    c.add_argument("--all", action="store_true", help="every folder's on this machine")
    c.set_defaults(fn=auto_list)
    auto_cmd("show", "one automation")
    auto_cmd("pause", "stop it firing")
    auto_cmd("resume", "let it fire again")
    ap = sub.add_parser("autopilot", help="a space's Assistant woken on a schedule or by events, with the heartbeat "
                        "(one schedule, events and heartbeat for every space; each space switches it on)").add_subparsers(dest="autopilot")

    def ap_cmd(name, help, space=True, everywhere=False):
        c = ap.add_parser(name, help=help)
        if space:
            c.add_argument("--space", help="the space (default: the Assistant's own)")
        if everywhere:
            c.add_argument("--everywhere", action="store_true", help="the schedule and events every space works from")
        c.add_argument("--json", action="store_true")
        c.set_defaults(fn=cmd_autopilot)
        return c
    ap_cmd("show", "this space's Autopilot (or --everywhere: the one schedule and events): when it wakes, next and last wake, progress", everywhere=True)
    c = ap.add_parser("list", help="the schedule and events every space works from, and each space's Autopilot on this machine")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_autopilot)
    ap_cmd("on", "turn it on in this space (makes the heartbeat file)")
    ap_cmd("off", "turn it off in this space")
    c = ap_cmd("set", "when every space on Autopilot wakes (the same in every space: --everywhere; --space refuses)", everywhere=True)
    c.add_argument("--every", help=HOW + ' "" or off: no schedule.')
    c.add_argument("--on", help="task events that wake it, comma-separated (\"\": none): " + ", ".join(EVENTS))
    ap_cmd("run-now", "wake its Assistant now (queued until it is idle)")
    ap_cmd("heartbeat", "the heartbeat file every space works from (made with a starter when missing)", everywhere=True)
    c = sub.add_parser("progress", help="an Assistant on Autopilot saves its progress and next step: progress \"Started HAT-4; next: check its review\"")
    c.add_argument("text")
    c.add_argument("--space")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_progress)
    c = sub.add_parser("complete", help="an Assistant on Autopilot proved its heartbeat's stopping goal: turns Autopilot off")
    c.add_argument("evidence")
    c.add_argument("--space")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_complete)
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
    c = ma.add_parser("reach", help="the reach map: the machines this one reaches (herdr-core links, ssh, Tailscale), and through each, what that one reaches")
    c.add_argument("--refresh", action="store_true", help="check every link now (default: the scheduler's map, at most 10 minutes old)")
    c.add_argument("--quiet", action="store_true", help=argparse.SUPPRESS)
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
    c = sub.add_parser("tell-assistant", help="message another Assistant, here or on a machine reachable from here: tell-assistant vm-demo/t3 \"...\" (or its space)")
    c.add_argument("target", help="its address as `assistants` lists it (t3, vm-demo/t3, laptop>vm-x/t3), or its space's name or id")
    c.add_argument("text")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_tell)
    c = cmd("fix", cmd_fix, "ask the task's agent to fix what keeps its pull request from merging")
    agent_opts(c)
    c.add_argument("--space")
    c.add_argument("--reason", help="what to fix (default: what Herdr found)")
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
    c = sub.add_parser("_allow")  # Codex's PermissionRequest hook (own_argv)
    c.add_argument("--command", required=True)
    c.set_defaults(fn=cmd_allow, json=False)
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
        args.fn(args)
    except Fail as e:
        if getattr(args, "json", False):
            print(json.dumps({"error": str(e)}))
        else:
            print(f"herdr-task: {e}", file=sys.stderr)
        return 1
    return 0
