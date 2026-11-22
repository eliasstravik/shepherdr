// 3.2 Screens: the real bin/herdr-browser on a throwaway home, with a stand-in agent-browser (it logs what it was
// asked) and a stand-in Chrome (its page list, its DevTools socket, a session's stream) on 127.0.0.1.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScreens, HAND_BACK_MS, nameOf, sessionOf, type Send, type Who } from "./screens.ts";

const BIN = join(import.meta.dir, "..", "bin");
const home = mkdtempSync(join(tmpdir(), "shep-screens-"));
const fake = join(home, "fake"), root = join(home, "sh", "state", "browser");
mkdirSync(fake, { recursive: true });
mkdirSync(join(home, "sh", "data"), { recursive: true });
writeFileSync(join(home, "sh", "data", "LAYOUT"), "2\n");

// the stand-in Chrome and stream
const inputs: any[] = [];
const srv = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(req, s) {
    const u = new URL(req.url);
    if (u.pathname === "/json/list") return Response.json([{ id: "T1", type: "page", url: "https://shop.test/cart", title: "Cart" }, { id: "T0", type: "page", url: "about:blank", title: "" }]);
    return s.upgrade(req, { data: { stream: u.pathname === "/" } } as any) ? undefined : new Response("no", { status: 400 });
  },
  websocket: {
    open(ws) {
      if (!(ws.data as any).stream) return;
      ws.send(JSON.stringify({ type: "tabs", tabs: [{ targetId: "T0", active: false, url: "about:blank" }, { targetId: "T1", active: true, url: "https://shop.test/cart", title: "Cart" }] }));
      ws.send(JSON.stringify({ type: "frame", data: Buffer.from("jpeg").toString("base64"), metadata: { deviceWidth: 1280, deviceHeight: 720 } }));
    },
    message(ws, m) {
      const j = JSON.parse(String(m));
      if (j.method === "Target.createTarget") ws.send(JSON.stringify({ id: j.id, result: { targetId: "T1" } }));
      else inputs.push(j);
    },
  },
});
writeFileSync(join(fake, "port"), String(srv.port));
const AB = join(fake, "agent-browser");
writeFileSync(AB, `#!/bin/sh
D=${JSON.stringify(fake)}
[ "$1" = --version ] && { echo "agent-browser 0.41.1"; exit 0; }
printf '%s\\n' "$*" >> "$D/log"
sess=default
while :; do case "$1" in --session) sess=$2; shift 2 ;; --profile|--cdp|--idle-timeout) shift 2 ;; --pin-tab) shift ;; *) break ;; esac; done
case "$1 $2" in
  "session list") echo "Active sessions:"; for f in "$D"/s.*; do [ -f "$f" ] && echo "  \${f##*/s.}"; done ;;
  "get cdp-url") : > "$D/s.$sess"; echo "ws://127.0.0.1:$(cat "$D/port")/devtools/browser/x" ;;
  "stream status") echo '{"success":true,"data":{"enabled":true,"port":'"$(cat "$D/port")"'}}' ;;
  "close "*) rm -f "\${D:?}/s.\${sess:?}" ;;
  *) : > "$D/s.$sess" ;;
esac
`);
chmodSync(AB, 0o755);
afterAll(() => { srv.stop(true); rmSync(home, { recursive: true, force: true }); });

