// Shared core: the source is core/bg-jobs.js; the chat mod and the service use it (bin/sync-shared copies it into
// mods/chat/core/). Edit it here, never a copy.
// What an agent left running in the background, shown over the chat box: its shells and watchers, live, gone once
// they end, each one stoppable (as Claude Code's "1 shell · ↓ to manage").
//   Claude Code: its log says what it started (a shell run in the background or moved there mid-run, a Monitor) and
//   when each ended (core/chat-log.js: Conversation.bg). A job stopped in its terminal or a watcher that timed out
//   leaves no word in the log, so the agent's own processes have the last say: a job runs while one of them holds its
//   output file open (<tmp>/claude-<uid>/<project>/<session>/tasks/<task>.output).
//   Codex: its log never says a command outlived its turn, so its processes say it all: a shell it started that still
//   runs (/ps in its terminal lists the same), shown once two looks in a row have seen it.
// JOBS runs on the agent's machine; `run(script, args)` -> Promise<{ stdout }> runs it there (sh -c script x args).

import { cmdWords } from "./chat-log.js";

//   jobs alive <kind> <pid>          "ok", then the agent's process tree as "<pid> <ppid> <args>" (codex) or
//                                    the output files its processes hold open, one "F <path>" each (claude)
//   jobs stop claude <pid> <task>    ends the processes that hold that task's output file, and theirs
//   jobs stop codex <pid> <child>    ends that shell of the agent's, and its own processes
//   jobs tail <path>                 the last lines a task's output file holds
export const JOBS = String.raw`
mode="$1"; kind="$2"; pid="$3"
# The processes under $1 (and $1 itself): "<pid> <ppid> <args>".
tree() {
  ps -A -o pid= -o ppid= -o args= 2>/dev/null | awk -v root="$1" '
    { p[$1] = $2; line[$1] = $0 }
    END { for (k in p) { x = k; n = 0; while (x != root && (x in p) && n < 64) { x = p[x]; n++ } if (x == root) print line[k] } }'
}
# The files those processes hold open: "<pid> <path>".
held() {
  pids=$(tree "$1" | awk '{ print $1 }')
  [ -n "$pids" ] || return 0
  if [ -d /proc/self/fd ]; then
    for p in $pids; do for d in /proc/$p/fd/*; do f=$(readlink "$d" 2>/dev/null) && echo "$p $f"; done; done
  else
    lsof -n -p "$(echo $pids | tr ' ' ',')" -Fpn 2>/dev/null | awk '/^p/ { p = substr($0, 2) } /^n/ { print p " " substr($0, 2) }'
  fi
}
case "$mode" in
alive)
  echo ok
  if [ "$kind" = codex ]; then tree "$pid"
  else held "$pid" | awk '$2 ~ /\/tasks\/[A-Za-z0-9_-]+\.output$/ { print "F " $2 }' | sort -u; fi
  ;;
stop)
  what="$4"
  case "$what" in ""|*[!A-Za-z0-9_-]*) exit 0 ;; esac
  if [ "$kind" = codex ]; then
    tree "$pid" | awk -v c="$what" '$1 == c { found = 1 } END { exit !found }' || exit 0
    kill -TERM $(tree "$what" | awk '{ print $1 }') 2>/dev/null
  else
    for h in $(held "$pid" | awk -v t="/tasks/$what.output" 'substr($2, length($2) - length(t) + 1) == t { print $1 }' | sort -u); do
      kill -TERM $(tree "$h" | awk '{ print $1 }') 2>/dev/null
    done
  fi
  ;;
tail)
  case "$2" in */tasks/*.output) tail -n 40 "$2" 2>/dev/null ;; esac
  ;;
esac
true`;

// How often to look again (ms): Claude Code's only while its log lists a job; Codex's always, more gently.
const EVERY = { claude: 3000, codex: 5000 };
// A Codex shell that is only its agent's own work right now: sh -c "<command>" of a tool call, not a hook.
const SHELL = /(?:^|\s|\/)(?:ba|z|da)?sh\s+-l?c\s+(.*)$/;
const HOOK = /herdr-agent-state|session-note|ask-hook/;

export class BgJobs {
  constructor() {
    // The last look: { at, files: Set of output paths } (claude) | { at, procs: [{ pid, cmd }] } (codex); null when
    // none worked (another machine out of reach): then the log alone says.
    this.seen = null;
    this.at = 0;
    this.busy = false;
    this.first = new Map(); // codex: pid -> when a look first saw it
  }

