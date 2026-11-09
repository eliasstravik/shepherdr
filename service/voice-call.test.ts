// A web call end to end, but for the voice service: a fake voice agent's socket asks the real call (voice.ts) to open
// things; the open goes to the page that started the call (a phone, a laptop's browser tab), never another, and the
// agent hears it's on screen only once that page said so.
import { afterAll, expect, test } from "bun:test";
import { callToResume, voiceCall } from "./voice.ts";
import type { VoiceIO, Where } from "./voice-tools.ts";
import type { HearIO } from "./voice-hear.ts";

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
const hear: HearIO = { snap: () => snap, view: () => null, follow: () => ({ stop: () => {} }) };

// the fake voice agent: sends each test's tool calls, keeps what the call answered
const results: any[] = [];
let agent: any = null;
const heard: any[] = [];
let agentClosed = 0;
const server = Bun.serve({
  port: 0,
  fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
  websocket: {
    close() { agentClosed++; },
    open(ws) { agent = ws; ws.send(JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { agent_output_audio_format: "pcm_16000" } })); },
    message(_ws, m) { const x = JSON.parse(String(m)); heard.push(x); if (x.type === "client_tool_result") results.push(x); },
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
      call = voiceCall({} as any, { io, hear, where,
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
  expect(JSON.parse(r.result)).toEqual({ ok: true, shown: "the artifact \"Hulk mini game · Proof\"" });
  expect(r.is_error).toBe(false);
  // another machine's space, by its machine's name
  const s = await tool({ what: "space", id: "home on the macbook pro" });
  expect(phone.got.filter((m) => m.type === "nav").pop().nav).toEqual({ kind: "space", place: "eliass-macbook-pro/h2" });
  expect(JSON.parse(s.result).ok).toBe(true);
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

test("the screen tool: done on the page that started the call, the agent hears the page's new screen", async () => {
  const phone = page((nav) => nav.kind === "screen" ? { ok: true, did: "Scrolled the messages down", screen: "Screen: the web app on a phone.\ne3 button \"Close\"" } : { ok: true });
  const c = phone.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  await Bun.sleep(50);
  const n = results.length;
  agent.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name: "screen", tool_call_id: "s1", parameters: { do: "scroll", direction: "down" } } }));
  await until(() => results.length > n);
  expect(phone.got.filter((m) => m.type === "nav").pop().nav).toMatchObject({ kind: "screen", do: "scroll", direction: "down" });
  // moving around: only that it worked, never the screen to read out (SHEP-83)
  expect(JSON.parse(results[n].result)).toEqual({ ok: true, did: "Scrolled the messages down" });
  expect(results[n].is_error).toBe(false);
  c.end();
  agent = null;
});

test("SHEP-67, SHEP-173: a call the voice service ends by itself says why in plain words; a broken one too", async () => {
  agent = null;
  const phone = page(null);
  phone.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  agent.close(1000, "Conversation has exceeded maximum duration");
  await until(() => phone.got.some((m) => m.type === "ended"));
  expect(phone.got.filter((m) => m.type === "ended" || m.type === "error")).toEqual([{ type: "ended", why: "it reached the 2-hour limit" }]);
  agent = null;
  const other = page(null);
  other.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  agent.close(4000, "quota");
  await until(() => other.got.some((m) => m.type === "ended"));
  expect(other.got.filter((m) => m.type === "ended" || m.type === "error")).toEqual([{ type: "ended", why: "the voice service closed it (quota)" }]);
});

// SHEP-173: ElevenLabs' records showed the model ending calls on its own right after "Passed it to ...". hang_up is
// Shepherdr's: it ends the call only right after the person's yes to a question, else it's refused and the call goes on.
test("SHEP-173: hang_up after a send is refused and the call goes on; after the person's yes it ends with no note", async () => {
  agent = null;
  const phone = page(null);
  const c = phone.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" });
  await until(() => !!agent);
  const ev = (m: object) => agent.send(JSON.stringify(m));
  ev({ type: "user_transcript", user_transcription_event: { user_transcript: "Tell the Home Assistant to update codex." } });
  ev({ type: "agent_response", agent_response_event: { agent_response: "On it." } });
  ev({ type: "client_tool_call", client_tool_call: { tool_name: "send", tool_call_id: "s1", parameters: { to: "Home", text: "Update codex." } } });
  await until(() => results.some((r) => r.tool_call_id === "s1"));
  ev({ type: "agent_response", agent_response_event: { agent_response: "Passed it to the Home Assistant." } });
  ev({ type: "client_tool_call", client_tool_call: { tool_name: "hang_up", tool_call_id: "h1", parameters: {} } });
  await until(() => results.some((r) => r.tool_call_id === "h1"));
  const refused = results.find((r) => r.tool_call_id === "h1");
  expect(refused.is_error).toBe(true);
  expect(JSON.parse(refused.result).ok).toBe(false);
  await Bun.sleep(1800);
  expect(phone.got.some((m) => m.type === "ended" || m.type === "error")).toBe(false);
  // the person asks to end it, is asked, says yes: it ends, after its last words, with no note
  ev({ type: "user_transcript", user_transcription_event: { user_transcript: "End the call." } });
  ev({ type: "agent_response", agent_response_event: { agent_response: "Are you sure you want to end the call?" } });
  ev({ type: "user_transcript", user_transcription_event: { user_transcript: "Yes." } });
  ev({ type: "agent_response", agent_response_event: { agent_response: "Bye." } });
  ev({ type: "client_tool_call", client_tool_call: { tool_name: "hang_up", tool_call_id: "h2", parameters: {} } });
  await until(() => results.some((r) => r.tool_call_id === "h2"));
  expect(results.find((r) => r.tool_call_id === "h2").is_error).toBe(false);
  for (let i = 0; i < 150 && !phone.got.some((m) => m.type === "ended"); i++) await Bun.sleep(20);
  expect(phone.got.filter((m) => m.type === "ended" || m.type === "error")).toEqual([{ type: "ended" }]);
  c.end();
});

