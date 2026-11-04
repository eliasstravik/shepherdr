// The web app is Shepherdr 2.1's screen (its design, phone layout and motion, kept as they were), fed with
// Shepherdr 3's data: this turns what the service builds with the shared core (spaces, tasks, chats) into the
// shapes 2.1's screen reads (web/shared/types.ts: Snapshot, Chat), and its chat keys back into terminals.
//   a space's chat (its Assistant):  p:<space id, "/" as ":">     a task's chat:  <task id>/worker
// A task id is its ref ("SHEP-7"), "<machine>:<ref>" on another machine, as 2.1 wrote them.
import type { Snapshot, Place, Task, Need, Section, Machine, Chat, Message, Status, TaskStatus, StepKind, ActivityAnswer, Question } from "../web/shared/types.ts";
import * as T from "../core/tasks.js";

const { ago } = T as any;

export type Row = any;
export type Space = any;

const SECTION: Record<string, TaskStatus> = { needs: "need", working: "work", merging: "merging", ready: "ready", queued: "queued", todo: "todo", done: "done" };
const AGENT: Record<string, Status> = { blocked: "need", working: "work", done: "idle", idle: "idle" };

export const placeKey = (spaceId: string) => `p:${spaceId.replace("/", ":")}`;
export const taskId = (r: Row) => (r.machine ? `${r.machine}:${r.ref}` : r.ref);

// a news event's dot: what the task was at that moment
const NEWS: Record<string, TaskStatus> = { added: "todo", queued: "queued", started: "work", needs: "need", asks: "need", stalled: "need", failed: "need", ready: "ready", merging: "merging", merged: "done", done: "done", closed: "done" };
const STEP: Record<string, StepKind> = { run: "run", read: "read", edit: "edit", search: "search", web: "web", agent: "agent" };
const stepRow = (s: any, i: number) => ({ key: `${s.id ?? i}`, kind: STEP[s.kind] ?? "other", text: s.count > 1 ? `${s.line} ×${s.count}` : s.line });

/** All of a tools row's steps, for 2.1's "N more" (GET api/activity?chat&what=turn&id). */
export function activity(reader: any, id: string): ActivityAnswer {
  const x = (reader?.conv?.items ?? []).find((i: any) => i.id === id && i.kind === "tools");
  if (!x) return { error: "That turn isn't in the chat any more." };
  return { steps: x.steps.map((s: any, i: number) => ({ id: `${s.id ?? i}`, kind: STEP[s.kind] ?? "other", tool: s.kind, at: 0, end: 1, title: s.line, doing: s.line, target: "" })) };
}

export class Compat {
  /** chat key -> terminal address, from the last build */
  private chats = new Map<string, string>();
  /** task id -> where herdr-task finds it */
  private tasks = new Map<string, { ref: string; folder: string; machine: string | null }>();

  taskOf(id: string) { return this.tasks.get(id) ?? null; }

  /** Open hook asks (service/asks.ts), set by main: they show as cards in their chat and in Needs you. */
  asks: { of(terminal: string): any[]; open: Map<string, any> } | null = null;

