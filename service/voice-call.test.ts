// A web call end to end, but for the voice service: a fake voice agent's socket asks the real call (voice.ts) to open
// things; the open goes to the page that started the call (a phone, a laptop's browser tab), never another, and the
// agent hears it's on screen only once that page said so.
import { afterAll, expect, test } from "bun:test";
import { voiceCall } from "./voice.ts";
import type { VoiceIO, Where } from "./voice-tools.ts";

const now = Date.now();
const snap: any = {
  host: "eliass-mac-mini", name: "Shepherdr", user: "You",
  machines: [{ id: "m:eliass-mac-mini", machine: "eliass-mac-mini", name: "This computer", status: "idle", here: true },
    { id: "m:mbp", machine: "eliass-macbook-pro", name: "MacBook Pro", status: "idle" }],
  places: [{ id: "h1", name: "Home", home: true, machine: "eliass-mac-mini", chat: "p:h1" },
    { id: "eliass-macbook-pro/h2", name: "Home", home: true, machine: "eliass-macbook-pro", chat: "p:eliass-macbook-pro:h2" }],
  tasks: [], needs: [], automations: {}, settings: [], asks: {},
  artifacts: [{ id: "hulk", title: "Hulk mini game · Proof", place: "h1", v: 1, at: now, when: "1m", by: "x" }],
};
const io: VoiceIO = { snap: () => snap, chat: async () => null, send: async () => {}, action: async () => ({ ok: true }) };

// the fake voice agent: sends each test's tool calls, keeps what the call answered
const results: any[] = [];
let agent: any = null;
const server = Bun.serve({
  port: 0,
  fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
  websocket: {
    open(ws) { agent = ws; ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { agent_output_audio_format: "pcm_16000" } })); },
    message(_ws, m) { const x = JSON.parse(String(m)); if (x.type === "client_tool_result") results.push(x); },
  },
});
afterAll(() => server.stop(true));

/** a page: what it was sent, and how it answers an open (none: an old page that never says) */
function page(answer: ((nav: any) => any) | null) {
  const got: any[] = [];
  let call: ReturnType<typeof voiceCall>;
  const p = {
    got,
    send(x: string | Uint8Array) {
      if (typeof x !== "string") return;
      const m = JSON.parse(x);
      got.push(m);
      if (m.type === "nav" && answer) queueMicrotask(() => call.message(JSON.stringify({ type: "navved", id: m.id, ...answer(m.nav) })));
    },
    close() {},
    start(where: Where, navWait = 1000) {
      call = voiceCall({} as any, "the Home Assistant", { view: { lastReply: () => null, status: () => null, asking: () => null }, io, where, follow: () => () => {},
        dial: async () => `ws://127.0.0.1:${server.port}/`, navWait }, p);
      return call;
    },
  };
  return p;
}
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(20); };
const tool = async (params: any) => {
  const n = results.length;
  agent.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name: "open", tool_call_id: `c${n}`, parameters: params } }));
  await until(() => results.length > n);
  return results[n];
};

test("a call from a phone: the open lands on that phone, and is said on screen once it says so", async () => {
  const phone = page((nav) => ({ ok: true, where: { device: "phone", artifact: nav.artifact } }));
  const laptop = page(() => ({ ok: true }));
  const c = phone.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  await Bun.sleep(50);
  const r = await tool({ what: "artifact", id: "the hulk mini game" });
  expect(phone.got.filter((m) => m.type === "nav").map((m) => m.nav)).toEqual([{ kind: "artifact", artifact: "hulk", title: "Hulk mini game · Proof", v: 1, machine: null }]);
  expect(laptop.got).toEqual([]);
  expect(r.result).toBe("It's on the person's screen now: the artifact \"Hulk mini game · Proof\".");
  expect(r.is_error).toBe(false);
  // another machine's space, by its machine's name
  const s = await tool({ what: "space", id: "home on the macbook pro" });
  expect(phone.got.filter((m) => m.type === "nav").pop().nav).toEqual({ kind: "space", place: "eliass-macbook-pro/h2" });
  expect(s.result).toContain("on the person's screen now");
  c.end();
  agent = null;
});

test("a page that can't show it, or never answers: the agent hears it didn't open", async () => {
  const refuses = page(() => ({ ok: false, why: "this app doesn't list that space" }));
  let c = refuses.start({ client: "web", device: "desktop", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  const r = await tool({ what: "space", id: "Mac Mini Home" });
  expect(r.is_error).toBe(true);
  expect(r.result).toContain("couldn't open the Home on This computer (eliass-mac-mini) space on the person's screen: this app doesn't list that space");
  c.end();
  agent = null;
  const old = page(null);
  c = old.start({ client: "web", device: "desktop", machine: "eliass-mac-mini", call: "p:h1" }, 200);
  await until(() => !!agent);
  const o = await tool({ what: "artifact", id: "hulk" });
  expect(o.is_error).toBe(true);
  expect(o.result).toContain("didn't confirm");
  c.end();
});
