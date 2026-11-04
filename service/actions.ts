// What a web page may do, each the same way the window does it (the shared core, hc and herdr-task): send the
// person's words to an agent, stop it, mark an Assistant read, accept a Ready task, read a task's evidence.
// Anything else is refused. Inputs are checked here; commands run with argument lists, never a shell line.
import type { Hub } from "./hub.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { sendBody, messageBody, refusal, reactionLine, mentionedIn, taskTag } from "../core/send.js";
import { kindOf } from "../core/chat-reader.js";
import * as AGa from "../core/agents.js";
const { sessionOf, forkArgv } = AGa as any;
import * as SP from "../core/spaces.js";
const { READ, withMove, withSection, withoutSection, withSectionName, withIcon } = SP as any;
import type { Compat } from "./compat.ts";
import { worktreeAct } from "./worktrees.ts";

const APP = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
const ATTACH = join(process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app"), "data", "chat-attach");
const ADDR = /^([\w.-]+\/)?t[0-9a-z]+$/;
const REF = /^[A-Z][A-Z0-9]*-\d+$/;
const MACHINE = /^[\w.-]+$/;

// Messages held until their agent is free, sent in order, each once.
const held: { addr: string; kind: string; body: string; hub: Hub }[] = [];
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
        if (alive && (st === "working" || st === "blocked")) continue;
        const i = held.indexOf(m);
        if (i < 0) continue;
        held.splice(i, 1);
        if (alive) await sendBody({ hc, sleep: (ms: number) => Bun.sleep(ms), status: () => (m.hub.terminals.get(m.addr) as any)?.status?.state ?? null }, m.addr, m.kind, m.body).catch(() => null);
      }
    } finally {
      busy = false;
    }
    if (!held.length && draining) { clearInterval(draining); draining = null; }
  }, 1000);
}

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

export const hc = (args: string[]) => run([process.env.SHEPHERDR_HC || "hc", ...args]);
const task = (args: string[], folder: string, machine: string | null) =>
  run(["herdr-task", ...(machine ? ["--on", machine] : []), ...args, "--folder", folder, "--json"]);

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