  /** A hook ask as 2.1's question card (core/asks.js words: a permission, a plan, or a question). */
  question(a: any, key: string): Question {
    const w = a.words;
    if (w.kind === "questions") {
      const q = w.questions[0];
      return { id: a.id, title: q.text, kind: "Question", to: key, multi: q.multi, other: true,
        choices: q.options.map((o: any) => ({ label: o.name, ...(o.description ? { description: o.description } : {}) })),
        ...(w.questions.length > 1 ? { steps: w.questions.map((x: any) => x.header || x.text) } : {}) };
    }
    // the request word for word in a code block whose fence no run of backticks in it can close; one too long to show
    // whole says so (and can't be allowed from here: service/asks.ts)
    const fence = "`".repeat(Math.max(3, ...[...String(w.detail ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)));
    const detail = w.detail ? `${fence}text\n${w.detail}\n${fence}${w.cut ? "\n\nToo long to show here in full: answer it in the terminal." : ""}` : undefined;
    return w.kind === "plan"
      ? { id: a.id, title: w.title, kind: "Plan", to: key, plan: `${w.detail ?? ""}${w.cut ? "\n\nToo long to show here in full: answer it in the terminal." : ""}`, choices: [{ label: "Approve" }, { label: "Keep planning" }], noteRequiredFor: 1 }
      : { id: a.id, title: w.title, kind: "Question", to: key, ...(detail ? { plan: detail } : {}), choices: [{ label: "Allow" }, { label: "Deny" }] };
  }
  last: Snapshot | null = null;

  addrOf(key: string) { return this.chats.get(key) ?? null; }

  snapshot(input: { host: string; user: string; machines: { name: string; here: boolean; state: string }[]; spaces: Space[]; sections: any[]; rows: Row[] }): Snapshot {
    const { host, spaces, rows } = input;
    const chats = new Map<string, string>();
    const machines: Machine[] = input.machines.map((m) => {
      const key = m.here ? host : m.name;
      return { id: `m:${key}`, machine: key, name: key, status: m.state === "connected" ? "idle" : "off" };
    });
    const placeOf = (r: Row) => spaces.find((s) => (s.machine ?? null) === (r.machine ?? null) && s.folder === r.folder)?.id ?? "";

    const places: Place[] = spaces.map((s) => {
      const key = placeKey(s.id);
      if (s.assistant) chats.set(key, s.assistant);
      const name = s.name || (s.folder.split("/").filter(Boolean).pop() ?? "home");
      return { id: s.id, name, machine: s.machine ?? host, level: 0, status: AGENT[s.assistantStatus] ?? "idle", mode: "regular", chat: key };
    });

    this.tasks = new Map(rows.map((r) => [taskId(r), { ref: r.ref, folder: r.folder, machine: r.machine ?? null }]));
    const tasks: Task[] = rows.filter((r) => r.section !== "done" || (r.done_at && Date.now() - r.done_at < 7 * 86400000)).map((r) => {
      const id = taskId(r);
      if (r.worker) chats.set(`${id}/worker`, r.worker);
      else if (r.lastLog) chats.set(`${id}/worker`, `log:${r.machine ?? ""}|${r.lastLog.kind}|${r.lastLog.path}`);
      const t: Task = {
        id, name: r.title, status: SECTION[r.section] ?? "todo", place: placeOf(r), age: r.started ? ago(r.started, false) : "",
        state: r.section, on: r.machine ?? host, created: "",
        ...(r.sub ? { sub: r.sub } : {}),
        ...(r.done_at ? { doneAt: r.done_at } : {}),
        ...(r.pr ? { pr: { number: r.pr.number, url: r.pr.url } } : {}),
        ...(r.pinned ? { pinned: 1 } : {}),
        ...(r.archived ? { archived: r.done_at ?? 1 } : {}),
        ...(r.section === "working" && r.pct != null ? { report: { msg: r.sub ?? "", progress: r.pct, ...(r.left ? { eta: parseInt(r.left) || 0 } : {}) } } : {}),
        ...(r.worker ? { agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: r.section === "needs" ? "need" : "work", running: true, age: "", note: "" } } : {}),
        ...(!r.worker && r.lastLog ? { agent: { chat: `${id}/worker`, role: "worker", cli: r.lastLog.kind, status: "idle", running: false, age: "", note: "" } } : {}),
      };
      return t;
    });

    const needs: Need[] = [
      ...rows.filter((r) => r.section === "needs" && !r.archived).map((r) => ({ id: "attention", chat: `${taskId(r)}/worker`, place: placeOf(r), task: taskId(r), at: r.started ?? Date.now(), text: r.sub ?? "" })),
      ...spaces.filter((s) => s.assistantStatus === "blocked").map((s) => ({ id: "attention", chat: placeKey(s.id), place: s.id, at: Date.now(), text: "Waits for you" })),
    ];

    // hook asks waiting on the person: each a Need with its card
    const keyOf = new Map([...chats].map(([k, a]) => [a, k]));
    for (const a of this.asks?.open.values() ?? []) {
      const key = keyOf.get(a.terminal);
      if (!key) continue;
      const task = key.endsWith("/worker") ? key.slice(0, -7) : undefined;
      const place = task ? tasks.find((x) => x.id === task)?.place ?? "" : places.find((p) => p.chat === key)?.id ?? "";
      needs.push({ id: a.id, chat: key, place, ...(task ? { task } : {}), at: a.at, question: this.question(a, key) });
    }

    const pinned = spaces.filter((s) => s.pinned).map((s) => s.id);
    const sections: Section[] = [
      ...(pinned.length ? [{ id: "pinned", name: "Pinned", spaces: pinned }] : []),
      ...input.sections.map((x: any) => ({ id: `s:${x.id}`, name: x.name, ...(x.emoji ? { emoji: x.emoji } : {}), ...(x.machine ? { machine: x.machine } : {}), spaces: x.spaces ?? [] })),
    ];

    // unread: a space's chat counts as new until its Assistant's turn is read (core label herdr.chat.read)
    const last: Record<string, number> = {}, read: Record<string, number> = { "*": 0 };
    for (const s of spaces) { const k = placeKey(s.id); last[k] = s.unread ? 2 : 1; read[k] = 1; }

    this.chats = chats;
    this.last = {
      name: "Shepherdr", host, user: input.user, places, machines, tasks, automations: {}, artifacts: [], asks: {}, needs, settings: [],
      sections, last, read,
    };
    return this.last;
  }

