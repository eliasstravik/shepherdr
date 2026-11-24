// What the web app shows, built with the shared core: the spaces (the service's own list, the shared document's
// "spaces"), their Assistants and unread marks, and every task list (herdr-task's files, through READ_LISTS) with each
// task's status from its live agents. Kept fresh from herdr-core's events, the local task folder's changes, and a slow
// poll for other machines.
import { watch, existsSync } from "node:fs";
import { join } from "node:path";
import { CoreClient } from "./hc/client.ts";
import type { Hub } from "./hub.ts";
import { readDue, type Live } from "./live.ts";
import { where } from "./paths.ts";
import { READ_LISTS, taskLists } from "../core/tasklists.js";
import { carryOver, IMPORTED } from "./carry-over.ts";
import { HOME } from "./paths.ts";
import * as T from "../core/tasks.js";
import { FIND } from "../core/chat-log.js";
import { isHelper, subagentsOf } from "../core/chat-view.js";
// The core is plain JavaScript; its defaults read as narrow types to TypeScript.
const { place, refOf, taskKey, autoPrefix, reportOf, ownReport, secondLine, leftOf, queueReason, machineOf, inSpace } = T as any;
import * as S from "../core/spaces.js";
const { sidebarOf, lastAssistantOf, isUnread, inOrder, byMachineOrder, machineOrderOf } = S as any;

import { SHELL, runsCommand, inFront } from "../core/send.js";
export { runsCommand };

/** Runs a command on a machine through herdr-core (null: here). Output comes back base64. */
export async function exec(hub: Hub, argv: string[], on: string | null = null, timeout = 60) {
  const r = await hub.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, ...(on ? { on } : {}), timeout }, (timeout + 5) * 1000);
  const text = (b: string) => Buffer.from(b ?? "", "base64").toString("utf8");
  return { code: r.code, stdout: text(r.stdout), stderr: text(r.stderr) };
}

export const sh = (hub: Hub, script: string, args: string[], on: string | null) => exec(hub, ["sh", "-c", script, ...args], on);

type List = any;
const missingDoc = (e: unknown) => ["not_found", "document_not_found", "doc_not_found"].includes(String((e as any)?.kind ?? ""));
/** set once the main machine's own ~ space was made (3.2.8): a removed one stays removed */
const TILDE_MADE = "spaces.tilde.made";

export class Model {
  private lists = new Map<string | null, List[]>();   // machine (null: here) -> its task lists
  private machines: string[] = [];                    // connected other machines
  private known: { name: string; state: string; why?: string }[] = []; // every other machine, with its state (the sidebar's headers) and herdr-core's why when down
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Told each build: what the screen's snapshot is made from (compat.ts). */
  onBuild: ((b: { spaces: any[]; sections: any[]; rows: any[]; machines: string[]; known: { name: string; state: string; why?: string }[]; automations: any[] }) => void) | null = null;

  /** The service's shared document (the spaces, the person's pins and the sidebar's groups and order). */
  doc: () => Record<string, any> = () => ({});
  /** The shared document to write the carry-over into (service/carry-over.ts), set by main: ready() once it is read
   *  and this machine is the one that keeps it. */
  own: { ready(): boolean; update(change: (value: Record<string, any>) => Record<string, any>): Promise<unknown> } | null = null;

  constructor(private hub: Hub, private live: Live) {}

  /** A shared value: the document's. */
  value(key: string) { return this.doc()[key]; }

  start() {
    this.hub.on((e) => {
      if (e.type === "reset") void this.refresh();
      else if ("terminal" in e && e.terminal) this.soon();
    });
    const tasks = where().tasks;
    if (existsSync(tasks)) watch(tasks, () => this.soon(() => this.readLists(null)));
    // every 10 s while a page is open, else every 2 minutes (alerts); a page opening reads at once (#1325)
    setInterval(() => { if (readDue(this.live.anyone(), this.readAt)) void this.refresh(); }, 10_000);
    this.live.onFirstPage(() => void this.refresh());
    void this.refresh();
  }

  /** Builds again shortly (many events come at once); `first` reads something before. */
  private soon(first?: () => Promise<void> | void) {
    if (first) void Promise.resolve(first()).then(() => this.soon());
    this.timer ??= setTimeout(() => { this.timer = null; this.build(); }, 150);
  }