export async function act(hub: Hub, b: any, compat: Compat): Promise<unknown> {
  // 2.1's screen names a chat by its key (compat.ts): its terminal here.
  const chat = (key: unknown) => {
    const a = typeof key === "string" ? compat.addrOf(key) : null;
    if (!a) throw new Error("That chat isn't here any more.");
    return a;
  };
  if (b?.type === "answer" && typeof b.question === "string") {
    // a hook ask's card (its id is the request's): answered as the window's card answers it
    if (!compat.asks) throw new Error("No questions here.");
    (compat.asks as any).answer(str(b.question, 200), { choice: typeof b.choice === "number" ? b.choice : undefined,
      choices: Array.isArray(b.choices) ? b.choices.filter((n: unknown) => typeof n === "number") : undefined,
      note: typeof b.note === "string" ? b.note.slice(0, 4000) : undefined, other: typeof b.other === "string" ? b.other.slice(0, 4000) : undefined,
      answers: Array.isArray(b.answers) ? b.answers.slice(0, 20).map((x: unknown) => String(x ?? "").slice(0, 4000)) : undefined });
    return { ok: true };
  }
  if (b?.type === "react" && typeof b.chat === "string" && typeof b.message === "string" && typeof b.emoji === "string" && b.emoji.length <= 16) {
    // a reaction toggles, as the window's: added unless it is yours already; the agent reads the core's reaction line
    const a = chat(b.chat), r = compat.reader?.(a);
    const item = r?.conv?.items?.find((x: any) => x.id === b.message);
    if (!item?.text) throw new Error("That message isn't in the chat any more.");
    const mine = (r.conv.reactions.get(b.message) ?? []).some((x: any) => x.by === "you" && x.emoji === b.emoji);
    if ((hub.terminals.get(a) as any)?.status?.state === "blocked") throw new Error("It's asking you something: answer that first.");
    const res = await hc(["send", a, reactionLine(b.emoji, item.text, !mine)]);
    if (res.code !== 0) throw new Error(refusal(res).message);
    return { ok: true };
  }
  // the person's shared choices (pins, the sidebar, icons): in the service's document, in the window's own format
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
    const to = b.to === "pinned" ? "pinned" : sec(b.to);
    await sh.set("spaces-chat", withMove(bar(), b.id, to, typeof b.before === "string" ? b.before : null));
    return { ok: true };
  }
  if (b?.type === "order" && sh && typeof b.under === "string" && Array.isArray(b.ids)) {
    // a dragged sidebar list, kept where the window keeps it: Pinned's and each section's spaces, and the sections'
    // order, in the shared sidebar data; a machine's own spaces in the window's order (space.move)
    const ids = b.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) as string[];
    const d = structuredClone(bar());
    d.sections ??= []; d.pinned ??= [];
    const same = (a: string[], c: string[]) => a.length === c.length && a.every((x) => c.includes(x));
    if (b.under === "pinned") { if (!same(ids, d.pinned)) throw new Error("Pinned changed meanwhile."); d.pinned = ids; }
    else if (sec(b.under)) {
      const x = d.sections.find((y: any) => y.id === sec(b.under));
      if (!x || !same(ids, x.spaces ?? [])) throw new Error("That section changed meanwhile.");
      x.spaces = ids;
    } else if (b.under === "sections" || b.under.startsWith("sections:")) {
      // the sections at the top (Pinned among them, which isn't one of the data's) or a machine's: their new order
      const order = ids.map(sec).filter(Boolean) as string[];
      d.sections = [...order.map((id) => d.sections.find((y: any) => y.id === id)).filter(Boolean), ...d.sections.filter((y: any) => !order.includes(y.id))];
    } else if (b.under.startsWith("m:")) {
      for (const [i, id] of ids.entries()) {
        const r = await run(["herdr-app", "do", "space.move", "--id", id, "--index", String(i + 1)]);
        if (r.code !== 0) throw new Error("Moving spaces needs the Herdr window open.");
      }
      return { ok: true };
    } else throw new Error("Machines keep their order: drag spaces and sections instead.");
    await sh.set("spaces-chat", d);
    return { ok: true };
  }
  if (b?.type === "section" && sh) {
    if (b.op === "new" && typeof b.name === "string" && b.name.trim()) {
      const machine = typeof b.machine === "string" && b.machine !== compat.host ? b.machine : null;
      await sh.set("spaces-chat", withSection(bar(), { id: `sec-${Date.now().toString(36)}`, name: b.name.trim().slice(0, 60), machine, icon: typeof b.emoji === "string" ? b.emoji.slice(0, 16) : null }));
      return { ok: true };
    }
    if (b.op === "delete" && sec(b.id)) { await sh.set("spaces-chat", withoutSection(bar(), sec(b.id))); return { ok: true }; }
  }
  if (b?.type === "rename" && typeof b.id === "string" && typeof b.name === "string" && sh) {
    const name = b.name.trim().slice(0, 80);
    const icon = typeof b.emoji === "string" ? b.emoji.slice(0, 16) || null : undefined;
    if (sec(b.id)) { await sh.set("spaces-chat", withSectionName(bar(), sec(b.id), name, icon)); return { ok: true }; }
    // a space: its icon is ours; its name is Herdr's (the window renames it, when it runs)
    if (icon !== undefined) await sh.set("spaces-chat", withIcon(bar(), b.id, icon));
    if (name) {
      const r = await run(["herdr-app", "do", "space.rename", "--id", b.id, "--name", name]);
      if (r.code !== 0) throw new Error("Renaming a space needs the Herdr window open.");
    }
    return { ok: true };
  }
  if (b?.type === "mode" && typeof b.place === "string" && (b.mode === "autopilot" || b.mode === "regular")) {
    // Autopilot: herdr-task's, per space on this machine (a plain switch, as the window's header)
    if (b.place.includes("/")) throw new Error("Autopilot is set on that space's own machine.");
    const r = await run(["herdr-task", "autopilot", b.mode === "autopilot" ? "on" : "off", "--space", b.place, "--json"]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "Autopilot didn't change.");
    return { ok: true };
  }
  if ((b?.type === "restart-info" || b?.type === "restart") && typeof b.chat === "string" && compat.agents) {
    // the model menu: what it runs on and its choices; a restart on another model, effort, speed or CLI
    const a = chat(b.chat), reader = compat.reader?.(a);
    if (b.type === "restart-info") return compat.agents.info(a, reader);
    if (!["claude", "codex"].includes(b.kind)) throw new Error("Pick Claude Code or Codex.");
    const opt = (v: unknown) => (typeof v === "string" && /^[\w.\[\]-]{1,60}$/.test(v) ? v : undefined);
    const next = await compat.agents.restart(a, reader, { kind: b.kind, model: opt(b.model), effort: opt(b.effort), speed: opt(b.speed) });
    return { ok: true, terminal: next };
  }
  if (b?.type === "machine-add" && typeof b.target === "string") {
    // another machine by ssh (hc machine add); one that asks something once (a password, a new host key) needs a terminal
    const target = b.target.trim();
    if (!/^[\w.@:-]{1,200}$/.test(target)) throw new Error("A host, like vps or me@10.0.0.7.");
    const r = await run(["hc", "machine", "add", target, "--install", "--json"]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || `Couldn't reach ${target}: add it once in a terminal (hc machine add ${target}).`);
    return { ok: true };
  }
  if (b?.type === "worktree" && typeof b.place === "string" && compat.shared) {
    const sp = compat.spaceOf(b.place);
    if (!sp) throw new Error("That space isn't here any more.");
    return worktreeAct(hub, sp, b, compat.shared, () => act(hub, { type: "space-remove", place: b.place }, compat).catch(() => null));
  }
  if (b?.type === "assistant-close" && typeof b.place === "string") {
    // 3.0's Close Assistant: its tab closes; "stop" ends the workers it started first, "keep" lets them finish
    const key = `p:${b.place.replace("/", ":")}`, a = compat.addrOf(key);
    const t: any = a ? hub.terminals.get(a) : null;
    if (!t) throw new Error("This space has no Assistant running.");
    const workers = [...hub.terminals.values()].filter((x: any) => x.state === "live" && x.parent === a).length;
    if (b.mode === "count") return { ok: true, workers };
    const tab = t.labels?.["herdr.coordinator.tab"];
    const script = join(APP, "mods", "coordinator", "close.sh");
    if (!tab || !existsSync(script)) throw new Error("Closing an Assistant needs Shepherdr's window layout installed.");
    const r = await run(["bash", script, tab, a!, b.mode === "stop" ? "stop" : "keep"]);
    if (r.code !== 0) throw new Error("It didn't close: the Herdr window needs to be open.");
    return { ok: true };
  }
  if (b?.type === "space-remove" && typeof b.place === "string" && compat.shared) {
    // Close a space: the window closes its own (herdr-app do space.close); the service forgets one of its own and ends its Assistant
    const own = Array.isArray(compat.shared.value("spaces")) ? compat.shared.value("spaces") : [];
    const mine = own.find((x: any) => (x.machine ? `${x.machine}/${x.id}` : x.id) === b.place);
    if (mine) {
      await compat.shared.set("spaces", own.filter((x: any) => x !== mine));
      for (const t of hub.terminals.values()) if (t.labels?.["herdr.coordinator.space"] === mine.id && (t.address.includes("/") ? t.address.split("/")[0] : null) === (mine.machine ?? null)) await hc(["kill", t.address]);
      return { ok: true };
    }
    const r = await run(["herdr-app", "do", "space.close", "--id", b.place, "--confirmed", "true"]);
    if (r.code !== 0) throw new Error("Closing a space needs the Herdr window open.");
    return { ok: true };
  }
  if (b?.type === "rewind" && typeof b.chat === "string" && typeof b.message === "string") {
    // the CLI's own rewind on that message, as the window's: Claude Code's /rewind lists the prompts newest last (Up
    // once per later prompt); Codex's Esc Esc browses back from the last (Left). Then its terminal shows it.
    const a = chat(b.chat), t: any = hub.terminals.get(a), r = compat.reader?.(a);
    if (t?.status?.state === "working") throw new Error("The agent is working: stop it first, then rewind.");
    const users = (r?.conv?.items ?? []).filter((x: any) => x.kind === "user" && !x.from && !/^\//.test(x.text ?? ""));
    const i = users.findIndex((u: any) => u.id === b.message), back = i < 0 ? 1 : users.length - i;
    if ((kindOf(t) ?? "claude") === "claude") { await hc(["send", a, "/rewind"]); await Bun.sleep(700); await hc(["keys", a, ...Array(back).fill("up")]); }
    else { await hc(["keys", a, "esc", "esc"]); await Bun.sleep(500); if (back > 1) await hc(["keys", a, ...Array(back - 1).fill("left")]); }
    return { ok: true, terminal: true };
  }
  if (b?.type === "fork" && typeof b.chat === "string") {
    // a copy of the conversation in a new tab of its space, through the CLI's own fork (the window makes the tab)
    const a = chat(b.chat), t: any = hub.terminals.get(a), r = compat.reader?.(a);
    const kind = kindOf(t) ?? "claude", session = sessionOf(kind, r?.path ?? null);
    if (!session) throw new Error("This conversation has no saved session to fork.");
    const space = ["herdr.space", "herdr.task.space", "herdr.coordinator.space"].map((k) => t?.labels?.[k]).find(Boolean);
    const res = await run(["herdr-app", "do", "tab.new", ...(space ? ["--space", space] : []), "--folder", t?.foreground?.cwd ?? t?.cwd ?? "", "--argv", JSON.stringify(forkArgv(kind, t?.foreground?.argv ?? t?.argv ?? [], session))]);
    if (res.code !== 0) throw new Error("A fork opens as a tab in the Herdr window: it needs the window open.");
    return { ok: true };
  }
  if (b?.type === "keys" && typeof b.chat === "string" && Array.isArray(b.keys) && b.keys.length <= 32 && b.keys.every((k: unknown) => typeof k === "string" && k.length <= 40)) {
    const res = await hc(["keys", chat(b.chat), ...b.keys]);
    return { ok: res.code === 0 };
  }
  if (b?.type === "send" && typeof b.chat === "string") {
    // what it replies to (2.1 names the message by id) and the tasks it mentions, as the window's chat sends them
    const a = chat(b.chat), r = compat.reader?.(a);
    const quoted = typeof b.reply === "string" ? r?.conv?.items?.find((x: any) => x.id === b.reply)?.text ?? null : null;
    const tags = mentionedIn(String(b.text ?? ""), compat.tasksFor(b.chat)).map((x: any) => taskTag(x, x.ref ?? `#${x.id}`)).join("");
    b = { ...b, addr: a, quote: quoted, tags };
  }
  else if (b?.type === "stop" && typeof b.chat === "string") b = { ...b, addr: chat(b.chat) };
  else if ((b?.type === "close" || b?.type === "delete" || b?.type === "archive") && typeof b.chat === "string") {
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
    if (!/^[\w.-]{1,120}$/.test(b.artifact)) throw new Error("Not an artifact.");
    const r = await run(["herdr-artifact", "rm", b.artifact, "--json"]);
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
      const a = addr(b.addr);
      const text = str(b.text ?? "").trim();
      if (!text && !(Array.isArray(b.attachments) && b.attachments.length)) throw new Error("nothing to send");
      const t = hub.terminals.get(a);
      if (!t || t.state !== "live") throw new Error("That agent isn't running.");
      const io = { hc, sleep: (ms: number) => Bun.sleep(ms), status: () => (hub.terminals.get(a) as any)?.status?.state ?? null };
      // files sent with it: their paths after the words, as the window's chat sends them (copied first to another machine)
      const files: string[] = [];
      for (const p of Array.isArray(b.attachments) ? b.attachments.slice(0, 20) : []) {
        if (typeof p !== "string" || !p.startsWith(ATTACH + "/") || p.includes("/../")) throw new Error("That file isn't one sent from here.");
        if (!a.includes("/")) { files.push(p); continue; }
        const put = await hc(["put", a, p, "--json"]);
        let landed: string | null = null;
        try { landed = JSON.parse(put.stdout || "{}").path ?? null; } catch {}
        if (put.code !== 0 || !landed) throw new Error("A file didn't reach that machine.");
        files.push(landed);
      }
      const body = [messageBody({ text, quote: typeof b.quote === "string" ? b.quote.slice(0, 2000) : null, tags: typeof b.tags === "string" ? b.tags : "" }), ...files].filter(Boolean).join("\n\n");
      // held on purpose (Ctrl+Enter, a long press): it goes once the agent stops working
      const st = (hub.terminals.get(a) as any)?.status?.state;
      if (b.hold && (st === "working" || st === "blocked")) { held.push({ addr: a, kind: kindOf(t) ?? "", body, hub }); drain(); return { ok: true, waiting: true, waitsFor: "turn" }; }
      const r = await sendBody(io, a, kindOf(t) ?? "", body);
      if (r.code !== 0) throw new Error(refusal(r).message);
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
    // the person's own calls on a task, as herdr-task makes them: done, removed, or back from the archive
    case "close": case "delete": case "archive": {
      if (b.type === "archive" && b.on !== false) throw new Error("Done tasks archive themselves: Settings › Tasks › Archive Done after.");
      const { ref, folder, machine } = taskOf(b);
      const r = await task([b.type === "close" ? "done" : b.type === "delete" ? "rm" : "unarchive", ref], folder, machine);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || out?.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "herdr-task refused it." };
      return { ok: true };
    }
  }
  // 2.1 has more buttons than this service answers yet: they say so plainly
  throw new Error("Not on the web yet: use the Herdr window for this.");
}