const env = { HOME: home, SHEPHERDR_HOME: join(home, "sh"), PATH: process.env.PATH ?? "", HERDR_BROWSER_BIN: AB, HERDR_DESKTOP_BIN: "/bin/true" };
const log = () => { try { return readFileSync(join(fake, "log"), "utf8"); } catch { return ""; } };
const until = async (ok: () => boolean, ms = 8000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timed out"); await Bun.sleep(20); } };
const people: Record<string, Who> = {
  "task:SHOP-2": { task: "shop#2", space: "sp1", machine: null, address: "t-worker", title: "Fix the cart" },
  "task:SHOP-3": { task: "shop#3", space: "sp1", machine: null, address: "t-three", title: "Other" },
  "chat:sp1": { space: "sp1", machine: null, address: "t-assistant" },
  "task:vmb:API-1": { task: "api#1", space: "sp9", machine: "vmb" },
};
let clock = Date.now();
function make(more: Partial<Parameters<typeof createScreens>[0]> = {}) {
  const sent: Send[] = [];
  const s = createScreens({
    who: (k) => people[k] ?? null,
    keyOf: (w) => Object.entries(people).find(([, p]) => !p.machine && (p.task ? p.task === w : `chat:${p.space}` === w))?.[0] ?? null,
    machine: "vm", send: (x) => void sent.push(x), root, browserBin: join(BIN, "herdr-browser"), desktopBin: join(BIN, "herdr-desktop"),
    shots: join(home, "shots"), shared: false, now: () => clock, env, ...more,
  });
  return { s, sent };
}
function page() {
  const got: any[] = [];
  return { got, send: (t: string) => void got.push(JSON.parse(t)), close() {}, buffered: () => 0, state: () => got.filter((m) => m.type === "state").pop() };
}
// (never spawnSync: the stand-in Chrome lives in this process, and a new tab asks it for a window)
async function sh(argv: string[], e: Record<string, string> = env) {
  const p = Bun.spawn(["sh", ...argv], { env: e, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return { exitCode: p.exitCode, stdout: out, stderr: err };
}
const hbRun = (args: string[]) => sh([join(BIN, "herdr-browser"), ...args]);
beforeEach(() => {
  clock = Date.now();
  rmSync(root, { recursive: true, force: true });
  for (const f of ["log", "s.herdr-s-sp1", "s.herdr-shop-2", "s.herdr-chat-sp1"]) rmSync(join(fake, f), { force: true });
  inputs.length = 0;
});

test("the same names as herdr-browser", async () => {
  for (const [task, space] of [["dev-shepherdr#168", "sp1"], [".config-herdr-app#57", "a/b c"], ["tmp-" + "very-long-folder-name-".repeat(6) + "demo#1", "sp-" + "x".repeat(60)]]) {
    const j = JSON.parse((await hbRun(["--task", task!, "--space", space!, "--name"])).stdout);
    expect(nameOf({ task, space: space! })).toBe(j.name);
    expect(sessionOf(task!)).toBe(j.session);
    const c = JSON.parse((await hbRun(["--chat", "--space", space!, "--name"])).stdout);
    expect(nameOf({ space: space!.split("/").pop()! })).toBe(c.name);
    expect(c.owner).toBe(j.owner);
    expect(c.profile).toBe(j.profile);          // one profile for the space: its chat and its tasks share sign-ins
    expect(j.session.length).toBeLessThanOrEqual(40);
  }
});

test("an idle screen is closed and yours: an address opens the space's browser and its own tab, then the stream shows", async () => {
  const { s } = make(), p = page();
  const r = s.screenRelay("task:SHOP-2", p);
  await until(() => p.state()?.closed === true);
  expect(s.screensOf()).toEqual({});
  r.message(JSON.stringify({ type: "go", url: "https://shop.test/cart" }));
  await until(() => p.got.some((m) => m.type === "frame"));
  const l = log();
  expect(l).toContain("--session herdr-s-sp1 --profile " + join(root, "spaces", "sp1") + " --idle-timeout 0 open about:blank");
  expect(l).toMatch(/--session herdr-shop-2 --cdp ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/x --pin-tab --idle-timeout 0 tab T1/);
  expect(l).toMatch(/--session herdr-shop-2 --cdp \S+ --pin-tab --idle-timeout 0 open https:\/\/shop\.test\/cart/);
  expect(p.state()).toMatchObject({ connected: true, url: "https://shop.test/cart", title: "Cart", driver: "agent" });
  // its own command didn't count as the agent using it: still idle, so the person's clicks go straight in
  expect(existsSync(join(root, "shop-2.used"))).toBe(false);
  r.message(JSON.stringify({ type: "input_mouse", eventType: "mousePressed", x: 5, y: 6 }));
  await until(() => inputs.length === 1);
  await s.sweep();
  expect(s.screensOf()).toEqual({ "task:SHOP-2": { b: { url: "https://shop.test/cart", title: "Cart" } } });
  expect((await s.shotOf("task:SHOP-2", "b"))?.type).toBe("image/jpeg");
  r.end();
});

test("the agent drives: watching only, until Take over; Hand back tells the agent to look again", async () => {
  const { s, sent } = make(), p = page();
  expect((await hbRun(["--task", "shop#2", "--space", "sp1", "open", "http://127.0.0.1:" + srv.port + "/json/list"])).exitCode).toBe(0);
  expect(existsSync(join(root, "shop-2.used"))).toBe(true);
  await s.sweep();
  expect(s.screensOf()["task:SHOP-2"]).toEqual({ b: { url: "https://shop.test/cart", title: "Cart" }, active: true, driver: "agent" });
  const r = s.screenRelay("task:SHOP-2", p);
  await until(() => p.state()?.connected === true);
  r.message(JSON.stringify({ type: "input_keyboard", eventType: "keyDown", key: "a" }));
  r.message(JSON.stringify({ type: "go", url: "https://evil.test/" }));
  await Bun.sleep(150);
  expect(inputs).toEqual([]);
  expect(log()).not.toContain("evil.test");

  expect(await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "take", src: "b" })).toEqual({ ok: true });
  expect(s.screensOf()["task:SHOP-2"]!.driver).toBe("you");
  // the agent's tools refuse, and read nothing, while the person drives: the browser's and the desktop's
  const refused = await hbRun(["--task", "shop#2", "--space", "sp1", "snapshot"]);
  expect(refused.exitCode).toBe(3);
  expect(refused.stderr).toContain("took over");
  const desk = await sh([join(BIN, "herdr-desktop"), "--task", "shop#2", "--space", "sp1", "snapshot"]);
  expect(desk.exitCode).toBe(3);
  expect((await hbRun(["--task", "shop#3", "--space", "sp1", "get", "url"])).exitCode).toBe(0);   // another task of the space carries on
  r.message(JSON.stringify({ type: "input_keyboard", eventType: "keyDown", key: "a" }));
  await until(() => inputs.length === 1);
  r.message(JSON.stringify({ type: "text", text: "hello" }));
  await until(() => log().includes("keyboard inserttext hello"));

  const back = await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "handback", src: "b" });
  expect(back.send).toEqual({ address: "t-worker", text: expect.stringContaining("handed your browser and desktop back") });
  expect(existsSync(join(root, "shop-2.you"))).toBe(false);
  expect((await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "handback" })).send).toBeUndefined();   // once
  expect(sent).toEqual([]);
  expect((await hbRun(["--task", "shop#2", "--space", "sp1", "snapshot"])).exitCode).toBe(0);
  r.end();
});

