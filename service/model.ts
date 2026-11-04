// What the web app shows, built with the shared core from the same data the window reads: every machine's
// spaces (Herdr's "herdr-app" documents), their Assistants and unread marks, and every task list (herdr-task's
// files, through READ_LISTS) with each task's status from its live agents. Kept fresh from herdr-core's events,
// the local task folder's changes, and a slow poll for other machines.
import { watch, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import type { Live } from "./live.ts";
import { HOME } from "./paths.ts";
import { READ_LISTS, taskLists } from "../core/tasklists.js";
import * as T from "../core/tasks.js";
// The core is plain JavaScript; its defaults read as narrow types to TypeScript.
const { place, refOf, taskKey, autoPrefix, reportOf, secondLine, leftOf, queueReason, machineOf } = T as any;
import * as S from "../core/spaces.js";
const { spacesFromDoc, sidebarOf, assistantOf, isUnread } = S as any;
import * as N from "../core/notify.js";
const { spaceLevel } = N as any;

const SHARED = join(HOME, ".config", "herdr-app", "shared.json");
const SHELL = /^(ba|z|fi|da|k|tc|c)?sh$|^nu$|^pwsh$/;

/** Runs a command on a machine through herdr-core (null: here). Output comes back base64. */
export async function exec(hub: Hub, argv: string[], on: string | null = null, timeout = 60) {
  const r = await hub.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, ...(on ? { on } : {}), timeout }, (timeout + 5) * 1000);
  const text = (b: string) => Buffer.from(b ?? "", "base64").toString("utf8");
  return { code: r.code, stdout: text(r.stdout), stderr: text(r.stderr) };
}

export const sh = (hub: Hub, script: string, args: string[], on: string | null) => exec(hub, ["sh", "-c", script, ...args], on);

type List = any;

export class Model {
  private lists = new Map<string | null, List[]>();   // machine (null: here) -> its task lists
  private docs = new Map<string | null, any>();       // machine -> its herdr-app document
  private machines: string[] = [];                    // connected other machines
  private shared: any = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Told each build: what the screen's snapshot is made from (compat.ts). */
  onBuild: ((b: { spaces: any[]; sections: any[]; rows: any[]; machines: string[]; automations: any[] }) => void) | null = null;

  /** The service's shared document (the person's pins, sidebar and Notify, in step with the window: lib/bridge.js). */
  doc: () => Record<string, any> = () => ({});

  constructor(private hub: Hub, private live: Live) {}

  /** A shared value: the document's, else the window's own (a window not on 3.1 yet). */
  value(key: string) { const d = this.doc(); return key in d ? d[key] : this.shared[key]; }

  start() {
    this.hub.on((e) => {
      if (e.type === "reset") void this.refresh();
      else if (e.type === "doc" && (e as any).data?.name === "herdr-app") void this.readDocs();
      else if ("terminal" in e && e.terminal) this.soon();
    });
    const tasks = join(HOME, ".herdr", "tasks");
    if (existsSync(tasks)) watch(tasks, () => this.soon(() => Promise.all([this.readAutopilot(), this.readLists(null)]).then(() => {})));
    if (existsSync(SHARED)) watch(SHARED, () => this.soon(() => this.readShared()));
    setInterval(() => void this.refresh(), 10_000);
    void this.refresh();
  }

  /** Builds again shortly (many events come at once); `first` reads something before. */
  private soon(first?: () => Promise<void> | void) {
    if (first) void Promise.resolve(first()).then(() => this.soon());
    this.timer ??= setTimeout(() => { this.timer = null; this.build(); }, 150);
  }

