// What a web page may do, each through the shared core, hc and herdr-task: send the
// person's words to an agent, stop it, mark an Assistant read, accept a Ready task, read a task's evidence.
// Anything else is refused. Inputs are checked here; commands run with argument lists, never a shell line.
import type { Hub } from "./hub.ts";
import { join } from "node:path";
import { HOME, appHome, writable } from "./paths.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { sendBody, steerNow, messageBody, refusal, reactionLine, mentionedIn, taskTag, inFront, NOT_TYPED } from "../core/send.js";
import { kindOf } from "../core/chat-reader.js";
import { WORDS } from "../core/chat-view.js";
import { settle } from "../core/pending.js";
import * as AGa from "../core/agents.js";
import { answerCodex } from "./codex-ask.ts";
const { CHOICE_KEY, choiceOf, withChoice, speedOf } = AGa as any;
import * as SP from "../core/spaces.js";
const { READ, assistantOf, withMove, withSection, withoutSection, withSectionName, withIcon, withMachineLook, withOrder, withMachineOrder, DELETED, deletedSection, withRestoredSection } = SP as any;
import type { Compat } from "./compat.ts";
import { noteFailed, once, wentIn } from "./send-once.ts";
import { execTemplate, ownId, withoutSpace } from "./spaces.ts";
import * as MA from "../core/machine-add.js";
import { exec } from "./model.ts";
import { FIND } from "../core/chat-log.js";
import { spawn } from "./spawn.ts";

const attachDir = () => join(appHome(), "data", "chat-attach");
/** files in one message at most (the page says so before it sends: web/plugins/chat/client.tsx) */
export const MAX_FILES = 50;
const ADDR = /^([\w.-]+\/)?t[0-9a-z]+$/;
const REF = /^[A-Z][A-Z0-9]*-\d+$/;
const MACHINE = /^[\w.-]+$/;

/** One page's message to its agent, its files' paths after its words. -> { ok, at } once it is in the agent's terminal
 *  (Claude Code's box clear: core/send.js settleBox), or { waiting } held for the agent's turn; else it throws. */