test("ten minutes without input hand back by themselves, and say so", async () => {
  const { s, sent } = make();
  let changed = 0;
  const { s: s2 } = make({ changed: () => changed++, send: (x) => void sent.push(x) });
  void s;
  await hbRun(["--task", "shop#2", "--space", "sp1", "get", "url"]);
  await s2.screenAction({ type: "screen", key: "task:SHOP-2", op: "take" });
  clock += HAND_BACK_MS - 1000;
  await s2.sweep();
  expect(existsSync(join(root, "shop-2.you"))).toBe(true);
  clock += 2000;
  await s2.sweep();
  expect(existsSync(join(root, "shop-2.you"))).toBe(false);
  expect(sent).toEqual([{ address: "t-worker", text: expect.stringContaining("by itself after 10 minutes without input") }]);
  expect(changed).toBeGreaterThan(0);
  // a flag whose service stopped: the next one counts from when it was last touched
  writeFileSync(join(root, "shop-2.you"), "");
  const old = new Date(clock - HAND_BACK_MS - 5000);
  utimesSync(join(root, "shop-2.you"), old, old);
  const { s: s3, sent: sent3 } = make();
  await s3.sweep();
  expect(existsSync(join(root, "shop-2.you"))).toBe(false);
  expect(sent3.length).toBe(1);
});