  private spaces: any[] = [];
  /** Each space folder's git, as the window's sidebar reads it: { name (the repo), linked (a worktree), repo }, null:
   *  not a repo. Read once, then again each minute. */
  private git = new Map<string, { info: { name: string; linked: boolean; repo: string; branch?: string | null; ahead?: number; behind?: number } | null; at: number }>();
  private async readGit(spaces: any[]) {
    const due = spaces.filter((s) => s.folder && Date.now() - (this.git.get(`${s.machine ?? ""}|${s.folder}`)?.at ?? 0) > 60_000);
    await Promise.all(due.slice(0, 12).map(async (s) => {
      const key = `${s.machine ?? ""}|${s.folder}`;
      this.git.set(key, { info: this.git.get(key)?.info ?? null, at: Date.now() });
      // as the window's sidebar reads it: its repo, and its branch and ahead/behind (no optional locks: reads only)
      const r = await exec(this.hub, ["sh", "-c", 'cd "$1" 2>/dev/null && git rev-parse --show-toplevel --path-format=absolute --git-common-dir 2>/dev/null && git --no-optional-locks -c core.fsmonitor=false status --porcelain=v2 --branch -uno 2>/dev/null | grep "^# branch\\."', "git", s.folder], s.machine ?? null, 20).catch(() => null);
      const [top, repo, ...rest] = (r?.stdout ?? "").trim().split("\n");
      const name = repo ? (repo.endsWith("/.git") ? repo.slice(0, -5) : repo.replace(/\.git$/, "")).split("/").pop()! : "";
      let branch: string | null = null, ahead = 0, behind = 0;
      for (const l of rest) {
        if (l.startsWith("# branch.head ")) branch = l.slice(14) === "(detached)" ? null : l.slice(14);
        else if (l.startsWith("# branch.ab ")) { const [a, b] = l.slice(12).split(" "); ahead = Math.abs(parseInt(a, 10)) || 0; behind = Math.abs(parseInt(b, 10)) || 0; }
      }
      this.git.set(key, { info: top && repo ? { name, linked: repo !== `${top}/.git`, repo, branch, ahead, behind } : null, at: Date.now() });
    }));
    if (due.length) this.soon();
  }
  gitOf(s: any) { return this.git.get(`${s.machine ?? ""}|${s.folder}`)?.info ?? null; }
  /** A space as last built (its id, name, machine, folder), or undefined. */
  spaceById(id: string) { return this.spaces.find((s) => s.id === id); }

  /** The connected other machines. */
  machineNames() { return this.machines; }

  /** Builds again soon (something the snapshot shows changed outside: an ask). */
  rebuild() { this.soon(); }

  private async refresh() {
    try {
      const r = await this.hub.call<{ machines: any[] }>("machine.list", {});
      this.machines = r.machines.filter((m) => m.state === "connected").map((m) => m.name);
    } catch {}
    this.readShared();
    await Promise.all([this.readAutopilot(), this.readDocs(), this.readLists(null), ...this.machines.map((m) => this.readLists(m))]);
    this.build();
  }

