// Screens (3.2): an agent's browser and desktop, to watch and to take over. A screen is named by a key:
// "chat:<space id>" (the space's chat's own agent), "task:<task id>" or "machine:<machine key>" (a real screen).
//   Browser: each space has one headless Chrome on one profile (bin/herdr-browser); each chat and task has its own
//   page in it, driven by its own agent-browser session, whose stream (frames out; mouse, keys and touches in) is
//   relayed here from 127.0.0.1 to the page over the app's own connection.
//   Desktop: its screen server's bytes, relayed by service/desktop.ts; bin/herdr-desktop says where it listens.
//   "You're driving": Take over sets <name>.you beside the browser's files; the agent's herdr-browser AND
//   herdr-desktop refuse to act or read while it is there. Hand back (or "I'm done") removes it and tells the agent to
//   look again; ten minutes without input hand back by themselves, and say so.
//   Needs your hands: <name>.hands (the agent asked through its tools), or its report "blocked, auth" while a browser
//   or desktop is open. Skip tells the agent to find another way.
// This machine's screens only: a live stream can't come through herdr-core's exec from another machine (it returns a
// command's output when it ends). A key on another machine gets a plain "can't be shown here" instead.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DATA, HOME, where } from "./paths.ts";
import { desktopRelay as relayDesktop, vnc, type Bytes, type DesktopDriver, type DesktopPage, type DesktopTarget } from "./desktop.ts";
import { spawn } from "./spawn.ts";

/** ten minutes without input hand a screen back by themselves (the plan's constant; the page counts the same) */
export const HAND_BACK_MS = 10 * 60_000;
/** an agent that ran a browser or desktop command this recently is "using it now" */
export const ACTIVE_MS = 3 * 60_000;
/** how long a settled Needs your hands stays in the thread ("You did this step") */
export const SETTLED_MS = 60 * 60_000;
const INPUT = new Set(["input_mouse", "input_keyboard", "input_touch"]);

export type ScreenInfo = {
  b?: { url: string; title?: string };
  d?: { of: string; own: boolean; busy?: string };
  active?: boolean;
  driver?: "agent" | "you";
  hands?: { what: string; settled?: "done" | "skip" };
};
/** the page's end of api/screen: JSON text both ways */
export type Page = { send(text: string): void; close(): void; buffered(): number };
/** a message for an agent's terminal: the service delivers it (hc send) */
export type Send = { address: string; text: string };
/** Whose screen a key names. */
export type Who = {
  /** the task's herdr.task key ("<slug>#<id>"); none: the space's chat's own agent */
  task?: string;
  /** its space's id on its own machine (bare: "sp12", not "vm/sp12") */
  space: string;
  /** the machine it runs on (null: this one) */
  machine: string | null;
  /** its agent's terminal, to tell it things */
  address?: string | null;
  /** the task's title (a shared desktop says who is using it) */
  title?: string;
  /** its agent reports blocked, auth (OSC 7501) */
  auth?: boolean;
};
export type Deps = {
  /** a key's owner, from the service's own lists: "chat:<space id>" and "task:<id>"; null: no such */
  who(key: string): Who | null;
  /** the screen key of what herdr-browser calls a task ("<slug>#<id>") or a chat ("chat:<space>") on this machine */
  keyOf(who: string): string | null;
  /** this machine's key, as the snapshot names it */
  machine: string;
  /** delivers a message the person didn't trigger with an action (the 10-minute hand back) */
  send?(s: Send): void;
  /** the screens changed (a hand back by itself): build the snapshot again */
  changed?(): void;
  /** a Mac's Screen Sharing password ("VNC viewers may control screen with password"), from Settings */
  password?(): string | undefined;
  root?: string;
  browserBin?: string;
  desktopBin?: string;
  /** where "Save a screenshot to the task" puts its pictures */
  shots?: string;
  shared?: boolean;
  driver?: DesktopDriver;
  now?(): number;
  env?: Record<string, string | undefined>;
};

export const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-/, "").replace(/-$/, "");
/** agent-browser's session, as bin/herdr-browser names it: a name over 32 characters is cut to its last 20 and 8 hex of
 *  its key's sha256 (SHEP-178: a long one overflows agent-browser's socket path) */
