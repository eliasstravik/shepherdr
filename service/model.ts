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
  onBuild: ((b: { spaces: any[]; sections: any[]; rows: any[]; machines: string[] }) => void) | null = null;

  constructor(private hub: Hub, private live: Live) {}

  start() {
    this.hub.on((e) => {
      if (e.type === "reset") void this.refresh();
      else if (e.type === "doc" && (e as any).data?.name === "herdr-app") void this.readDocs();
      else if ("terminal" in e && e.terminal) this.soon();
    });
    const tasks = join(HOME, ".herdr", "tasks");
    if (existsSync(tasks)) watch(tasks, () => this.soon(() => this.readLists(null)));
    if (existsSync(SHARED)) watch(SHARED, () => this.soon(() => this.readShared()));
    setInterval(() => void this.refresh(), 10_000);
    void this.refresh();
  }

  /** Builds again shortly (many events come at once); `first` reads something before. */
  private soon(first?: () => Promise<void> | void) {
    if (first) void Promise.resolve(first()).then(() => this.soon());
    this.timer ??= setTimeout(() => { this.timer = null; this.build(); }, 150);
  }

  /** Builds again soon (something the snapshot shows changed outside: an ask). */
  rebuild() { this.soon(); }

  private async refresh() {
    try {
      const r = await this.hub.call<{ machines: any[] }>("machine.list", {});
      this.machines = r.machines.filter((m) => m.state === "connected").map((m) => m.name);
    } catch {}
    this.readShared();
    await Promise.all([this.readDocs(), this.readLists(null), ...this.machines.map((m) => this.readLists(m))]);
    this.build();
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
    const pins = new Set<string>(Array.isArray(this.shared["tasks.pinned"]) ? this.shared["tasks.pinned"] : []);
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
        summary: task.summary ?? null, pr: task.pr ?? null,
        worktree: task.worktree ?? list.folder, base: task.base ?? null, start: task.start ?? null, branch: task.branch ?? null,
        lastLog: !worker && last?.log ? { path: last.log, kind: last.agent ?? "claude" } : null,
      };
    }));
    this.live.put("tasks", rows);

    const bar = sidebarOf(this.shared["spaces-chat"]);
    const seen = this.shared["chat.seen"] ?? {};
    const spaces = [null, ...this.machines].flatMap((m) => spacesFromDoc(this.docs.get(m), m)).map((s, at) => {
      const k = assistantOf(s, terminals as any[]);
      const here = rows.filter((r) => (r.machine ?? null) === (s.machine ?? null) && r.folder === s.folder && !r.archived);
      return {
        ...s, at, icon: bar.icons[s.id] ?? null, pinned: bar.pinned.includes(s.id),
        section: bar.sections.find((x: any) => (x.spaces ?? []).includes(s.id))?.id ?? null,
        assistant: k?.address ?? null, assistantStatus: (k as any)?.status?.state ?? null,
        unread: isUnread(k, seen),
        red: here.filter((r) => r.section === "needs").length + ((k as any)?.status?.state === "blocked" ? 1 : 0),
        green: here.filter((r) => r.section === "ready").length,
      };
    });
    this.live.put("spaces", { spaces, sections: bar.sections });
    this.onBuild?.({ spaces, sections: bar.sections, rows, machines: this.machines });
  }
}