  private autopilot: Record<string, any> = {};
  private reading: Promise<void> | null = null;
  /** Each space's Autopilot on this machine, as herdr-task tells it (when it wakes, next and last wake, progress), with
   *  its heartbeat file's words. One read at a time. */
  readAutopilot() {
    return this.reading ??= (async () => {
      try {
        const p = Bun.spawn(["herdr-task", "autopilot", "list", "--json"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
        const list = JSON.parse(await new Response(p.stdout).text() || "[]") as any[];
        this.autopilot = Object.fromEntries(list.map((a) => {
          let heartbeat = "";
          try { heartbeat = a.heartbeat && existsSync(a.heartbeat) ? readFileSync(a.heartbeat, "utf8") : ""; } catch {}
          return [a.space, { ...a, words: heartbeat }];
        }));
      } catch {}
    })().finally(() => { this.reading = null; });
  }

  private readShared() {
    try { this.shared = JSON.parse(readFileSync(SHARED, "utf8")); } catch {}
  }

  private async readDocs() {
    await Promise.all([null, ...this.machines].map(async (m) => {
      try {
        const d = await this.hub.call<{ value: any }>("doc.get", { name: "herdr-app", ...(m ? { on: m } : {}) });
        this.docs.set(m, d.value);
      } catch {}
    }));
    this.soon();
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
    const out: { address: string; status: string | null; role: string }[] = [];
    for (const k of this.hub.terminals.values()) {
      if (k.state !== "live" || k.labels?.["herdr.task"] !== key || machineOf(k.address) !== (list.machine ?? null)) continue;
      const st = typeof k.status === "object" ? k.status?.state ?? null : null;
      if (!st && SHELL.test(String((k as any).foreground?.name ?? ""))) continue;
      out.push({ address: k.address, status: st, role: k.labels?.["herdr.role"] ?? "worker" });
    }
    return out;
  }

  private build() {
    const terminals = [...this.hub.terminals.values()];
    const pinList = this.value("tasks.pinned");
    const pins = new Set<string>(Array.isArray(pinList) ? pinList : []);
    const lists = [null, ...this.machines].flatMap((m) => this.lists.get(m) ?? []);

    const rows = lists.flatMap((list) => list.tasks.map((task: any) => {
      const live = this.agentsOf(list, task);
      const p = place(list, task, { live });
      const own = live.map((a) => (this.hub.terminals.get(a.address) as any)?.report).find((r) => typeof r?.progress === "number" && r.progress >= 0);
      const w = reportOf(task, p.section, own ? { pct: own.progress, msg: own.msg || null } : null);
      const running = p.section === "queued" ? list.tasks.filter((x: any) => x.state === "running" && this.agentsOf(list, x).length).length : 0;
      const worker = live.find((a) => a.role !== "reviewer" && a.status === "blocked")?.address ?? live.find((a) => a.role !== "reviewer")?.address ?? live[0]?.address ?? null;
      const last = task.agents?.[task.agents.length - 1];
      return {
        key: taskKey(list, task), ref: refOf(list, task), title: task.title, section: p.section, needs: p.needs,
        sub: secondLine(p, w, p.section === "queued" ? queueReason(list, task, running) : null), left: leftOf(p, w), pct: w?.done ?? null,
        machine: list.machine, folder: list.folder, slug: list.slug, id: task.id, list: list.name,
        worker, archived: !!task.archived, pinned: pins.has(taskKey(list, task)),
        started: task.started ?? null, ready_at: task.ready_at ?? null, done_at: task.done_at ?? null,
        summary: task.summary ?? null, pr: task.pr ?? null, prompt: String(task.prompt ?? "").slice(0, 500), why: p.why ?? null,
        worktree: task.worktree ?? list.folder, base: task.base ?? null, start: task.start ?? null, branch: task.branch ?? null,
        lastLog: !worker && last?.log ? { path: last.log, kind: last.agent ?? "claude" } : null,
      };
    }));
    this.live.put("tasks", rows);

    const bar = sidebarOf(this.value("spaces-chat"));
    const seen = this.shared["chat.seen"] ?? {};
    // the window's spaces (its herdr-app documents), and the service's own (a web-only install: no window)
    const own = (Array.isArray(this.doc().spaces) ? this.doc().spaces : []).map((x: any) => ({ id: x.machine ? `${x.machine}/${x.id}` : x.id, machine: x.machine ?? null, name: x.name, folder: x.folder, tabs: [] }));
    const fromDocs = [null, ...this.machines].flatMap((m) => spacesFromDoc(this.docs.get(m), m));
    const spaces = [...fromDocs, ...own.filter((x: any) => !fromDocs.some((y: any) => y.id === x.id))].map((s: any, at: number) => {
      const k = assistantOf(s, terminals as any[]);
      const here = rows.filter((r) => (r.machine ?? null) === (s.machine ?? null) && r.folder === s.folder && !r.archived);
      return {
        ...s, at, icon: bar.icons[s.id] ?? null, pinned: bar.pinned.includes(s.id),
        section: bar.sections.find((x: any) => (x.spaces ?? []).includes(s.id))?.id ?? null,
        assistant: k?.address ?? null, assistantStatus: (k as any)?.status?.state ?? null,
        autopilot: !s.machine && this.autopilot[s.id]?.on ? { next: this.autopilot[s.id].next_run ?? null } : null,
        git: this.gitOf(s),
        pilot: s.machine ? null : this.autopilot[s.id] ?? { on: false, events: [], every: null, trigger: "Only Run now" },
        unread: isUnread(k, seen) && spaceLevel(this.value("notify") ?? {}, s.id) !== "Off",
        red: here.filter((r) => r.section === "needs").length + ((k as any)?.status?.state === "blocked" ? 1 : 0),
        green: here.filter((r) => r.section === "ready").length,
      };
    });
    this.spaces = spaces;
    void this.readGit(spaces);
    this.live.put("spaces", { spaces, sections: bar.sections });
    // each list's automations (herdr-task auto), with the folder and machine they belong to, for 3.0's Automations group
    const automations = lists.flatMap((l: any) => (Array.isArray(l.automations) ? l.automations : []).map((a: any) => ({ ...a, folder: l.folder, machine: l.machine ?? null })));
    this.onBuild?.({ spaces, sections: bar.sections, rows, machines: this.machines, automations });
  }
}