// SHEP-102: a phone that locks (or loses the network) may drop the page's socket. The call holds on the server, with
// the voice agent's conversation still open, and the page goes back to it; the agent hears the phone is back.
function bare(who = "person@example.com") {
  const got: any[] = [];
  let closed = false;
  const p = { got, get closed() { return closed; }, send(x: string | Uint8Array) { got.push(typeof x === "string" ? JSON.parse(x) : x); }, close() { closed = true; } };
  const start = (holdMs = 5000) => voiceCall({} as any, { io, hear,
    where: { client: "web", device: "phone", machine: "eliass-mac-mini", call: "p:h1" }, dial: async () => `ws://127.0.0.1:${server.port}/`, holdMs, who }, p);
  return { ...p, p, start };
}

test("SHEP-102: the page's socket drops; the call holds and the page comes back to it, the agent says it's back", async () => {
  agent = null;
  const first = bare();
  const c = first.start();
  const id = first.got.find((m) => m.type === "call")?.id;
  expect(typeof id).toBe("string");
  await until(() => !!agent);
  const closedBefore = agentClosed;
  c.detach(first.p);
  await Bun.sleep(200);
  // still on with the voice agent
  expect(agentClosed).toBe(closedBefore);
  // only the same person gets it back
  expect(callToResume(id, "someone@example.com")).toBeNull();
  const again = bare();
  const n = heard.length;
  expect(callToResume(id, "person@example.com")!.attach(again.p)).toBe(true);
  expect(again.got).toEqual([{ type: "resumed", id }]);
  await until(() => heard.length > n);
  const back = heard.slice(n).find((m) => m.type === "user_message");
  expect(back.text).toContain("lost the call's connection");
  expect(back.text).toContain("Say you're back");
  // the agent's voice now goes to the page that came back
  agent.send(JSON.stringify({ type: "audio", audio_event: { audio_base_64: Buffer.from([1, 0, 2, 0]).toString("base64") } }));
  await until(() => again.got.some((m) => m instanceof Uint8Array));
  expect(again.got.some((m) => m instanceof Uint8Array)).toBe(true);
  expect(first.got.some((m) => m instanceof Uint8Array)).toBe(false);
  // the old socket's late close changes nothing
  c.detach(first.p);
  await Bun.sleep(100);
  expect(again.p.closed).toBe(false);
  c.end();
  expect(callToResume(id, "person@example.com")).toBeNull();
});

test("SHEP-102: a page that never comes back: the call ends once the hold is up; End ends it at once", async () => {
  agent = null;
  const gone = bare();
  const c = gone.start(150);
  const id = gone.got.find((m) => m.type === "call").id;
  await until(() => !!agent);
  const closedBefore = agentClosed;
  c.detach(gone.p);
  await until(() => agentClosed > closedBefore);
  expect(agentClosed).toBe(closedBefore + 1);
  expect(callToResume(id, "person@example.com")).toBeNull();
  // the person's End (or the lock screen's hang up): no holding
  agent = null;
  const ends = bare();
  const d = ends.start();
  const id2 = ends.got.find((m) => m.type === "call").id;
  await until(() => !!agent);
  const before = agentClosed;
  d.message(JSON.stringify({ type: "end" }));
  await until(() => agentClosed > before);
  expect(ends.p.closed).toBe(true);
  expect(callToResume(id2, "person@example.com")).toBeNull();
  expect(d.attach(bare().p)).toBe(false);
});