  spaces: any[] = [];
  /** every task as last built (its folder, worktree and machine among them) */
  rows: any[] = [];
  /** each task's whole prompt, by its key (rows keep only its start): its page's first message (SHEP-330) */
  prompts = new Map<string, string>();
  /** Each space folder's git: { name (the repo), linked (a worktree), repo }, null:
   *  not a repo. Read once, then again each minute. */
  private git = new Map<string, { info: { name: string; linked: boolean; repo: string; branch?: string | null } | null; at: number }>();
  private async readGit(spaces: any[]) {
    const due = spaces.filter((s) => s.folder && Date.now() - (this.git.get(`${s.machine ?? ""}|${s.folder}`)?.at ?? 0) > 60_000);
    await Promise.all(due.slice(0, 12).map(async (s) => {
      const key = `${s.machine ?? ""}|${s.folder}`;
      this.git.set(key, { info: this.git.get(key)?.info ?? null, at: Date.now() });
      // its repo and its branch (reads only: nothing under .git is written)
      const r = await exec(this.hub, ["sh", "-c", 'cd "$1" 2>/dev/null && git rev-parse --show-toplevel --path-format=absolute --git-common-dir 2>/dev/null && { git symbolic-ref --short -q HEAD 2>/dev/null || echo; }', "git", s.folder], s.machine ?? null, 20).catch(() => null);
      const [top, repo, head] = (r?.stdout ?? "").split("\n").map((l) => l.trim());
      const name = repo ? (repo.endsWith("/.git") ? repo.slice(0, -5) : repo.replace(/\.git$/, "")).split("/").pop()! : "";
      this.git.set(key, { info: top && repo ? { name, linked: repo !== `${top}/.git`, repo, branch: head || null } : null, at: Date.now() });
    }));
    if (due.length) this.soon();
  }
  gitOf(s: any) { return this.git.get(`${s.machine ?? ""}|${s.folder}`)?.info ?? null; }
  /** A space as last built (its id, name, machine, folder), or undefined. */
  spaceById(id: string) { return this.spaces.find((s) => s.id === id); }

  /** Whether the person has other machines (connected or not): the main machine then has its own ~ space too. */
  hasOthers() { return this.known.length > 0; }

  /** The connected other machines. */
  machineNames() { return this.machines; }

  /** Builds again soon (something the snapshot shows changed outside: an ask). */
  rebuild() { this.soon(); }

  /** A space just made (New space): the snapshot built with it now, not at the next event. Whether it showed. */
  async waitSpace(id: string) {
    this.build();
    return this.spaces.some((s) => s.id === id);
  }

  /** A task's list read again now, after the person acted on it (SHEP-450): another machine's lists are otherwise read
   *  only every 10 s, so its card kept its buttons for up to that long after the server said yes. This machine's are
   *  watched (fs.watch) and need no help. */
  async reread(machine: string | null) {
    if (!machine) return;
    await this.readLists(machine);
    this.build();
  }

  private readAt = 0;
  async refresh() {
    this.readAt = Date.now();
    try {
      const r = await this.hub.call<{ machines: any[] }>("machine.list", {});
      this.machines = r.machines.filter((m) => m.state === "connected").map((m) => m.name);
      // every machine the window's sidebar lists, connected or not (a temporary one aside): an offline one reads "Offline"
      this.known = r.machines.filter((m) => !m.temporary).map((m) => ({ name: m.name, state: String(m.state ?? ""), ...(typeof m.why === "string" && m.why ? { why: m.why } : {}) }));
    } catch {}
    await Promise.all([this.carry(), this.readLists(null), ...this.machines.map((m) => this.readLists(m))]);
    this.build();
  }