  /** A followed conversation (core/chat-reader.js) as 2.1's Chat. A run of tool calls (3.0's tools row) is 2.1's turn
   *  rows: the first three, then "N more" (activity()). */
  chat(key: string, reader: any, t: any): Chat {
    const messages: Message[] = [];
    let at = 0;
    for (const x of reader.conv?.items ?? []) {
      if (x.at) at = x.at;
      if (x.kind === "user" && x.text) messages.push({ id: x.id, who: "you", text: x.text, at: x.at, ...(x.replyTo ? { reply: { text: x.replyTo } } : {}) } as Message);
      else if (x.kind === "agent" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at });
      else if (x.kind === "error" && x.text) messages.push({ id: x.id, who: "agent", text: x.text, at: x.at });
      else if (x.kind === "news" && x.ref) {
        // a task's news line in its Assistant's chat (<herdr-news task=… event=…>), as it was said
        const task = reader.machine ? `${reader.machine}:${x.ref}` : x.ref;
        const status = NEWS[x.event] ?? "work";
        messages.push({ id: x.id, who: "agent", at: x.at, text: `${task} ${x.text}`, card: { id: x.id, task, status, text: x.text } });
      } else if (x.kind === "tools" && x.steps?.length) {
        const rows = x.steps.map(stepRow);
        messages.push({ id: x.id, who: "agent", at, activity: { id: x.id, at, end: at, rows: rows.slice(0, 3), steps: x.steps.length, ...(rows.length > 3 ? { more: rows.length - 3 } : {}) } });
      }
    }
    // what the agent asks now, as cards at the end of its chat
    const addr = this.chats.get(key);
    for (const a of addr ? this.asks?.of(addr) ?? [] : []) messages.push({ id: `ask:${a.id}`, who: "agent", at: a.at, question: this.question(a, key) });
    const st = t?.status?.state ?? null;
    return { key, messages, working: st === "working", cli: reader.kind === "codex" ? "codex" : "claude", ...(reader.pinned || (t && t.state !== "live") ? { finished: true } : {}) };
  }
}
