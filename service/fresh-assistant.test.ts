// SHEP-263: a space's Assistant that hasn't started. The web app's chat box said "Claude Code · Not known yet" for a
// space whose Assistant Settings set to Codex's GPT-6.2 Sol on Ultrafast; nothing told the page what the first message
// would start, and its model menu had nothing to change. Now the service sends a fresh chat for it (what it starts on,
// with its CLI), the model menu changes that choice (kept where the window's chat keeps its own), and the first
// message starts it on the choice. Around it: Settings changed outside the service reach it (the watcher waited for
// the file's old name, so a start could run on stale settings: Fast where Settings said Ultrafast), and a CLI held on
// its own start screen (Codex's "Update available", "Hooks need review") is an empty chat with that screen's card,
// not "Can't find this conversation".
// A hub whose machine.exec runs here with HOME a throwaway: its ~/.codex names the models, its templates folder
// holds the Assistant's, and PATH has stand-in CLIs. hc is a script that records what it was asked to run.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "./agents.ts";
import { Compat } from "./compat.ts";
import { Live, FRESH_AFTER_MS } from "./live.ts";
import { act } from "./actions.ts";
import { ChatReader } from "../core/chat-reader.js";
import * as AG from "../core/agents.js";
const { CHOICE_KEY, choiceOf } = AG as any;