  // Read the old session directly if its copy has not arrived. A failed read must remain retryable.
  legacySpaces: ((machine: string | null) => Promise<any>) | null = null;
  private async oldSpaces(machine: string | null): Promise<any> {
    if (this.legacySpaces) return this.legacySpaces(machine);
    const session = process.env.SHEPHERDR_FROM_SESSION || "default";
    const state = process.env.XDG_STATE_HOME || join(HOME, ".local", "state");
    if (!existsSync(join(state, "herdr-core", session, "core.json"))) return null;
    const client = await CoreClient.endpoint({ binary: process.env.SHEPHERDR_HC || "hc", ...(session !== "default" ? { session } : {}) });
    try {
      try { return (await client.call<{ value: any }>("doc.get", { name: "herdr-app", ...(machine ? { on: machine } : {}) }, 8000)).value ?? null; }
      catch (e) { if (missingDoc(e)) return null; throw e; }
    } finally { client.close(); }
  }

  legacyHistory: ((machine: string | null) => Promise<Record<string, { path: string; kind: string }>>) | null = null;
  private async oldHistory(machine: string | null) {
    if (this.legacyHistory) return this.legacyHistory(machine);
    const session = process.env.SHEPHERDR_FROM_SESSION || "default";
    const state = process.env.XDG_STATE_HOME || join(HOME, ".local", "state");
    if (!existsSync(join(state, "herdr-core", session, "core.json"))) return {};
    const client = await CoreClient.endpoint({ binary: process.env.SHEPHERDR_HC || "hc", ...(session !== "default" ? { session } : {}) });
    try {
      if (machine) {
        const { machines } = await client.call<{ machines: any[] }>("machine.list", {}, 8000);
        const prior = machines.find((m) => m.name === machine);
        if (prior && prior.state !== "connected") throw new Error("The old session's machine is offline");
      }
      const { terminals } = await client.call<{ terminals: any[] }>("terminal.list", {}, 8000);
      const found: Record<string, { path: string; kind: string }> = {};
      for (const t of terminals) {
        const labels = t.labels ?? {}, address = String(t.address ?? "");
        const on = address.includes("/") ? address.split("/")[0] : null;
        if (on !== machine || labels["herdr.role"] !== "coordinator" || !labels["herdr.coordinator.space"]) continue;
        let resume: any = {};
        try { resume = JSON.parse(labels["herdr.resume"] || "{}"); } catch {}
        let path = resume.log, kind = resume.kind;
        if (!path && t.state === "live") {
          const detail: any = await client.call("terminal.get", { terminal: address }, 8000);
          const fg = detail.foreground ?? detail.terminal?.foreground;
          const name = String(fg?.name ?? "").replace("-code", "");
          if ((name === "claude" || name === "codex") && fg?.pid) {
            kind = name;
            path = (await sh(this.hub, FIND, ["chat", kind, String(fg.pid)], machine)).stdout.trim().split("\n").pop();
          }
        }
        if (typeof path === "string" && path.startsWith("/") && (kind === "claude" || kind === "codex")) {
          const space = String(labels["herdr.coordinator.space"]);
          found[machine ? `${machine}/${space}` : space] = { path, kind };
        }
      }
      return found;
    } finally { client.close(); }
  }