async function sendNow(hub: Hub, b: any, compat: Compat, again = false) {
  const a = addr(b.addr);
  const text = str(b.text ?? "").trim();
  if (!text && !(Array.isArray(b.attachments) && b.attachments.length)) throw new Error("nothing to send");
  const t = hub.terminals.get(a);
  if (!t || t.state !== "live") throw new Error("That agent isn't running.");
  const io = { hc: asPerson(hub), sleep: (ms: number) => Bun.sleep(ms), status: () => (hub.terminals.get(a) as any)?.status?.state ?? null };
  // files sent with it: their paths after the words (copied first to another machine)
  const sent: string[] = Array.isArray(b.attachments) ? b.attachments : [];
  // never some of them quietly
  if (sent.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files in one message.`);
  for (const p of sent) if (typeof p !== "string" || !p.startsWith(attachDir() + "/") || p.includes("/../")) throw new Error("That file isn't one sent from here.");
  // all at once
  const files = await Promise.all(sent.map(async (p) => {
    if (!a.includes("/")) return p;
    const put = await hc(["put", a, p, "--json"]);
    let landed: string | null = null;
    try { landed = JSON.parse(put.stdout || "{}").path ?? null; } catch {}
    if (put.code !== 0 || !landed) throw new Error("A file didn't reach that machine.");
    return landed;
  }));
  const body = [messageBody({ text, quote: typeof b.quote === "string" ? b.quote.slice(0, 2000) : null, tags: typeof b.tags === "string" ? b.tags : "" }), ...files].filter(Boolean).join("\n\n");
  // held on purpose (Ctrl+Enter, a long press): it goes once the agent stops working
  const st = (hub.terminals.get(a) as any)?.status?.state;
  if (b.hold && (st === "working" || st === "blocked")) {
    const cid = typeof b.cid === "string" ? b.cid.slice(0, 80) : undefined;
    // once it goes: the chat knows it again by its words (its id and files), so the page sees it went in
    const note = () => { if (cid) compat.noteSend?.(a, { cid, text, files: sent, at: Date.now() }); };
    held.push({ addr: a, kind: kindOf(t) ?? "", body, hub, cid, note });
    drain();
    return { ok: true, waiting: true, waitsFor: "turn" };
  }
  // when it began to go in, by this clock: the page knows it again in the chat by it (web/src/outbox.ts sameAs)
  const at = Date.now();
  // what it was, so the chat knows it again while it waits in the CLI's queue
  if (typeof b.cid === "string") compat.noteSend?.(a, { cid: b.cid.slice(0, 80), text, files: sent, at });
  const r: any = await sendBody(io, a, kindOf(t) ?? "", body, again);
  // (stuck: it stayed in Claude Code's box; sent again with this id it gets only its Enter: send-once.ts)
  if (r.code !== 0) throw Object.assign(new Error(refusal(r).message), { stuck: !!r.stuck });
  return { ok: true, at };
}

/** Retry on one that went in but didn't show up in the chat (b.was: its first id; SHEP-312): when the agent's log has
 *  it after all (it came back late, or without its id), it is not sent twice: its answer is the first's, and the chat
 *  gives the log's message the new id. -> that answer, or null: send it. */
export function arrived(b: any, compat: Compat): { ok: true; at: number; already: true } | null {
  const at = wentIn(String(b.was).slice(0, 80));
  if (at === null) return null;
  const a = addr(b.addr), text = said(str(b.text ?? ""));
  const items: any[] = compat.reader?.(a)?.conv?.items ?? [];
  const sent: string[] = Array.isArray(b.attachments) ? b.attachments : [];
  const x = items.find((x) => x.kind === "user" && !x.from && (x.at ?? 0) >= at - 60_000 && said(String(x.text ?? "").split("\n").filter((l) => !(/^[/~]\S+$/.test(l.trim()) && sent.some((p) => p.split("/").pop() === l.trim().split("/").pop()))).join("\n")) === text);
  if (!x) return null;
  // the first's id never takes it again: the new one does
  compat.sends?.set(a, (compat.sends.get(a) ?? []).filter((s: any) => s.cid !== b.was));
  compat.noteSend?.(a, { cid: String(b.cid).slice(0, 80), text: str(b.text ?? "").trim(), files: sent, at: x.at ?? at });
  return { ok: true, at: x.at ?? at, already: true };
}
const said = (v: string) => v.replace(/\s+/g, " ").trim();

// Messages held until their agent is free, sent in order, each once.
const held: { addr: string; kind: string; body: string; hub: Hub; cid?: string; now?: boolean; note?: () => void }[] = [];
let draining: ReturnType<typeof setInterval> | null = null, busy = false;
function drain() {
  draining ??= setInterval(async () => {
    // one pass at a time: a slow send never overlaps the next tick
    if (busy) return;
    busy = true;
    try {
      for (const m of [...held]) {
        const st = (m.hub.terminals.get(m.addr) as any)?.status?.state;
        const alive = m.hub.terminals.get(m.addr)?.state === "live";
        if (alive && !m.now && (st === "working" || st === "blocked")) continue;
        const i = held.indexOf(m);
        if (i < 0) continue;
        held.splice(i, 1);
        // one that can't go now is told to its page (Chat.failed: Not sent, with Retry), never dropped quietly
        if (alive) m.note?.();
        const r: any = alive
          ? await sendBody({ hc: asPerson(m.hub), sleep: (ms: number) => Bun.sleep(ms), status: () => (m.hub.terminals.get(m.addr) as any)?.status?.state ?? null }, m.addr, m.kind, m.body).catch((e: Error) => ({ code: 1, stderr: e.message }))
          : { code: 1, stderr: "That agent isn't running." };
        if (r.code !== 0 && m.cid) noteFailed(m.addr, m.cid, refusal(r).message, !!r.stuck);
      }
    } finally {
      busy = false;
    }
    if (!held.length && draining) { clearInterval(draining); draining = null; }
  }, 1000);
}

// An Assistant's first message for a space whose machine is offline (the window's chat does the same): kept here and
// sent again, so the Assistant starts there once the machine is back. One per space, the latest words; a day at most.
const starts = new Map<string, { b: any; hub: Hub; compat: Compat; at: number }>();
let startTimer: ReturnType<typeof setInterval> | null = null;
function startWhenBack() {
  startTimer ??= setInterval(async () => {
    const up = new Set((await addedMachines()).filter((m: any) => m.state === "connected").map((m: any) => m.name));
    for (const [space, w] of [...starts]) {
      const machine = space.split("/")[0];
      if (Date.now() - w.at > 86_400_000) starts.delete(space);
      else if (up.has(machine)) { starts.delete(space); await act(w.hub, w.b, w.compat).catch(() => null); }
    }
    if (!starts.size && startTimer) { clearInterval(startTimer); startTimer = null; }
  }, 15_000);
}

// An Assistant whose CLI showed a screen of its own (trust this folder) before hc could hand it its first message: the
// template's words and the task go once it is idle past that screen, as the window's chat does (mods/chat follow()).
// It took a turn already (hc got the message in after all, or the person typed in its terminal): nothing is sent. A turn
// alone doesn't say so: Codex counts one for coming up, before any message, so past its own screens ("Update
// available", "Hooks need review") its first message was dropped and it sat idle without its instructions (SHEP-263).
// A turn counts only once its session log is there (core/chat-log.js FIND: a conversation was written).
export function firstWhenIdle(hub: Hub, addr: string, text: string, every = 2000) {
  const until = Date.now() + 15 * 60_000;
  let busy = false;
  const timer = setInterval(async () => {
    const t: any = hub.terminals.get(addr);
    if (!t || t.state !== "live" || Date.now() > until) return clearInterval(timer);
    if (t.status?.state !== "idle" || busy) return;
    busy = true;
    try {
      if ((t.turn ?? 0) > 0) {
        const kind = kindOf(t), pid = t.foreground?.pid;
        const f = kind && pid ? await exec(hub, ["sh", "-c", FIND, "chat", kind, String(pid)], addr.includes("/") ? addr.split("/")[0] : null).catch(() => null) : null;
        // (its log couldn't be looked for now: asked again at the next look)
        if (kind && pid && !f) return;
        const path = String(f?.stdout ?? "").trim().split("\n").pop() ?? "";
        if (path && path !== "pending") return clearInterval(timer);
      }
      clearInterval(timer);
      await hub.send(addr, text);
    } finally { busy = false; }
  }, every);
  return timer;
}

async function run(cmd: string[]) {
  // a program that isn't there fails as any other: its code, not a throw
  let p: ReturnType<typeof spawn<"ignore", "pipe", "pipe">>;
  try { p = spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" }); }
  catch (e) { return { code: 127, stdout: "", stderr: String(e) }; }
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

export const hc = (args: string[]) => run([process.env.SHEPHERDR_HC || "hc", ...args]);

/** Settings › Machines › Find machines (#967): what it would try (go false: contacts nothing), or one run now, as
 *  herdr-task machines find gives it on this machine; its refusals (add-on off, ran recently) come back as error */
export async function findMachines(go: boolean) {
  const r = await run(["herdr-task", "machines", "find", "--json", ...(go ? ["--go"] : [])]);
  try { return JSON.parse(r.stdout.trim().split("\n").pop() || ""); }
  catch { return { hosts: [], last: null, wait_ms: 0, error: r.stderr.trim().split("\n").pop() || "Find machines failed." }; }
}

// hc for core/send.js, its sends as the person's (Hub.send: no <hc from=…> tag on another machine)
const asPerson = (hub: Hub) => (args: string[]) => args[0] === "send" ? hub.send(args[1], args[2]) : hc(args);

/** The machines added (hc machine ls), as Add machine marks them: not the temporary ones. */
async function addedMachines() {
  const r = await hc(["machine", "ls", "--json"]).catch(() => null);
  try { return r?.code === 0 ? (JSON.parse(r.stdout).machines ?? []).filter((m: any) => !m.temporary) : []; } catch { return []; }
}
// still running there after a slow or dropped link: its real result, followed (core/pending.js, SHEP-227)
const task = async (args: string[], folder: string, machine: string | null) =>
  settle((a: string[]) => run(["herdr-task", ...a]), await run(["herdr-task", ...(machine ? ["--on", machine] : []), ...args, "--folder", folder, "--json"]));

function str(v: unknown, max = 100_000) {
  if (typeof v !== "string" || v.length > max) throw new Error("bad input");
  return v;
}
function addr(v: unknown) {
  const a = str(v, 80);
  if (!ADDR.test(a)) throw new Error("bad terminal");
  return a;
}
function taskOf(b: any) {
  const ref = str(b.ref, 40), folder = str(b.folder, 4096), machine = b.machine == null ? null : str(b.machine, 80);
  if (!REF.test(ref) || !folder.startsWith("/") || (machine && !MACHINE.test(machine))) throw new Error("bad task");
  return { ref, folder, machine };
}

/** A space's Assistant chat with no Assistant yet: the first message starts it (the assistant template) with the
 *  message as its task, labelled for its space. -> { ok, started, at, addr }, or { waiting } for an offline machine. */
async function startFresh(hub: Hub, b: any, compat: Compat): Promise<any> {
  // a space's Assistant chat with no Assistant yet: the first message starts it (the assistant template) with the
  // message as its task, labelled for its space
  const space = b.chat.slice(2).replace(":", "/"), sp = compat.spaceOf(space);
  if (!sp) throw new Error("That space isn't here any more.");
  const bare = String(sp.id).split("/").pop()!;
  const text = str(b.text ?? "").trim();
  if (!text) throw new Error("nothing to send");
  const files = Array.isArray(b.attachments) && !sp.machine ? b.attachments.filter((p: unknown) => typeof p === "string" && p.startsWith(attachDir() + "/") && !p.includes("/../")) : [];
  const task = [text, ...files].join("\n\n");
  // its machine offline: it waits (the web shows it waiting to be reached) and starts once the machine is back
  if (sp.machine && !(await addedMachines()).some((m: any) => m.name === sp.machine && m.state === "connected")) {
    const was = starts.get(space)?.b.text;
    starts.set(space, { b: { ...b, text: was ? `${was}\n\n${text}` : text }, hub, compat, at: Date.now() });
    startWhenBack();
    return { ok: true, waiting: true };
  }
  const labels = ["--label", "herdr.role=coordinator", "--label", `herdr.coordinator.space=${bare}`, "--label", `herdr.space=${bare}`];
  const tpl = await execTemplate(hub, "assistant", sp.machine ?? null, compat.assistantPick?.(sp.id) ?? null);
  // when it began to go in, by this clock: the page knows its message again in the chat by it, as any send's
  const at = Date.now();
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--keep", ...(sp.machine ? ["--on", sp.machine] : []), ...(sp.folder ? ["--cwd", sp.folder] : []), ...labels, tpl.name, task]);
  tpl.done();
  let out: any = {};
  try { out = JSON.parse(r.stdout || "{}"); } catch {}
  if (r.code !== 0 || !out.address) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "The Assistant didn't start.");
  // what the person asked, for its chat to show apart from the template (data/chat-first)
  const first = join(appHome(), "data", "chat-first");
  const addr = sp.machine && !String(out.address).includes("/") ? `${sp.machine}/${out.address}` : String(out.address);
  if (out.first_message?.sent === false && tpl.words) firstWhenIdle(hub, addr, `${tpl.words}\n\n${task}`);
  try { mkdirSync(first, { recursive: true }); writeFileSync(writable(join(first, `${String(addr).replace(/[^\w.-]/g, "_")}.txt`)), text); } catch {}
  // it started on the choice made in its chat (assistantPick): that choice is spent, the next start is Settings' again
  if (compat.shared && choiceOf(compat.shared.value(CHOICE_KEY), sp.id)) void compat.shared.set(CHOICE_KEY, withChoice(compat.shared.value(CHOICE_KEY), sp.id, null)).catch(() => null);
  // the page's own id for it (SHEP-263): the chat gives its message back with that id, so the page's pending copy
  // goes once the log has it (it stayed under the reply, said twice, until it gave up on it two minutes later)
  if (typeof b.cid === "string") compat.noteSend?.(addr, { cid: b.cid.slice(0, 80), text, files, at });
  return { ok: true, started: true, at, addr };
}

// A space's Assistant that ended, started again for its next message (SHEP-297): one start per space at a time, so
// two messages sent meanwhile (two devices, a send and a voice call) reach the same new Assistant.
const reviving = new Map<string, Promise<{ addr: string; mine?: symbol; result?: unknown }>>();
/** how long a restarted Assistant may take to come up before its message is given up on (the page's Retry) */
export const REVIVE_WAIT = { ms: 120_000, every: 500 };

/** A message to a space whose Assistant ended: it starts again on its own conversation (Agents.revive, the Stopped
 *  card's Restart), and the message goes to the new one once it is up, held for its turn if it is busy. One that can't
 *  start again (its record gone, no log to resume) gives way to a fresh Assistant with the message as its task. */
async function sendToEnded(hub: Hub, b: any, compat: Compat, old: string): Promise<unknown> {
  const place = b.chat.slice(2).replace(":", "/"), sp = compat.spaceOf(place);
  if (!sp) throw new Error("That space isn't here any more.");
  const text = str(b.text ?? "").trim();
  if (!text && !(Array.isArray(b.attachments) && b.attachments.length)) throw new Error("nothing to send");
  // what it replies to and the tasks it mentions, from the chat as it shows (the old one's)
  const r = compat.reader?.(old);
  const quote = typeof b.reply === "string" ? r?.conv?.items?.find((x: any) => x.id === b.reply)?.text ?? null : null;
  const tags = mentionedIn(String(b.text ?? ""), compat.tasksFor(b.chat)).map((x: any) => taskTag(x, x.ref ?? `#${x.id}`)).join("");
  const me = Symbol("send");
  let p = reviving.get(place);
  if (!p) {
    p = (async () => {
      // one started meanwhile (another device's message, the Restart card): that one
      const live = assistantOf(sp, [...hub.terminals.values()]);
      if (live && live.address !== old && inFront(live) !== "shell") return { addr: live.address as string };
      try {
        if (!compat.agents?.revive) throw new Error("no restart here");
        return { addr: await compat.agents.revive(old, r ?? null) };
      } catch {
        // it couldn't start again: a fresh Assistant, this message its task
        const result: any = await startFresh(hub, b, compat);
        return { addr: result.addr, mine: me, result };
      }
    })().finally(() => reviving.delete(place));
    reviving.set(place, p);
  }
  const got = await p;
  if (got.mine === me) return got.result;
  if (!got.addr) throw new Error("The Assistant didn't start.");
  // up once it reports a status (Claude Code's or Codex's screen is drawn); a busy one gets it at its turn
  const until = Date.now() + REVIVE_WAIT.ms;
  while (!((hub.terminals.get(got.addr) as any)?.state === "live" && (hub.terminals.get(got.addr) as any)?.status?.state)) {
    if (Date.now() > until) throw new Error("The Assistant started again but isn't ready yet. Send it again in a moment.");
    await Bun.sleep(REVIVE_WAIT.every);
  }
  return sendNow(hub, { ...b, addr: got.addr, quote, tags, hold: true }, compat);
}

export async function act(hub: Hub, b: any, compat: Compat): Promise<unknown> {
  // 2.1's screen names a chat by its key (compat.ts): its terminal here.
  const chat = (key: unknown) => {
    const a = typeof key === "string" ? compat.addrOf(key) : null;
    if (!a) throw new Error("That chat isn't here any more.");
    return a;
  };
  if (b?.type === "answer" && typeof b.question === "string" && b.question.startsWith("scr-")) {
    // a CLI's start screen (service/watch.ts): a tap presses that choice, only on the screen the card was drawn from;
    // "Answer in terminal" just shows the terminal
    if (b.terminal === true) return { ok: true };
    const why = await (compat as any).watch?.press(str(b.question, 300), typeof b.choice === "number" ? b.choice : -1);
    return why ? { ok: false, error: why } : { ok: true };
  }
  if (b?.type === "answer" && typeof b.question === "string" && b.question.startsWith("cq:")) {
    // Codex's own questions (compat.ts codexQuestion): answered on its screen, as a person would
    const a = chat(b.chat);
    const item = (compat.reader?.(a)?.conv?.items ?? []).find((x: any) => x.kind === "ask" && x.id === b.question.slice(3));
    if (!item?.questions?.length || item.closed) throw new Error("That question was answered already.");
    // SHEP-324: answered by typing on its screen: only while Codex itself is in front
    const f = await hub.front?.(a);
    if (f && f !== "agent") throw new Error(NOT_TYPED[f]);
    const why = await answerCodex(hc, a, item.questions, b);
    if (why) throw new Error(why);
    return { ok: true };
  }
  if (b?.type === "answer" && typeof b.question === "string") {
    // a hook ask's card (its id is the request's): answered as the window's card answers it
    if (!compat.asks) throw new Error("No questions here.");
    await (compat.asks as any).answer(str(b.question, 200), { choice: typeof b.choice === "number" ? b.choice : undefined,
      choices: Array.isArray(b.choices) ? b.choices.filter((n: unknown) => typeof n === "number") : undefined,
      note: typeof b.note === "string" ? b.note.slice(0, 4000) : undefined, other: typeof b.other === "string" ? b.other.slice(0, 4000) : undefined,
      answers: Array.isArray(b.answers) ? b.answers.slice(0, 20).map((x: unknown) => String(x ?? "").slice(0, 4000)) : undefined,
      terminal: b.terminal === true, talk: b.talk === true, dismiss: b.dismiss === true });
    return { ok: true };
  }
  if (b?.type === "react" && typeof b.chat === "string" && typeof b.message === "string" && typeof b.emoji === "string" && b.emoji.length <= 16) {
    // a reaction toggles, as the window's: added unless it is yours already; the agent reads the core's reaction line
    const a = chat(b.chat), r = compat.reader?.(a);
    const item = r?.conv?.items?.find((x: any) => x.id === b.message);
    if (!item?.text) throw new Error("That message isn't in the chat any more.");
    const mine = (r.conv.reactions.get(b.message) ?? []).some((x: any) => x.by === "you" && x.emoji === b.emoji);
    if ((hub.terminals.get(a) as any)?.status?.state === "blocked") throw new Error("It's asking you something: answer that first.");
    const res = await hub.send(a, reactionLine(b.emoji, item.text, !mine));
    if (res.code !== 0) throw new Error(refusal(res).message);
    return { ok: true };
  }
  // the person's shared choices (the spaces, pins, groups, icons, order): in the service's document
  const sh = compat.shared;
  if (b?.type === "pin" && typeof b.chat === "string" && b.chat.endsWith("/worker") && sh) {
    const t = compat.taskOf(b.chat.slice(0, -7));
    if (!t) throw new Error("That task isn't here any more.");
    const now = new Set<string>(Array.isArray(sh.value("tasks.pinned")) ? sh.value("tasks.pinned") : []);
    if (b.on) now.add(t.pin); else now.delete(t.pin);
    await sh.set("tasks.pinned", [...now]);
    return { ok: true };
  }
  const bar = () => sh!.value("spaces-chat") ?? {};
  const sec = (id: unknown) => (typeof id === "string" && id.startsWith("s:") ? id.slice(2) : null);
  if (b?.type === "move" && typeof b.id === "string" && typeof b.to === "string" && sh) {
    const to = sec(b.to);
    await sh.set("spaces-chat", withMove(bar(), b.id, to, typeof b.before === "string" ? b.before : null));
    return { ok: true };
  }
  if (b?.type === "order" && sh && typeof b.under === "string" && Array.isArray(b.ids)) {
    // a dragged sidebar list: each group's spaces, the groups' order, a machine's spaces and the machines, all in the
    // shared sidebar data ("spaces-chat")
    const ids = b.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) as string[];
    const d = structuredClone(bar());
    d.sections ??= [];
    const same = (a: string[], c: string[]) => a.length === c.length && a.every((x) => c.includes(x));
    if (sec(b.under)) {
      const x = d.sections.find((y: any) => y.id === sec(b.under));
      if (!x || !same(ids, x.spaces ?? [])) throw new Error("That section changed meanwhile.");
      x.spaces = ids;
    } else if (b.under === "sections" || b.under.startsWith("sections:")) {
      // the groups at the top or a machine's: their new order
      const order = ids.map(sec).filter(Boolean) as string[];
      d.sections = [...order.map((id) => d.sections.find((y: any) => y.id === id)).filter(Boolean), ...d.sections.filter((y: any) => !order.includes(y.id))];
    } else if (b.under.startsWith("m:")) {
      // the order is the sidebar's own (core/spaces.js withOrder), so it holds on every device; the rest of the
      // machine's stay where they were
      const key = b.under.slice(2), machine = key === compat.host ? null : key;
      const all: any[] = compat.allSpaces?.() ?? [];
      const now = all.filter((s) => (s.machine ?? null) === machine).map((s) => s.id);
      await sh.set("spaces-chat", withOrder(bar(), machine, ids, now));
      return { ok: true };
    } else if (b.under === "all") {
      // the machines (m:<key>, this computer by its name): their order in the sidebar's data, "" for this computer, so
      // every device shows it (core/spaces.js withMachineOrder, SHEP-153)
      const keys = ids.filter((id) => id.startsWith("m:")).map((id) => (id.slice(2) === compat.host ? "" : id.slice(2)));
      await sh.set("spaces-chat", withMachineOrder(bar(), keys));
      return { ok: true };
    } else throw new Error("That list keeps its order.");
    await sh.set("spaces-chat", d);
    return { ok: true };
  }
  if (b?.type === "section" && sh) {
    if (b.op === "new" && typeof b.name === "string" && b.name.trim()) {
      const machine = typeof b.machine === "string" && b.machine !== compat.host ? b.machine : null;
      const id = `sec-${Date.now().toString(36)}`;
      await sh.set("spaces-chat", withSection(bar(), { id, name: b.name.trim().slice(0, 60), machine, icon: typeof b.emoji === "string" ? b.emoji.slice(0, 16) : null }));
      // its id as the list names it, so a space can be moved straight into it (Move to group › New group…)
      return { ok: true, id: `s:${id}` };
    }
    if (b.op === "delete" && sec(b.id)) {
      // at once, kept for its toast's Undo (shared "spaces-chat.deleted")
      const gone = deletedSection(bar(), sec(b.id));
      if (gone) await sh.set(DELETED, gone);
      await sh.set("spaces-chat", withoutSection(bar(), sec(b.id)));
      return { ok: true };
    }
    if (b.op === "restore") {
      const gone = sh.value(DELETED);
      if (!gone?.section) return { ok: false, error: "There is nothing to undo." };
      await sh.set(DELETED, null);
      await sh.set("spaces-chat", withRestoredSection(bar(), gone));
      return { ok: true };
    }
  }
  if (b?.type === "rename" && typeof b.id === "string" && typeof b.name === "string" && sh) {
    const name = b.name.trim().slice(0, 80);
    const icon = typeof b.emoji === "string" ? b.emoji.slice(0, 16) || null : undefined;
    if (sec(b.id)) { await sh.set("spaces-chat", withSectionName(bar(), sec(b.id), name, icon)); return { ok: true }; }
    if (b.id.startsWith("m:")) {
      // a machine's own name and emoji in the sidebar (this computer is the snapshot's host)
      const key = b.id.slice(2);
      await sh.set("spaces-chat", withMachineLook(bar(), key === compat.host ? null : key, name, icon ?? null));
      return { ok: true };
    }
    // a space: its icon in the sidebar's data, its name in the list of spaces (shared "spaces")
    if (icon !== undefined) await sh.set("spaces-chat", withIcon(bar(), b.id, icon));
    // an empty name (unname) gives it back the name of where it is: its repo's, else its folder's (core spaceName)
    if (name || b.unname === true) {
      const own: any[] = Array.isArray(sh.value("spaces")) ? sh.value("spaces") : [];
      if (!own.some((x) => ownId(x) === b.id)) throw new Error("That space isn't here any more.");
      await sh.set("spaces", own.map((x) => (ownId(x) === b.id ? { ...x, name } : x)));
    }
    return { ok: true };
  }
  if (b?.type === "model-pin" && compat.agents && ["claude", "codex"].includes(b.agent) && typeof b.model === "string" && /^[\w.\[\]-]{1,60}$/.test(b.model)) {
    // the model menu's star: pinned to the top of its agent's list (core/agents.js PICKS_FILE)
    return { ok: true, picks: (compat.agents as any).pin(b.agent, b.model) };
  }
  if ((b?.type === "restart-info" || b?.type === "model-menu" || b?.type === "restart") && typeof b.chat === "string" && compat.agents) {
    // the model menu: what it runs on and its choices (model-menu: the window's, mods/chat-models); a restart on
    // another model, effort, speed, permission mode or CLI
    const fresh = b.type !== "restart-info" && b.chat.startsWith("p:") && !compat.addrOf(b.chat) ? compat.spaceOf(b.chat.slice(2).replace(":", "/")) : null;
    if (fresh) {
      // a space's Assistant that hasn't started (SHEP-263): the menu shows what its first message starts it on, and a
      // pick only changes that choice (nothing runs yet), kept in the shared document (CHOICE_KEY)
      if (b.type === "model-menu") return { ok: true, menu: await (compat.agents as any).freshMenu(fresh.machine, compat.assistantPick?.(fresh.id) ?? null) };
      if (!["claude", "codex"].includes(b.kind)) throw new Error("Pick Claude Code or Codex.");
      const opt = (v: unknown) => (typeof v === "string" && /^[\w.\[\]-]{1,60}$/.test(v) ? v : null);
      if (!compat.shared) throw new Error("The choice couldn't be kept.");
      await compat.shared.set(CHOICE_KEY, withChoice(compat.shared.value(CHOICE_KEY), fresh.id, { agent: b.kind, model: opt(b.model), effort: opt(b.effort), fast: speedOf(opt(b.speed)), perm: opt(b.perm) }));
      return { ok: true, chosen: true };
    }
    const a = chat(b.chat), reader = compat.reader?.(a);
    if (b.type === "restart-info") return compat.agents.info(a, reader);
    if (b.type === "model-menu") return { ok: true, menu: await (compat.agents as any).menu(a, reader) };
    if (!["claude", "codex"].includes(b.kind)) throw new Error("Pick Claude Code or Codex.");
    const opt = (v: unknown) => (typeof v === "string" && /^[\w.\[\]-]{1,60}$/.test(v) ? v : undefined);
    const pick = { kind: b.kind, model: opt(b.model), effort: opt(b.effort), speed: opt(b.speed), perm: opt(b.perm) };
    // the model menu (live): in place when only the model, level or Fast changes; the restart sheet restarts
    if (b.live === true) return { ok: true, ...(await (compat.agents as any).change(a, reader, pick)) };
    const next = await compat.agents.restart(a, reader, pick);
    return { ok: true, terminal: next };
  }
  if (b?.type === "machine-hosts") {
    // Add machine, as the window's (mods/machine-add-chat, core/machine-add.js): the hosts in ~/.ssh/config, and the
    // machines added already (hc machine ls)
    const text = await Bun.file(join(homedir(), ".ssh", "config")).text().catch(() => null);
    return { hosts: MA.parseConfig(text), added: await addedMachines() };
  }
  if (b?.type === "machine-add" && typeof b.target === "string") {
    // another machine by ssh (hc machine add); an added Mac gets its Full Disk Access note
    const target = b.target.trim();
    if (!target || target.startsWith("-") || /\s/.test(target) || target.length > 200) return { error: MA.WORDS.failed };
    const r = await hc(["machine", "add", target, "--json"]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
    const why = MA.failure(r);
    if (!why) {
      const added = await addedMachines();
      const m = added.find((x: any) => x.target === target || x.name === target);
      const mac = m ? await exec(hub, ["sh", "-c", MA.MAC_CHECK], m.name).catch(() => null) : null;
      const [os, core] = (mac?.stdout ?? "").trim().split("\n");
      return { ok: true, added, ...(m && os === "Darwin" ? { mac: { name: m.name, core: core ?? "~/.local/bin/herdr-core" } } : {}) };
    }
    // the window answers it in a small terminal window of its own; the web has none to open, so it gets the window's
    // own fallback for that: the command to copy and run in any terminal
    if (MA.needsTerminal(why)) return { manual: true };
    return { error: why.message || MA.WORDS.failed };
  }
  if (b?.type === "machine-mac-open" && typeof b.machine === "string") {
    // the Mac's Full Disk Access setting, opened on its own screen
    await exec(hub, ["open", MA.MAC_SETTING], b.machine).catch(() => null);
    return { ok: true };
  }
  if (b?.type === "assistant-close" && typeof b.place === "string") {
    // a space's own agent stopped: its Assistant's terminal ends (hc kill); "stop" ends the workers it started first,
    // "keep" lets them finish, "count" only says how many there are
    const key = `p:${b.place.replace("/", ":")}`, a = compat.addrOf(key);
    const t: any = a ? hub.terminals.get(a) : null;
    if (!a || !t) throw new Error("This space has no Assistant running.");
    const workers = [...hub.terminals.values()].filter((x: any) => x.state === "live" && x.parent === a);
    if (b.mode === "count") return { ok: true, workers: workers.length };
    if (b.mode === "stop") for (const w of workers) await hc(["kill", w.address]);
    const r = await hc(["kill", a]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "It didn't stop.");
    return { ok: true };
  }
  if ((b?.type === "held-now" || b?.type === "held-drop") && typeof b.cid === "string") {
    // a queued message (Send now and ×): sent at once, or taken back unsent
    const m = held.find((x) => x.cid === b.cid);
    if (!m) throw new Error("That message has gone in already.");
    if (b.type === "held-drop") held.splice(held.indexOf(m), 1);
    else { m.now = true; drain(); }
    return { ok: true };
  }
  if (b?.type === "space-commit" && typeof b.place === "string" && typeof b.message === "string") {
    // Commit, for the space's folder: everything (git add -A), with the message typed
    const sp = compat.spaceOf(b.place), message = b.message.trim().slice(0, 10_000);
    if (!sp) throw new Error("That space isn't here any more.");
    if (!message) throw new Error("Type a commit message first.");
    const r = await exec(hub, ["sh", "-c", 'cd "$1" && cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "$2"', "commit", sp.folder, message], sp.machine ?? null);
    if (r.code !== 0) throw new Error(`Commit failed: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
    return { ok: true };
  }
  if (b?.type === "space-remove" && typeof b.place === "string" && compat.shared) {
    // Remove a space: gone from the list of spaces (shared "spaces") and from the sidebar's data (its group, icon and
    // place in the order), its Assistant ended. Nothing in its folder is touched.
    const own: any[] = Array.isArray(compat.shared.value("spaces")) ? compat.shared.value("spaces") : [];
    const mine = own.find((x: any) => ownId(x) === b.place);
    if (!mine) throw new Error("That space isn't here any more.");
    // Everything stays (SHEP-296): removed, the service made it again at once, and a Home made by hand was a second
    if (mine === SP.everythingOf(own, HOME)) throw new Error(SP.EVERYTHING_STAYS);
    await compat.shared.set("spaces", own.filter((x: any) => x !== mine));
    const bar = compat.shared.value("spaces-chat") ?? {}, next = withoutSpace(bar, b.place);
    if (next !== bar) await compat.shared.set("spaces-chat", next);
    for (const t of hub.terminals.values()) if (t.state === "live" && t.labels?.["herdr.coordinator.space"] === mine.id && (t.address.includes("/") ? t.address.split("/")[0] : null) === (mine.machine ?? null)) await hc(["kill", t.address]);
    return { ok: true };
  }
  if (b?.type === "rewind" && typeof b.chat === "string" && typeof b.message === "string") {
    // the CLI's own rewind on that message: Claude Code's /rewind lists the prompts newest last (Up
    // once per later prompt); Codex's Esc Esc browses back from the last (Left). Then its terminal shows it.
    const a = chat(b.chat), t: any = hub.terminals.get(a), r = compat.reader?.(a);
    if (t?.status?.state === "working") throw new Error("The agent is working: stop it first, then rewind.");
    const users = (r?.conv?.items ?? []).filter((x: any) => x.kind === "user" && !x.from && !/^\//.test(x.text ?? ""));
    const i = users.findIndex((u: any) => u.id === b.message), back = i < 0 ? 1 : users.length - i;
    if ((kindOf(t) ?? "claude") === "claude") { await hub.send(a, "/rewind"); await Bun.sleep(700); await hc(["keys", a, ...Array(back).fill("up")]); }
    else { await hc(["keys", a, "esc", "esc"]); await Bun.sleep(500); if (back > 1) await hc(["keys", a, ...Array(back - 1).fill("left")]); }
    return { ok: true, terminal: true };
  }
  if (b?.type === "earlier" && typeof b.chat === "string") {
    // the chat scrolled to its top ("Loading earlier…"): the log's page before what it shows
    const current = compat.addrOf(b.chat);
    const reader = current && compat.reader?.(current);
    const history = compat.historyOf(b.chat);
    const prior = history && compat.reader?.(history);
    if (current && reader?.start) await (compat as any).earlier?.(current);
    else if (history && prior?.start) await (compat as any).earlier?.(history);
    return { ok: true };
  }
  if (b?.type === "keys" && typeof b.chat === "string" && Array.isArray(b.keys) && b.keys.length <= 32 && b.keys.every((k: unknown) => typeof k === "string" && k.length <= 40)) {
    const res = await hc(["keys", chat(b.chat), ...b.keys]);
    return { ok: res.code === 0 };
  }
  if (b?.type === "send" && typeof b.chat === "string" && b.chat.startsWith("p:") && !compat.addrOf(b.chat)) return startFresh(hub, b, compat);
  if (b?.type === "send" && typeof b.chat === "string" && b.chat.startsWith("p:")) {
    // a space's Assistant that ended (killed, crashed, exited: SHEP-297): the message starts it again and goes to it,
    // once (the same id asked again gets the same answer: send-once.ts), never to the finished terminal
    const old = compat.addrOf(b.chat)!;
    // SHEP-324: one whose agent exited and left a plain shell (herdr-core lost it, or it quit) is ended too: the words
    // would run there as a shell command
    if (!old.startsWith("log:") && (hub.terminals.get(old)?.state !== "live" || (await hub.front?.(old)) === "shell")) {
      const cid = typeof b.cid === "string" && b.cid ? b.cid.slice(0, 80) : null;
      return cid ? once(cid, () => sendToEnded(hub, b, compat, old)) : sendToEnded(hub, b, compat, old);
    }
  }
  if (b?.type === "send" && typeof b.chat === "string" && b.chat.endsWith("/worker")) {
    // a reply typed into a task whose agent is gone (Done, or stopped): herdr-task starts its agent again in the same
    // thread with the reply, and the task goes back to Working
    const t = compat.taskOf(b.chat.split("/")[0]), a = compat.addrOf(b.chat);
    // (SHEP-324: a plain shell left where its agent was counts as gone: never typed into)
    if (t && (!a || a.startsWith("log:") || hub.terminals.get(a)?.state !== "live" || (await hub.front?.(a)) === "shell")) {
      const text = str(b.text ?? "", 100_000).trim();
      if (!text) throw new Error("Nothing to send.");
      const files = Array.isArray(b.attachments) ? b.attachments.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
      const r = await task(["reply", t.ref, [text, ...files].join("\n\n")], t.folder, t.machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) throw new Error(out?.error || r.stderr.trim().split("\n").pop() || "Its agent didn't start.");
      return { ok: true, started: true, at: Date.now() };
    }
  }
  if (b?.type === "send" && typeof b.chat === "string") {
    // what it replies to (the message by its id) and the tasks it mentions
    const a = chat(b.chat), r = compat.reader?.(a);
    const quoted = typeof b.reply === "string" ? r?.conv?.items?.find((x: any) => x.id === b.reply)?.text ?? null : null;
    const tags = mentionedIn(String(b.text ?? ""), compat.tasksFor(b.chat)).map((x: any) => taskTag(x, x.ref ?? `#${x.id}`)).join("");
    b = { ...b, addr: a, quote: quoted, tags };
  }
  else if (b?.type === "stop" && typeof b.chat === "string" && compat.taskOf(b.chat.split("/")[0])) {
    // Stop on a task pauses its agent, like pressing Esc: it drops what it was doing and waits. herdr-task records
    // that the person stopped it ("Stopped by you"); the next message carries on from there.
    const t = compat.taskOf(b.chat.split("/")[0])!;
    const r = await task(["stop", t.ref], t.folder, t.machine);
    let out: any = null;
    try { out = JSON.parse(r.stdout); } catch {}
    if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "It didn't stop." };
    return { ok: true };
  }
  else if ((b?.type === "stop" || b?.type === "steer") && typeof b.chat === "string") b = { ...b, addr: chat(b.chat) };
  else if (b?.type === "stop-job" && typeof b.chat === "string" && typeof b.job === "string") {
    // Stop on a background shell or watcher (core/bg-jobs.js): its processes end; its CLI then tells the agent
    const r = compat.reader?.(chat(b.chat));
    if (!r || !b.job.startsWith("b:") || !(await r.stopJob(b.job.slice(2)))) throw new Error("It isn't running any more.");
    return { ok: true };
  }
  else if ((b?.type === "close" || b?.type === "delete" || b?.type === "archive" || b?.type === "reopen" || b?.type === "task-resume" || b?.type === "schedule" || b?.type === "task-start" || b?.type === "task-move" || b?.type === "task-rename") && typeof b.chat === "string") {
    // a task's row menu: its chat key is "<task>/worker" (or 2.1's "/Agent")
    const t = compat.taskOf(b.chat.split("/")[0]);
    if (!t) throw new Error("That task isn't here any more.");
    b = { ...b, ref: t.ref, folder: t.folder, machine: t.machine };
  }
  else if ((b?.type === "evidence" || b?.type === "accept") && typeof b.task === "string") {
    const t = compat.taskOf(b.task);
    if (!t) throw new Error("That task isn't here any more.");
    b = { ...b, ref: t.ref, folder: t.folder, machine: t.machine };
  }
  else if (b?.type === "read" && b.chats && typeof b.chats === "object") {
    for (const key of Object.keys(b.chats).slice(0, 20)) { const a = compat.addrOf(key); if (a) await act(hub, { type: "read", addr: a }, compat); }
    return { ok: true };
  }
  // a call started or ended on the page: its audio goes over /api/voice; nothing to keep here
  if (b?.type === "call") return { ok: true };
  if (b?.type === "artifact-delete" && typeof b.artifact === "string") {
    // an artifact deleted from its ⋯, as herdr-artifact rm (it and its versions)
    if (!/^\w[\w.-]{0,119}$/.test(b.artifact)) throw new Error("Not an artifact.");
    const r = await run(["herdr-artifact", "rm", "--json", "--", b.artifact]);
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().split("\n").pop() || "It wasn't deleted." };
    return { ok: true };
  }
  if ((b?.type === "artifact-send" || b?.type === "artifact-note" || b?.type === "artifact-say") && typeof b.artifact === "string" && compat.artifacts) {
    // a recipe's answer or a note on one of its blocks: to the agent that keeps the artifact
    const text = str(b.text ?? b.note, 4000).trim();
    if (!text) throw new Error("Nothing to send.");
    return compat.artifacts.say(str(b.artifact, 100), Number(b.v) || 1, text, typeof b.target === "string" ? b.target.slice(0, 300) : undefined);
  }
  switch (b?.type) {
    case "send": {
      // one page's send asked again (its answer lost on the way, a reload, Retry): the same one, never twice
      const cid = typeof b.cid === "string" && b.cid ? b.cid.slice(0, 80) : null;
      if (!cid) return sendNow(hub, b, compat);
      return once(cid, async (again) => (typeof b.was === "string" && arrived(b, compat)) || sendNow(hub, b, compat, again));
    }
    case "steer": {
      // Send now on a message in Claude Code's own queue (#662): its Ctrl+Enter, only while its screen offers it
      const a = addr(b.addr), t = hub.terminals.get(a);
      if (!t || t.state !== "live") throw new Error("That agent isn't running.");
      const io = { hc: asPerson(hub), sleep: (ms: number) => Bun.sleep(ms), status: () => (hub.terminals.get(a) as any)?.status?.state ?? null };
      if (!(await steerNow(io, a))) throw new Error(WORDS.notNow);
      return { ok: true };
    }
    case "stop": {
      const r = await hc(["interrupt", addr(b.addr)]);
      return { ok: r.code === 0 };
    }
    case "read": {
      const a = addr(b.addr), t: any = hub.terminals.get(a);
      if (!t || t.labels?.["herdr.role"] !== "coordinator" || !(t.turn > 0)) return { ok: true };
      const r = await hc(["label", a, `${READ}=${t.turn}`]);
      return { ok: r.code === 0 };
    }
    case "evidence": {
      const { ref, folder, machine } = taskOf(b);
      const r = await task(["show", ref, "--evidence"], folder, machine);
      if (r.code !== 0) throw new Error(r.stderr.trim() || "herdr-task show failed");
      return JSON.parse(r.stdout);
    }
    case "accept": {
      const { ref, folder, machine } = taskOf(b);
      const r = await task(["accept", ref], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) throw new Error(out?.error || r.stderr.trim() || "herdr-task accept failed");
      return out ?? { ok: true };
    }
    case "task-resume": {
      // an ended task's Resume: herdr-task starts its agent again on its session
      const { ref, folder, machine } = taskOf(b);
      const r = await task(["resume", ref], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error || !out?.terminal) throw new Error(out?.error || r.stderr.trim().split("\n").pop() || "Its agent didn't start.");
      return { ok: true, terminal: out.terminal };
    }
    // a task's Start later (SHEP-38): herdr-task schedules it, takes that back, or starts it now; its words refused come back
    case "schedule": {
      const { ref, folder, machine } = taskOf(b);
      const args = b.now ? ["start", ref, "--now"] : b.off ? ["edit", ref, "--at", ""]
        : typeof b.in === "string" ? ["edit", ref, "--in", str(b.in, 80)] : ["edit", ref, "--at", str(b.at, 80)];
      const r = await task(args, folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "herdr-task refused it." };
      return { ok: true, why: out?.why ?? null };
    }
    // the person's own calls on a task, as herdr-task makes them: done, removed, or back from the archive
    // Start task, from the dialog of one not started yet: on the agent picked there
    case "task-start": {
      const { ref, folder, machine } = taskOf(b);
      const p = b.agent && typeof b.agent === "object" ? b.agent : {};
      const word = (v: unknown) => (typeof v === "string" && /^[\w.\[\]:/-]{1,80}$/.test(v) ? v : null);
      const args = ["start", ref, ...(word(p.agent) ? ["--agent", word(p.agent)!] : []), ...(word(p.model) ? ["--model", word(p.model)!] : []), ...(word(p.effort) ? ["--effort", word(p.effort)!] : []),
        ...(p.fast ? ["--speed", p.fast === "ultrafast" ? "ultrafast" : "fast"] : []), ...(word(p.perm) ? ["--permission", word(p.perm)!] : [])];
      const r = await task(args, folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "It didn't start." };
      return { ok: true };
    }
    case "task-rename": {
      const { ref, folder, machine } = taskOf(b);
      const r = await task(["edit", ref, "--title", str(b.name, 200).trim()], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "It wasn't renamed." };
      return { ok: true };
    }
    // Move to another space: only before the task has started, and on the same machine
    case "task-move": {
      const { ref, folder, machine } = taskOf(b);
      const to = compat.spaceOf(str(b.place, 200));
      if (!to) throw new Error("That space isn't here any more.");
      if ((to.machine ?? null) !== (machine ?? null)) return { ok: false, error: "A task can move to a space on the same machine. For another machine, ask in that space's chat to add it there." };
      const bare = to.id.slice(to.id.lastIndexOf("/") + 1);
      const r = await task(["edit", ref, "--space", bare, ...(to.folder !== folder ? ["--move-to", to.folder] : [])], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "It didn't move." };
      return { ok: true };
    }
    case "close": case "delete": case "archive": case "reopen": {
      const { ref, folder, machine } = taskOf(b);
      // archiving takes it out of the list without deleting it; Mark as done from the menu closes it without merging
      const r = await task([b.type === "close" ? "done" : b.type === "delete" ? "rm" : b.type === "reopen" ? "reopen" : b.on === false ? "unarchive" : "archive", ref], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "herdr-task refused it." };
      return { ok: true };
    }
  }
  // an action this service doesn't answer (yet): said plainly
  throw new Error("Shepherdr can't do that yet.");
}