const home = mkdtempSync(join(tmpdir(), "shep-fresh-")), bin = join(home, "bin"), tpl = join(home, ".config", "herdr-core", "templates");
mkdirSync(bin); mkdirSync(tpl, { recursive: true }); mkdirSync(join(home, ".codex"));
writeFileSync(join(tpl, "assistant.md"), "---\nname: assistant\ndescription: The Assistant\ncommand: claude\n---\nYou are the Assistant.\n");
for (const c of ["claude", "codex"]) { writeFileSync(join(bin, c), "#!/bin/sh\n"); chmodSync(join(bin, c), 0o755); }
// Codex's own model list, as its models_cache.json has it: Sol takes Fast and Ultrafast, Luna only Fast
writeFileSync(join(home, ".codex", "models_cache.json"), JSON.stringify({ models: [
  { slug: "gpt-6.2-sol", display_name: "GPT-6.2 Sol", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], default_reasoning_level: "medium", service_tiers: [{ id: "fast" }, { id: "ultrafast" }] },
  { slug: "gpt-6-luna", display_name: "GPT-6 Luna", supported_reasoning_levels: [{ effort: "low" }], default_reasoning_level: "low", service_tiers: [{ id: "fast" }] },
] }));
// hc: `run` answers as herdr-core does and keeps its arguments and the one-off template it was given
const ran = join(home, "ran.json"), hcFile = join(bin, "hc");
writeFileSync(hcFile, `#!/bin/sh
if [ "$1" = run ]; then
  for a; do last2="$last"; last="$a"; done
  node -e 'const fs=require("fs");const [out,dir,name,...args]=process.argv.slice(1);let t="";try{t=fs.readFileSync(dir+"/"+name+".md","utf8")}catch{};fs.writeFileSync(out,JSON.stringify({args,template:t}))' "${ran}" "${tpl}" "$last2" "$@"
  echo '{"address":"t9","first_message":{"sent":true}}'
fi
exit 0
`, { mode: 0o755 });
const hcWas = process.env.SHEPHERDR_HC;
process.env.SHEPHERDR_HC = hcFile;
afterAll(() => { if (hcWas === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = hcWas; });

const hub: any = {
  terminals: new Map(),
  on: () => () => {},
  call: async (method: string, a: { argv: string[] }) => {
    if (method !== "machine.exec") throw new Error(`no ${method} here`);
    const argv = a.argv.map((x) => x.replace(":/opt/homebrew/bin:/usr/local/bin", ""));
    const p = Bun.spawnSync(argv, { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
    const b64 = (x: Uint8Array) => Buffer.from(x).toString("base64");
    return { code: p.exitCode, stdout: b64(p.stdout), stderr: b64(p.stderr) };
  },
};
const SOL = { agent: "codex", model: "gpt-6.2-sol", effort: null, fast: "ultrafast", perm: "full" };

/** a compat with one space, no Assistant in it, whose Settings choose `settings` for its Assistant; its shared
 *  document is a plain object */
function world(settings: any = SOL) {
  const doc: Record<string, any> = {};
  const compat = new Compat() as any;
  compat.agents = new Agents(hub);
  compat.shared = { value: (k: string) => doc[k], set: async (k: string, v: unknown) => { doc[k] = v; } };
  compat.assistantPick = (space: string) => choiceOf(doc[CHOICE_KEY], space) ?? settings;
  compat.spaceList = [{ id: "sp1", machine: null, folder: home, assistant: null }];
  return { compat: compat as Compat & Record<string, any>, doc };
}

test("before its first message the chat says what Settings will start it on: Codex's model, its level, Ultrafast", async () => {
  const { compat } = world();
  // what the machine's CLIs offer is read once in the background: the first answer is the pick as it is
  expect(compat.freshChat("p:sp1")).toMatchObject({ key: "p:sp1", fresh: true, cli: "codex", messages: [], agent: { kind: "codex" } });
  await compat.agents.freshMenu(null, SOL);
  const chat = compat.freshChat("p:sp1");
  expect(chat.agent.words).toBe("GPT-6.2 Sol · Medium · Ultrafast");
  expect(chat.agent.planned).toEqual({ model: "gpt-6.2-sol", modelLabel: "GPT-6.2 Sol", effort: "medium" });
  expect(chat.cli).toBe("codex");
});

test("no Settings choice: the CLI's own default, never 'Not known yet'; a space whose Assistant runs has no fresh chat", async () => {
  const { compat } = world(null);
  await compat.agents.freshMenu(null, null);
  const chat = compat.freshChat("p:sp1");
  expect(chat.cli).toBe("claude");
  expect(chat.agent.words).toMatch(/^Opus /);
  compat.spaceList = [{ id: "sp1", machine: null, folder: home, assistant: "t1" }];
  expect(compat.freshChat("p:sp1")).toBeNull();
  expect(compat.freshChat("p:gone")).toBeNull();
});

test("the model menu opens on that choice, and a pick only changes it: kept for the space, said on the button", async () => {
  const { compat, doc } = world();
  const r: any = await act(hub, { type: "model-menu", chat: "p:sp1" }, compat);
  expect(r.menu.fresh).toBe(true);
  expect(r.menu.current).toEqual({ agent: "codex", model: "gpt-6.2-sol", effort: null, fast: "ultrafast", perm: "full" });
  expect(r.menu.menus.codex.models.find((m: any) => m.id === "gpt-6.2-sol")).toMatchObject({ fast: true, ultrafast: true });
  // Luna on Fast, picked in the menu
  expect(await act(hub, { type: "restart", chat: "p:sp1", kind: "codex", model: "gpt-6-luna", effort: "low", speed: "fast", perm: "auto" }, compat)).toEqual({ ok: true, chosen: true });
  expect(choiceOf(doc[CHOICE_KEY], "sp1")).toEqual({ agent: "codex", model: "gpt-6-luna", effort: "low", fast: true, perm: "auto" });
  expect(compat.freshChat("p:sp1").agent.words).toBe("GPT-6 Luna · Low · Fast");
  // and the menu opens on it the next time
  expect(((await act(hub, { type: "model-menu", chat: "p:sp1" }, compat)) as any).menu.current.model).toBe("gpt-6-luna");
});

test("the first message starts it on the choice (Codex, its model, service_tier ultrafast), then forgets the choice", async () => {
  const { compat, doc } = world({ agent: "claude", model: "opus", effort: null, fast: false, perm: "manual" });
  // the window's chat (or the web's menu) chose Sol on Ultrafast for this space before the first message
  doc[CHOICE_KEY] = { sp1: { ...SOL, at: 5 } };
  expect(await act(hub, { type: "send", chat: "p:sp1", text: "hello" }, compat)).toEqual({ ok: true, started: true });
  const { args, template } = JSON.parse(readFileSync(ran, "utf8"));
  expect(args.slice(0, 2)).toEqual(["run", "--bg"]);
  expect(args).toContain("herdr.role=coordinator");
  expect(args.at(-1)).toBe("hello");
  const command = /^command:(.*)$/m.exec(template)?.[1] ?? "";
  expect(command).toContain("exec codex --no-daemon -m gpt-6.2-sol");
  expect(command).toContain(`service_tier="ultrafast"`);
  expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(command).not.toContain(`service_tier="fast"`);
  await Bun.sleep(20);
  expect(choiceOf(doc[CHOICE_KEY], "sp1")).toBeNull();
});

test("a page with the chat open is sent the fresh chat, again only when it changed, and not the moment an Assistant goes", async () => {
  const { compat, doc } = world();
  await compat.agents.freshMenu(null, SOL);
  const store: any = { on: () => () => {}, load: async () => ({ version: 1, value: {} }), doc: { version: 1, value: {} } };
  const live = new Live(hub, store, () => null, "0.0.0");
  live.compat = compat;
  live.chats = { watch: () => {}, unwatch: () => {} } as any;
  const got: any[] = [];
  const ws: any = { data: { who: "me" }, readyState: 1, getBufferedAmount: () => 0, send: (t: string) => { const m = JSON.parse(t); if (m.type === "chat") got.push(m.chat); }, close: () => {} };
  live.join(ws);
  live.message(ws, JSON.stringify({ type: "watch", chats: ["p:sp1"] }));
  expect(got.map((c) => c.agent.words)).toEqual(["GPT-6.2 Sol · Medium · Ultrafast"]);
  live.refresh();
  expect(got.length).toBe(1);
  doc[CHOICE_KEY] = { sp1: { agent: "codex", model: "gpt-6-luna", effort: null, fast: false, perm: "auto", at: 9 } };
  live.refresh();
  expect(got.map((c) => c.agent.words)).toEqual(["GPT-6.2 Sol · Medium · Ultrafast", "GPT-6 Luna · Low"]);
  // its Assistant runs: the real chat's turn, no fresh one
  compat.chats = new Map([["p:sp1", "t1"]]);
  compat.spaceList = [{ id: "sp1", machine: null, folder: home, assistant: "t1" }];
  live.refresh();
  // it goes (a restart starts another in a moment): nothing is said until it has stayed gone
  compat.chats = new Map();
  compat.spaceList = [{ id: "sp1", machine: null, folder: home, assistant: null }];
  live.refresh();
  expect(got.length).toBe(2);
  await Bun.sleep(FRESH_AFTER_MS + 300);
  expect(got.length).toBe(3);
  live.leave(ws);
}, 15_000);

test("Settings changed outside the service (the window's Settings) are what the next start runs on", async () => {
  // the file by the name it really has: the watcher waited for "shepherdr.json", its name before the move
  const file = join(mkdtempSync(join(tmpdir(), "shep-fresh-settings-")), "settings.json");
  const write = (fast: unknown) => writeFileSync(file, JSON.stringify({ version: 1, spaces: { sp1: { coordinator: { ...SOL, fast } } } }));
  write(true);
  const was = process.env.HERDR_TASK_SETTINGS;
  process.env.HERDR_TASK_SETTINGS = file;
  try {
    const { Settings } = await import("./settings.ts");
    const s = new Settings();
    s.start();
    let told = 0;
    s.on(() => { told++; });
    expect(s.role("sp1", "coordinator").fast).toBe(true);
    write("ultrafast");
    // (a clock that didn't tick between the two writes: the file's time says it changed all the same)
    utimesSync(file, new Date(), new Date(Date.now() + 2000));
    expect(s.role("sp1", "coordinator").fast).toBe("ultrafast");
    write(false);
    for (let i = 0; i < 40 && told < 2; i++) await Bun.sleep(50);
    // heard through the watcher too (the snapshot's Settings pages follow)
    expect(told).toBeGreaterThanOrEqual(2);
  } finally {
    if (was === undefined) delete process.env.HERDR_TASK_SETTINGS; else process.env.HERDR_TASK_SETTINGS = was;
  }
});

test("a CLI held on its own start screen is an empty chat (its card shows), not 'Can't find this conversation'", async () => {
  const io = { sh: async () => ({ code: 0, stdout: "" }) };
  // Codex on "Update available" or "Hooks need review": live, no report yet, no turn, no session log open
  const held = { address: "t1", state: "live", status: null, turn: 0, foreground: { name: "codex", pid: 4242 } };
  const r: any = new ChatReader(io, "t1");
  await r.locate(held);
  expect(r.state).toBe("pending");
  expect(r.conv).toBeTruthy();
  const { compat } = world();
  const chat = compat.chat("t:t1", r, held);
  expect(chat.notice).toBeUndefined();
  // in its session (it reports) with no log to be found: the notice, as before
  const lost: any = new ChatReader(io, "t2");
  await lost.locate({ ...held, address: "t2", status: { state: "idle", app: "codex" } });
  expect(lost.state).toBe("none");
});