  private carrying = false;
  /** The Herdr window's spaces, carried over once per machine (service/carry-over.ts): each machine not in the marker
   *  yet has its "herdr-app" document read (this computer's, and every connected machine's: one that is offline now is
   *  done when it first connects), its spaces go into the own list, and it is never read again. */
  private async carry() {
    if (this.carrying || !this.own?.ready()) return;
    const done: unknown = this.doc()[IMPORTED];
    const machines = [null, ...this.machines];
    const todo = machines.filter((m) => !(Array.isArray(done) && done.includes(m ?? "")));
    const historyDone = this.doc()["chat.history.imported"];
    const historyTodo = machines.filter((m) => !(Array.isArray(historyDone) && historyDone.includes(m ?? "")));
    // Everything: the root space, one agent in the home folder on the serving machine. Once this computer's spaces
    // are carried over and none of them is the home folder, it is made (its agent starts with its first message).
    const own: any[] = Array.isArray(this.doc().spaces) ? this.doc().spaces : [];
    if (Array.isArray(done) && done.includes("") && !S.everythingOf(own, HOME)) {
      this.carrying = true;
      try {
        await this.own.update((v) => {
          const list: any[] = Array.isArray(v.spaces) ? (v.spaces as any[]) : [];
          return S.everythingOf(list, HOME) ? v : { ...v, spaces: [{ id: "home", name: "Home", folder: HOME, machine: null, at: Date.now() }, ...list] };
        });
      } catch {} finally { this.carrying = false; }
    }
    // The main machine's own home space (~, 3.2.8): beside Everything in its folder, made once there are other machines
    // (one machine keeps Everything alone), with no agent until its first message. Made once: Remove keeps it gone.
    if (S.everythingOf(own, HOME) && this.known.length && !this.doc()[TILDE_MADE]) {
      this.carrying = true;
      try {
        await this.own.update((v) => {
          const list: any[] = Array.isArray(v.spaces) ? (v.spaces as any[]) : [];
          if (v[TILDE_MADE] || !S.everythingOf(list, HOME)) return v;
          // right after Everything: the first row under this computer
          const at = list.indexOf(S.everythingOf(list, HOME)) + 1;
          const spaces = S.tildeOf(list, HOME) ? list : [...list.slice(0, at), { id: S.TILDE, name: "", folder: HOME, machine: null, at: Date.now() }, ...list.slice(at)];
          return { ...v, spaces, [TILDE_MADE]: true };
        });
      } catch {} finally { this.carrying = false; }
    }
    if (!todo.length && !historyTodo.length) return;
    this.carrying = true;
    try {
      const docs = new Map<string | null, any>();
      const histories = new Map<string | null, Record<string, { path: string; kind: string }>>();
      await Promise.all([
        ...todo.map(async (m) => {
          try {
            let current: any = null;
            try { current = (await this.hub.call<{ value: any }>("doc.get", { name: "herdr-app", ...(m ? { on: m } : {}) }, 8000)).value ?? null; }
            catch (e) { if (!missingDoc(e)) throw e; }
            let old = current;
            if (current == null || Object.keys(current).length === 0) {
              try { old = await this.oldSpaces(m); }
              catch (e) { if ((e as any)?.kind === "machine_unknown") old = null; else throw e; }
            }
            docs.set(m, old ?? {});
          } catch { /* unavailable or uncertain: retry without marking spaces imported */ }
        }),
        ...historyTodo.map(async (m) => {
          try { histories.set(m, await this.oldHistory(m)); }
          catch { /* a missing history never holds back the spaces; retry it separately */ }
        }),
      ]);
      if (docs.size || histories.size) await this.own.update((v) => {
        const r = carryOver(v.spaces, v[IMPORTED], docs);
        const history = { ...(v["chat.history"] ?? {}) };
        const marked = new Set<string>(Array.isArray(v["chat.history.imported"]) ? v["chat.history.imported"] : []);
        for (const [m, old] of histories) {
          if (marked.has(m ?? "")) continue;
          for (const [key, value] of Object.entries(old)) if (!history[key]) history[key] = value;
          marked.add(m ?? "");
        }
        return { ...v, ...(r ? { spaces: r.spaces, [IMPORTED]: r.imported } : {}), "chat.history": history, "chat.history.imported": [...marked] };
      });
    } catch {} finally { this.carrying = false; }
  }

  private async readLists(m: string | null) {
    try {
      const r = await sh(this.hub, READ_LISTS, [], m);
      if (r.code !== 0) return;
      this.lists.set(m, taskLists(r.stdout).map((d: any) => ({ ...d, machine: m, prefix: d.prefix || autoPrefix(d.folder), tasks: Array.isArray(d.tasks) ? d.tasks : [] })));
    } catch {}
  }

  /** A task's agents now: live terminals labelled with its key, on the folder's machine, not shells. */
  private agentsOf(list: List, task: any) {
    const key = `${list.slug}#${task.id}`;
    const out: { address: string; status: string | null; role: string; turn: number; since: number }[] = [];
    for (const k of this.hub.terminals.values()) {
      if (k.state !== "live" || k.labels?.["herdr.task"] !== key || machineOf(k.address) !== (list.machine ?? null)) continue;
      const st = typeof k.status === "object" ? k.status?.state ?? null : null;
      // a plain shell in front: its agent is gone, whatever status hc kept (#1022: one that died mid-turn keeps
      // "working" for good); a shell that runs a command (fish -ic "claude ...", #780) still holds its agent
      const fg = (k as any).foreground;
      if (SHELL.test(String(fg?.name ?? "").split("/").pop() ?? "") && (!st || !runsCommand(fg?.argv))) continue;
      // its worker's own helper (SHEP-54: its reviewer, an hc child): never one of its agents (helpersOf)
      if (isHelper(k)) continue;
      // turn: its finished turns, for a Ready task back at work (core busyAgain()); since: when its status last
      // changed (hc's status_ms), for the grace before a quiet agent needs the person (core GRACE_MS, SHEP-133)
      out.push({ address: k.address, status: st, role: k.labels?.["herdr.role"] ?? "worker", turn: Number((k as any).turn) || 0, since: Number((k as any).status_ms) || 0 });
    }
    return out;
  }

