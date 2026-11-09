// A task's browser on the web (2.1's Browser panel): the task's own agent-browser session (herdr-<task>, the one
// its agent drives and the window's Browser view shows in a terminal), relayed from agent-browser's stream on
// 127.0.0.1 to the page: its frames and its address out, the person's mouse, keys and touches in. The person's
// first input takes it over as in the window ("You're driving": ~/.local/state/shepherdr/browser/<name>.you, which herdr-browser
// reads to hold the agent off); Hand back ends that. While a page shows it, <name>.view stays fresh, as the window's
// view keeps it, so the session isn't closed as unwatched. This machine's tasks only.
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HOME, where } from "./paths.ts";

const ROOT = where().browser;
const BIN = [join(HOME, ".config", "herdr-app", "bin", "herdr-browser"), join(HOME, ".local", "bin", "herdr-browser")].find(existsSync) ?? "herdr-browser";
const INPUT = new Set(["input_mouse", "input_keyboard", "input_touch"]);

type Page = { send(text: string): void; close(): void; buffered(): number };

const nameOf = (task: string) => task.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-/, "").replace(/-$/, "");
// agent-browser's session, as bin/herdr-browser names it: a name over 32 characters is cut to its last 20 and 8 hex of
// the key's sha256 (SHEP-178: a long one overflows agent-browser's socket path)
export const sessionOf = (task: string, name = nameOf(task)) =>
  name.length <= 32 ? `herdr-${name}` : `herdr-${name.slice(-20).replace(/^-+/, "")}-${createHash("sha256").update(task).digest("hex").slice(0, 8)}`;
const touch = (f: string) => { const t = new Date(); try { utimesSync(f, t, t); } catch { try { writeFileSync(f, ""); } catch {} } };

/** herdr-browser's answer: its JSON data, or why it failed (its whole message: a missing agent-browser's says the
 *  command that fixes it) */
async function abRun(task: string, args: string[]): Promise<{ data: any; error: string }> {
  const p = Bun.spawn([BIN, "--own", "--task", task, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  let data = null;
  try { data = JSON.parse(out)?.data ?? null; } catch {}
  return { data, error: p.exitCode ? err.trim().replace(/^herdr-browser: /, "") : "" };
}
const ab = async (task: string, args: string[]) => (await abRun(task, args)).data;

/** One page's view of a task's browser. task: "<list slug>#<id>", as herdr-task labels it. */
export function browserRelay(task: string, page: Page) {
  const name = nameOf(task), session = sessionOf(task, name), file = (ext: string) => join(ROOT, name + ext);
  let ended = false, stream: WebSocket | null = null, driving = false;
  let state = { type: "state", driver: "agent", url: "", title: "", connected: false, viewport: { w: 1280, h: 800 } };
  const say = (m: object) => { if (!ended && page.buffered() < 2 << 20) page.send(JSON.stringify(m)); };
  const show = () => say({ ...state, driver: driving ? "you" : "agent" });
  mkdirSync(ROOT, { recursive: true });
  const beat = setInterval(() => touch(file(".view")), 5000);
  touch(file(".view"));

  let looping = false;
  async function connect() {
    if (looping) return;
    looping = true;
    while (!ended) {
      const listed = await abRun(task, ["session", "list", "--json"]);
      const sessions = listed.data?.sessions;
      if (Array.isArray(sessions) && sessions.includes(session)) {
        let st = await ab(task, ["stream", "status", "--json"]);
        if (st && !st.enabled) { await ab(task, ["stream", "enable"]); st = await ab(task, ["stream", "status", "--json"]); }
        const port = Number(st?.port);
        if (port) {
          await new Promise<void>((done) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
            stream = ws;
            ws.onopen = () => { state = { ...state, connected: true }; show(); };
            ws.onmessage = (e) => {
              let m: any;
              try { m = JSON.parse(String(e.data)); } catch { return; }
              if (m.type === "frame") say(m);
              else if (m.type === "tabs") {
                const t = (m.tabs ?? []).find((x: any) => x.active);
                if (t) { state = { ...state, url: t.url ?? state.url, title: t.title ?? "" }; show(); }
              } else if (m.type === "url") { state = { ...state, url: String(m.url ?? "") }; show(); }
            };
            ws.onclose = () => { if (stream === ws) stream = null; state = { ...state, connected: false }; show(); done(); };
            ws.onerror = () => ws.close();
          });
        }
      } else if (!ended) {
        // no session: the window's view says the browser isn't open (its agent opens it when it checks a page)
        state = { ...state, connected: false, ...(Array.isArray(sessions) ? { closed: true } : { closed: false, error: listed.error || "agent-browser didn't answer." }) } as typeof state;
        show();
      }
      if (Array.isArray(sessions) && sessions.includes(session)) state = { ...state, closed: false, error: undefined } as typeof state;
      await Bun.sleep(3000);
    }
  }
  void connect();

  const take = () => { driving = true; touch(file(".you")); show(); };
  const handBack = () => { driving = false; try { rmSync(file(".you"), { force: true }); } catch {} show(); };

  return {
    message(raw: string) {
      if (ended || raw.length > 65_536) return;
      let m: any;
      try { m = JSON.parse(raw); } catch { return; }
      if (INPUT.has(m.type)) {
        if (!driving) take(); else touch(file(".you"));
        if (stream?.readyState === WebSocket.OPEN) stream.send(JSON.stringify(m));
      } else if (m.type === "take") take();
      else if (m.type === "handback") handBack();
      else if (m.type === "start") void connect();
      // the window's view's ‹ Back, ↻ Reload (Alt+←, Ctrl+R) and Open browser, as Herdr's own commands (--own)
      else if (m.type === "back") void ab(task, ["back"]);
      else if (m.type === "reload") void ab(task, ["reload"]);
      else if (m.type === "open") void ab(task, ["open", state.url || "about:blank"]).then(() => connect());
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(beat);
      if (driving) handBack();
      stream?.close();
    },
  };
}