  // Is a look due now? (kind: "claude" | "codex"; conv: its Conversation)
  due(kind, conv, now = Date.now()) {
    if (this.busy || !EVERY[kind]) return false;
    if (kind === "claude" && !conv?.bg?.length) { this.seen = null; return false; }
    return now - this.at >= EVERY[kind];
  }

  // Looks at the agent's processes (pid: its CLI's). -> true when what shows changed.
  async look(run, kind, pid, conv) {
    const before = this.sig(kind, conv);
    this.busy = true;
    this.at = Date.now();
    let out = null;
    try { out = (await run(JOBS, ["jobs", "alive", kind, String(pid)]))?.stdout ?? null; } catch {}
    finally { this.busy = false; }
    this.read(kind, pid, out, Date.now());
    return this.sig(kind, conv) !== before;
  }

  // What a look printed (null: it didn't work).
  read(kind, pid, out, now) {
    const lines = String(out ?? "").split("\n");
    if (lines[0]?.trim() !== "ok") { this.seen = null; return; }
    if (kind === "codex") {
      const rows = lines.slice(1).map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: m[1], ppid: m[2], args: m[3] }));
      const shells = new Map(rows.filter((r) => r.pid !== String(pid) && SHELL.test(r.args) && !HOOK.test(r.args)).map((r) => [r.pid, r]));
      // The topmost shell of each command (a shell its shell started is part of it).
      const procs = [...shells.values()].filter((r) => !shells.has(r.ppid)).map((r) => ({ pid: r.pid, cmd: SHELL.exec(r.args)[1].replace(/^(['"])(.*)\1$/, "$2") }));
      for (const p of procs) if (!this.first.has(p.pid)) this.first.set(p.pid, now);
      for (const k of this.first.keys()) if (!procs.some((p) => p.pid === k)) this.first.delete(k);
      this.seen = { at: now, procs };
    } else {
      this.seen = { at: now, files: new Set(lines.slice(1).filter((l) => l.startsWith("F ")).map((l) => l.slice(2))) };
    }
  }

  // The jobs that run now, oldest first: { id, kind: "shell" | "monitor", label, cmd, at, task?, path?, pid? }.
  list(kind, conv) {
    const s = this.seen;
    if (kind === "codex") {
      if (!s?.procs) return [];
      return s.procs.filter((p) => this.first.get(p.pid) < s.at)
        .map((p) => ({ id: `p${p.pid}`, kind: "shell", label: cmdWords(p.cmd) || p.cmd, cmd: p.cmd, at: this.first.get(p.pid), pid: p.pid }));
    }
    const path = (task) => (s?.files ? [...s.files].find((f) => f.endsWith(`/tasks/${task}.output`)) : undefined);
    return (conv?.bg ?? []).filter((j) => {
      // No look (yet, or it failed), or started after the last look: the log says.
      if (!s?.files || (j.at ?? 0) > s.at - 2000) return true;
      // No task id yet: no output file vouches for it, so only for a minute (its call still waiting for an answer).
      if (!j.task) return (j.at ?? 0) > s.at - 60000;
      return Boolean(path(j.task));
    }).map((j) => ({ ...j, ...(j.task && path(j.task) ? { path: path(j.task) } : {}) }));
  }

  // What shows, to tell a change.
  sig(kind, conv) { return this.list(kind, conv).map((j) => j.id).join(" "); }

  // Stops a job (one of list()'s). Its CLI then tells the agent it ended, as when it stops one itself.
  async stop(run, kind, pid, job) {
    const what = kind === "codex" ? job?.pid : job?.task;
    if (!what) return false;
    await run(JOBS, ["jobs", "stop", kind, String(pid), String(what)]);
    // Look again soon.
    this.at = 0;
    if (kind === "codex") this.seen = this.seen && { ...this.seen, procs: this.seen.procs.filter((p) => p.pid !== job.pid) };
    else if (this.seen?.files && job.path) { this.seen.files.delete(job.path); this.seen.at = Date.now(); }
    return true;
  }

  // The last lines a job printed (Claude Code keeps them in its output file), or null.
  async output(run, job) {
    if (!job?.path) return null;
    const r = await run(JOBS, ["jobs", "tail", job.path]).catch(() => null);
    if (!r) return null;
    return String(r.stdout ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").replace(/\n+$/, "");
  }
}