  /** Its worker's own helper agents now (SHEP-54): core place() counts one at work as the task at work. */
  private helpersOf(list: List, task: any, live: { address: string }[]) {
    const key = `${list.slug}#${task.id}`, mine = new Set(live.map((a) => a.address.split("/").pop()));
    // on the folder's machine, a child of one of its agents
    return [...this.hub.terminals.values()].filter((k: any) => k.state === "live" && k.labels?.["herdr.task"] === key && isHelper(k)
      && machineOf(k.address) === (list.machine ?? null) && mine.has(String(k.parent).split("/").pop()))
      .map((k: any) => ({ address: k.address, status: typeof k.status === "object" ? k.status?.state ?? null : null }));
  }

  private build() {
    const terminals = [...this.hub.terminals.values()];
    const pinList = this.value("tasks.pinned");
    const pins = new Set<string>(Array.isArray(pinList) ? pinList : []);
    const lists = [null, ...this.machines].flatMap((m) => this.lists.get(m) ?? []);

    let settles = Infinity;
    const prompts = new Map<string, string>();
    const rows = lists.flatMap((list) => list.tasks.map((task: any) => {
      if (task.prompt) prompts.set(taskKey(list, task), String(task.prompt));
      const live = this.agentsOf(list, task);
      const p = place(list, task, { live, helpers: this.helpersOf(list, task, live) });
      if (p.settles) settles = Math.min(settles, p.settles);
      // the % its agent's terminal reports itself (OSC 7501's progress, core ownReport), beside herdr-task status --done
      const own = live.map((a) => ownReport(this.hub.terminals.get(a.address))).find(Boolean) ?? null;
      const w = reportOf(task, p.section, own);
      const mine = live.filter((a) => a.role !== "reviewer" && a.role !== "helper");
      const worker = mine.find((a) => a.status === "blocked")?.address ?? mine[0]?.address ?? null;
      const last = task.agents?.[task.agents.length - 1];
      return {
        key: taskKey(list, task), ref: refOf(list, task), title: task.title, section: p.section, needs: p.needs,
        sub: secondLine(p, w, p.section === "queued" ? queueReason(list, task) : null), left: leftOf(p, w), pct: w?.done ?? null,
        // what its agent last said (core reportOf): working, and frozen while it
        // needs the person
        said: w?.text ? { text: w.text, done: w.done ?? null, left: w.left ?? null, paused: !!w.paused } : null,
        machine: list.machine, folder: list.folder, slug: list.slug, id: task.id, list: list.name, kind: list.kind ?? null,
        // the space whose Assistant started it (herdr-task keeps it): it is counted and listed there
        space: task.space ? (list.machine ? `${list.machine}/${task.space}` : task.space) : null,
        worker, archived: !!task.archived, pinned: pins.has(taskKey(list, task)),
        // 3.2: the facts the app works a status out from (service/next.ts enrich), as herdr-task keeps them
        x: { mode: task.mode ?? null, merged: !!task.merged, quiet: task.quiet ?? null, told: task.told ?? null, automation: task.automation ?? null, stopped_by: task.stopped_by ?? null, stopped_why: task.stopped_why ?? null,
          merge_failed: task.merge_failed ?? null, attention_at: task.attention_at ?? null, after: task.after ?? null, closed_unmerged: !!task.closed_unmerged },
        scheduled_for: task.state === "scheduled" ? task.scheduled_for ?? null : null,
        started: task.started ?? null, ready_at: task.ready_at ?? null, done_at: task.done_at ?? null,
        summary: task.summary ?? null, details: task.details ?? null, pr: task.pr ?? task.pr_seen ?? null, prompt: String(task.prompt ?? "").slice(0, 500), why: p.why ?? null,
        worktree: task.worktree ?? list.folder, base: task.base ?? null, start: task.start ?? null, branch: task.branch ?? null,
        lastLog: !worker && last?.log ? { path: last.log, kind: last.agent ?? "claude" } : null,
        // its worker's own helper agents (SHEP-54), for the task's detail
        subagents: worker ? subagentsOf(terminals as any[], worker) : [],
        // what finds its artifacts (core/task-artifacts.js): its proof, its agents' terminals while they ran, their logs
        proof: task.proof?.id ?? null,
        // its last recorded review round (herdr-task reviews: report and pass passed, changes asked for changes), for the
        // glance feed's Ready items (SHEP-447)
        review: ((r) => (r === "changes" ? "changes" : r === "pass" || r === "report" ? "passed" : null))((Array.isArray(task.reviews) ? task.reviews : []).filter((x: any) => ["report", "pass", "changes"].includes(x?.result)).pop()?.result),
        agents: (Array.isArray(task.agents) ? task.agents : []).map((a: any) => ({ address: a.address ?? null, at: a.at ?? 0, ended: a.ended ?? null })),
        logs: (Array.isArray(task.agents) ? task.agents : []).map((a: any) => a.log).filter((x: unknown) => typeof x === "string"),
      };
    }));
    this.rows = rows;
    this.prompts = prompts;
    this.live.put("tasks", rows);
    // a task in its grace before Needs you (core GRACE_MS): built again the moment it ends, not up to 10 s later
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = settles < Infinity ? setTimeout(() => { this.settleTimer = null; this.soon(); }, Math.max(0, settles - Date.now()) + 50) : null;

    const bar = sidebarOf(this.value("spaces-chat"));
    // the spaces: the service's own list (shared "spaces"), each machine's in the order the person dragged them into
    // (core/spaces.js inOrder), and the machines in the order the person dragged them into (SHEP-153)
    const own = (Array.isArray(this.doc().spaces) ? this.doc().spaces : []).map((x: any) => ({ id: x.machine ? `${x.machine}/${x.id}` : x.id, machine: x.machine ?? null, name: x.name ?? "", folder: x.folder ?? "" }));
    const spaces = byMachineOrder(inOrder(own, this.value("spaces-chat")?.order), machineOrderOf(this.value("spaces-chat"))).map((s: any, at: number) => {
      // the one its chat reads: live, else the latest that ended (a message to it starts it again: actions.ts)
      const k = lastAssistantOf(s, terminals as any[]);
      // a space's tasks (SHEP-325, the window's rule: core inSpace): the ones it started and the ones working in its folder
      const here = rows.filter((r) => !r.archived && inSpace(s, r));
      return {
        ...s, at, icon: bar.icons[s.id] ?? null,
        // when its Assistant last changed state (its terminal's status time)
        changedAt: Number((k as any)?.status_ms) || 0,
        section: bar.sections.find((x: any) => (x.spaces ?? []).includes(s.id))?.id ?? null,
        assistant: k?.address ?? null, turn: (k as any)?.turn ?? 0, assistantStatus: k && (k.state !== "live" || (k as any)?.status?.state === "error" || inFront(k) === "shell") ? "stopped" : (k as any)?.status?.state ?? null,
        git: this.gitOf(s),
        unread: isUnread(k),
        red: here.filter((r) => r.section === "needs").length + ((k as any)?.status?.state === "blocked" ? 1 : 0),
        green: here.filter((r) => r.section === "ready").length,
      };
    });
    this.spaces = spaces;
    void this.readGit(spaces);
    this.live.put("spaces", { spaces, sections: bar.sections });
    // each list's schedules (herdr-task auto), with the folder and machine they belong to
    const automations = lists.flatMap((l: any) => (Array.isArray(l.automations) ? l.automations : []).map((a: any) => ({ ...a, folder: l.folder, machine: l.machine ?? null, list: l.name })));
    this.onBuild?.({ spaces, sections: bar.sections, rows, machines: this.machines, known: this.known, automations });
  }
}
