// What a web page may do, each the same way the window does it (the shared core, hc and herdr-task): send the
// person's words to an agent, stop it, mark an Assistant read, accept a Ready task, read a task's evidence.
// Anything else is refused. Inputs are checked here; commands run with argument lists, never a shell line.
import type { Hub } from "./hub.ts";
import { sendBody, messageBody, refusal } from "../core/send.js";
import { kindOf } from "../core/chat-reader.js";
import { READ } from "../core/spaces.js";
import type { Compat } from "./compat.ts";

const ADDR = /^([\w.-]+\/)?t[0-9a-z]+$/;
const REF = /^[A-Z][A-Z0-9]*-\d+$/;
const MACHINE = /^[\w.-]+$/;

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
      note: typeof b.note === "string" ? b.note.slice(0, 4000) : undefined, other: typeof b.other === "string" ? b.other.slice(0, 4000) : undefined });
    return { ok: true };
  }
  if (b?.type === "send" && typeof b.chat === "string") b = { ...b, addr: chat(b.chat), quote: b.replyText ?? null };
  else if (b?.type === "stop" && typeof b.chat === "string") b = { ...b, addr: chat(b.chat) };
  else if ((b?.type === "evidence" || b?.type === "accept") && typeof b.task === "string") {
    const t = compat.taskOf(b.task);
    if (!t) throw new Error("That task isn't here any more.");
    b = { ...b, ref: t.ref, folder: t.folder, machine: t.machine };
  }
  else if (b?.type === "read" && b.chats && typeof b.chats === "object") {
    for (const key of Object.keys(b.chats).slice(0, 20)) { const a = compat.addrOf(key); if (a) await act(hub, { type: "read", addr: a }, compat); }
    return { ok: true };
  }
  switch (b?.type) {
    case "send": {
      const a = addr(b.addr);
      const text = str(b.text).trim();
      if (!text) throw new Error("nothing to send");
      const t = hub.terminals.get(a);
      if (!t || t.state !== "live") throw new Error("That agent isn't running.");
      const io = { hc, sleep: (ms: number) => Bun.sleep(ms), status: () => (hub.terminals.get(a) as any)?.status?.state ?? null };
      const body = messageBody({ text, quote: typeof b.quote === "string" ? b.quote.slice(0, 2000) : null });
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
  }
  throw new Error("unknown action");
}