test("Needs your hands: asked through the tools, or a sign-in report with a screen open; Skip and I'm done settle it", async () => {
  const { s } = make();
  await hbRun(["--task", "shop#2", "--space", "sp1", "get", "url"]);
  const asked = await hbRun(["--task", "shop#2", "--space", "sp1", "hands", "Sign", "in", "to", "Stripe"]);
  expect(asked.stdout).toContain("asked the person");
  await s.sweep();
  expect(s.screensOf()["task:SHOP-2"]!.hands).toEqual({ what: "Sign in to Stripe" });
  const skip = await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "skip" });
  expect(skip.send!.text).toContain('skipped the step you asked their hands for ("Sign in to Stripe")');
  expect(s.screensOf()["task:SHOP-2"]!.hands).toEqual({ what: "Sign in to Stripe", settled: "skip" });
  // asked again, taken over, done
  await hbRun(["--task", "shop#2", "--space", "sp1", "hands", "The code from your phone"]);
  await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "take" });
  const done = await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "handback", done: true });
  expect(done.send!.text).toContain('did the step you asked their hands for ("The code from your phone")');
  expect(s.screensOf()["task:SHOP-2"]!.hands).toEqual({ what: "The code from your phone", settled: "done" });
  clock += 61 * 60_000;
  expect(s.screensOf()["task:SHOP-2"]!.hands).toBeUndefined();
  // the agent's own report (blocked, auth) raises it while its browser is open; with none open it is not a screen's card
  people["task:SHOP-2"]!.auth = true;
  expect(s.screensOf()["task:SHOP-2"]!.hands).toEqual({ what: "Sign in" });
  await hbRun(["--own", "--task", "shop#2", "--space", "sp1", "--close-space"]);
  await s.sweep();
  expect(s.screensOf()["task:SHOP-2"]).toBeUndefined();
  delete people["task:SHOP-2"]!.auth;
});

test("a chat's own agent has its tab in the same browser; a screenshot is saved for the task; another machine says so", async () => {
  const { s } = make();
  expect((await hbRun(["--chat", "--space", "sp1", "open", "http://127.0.0.1:" + srv.port + "/json/list"])).exitCode).toBe(0);
  expect(log()).toMatch(/--session herdr-chat-sp1 --cdp \S+ --pin-tab --idle-timeout 0 tab T1/);
  expect(log().match(/open about:blank/g)!.length).toBe(1);
  await s.sweep();
  expect(Object.keys(s.screensOf())).toEqual(["chat:sp1"]);
  const shot = await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "shot", src: "b", data: "data:image/png;base64," + Buffer.from("png!").toString("base64") });
  expect(readFileSync(shot.path!, "utf8")).toBe("png!");
  expect(shot.send).toEqual({ address: "t-worker", text: expect.stringContaining(shot.path!) });
  expect((await s.screenAction({ type: "screen", key: "task:SHOP-2", op: "shot", data: "data:text/html;base64,AAAA" })).ok).toBe(false);
  expect(await s.screenAction({ type: "screen", key: "task:vmb:API-1", op: "take" })).toEqual({ ok: false, error: expect.stringContaining("another machine") });
  expect((await s.screenAction({ type: "screen", key: "task:NOPE", op: "take" })).error).toBe("There is no such screen.");
  const p = page();
  s.screenRelay("task:vmb:API-1", p);
  expect(p.state()).toMatchObject({ closed: true, error: expect.stringContaining("vmb") });
  expect(await s.desktopOf("task:vmb:API-1")).toMatchObject({ ok: false });
});

test("a Mac's one desktop: who holds it, who waits, and the machine's own screen", async () => {
  const { s } = make({ shared: true, env: { ...env, HERDR_DESKTOP_DRIVER: "shared", HERDR_DESKTOP_PORT: String(srv.port), HERDR_DESKTOP_WAIT: "0" } });
  const hd = (task: string) => sh([join(BIN, "herdr-desktop"), "--task", task, "--space", "sp1", "click", "@e1"], { ...env, HERDR_DESKTOP_DRIVER: "shared", HERDR_DESKTOP_WAIT: "0" });
  expect((await hd("shop#2")).exitCode).toBe(0);
  const waits = await hd("shop#3");
  expect(waits.exitCode).toBe(6);
  expect(waits.stderr).toContain("another agent is still using it");
  writeFileSync(join(root, "shop-3.waits"), "shop#2\n");     // as it stands while herdr-desktop waits
  writeFileSync(join(root, "shop-3.task"), "shop#3\n");
  clock = Date.now();
  await s.sweep();
  expect(s.waiting()).toEqual(["task:SHOP-3"]);
  expect(s.screensOf()).toEqual({
    "task:SHOP-2": { d: { of: "vm", own: false }, active: true, driver: "agent" },
    "task:SHOP-3": { d: { of: "vm", own: false, busy: "Fix the cart" } },
    "machine:vm": { d: { of: "vm", own: false, busy: "Fix the cart" } },
  });
  expect(s.desktops()).toEqual(["vm"]);
  expect(await s.desktopOf("machine:vm")).toEqual({ ok: true, port: srv.port!, own: false, password: undefined });
});