export const sessionOf = (key: string, name = safe(key)) =>
  name.length <= 32 ? `herdr-${name}` : `herdr-${name.slice(-20).replace(/^-+/, "")}-${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
/** the name its files carry, as bin/herdr-browser and bin/herdr-desktop make it */
export const nameOf = (w: Pick<Who, "task" | "space">) => (w.task ? safe(w.task) : `chat-${safe(w.space)}`);
// (a throwaway service names its own: SHEPHERDR_HERDR_BROWSER / SHEPHERDR_HERDR_DESKTOP, as SHEPHERDR_HC for hc)
const bin = (name: string) => process.env[`SHEPHERDR_${name.toUpperCase().replace(/-/g, "_")}`] || ([join(import.meta.dir, "..", "bin", name), join(HOME, ".local", "bin", name)].find(existsSync) ?? name);

export function createScreens(deps: Deps) {
  const root = deps.root ?? where().browser;
  const now = deps.now ?? Date.now;
  const HB = deps.browserBin ?? bin("herdr-browser"), HD = deps.desktopBin ?? bin("herdr-desktop");
  const shared = deps.shared ?? process.platform === "darwin";
  const driver = deps.driver ?? vnc;
  const file = (name: string, ext: string) => join(root, name + ext);
  const read = (f: string) => { try { return readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const age = (f: string) => { const st = statSync(f, { throwIfNoEntry: false }); return st ? now() - st.mtimeMs : Infinity; };
  const touch = (f: string) => { const t = new Date(now()); try { utimesSync(f, t, t); } catch { try { mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(f, ""); } catch {} } };
  const drop = (f: string) => { try { rmSync(f, { force: true }); } catch {} };

  /** who drives: name -> the last input's time */
  const driving = new Map<string, { at: number; key: string }>();
  /** each space's pages, as its Chrome lists them: target id -> address and title */
  const tabs = new Map<string, { url: string; title: string }>();
  /** the last frame a page was sent, by name: the small picture in a thread */
  const frames = new Map<string, { at: number; jpeg: Bytes }>();
  /** a Mac's Screen Sharing answers (asked by the sweep) */
  let realScreen = false;

  const local = (w: Who | null): w is Who => !!w && !w.machine;
  const args = (w: Who) => (w.task ? ["--task", w.task, "--space", w.space] : ["--chat", "--space", w.space]);
  async function run(argv: string[], env: Record<string, string> = {}, ms = 120_000) {
    const p = spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...(deps.env ?? process.env), ...env } as Record<string, string> });
    const timer = setTimeout(() => p.kill(), ms);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    await p.exited;
    clearTimeout(timer);
    return { code: p.exitCode ?? 1, out, err: err.trim().replace(/^herdr-(browser|desktop): /, "") };
  }
  const json = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  /** herdr-browser as Shepherdr's own: never refused, never counted as the agent's use */
  const hb = (w: Who, rest: string[], env?: Record<string, string>) => run([HB, "--own", ...args(w), ...rest], env);
  const hd = (key: string, w: Who | null, rest: string[]) => run([HD, "--own", ...(key.startsWith("machine:") ? ["--machine"] : args(w!)), ...rest], {}, 30_000);

  const isDriving = (name: string) => driving.has(name) || existsSync(file(name, ".you"));
  const handsOf = (name: string): { what: string; src?: string; settled?: "done" | "skip"; at?: number } | null => {
    const h = json(read(file(name, ".hands")));
    return h && typeof h.what === "string" ? h : null;
  };
  const agentActive = (name: string) => Math.min(age(file(name, ".used")), age(file(name, ".dused"))) < ACTIVE_MS;
  /** its page in the space's browser, when that browser runs and it has one */
  const tabOf = (name: string) => {
    const cdp = read(file(name, ".cdp")), sp = read(file(name, ".space"));
    if (!cdp || !sp || cdp !== read(join(root, "spaces", sp + ".cdp"))) return null;
    return tabs.get(read(file(name, ".tab"))) ?? null;
  };
  const holder = () => (shared ? read(join(root, "desktop.holder")) : "");
  const titleOf = (who: string) => { const k = deps.keyOf(who), w = k ? deps.who(k) : null; return w?.title ?? who; };
  const nameOfKey = (key: string) => { if (key.startsWith("machine:")) return key === `machine:${deps.machine}` ? "machine" : null; const w = deps.who(key); return local(w) ? nameOf(w) : null; };

  function take(name: string, key: string) {
    driving.set(name, { at: now(), key });
    touch(file(name, ".you"));
  }
  /** Ends a take-over and settles what the agent asked for. Returns what to tell the agent, if anything. */
  function release(name: string, key: string, how: "back" | "done" | "skip" | "idle"): Send | undefined {
    const was = isDriving(name), h = handsOf(name), open = h && !h.settled ? h : null;
    driving.delete(name);
    drop(file(name, ".you"));
    if (open && how !== "back" && how !== "idle") { try { writeFileSync(file(name, ".hands"), JSON.stringify({ ...open, settled: how, at: Math.floor(now() / 1000) }) + "\n"); } catch {} }
    const w = key.startsWith("machine:") ? null : deps.who(key);
    if (!w?.address) return undefined;
    const again = "Look again (snapshot) before you carry on.";
    const text = how === "skip" ? (open ? `The person skipped the step you asked their hands for ("${open.what}"): they won't do it. Find another way, or say plainly what you can't finish without it.` : "")
      : how === "done" && open ? `The person did the step you asked their hands for ("${open.what}") and handed your browser and desktop back. ${again}`
      : !was ? ""
      : how === "idle" ? `The person had taken over your browser and desktop; it was handed back to you by itself after 10 minutes without input. ${again}`
      : `The person handed your browser and desktop back to you. ${again}`;
    return text ? { address: w.address, text } : undefined;
  }

  /** The snapshot's screens: every key on this machine with a page open, a desktop up, a driver or a call for hands. */
  function screensOf(): Record<string, ScreenInfo> {
    const out: Record<string, ScreenInfo> = {};
    let names: string[] = [];
    try { names = readdirSync(root).filter((f) => f.endsWith(".task")).map((f) => f.slice(0, -5)); } catch {}
    const held = holder();
    for (const name of names) {
      const who = read(file(name, ".task"));
      const key = who ? deps.keyOf(who) : null;
      if (!key) continue;
      const info: ScreenInfo = {};
      const tab = tabOf(name);
      if (tab) info.b = { url: tab.url === "about:blank" ? "" : tab.url, ...(tab.title && tab.title !== tab.url ? { title: tab.title } : {}) };
      if (shared) {
        const waits = age(file(name, ".waits")) < 30_000;
        if (held === who || waits) info.d = { of: deps.machine, own: false, ...(waits && held && held !== who ? { busy: titleOf(held) } : {}) };
      } else if (existsSync(file(name, ".display"))) info.d = { of: deps.machine, own: true };
      const h = handsOf(name), w = deps.who(key);
      if (h && (!h.settled || now() - (h.at ?? 0) * 1000 < SETTLED_MS)) info.hands = { what: h.what, ...(h.settled ? { settled: h.settled } : {}) };
      else if (w?.auth && (info.b || info.d)) info.hands = { what: "Sign in" };
      if (isDriving(name)) info.driver = "you";
      if ((info.b || info.d) && agentActive(name)) { info.active = true; info.driver ??= "agent"; }
      if (info.b || info.d || info.hands || info.driver) out[key] = info;
    }
    if (shared && realScreen) {
      const k = `machine:${deps.machine}`;
      out[k] = { d: { of: deps.machine, own: false, ...(held ? { busy: titleOf(held) } : {}) }, ...(isDriving("machine") ? { driver: "you" as const } : {}) };
    }
    return out;
  }
  /** the tasks waiting for a Mac's one desktop (the snapshot's Task.waitsDesktop), as screen keys */
  function waiting(): string[] {
    if (!shared) return [];
    let names: string[] = [];
    try { names = readdirSync(root).filter((f) => f.endsWith(".waits")).map((f) => f.slice(0, -6)); } catch {}
    return names.filter((n) => age(file(n, ".waits")) < 30_000).map((n) => deps.keyOf(read(file(n, ".task")))).filter((k): k is string => !!k);
  }
  /** the machines with a real screen whose desktop can be opened (Settings › Machines "Open desktop") */
  const desktops = () => (shared && realScreen ? [deps.machine] : []);

  /** Every few seconds: what each space's Chrome shows, take-overs nobody touched for ten minutes, a real screen. */
  let last = "";
  async function sweep() {
    const seen = new Map<string, { url: string; title: string }>();
    let spaces: string[] = [];
    try { spaces = readdirSync(join(root, "spaces")).filter((f) => f.endsWith(".cdp")); } catch {}
    await Promise.all(spaces.map(async (f) => {
      const port = /^ws:\/\/127\.0\.0\.1:(\d+)\//.exec(read(join(root, "spaces", f)))?.[1];
      if (!port) return;
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
        for (const t of (await r.json()) as any[]) if (t.type === "page") seen.set(String(t.id), { url: String(t.url ?? ""), title: String(t.title ?? "") });
      } catch {}
    }));
    tabs.clear();
    for (const [k, v] of seen) tabs.set(k, v);
    // a flag left by a service that stopped: taken up, counted from when it was last touched
    try {
      for (const f of readdirSync(root)) if (f.endsWith(".you") && !driving.has(f.slice(0, -4))) {
        const name = f.slice(0, -4), key = name === "machine" ? `machine:${deps.machine}` : deps.keyOf(read(file(name, ".task")));
        if (key) driving.set(name, { at: now() - age(file(name, ".you")), key }); else drop(file(name, ".you"));
      }
    } catch {}
    for (const [name, d] of [...driving]) {
      if (now() - d.at < HAND_BACK_MS) continue;
      const send = release(name, d.key, "idle");
      if (send) deps.send?.(send);
    }
    if (shared) realScreen = (json((await hd(`machine:${deps.machine}`, null, ["--state"])).out)?.ok) === true;
    for (const [n, f] of [...frames]) if (now() - f.at > 60_000) frames.delete(n);
    const next = JSON.stringify(screensOf());
    if (next !== last) { last = next; deps.changed?.(); }
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  /** starts the sweep (every 3 s); stop() ends it */
  function start(every = 3000) { if (!timer) { timer = setInterval(() => void sweep().catch(() => {}), every); (timer as any).unref?.(); } void sweep().catch(() => {}); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  /** One page's view of a key's browser (ws api/screen), speaking web/shared/browser.ts. */
  function screenRelay(key: string, page: Page) {
    const w = deps.who(key);
    let ended = false, stream: WebSocket | null = null, looping = false, wake: (() => void) | null = null;
    let state: Record<string, unknown> = { type: "state", driver: "agent", url: "", title: "", connected: false, viewport: { w: 1280, h: 800 } };
    const say = (m: object) => { if (!ended && page.buffered() < 2 << 20) page.send(JSON.stringify(m)); };
    if (!local(w)) {
      say({ ...state, closed: true, error: w ? `This runs on ${(w as Who).machine}. Its browser can be watched only on the machine Shepherdr is served from, for now.` : "There is no such screen." });
      return { message(_raw: string) {}, end() { ended = true; } };
    }
    const name = nameOf(w);
    const show = () => say({ ...state, driver: isDriving(name) ? "you" : "agent" });
    const set = (p: Record<string, unknown>) => { state = { ...state, ...p }; show(); };

    async function connect() {
      if (looping) return;
      looping = true;
      while (!ended) {
        const st = json((await hb(w!, ["--state"])).out);
        if (st?.open) {
          const got = json((await hb(w!, ["stream", "status", "--json"])).out)?.data;
          const port = Number(got?.port);
          if (port && !ended) {
            await new Promise<void>((done) => {
              const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
              stream = ws;
              ws.onopen = () => set({ connected: true, closed: false, error: undefined });
              ws.onmessage = (e) => {
                let m: any;
                try { m = JSON.parse(String(e.data)); } catch { return; }
                if (m.type === "frame") {
                  say(m);
                  if (typeof m.data === "string") frames.set(name, { at: now(), jpeg: new Uint8Array(Buffer.from(m.data, "base64")) });
                } else if (m.type === "tabs") {
                  const t = (m.tabs ?? []).find((x: any) => x.targetId === st.tab) ?? (m.tabs ?? []).find((x: any) => x.active);
                  if (t) set({ url: t.url === "about:blank" ? "" : (t.url ?? state.url), title: t.title ?? "" });
                } else if (m.type === "url") set({ url: String(m.url ?? "") });
                else if (m.type === "status" && m.viewportWidth) set({ viewport: { w: m.viewportWidth, h: m.viewportHeight } });
              };
              ws.onclose = () => { if (stream === ws) stream = null; set({ connected: false }); done(); };
              ws.onerror = () => ws.close();
            });
            continue;
          }
        } else set({ connected: false, closed: true, ...(st ? { error: st.desk ? "The person is signing in on the desktop: see the Desktop tab." : undefined } : { error: "herdr-browser didn't answer." }) });
        if (ended) break;
        await new Promise<void>((r) => { wake = r; setTimeout(r, 3000); });
        wake = null;
      }
    }
    void connect();
    /** the person's own command on the page (the address bar, Back, Reload, a paste): opens the browser when it is closed */
    const own = async (rest: string[]) => {
      const r = await hb(w, rest);
      touch(join(root, "spaces", safe(w.space) + ".used"));
      if (r.code) set({ error: r.err || "The browser didn't answer." });
      wake?.();
    };
    /** may the person act: they took over, or the agent isn't using it (then it is simply theirs) */
    const may = () => isDriving(name) || !agentActive(name);
    const spaceUsed = join(root, "spaces", safe(w.space) + ".used");
    const bump = () => {
      if (age(spaceUsed) > 30_000) touch(spaceUsed);   // the person's use keeps the space's browser from its idle close
      const d = driving.get(name);
      if (!d) return;
      if (now() - d.at > 5000) touch(file(name, ".you"));
      d.at = now();
    };
    return {
      message(raw: string) {
        if (ended || raw.length > 65_536) return;
        let m: any;
        try { m = JSON.parse(raw); } catch { return; }
        if (m.type === "take") { take(name, key); show(); deps.changed?.(); return; }
        if (m.type === "handback") { const s = release(name, key, "back"); if (s) deps.send?.(s); show(); deps.changed?.(); return; }
        if (m.type === "start") return void connect();
        if (!may()) return;                       // the agent drives: watching only
        bump();
        if (INPUT.has(m.type)) { if (stream?.readyState === WebSocket.OPEN) stream.send(JSON.stringify(m)); }
        else if (m.type === "text" && typeof m.text === "string" && m.text) void own(["keyboard", "inserttext", m.text]);
        else if (m.type === "go" && typeof m.url === "string" && /^(https?|file|about):/i.test(m.url)) void own(["open", m.url]);
        else if (m.type === "back") void own(["back"]);
        else if (m.type === "forward") void own(["forward"]);
        else if (m.type === "reload") void own(["reload"]);
        else if (m.type === "open") void own(["open", String(state.url || "about:blank")]);
      },
      end() {
        if (ended) return;
        ended = true;
        wake?.();
        stream?.close();
      },
    };
  }

  /** Where a key's desktop can be watched: starts an agent's own display when it has none (Linux). */
  async function desktopOf(key: string): Promise<DesktopTarget> {
    const machine = key.startsWith("machine:"), w = machine ? null : deps.who(key);
    if (machine ? key !== `machine:${deps.machine}` : !local(w)) return { ok: false, why: "This desktop is on another machine. It can be watched only on the machine Shepherdr is served from, for now." };
    if (machine && !shared) return { ok: false, why: "This machine has no screen of its own: each agent has its own desktop." };
    const r = await hd(key, w, ["--up"]);
    const st = json(r.out);
    if (!st?.ok || !st.port) return { ok: false, why: st?.why || r.err || "herdr-desktop didn't answer." };
    return { ok: true, port: Number(st.port), own: !!st.own, ...(st.own ? {} : { password: deps.password?.() }) };
  }
  /** One page's view of a key's desktop (ws api/desktop): the screen server's own bytes; view-only until Take over. */
  function desktopRelay(key: string, page: DesktopPage) {
    const name = nameOfKey(key) ?? "";
    return relayDesktop(desktopOf(key), page, {
      driving: () => !!name && (isDriving(name) || (name !== "machine" && !agentActive(name))),
      input: () => { const d = driving.get(name); if (d) { if (now() - d.at > 5000) touch(file(name, ".you")); d.at = now(); } },
    }, driver);
  }

  /** The latest picture of a key's browser (JPEG) or desktop (PNG), for cards and thumbnails; null: nothing to show. */
  async function shotOf(key: string, src: "b" | "d"): Promise<{ type: string; body: Bytes } | null> {
    const name = nameOfKey(key);
    if (!name) return null;
    if (src === "d") {
      const w = key.startsWith("machine:") ? null : deps.who(key);
      const st = json((await hd(key, w, ["--state"])).out);       // a thumbnail never starts a display
      if (!st?.ok || !st.port) return null;
      const body = await driver.shot({ ok: true, port: Number(st.port), own: !!st.own, ...(st.own ? {} : { password: deps.password?.() }) });
      return body ? { type: "image/png", body } : null;
    }
    const f = frames.get(name);
    if (f && now() - f.at < 4000) return { type: "image/jpeg", body: f.jpeg };
    const w = deps.who(key);
    if (!local(w) || !tabOf(name)) return null;
    const tmp = join(root, `.shot-${name}-${now()}.jpg`);
    try {
      const r = await hb(w, ["screenshot", tmp, "--screenshot-format", "jpeg", "--screenshot-quality", "60"]);
      if (r.code || !existsSync(tmp)) return null;
      const jpeg = new Uint8Array(readFileSync(tmp));
      frames.set(name, { at: now(), jpeg });
      return { type: "image/jpeg", body: jpeg };
    } finally { drop(tmp); }
  }

  /** POST api/action {type:"screen", key, op, …}. `send`: a message the service delivers to the agent (hc send). */
  async function screenAction(body: any): Promise<{ ok: boolean; error?: string; path?: string; send?: Send }> {
    const key = String(body?.key ?? ""), op = String(body?.op ?? "");
    const name = nameOfKey(key);
    if (!name) return { ok: false, error: deps.who(key) ? "This screen is on another machine. It can be used only on the machine Shepherdr is served from, for now." : "There is no such screen." };
    const w = key.startsWith("machine:") ? null : deps.who(key);
    if (op === "take") { take(name, key); return { ok: true }; }
    if (op === "handback" || op === "skip") {
      const send = release(name, key, op === "skip" ? "skip" : body.done ? "done" : "back");
      // the person was signing in on the desktop: the space's own browser starts again, signed in, with its next command
      if (w && existsSync(join(root, "spaces", safe(w.space) + ".desk"))) await hb(w, ["--desk-end"]);
      return { ok: true, ...(send ? { send } : {}) };
    }
    if (op === "shot") {
      const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data ?? ""));
      if (!m || m[2]!.length > 24_000_000) return { ok: false, error: "There is no picture to save." };
      const dir = join(deps.shots ?? join(DATA, "screens"), name);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, `${body.src === "d" ? "desktop" : "browser"}-${new Date(now()).toISOString().replace(/[:.]/g, "-")}.${m[1] === "png" ? "png" : "jpg"}`);
      writeFileSync(path, Buffer.from(m[2]!, "base64"));
      return { ok: true, path, ...(w?.address ? { send: { address: w.address, text: `The person saved a screenshot of your ${body.src === "d" ? "desktop" : "browser"} for you to look at: ${path}` } } : {}) };
    }
    if (op === "desktop") {
      // Open on the desktop instead: a site that refuses an automated browser, opened in a normal one on its desktop
      if (!w) return { ok: false, error: "Open it from a chat's or a task's screen." };
      const url = String(body.url ?? "");
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "There is no address to open yet." };
      const t = await desktopOf(key);
      if (!t.ok) return { ok: false, error: t.why };
      const st = json((await hd(key, w, ["--state"])).out);
      const r = await hb(w, ["--desk", url], st?.display ? { DISPLAY: String(st.display) } : {});
      return r.code ? { ok: false, error: r.err || "Couldn't open it on the desktop." } : { ok: true };
    }
    return { ok: false, error: "Unknown screen action." };
  }

  return { screensOf, waiting, desktops, sweep, start, stop, screenRelay, desktopRelay, desktopOf, shotOf, screenAction };
}