// SHEP-105: what the call hears waits for a quiet moment: nothing is said over the person, then it comes as one line.
test("SHEP-105: updates wait while the person talks, then come together; a send follows that chat", async () => {
  agent = null;
  const box = { reply: null as null | { id: string; text: string } };
  const hearIO: HearIO = { snap: () => snap, view: (key) => (key === "p:h1" ? { lastReply: () => box.reply, status: () => "idle", asking: () => null } : null), follow: () => ({ stop: () => {} }) };
  const p = page(null);
  const sent: string[] = [];
  const c = voiceCall({} as any, { io: { ...io, send: async (k) => { sent.push(k); } }, hear: hearIO, where: { client: "web", device: "phone", machine: "box" }, dial: async () => `ws://127.0.0.1:${server.port}/` }, p as any);
  await until(() => !!agent);
  await Bun.sleep(100);
  // a sidebar call with no chat: the opening says it is with Shepherdr
  const open = heard.findLast((m) => m.type === "conversation_initiation_client_data");
  expect(open.conversation_config_override.agent.prompt.prompt).toContain("It is with Shepherdr, not one agent");
  // send to Home: followed from now on
  const n = results.length;
  agent.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name: "send", tool_call_id: "s1", parameters: { to: "home on this computer", text: "Check the build" } } }));
  await until(() => results.length > n);
  expect(sent).toEqual(["p:h1"]);
  // its answer to the tool's result (SHEP-113: updates wait until the person's ask is answered)
  agent.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "Passed it to Home." } }));
  // the person keeps talking while a reply comes in
  const loud = new Uint8Array(new Int16Array(1600).map((_, i) => (i % 2 ? 5000 : -5000)).buffer);
  const before = heard.length;
  box.reply = { id: "r1", text: "The build is green." };
  for (let i = 0; i < 6; i++) { c.message(Buffer.from(loud)); await Bun.sleep(300); }
  expect(heard.slice(before).some((m) => m.type === "user_message")).toBe(false);
  // quiet: said once
  await until(() => heard.slice(before).some((m) => m.type === "user_message"));
  const said = heard.slice(before).filter((m) => m.type === "user_message");
  expect(said).toHaveLength(1);
  expect(said[0].text).toContain('the Home Assistant replied: """The build is green."""');
  c.end();
}, 10000);

test("SHEP-113: the person's ask is answered first; updates that came meanwhile wait, then follow; the page sees each state", async () => {
  agent = null;
  const box = { reply: null as null | { id: string; text: string } };
  const hearIO: HearIO = { snap: () => snap, view: (key) => (key === "p:h1" ? { lastReply: () => box.reply, status: () => "idle", asking: () => null } : null), follow: () => ({ stop: () => {} }) };
  const p = page(null);
  // the Home space on screen: the call follows its chat's replies
  const c = voiceCall({} as any, { io, hear: hearIO, where: { client: "web", device: "phone", machine: "box", place: "h1" }, dial: async () => `ws://127.0.0.1:${server.port}/` }, p as any);
  await until(() => !!agent);
  await Bun.sleep(100);
  const states = () => p.got.filter((m) => m.type === "state").map((m) => (m.doing ? `${m.state}: ${m.doing}` : m.state));
  // the person asks; while the voice works on it, a reply comes in elsewhere
  const before = heard.length;
  agent.send(JSON.stringify({ type: "user_transcript", user_transcription_event: { user_transcript: "What's working right now?" } }));
  await until(() => states().includes("thinking"));
  box.reply = { id: "r1", text: "The build is green." };
  agent.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "On it." } }));
  const n = results.length;
  agent.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name: "look", tool_call_id: "l1", parameters: { what: "tasks", query: "working" } } }));
  await until(() => results.length > n);
  // quiet for well past the quiet moment: the update still waits, the answer is owed
  await Bun.sleep(2600);
  expect(heard.slice(before).some((m) => m.type === "user_message")).toBe(false);
  // the answer, then the update after it
  agent.send(JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "Nothing is working now." } }));
  const answeredAt = heard.length;
  await until(() => heard.slice(before).some((m) => m.type === "user_message"));
  const said = heard.slice(before).filter((m) => m.type === "user_message");
  expect(said).toHaveLength(1);
  expect(said[0].text).toContain("The build is green.");
  expect(heard.indexOf(said[0])).toBeGreaterThanOrEqual(answeredAt);
  // the page saw each state, with what the tool did in plain words
  // ("On it." is said while it shows Speaking: the page shows the voice playing over this state)
  expect(states()).toEqual(["listening", "thinking", "listening", "working: checking tasks", "thinking", "listening"]);
  c.end();
}, 10000);

test("SHEP-124: call_view: the voice agent sets the web call full screen or minimized on the page that started it", async () => {
  const phone = page((nav) => ({ ok: true, where: { device: "phone", full: nav.full } }));
  const c = phone.start({ client: "web", device: "phone", machine: "eliass-mac-mini", call: null });
  await until(() => !!agent);
  await Bun.sleep(50);
  for (const view of ["minimized", "full"]) {
    const n = results.length;
    agent.send(JSON.stringify({ type: "client_tool_call", client_tool_call: { tool_name: "call_view", tool_call_id: `v-${view}`, parameters: { view } } }));
    await until(() => results.length > n);
    expect(phone.got.filter((m) => m.type === "nav").pop().nav).toEqual({ kind: "call", full: view === "full" });
    expect(JSON.parse(results[n].result).ok).toBe(true);
    expect(results[n].is_error).toBe(false);
  }
  c.end();
  agent = null;
});
