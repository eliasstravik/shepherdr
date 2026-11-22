// SHEP-105: what a call with Shepherdr hears: the chats it sent to and the one on screen, and what needs the person
// anywhere (a question, a command to allow, a step for their hands, a task Ready for review or Stopped), said once, in
// the app's words, and several as one. Fake data only.
import { expect, test } from "bun:test";
import { hearing, needsNow, type ChatView } from "./voice-hear.ts";
import { talking } from "./voice.ts";

function world() {
  const snap: any = {
    host: "box", everything: "home",
    machines: [{ id: "m:box", machine: "box", name: "box", here: true }],
    places: [{ id: "home", name: "home", home: true, machine: "box", chat: "p:home" }, { id: "shop", name: "shop", machine: "box", chat: "p:shop" }, { id: "lab", name: "lab", machine: "box", chat: "p:lab" }],
    tasks: [{ id: "TEST-7", name: "Fix the login", status: "work", place: "shop", agent: { chat: "TEST-7/worker" } }],
    needs: [], screens: {},
  };
  const chats: Record<string, { reply: { id: string; text: string } | null; status: string | null; asking: string | null }> = {
    "p:shop": { reply: { id: "r0", text: "old" }, status: "idle", asking: null },
    "p:lab": { reply: null, status: "idle", asking: null },
    "TEST-7/worker": { reply: null, status: "working", asking: null },
  };
  const followed: string[] = [];
  const io = {
    snap: () => snap,
    view: (key: string): ChatView | null => chats[key] ? { lastReply: () => chats[key].reply, status: () => chats[key].status, asking: () => chats[key].asking } : null,
    follow: (key: string) => { followed.push(key); return { stop: () => { followed.splice(followed.indexOf(key), 1); } }; },
  };
  return { snap, chats, followed, io };
}
const texts = (lines: { text: string }[]) => lines.map((l) => l.text).join("\n");

test("follows the chat on screen and the ones it sent to; says their replies, not what came before", () => {
  const w = world();
  const h = hearing(w.io);
  h.onScreen({ client: "web", place: "shop" });
  expect(h.following()).toEqual(["p:shop"]);
  h.tick();
  // the reply already there when the call started isn't news
  expect(h.take()).toEqual([]);
  w.chats["p:shop"].reply = { id: "r1", text: "The build is fixed." };
  h.tick();
  expect(texts(h.take())).toContain('A reply in #shop: """The build is fixed."""');
  // sent to lab, then moved to another space: lab stays followed, shop goes
  h.sentTo("p:lab");
  h.onScreen({ client: "web", place: "lab" });
  expect(h.following().sort()).toEqual(["p:lab"]);
  h.onScreen({ client: "web", place: "shop" });
  expect(h.following().sort()).toEqual(["p:lab", "p:shop"]);
  // a task open: its agent is "here"
  h.onScreen({ client: "web", place: "shop", task: "TEST-7" });
  expect(h.following().sort()).toEqual(["TEST-7/worker", "p:lab"]);
  h.stop();
  expect(w.followed).toEqual([]);
});

test("anything new anywhere that needs the person: one short line, once; a followed chat's wait said by its status", () => {
  const w = world();
  const h = hearing(w.io);
  h.onScreen({ client: "web", place: "shop" });
  // lab (not followed) asks a question, and the task turns Ready for review
  w.snap.needs = [{ id: "q1", chat: "p:lab", place: "lab", at: 1, question: { id: "q1", title: "Which port?", kind: "Question" } }];
  w.snap.tasks[0].status = "ready";
  h.tick();
  const out = h.take();
  expect(out).toHaveLength(1);
  expect(out[0].type).toBe("user_message");
  expect(out[0].text).toContain("2 things came in together");
  expect(out[0].text).toContain("#lab asks: Which port?");
  expect(out[0].text).toContain('The task "Fix the login" is ready for review');
  expect(out[0].text).not.toContain("TEST");
  // said once
  h.tick();
  expect(h.take()).toEqual([]);
  // shop's own chat (on screen) asks: its status says it, not a second line
  w.chats["p:shop"].status = "blocked";
  w.chats["p:shop"].asking = "Deploy now?";
  w.snap.needs.push({ id: "q2", chat: "p:shop", place: "shop", at: 2, text: "Deploy now?" });
  h.tick();
  const said = texts(h.take());
  expect(said).toContain("#shop needs the person: Deploy now?");
  expect(said.match(/Deploy now/g)).toHaveLength(1);
  h.stop();
});

test("a chat with no agent yet is followed once it starts", () => {
  const w = world();
  const h = hearing(w.io);
  const saved = w.chats["p:lab"];
  delete (w.chats as any)["p:lab"];
  h.sentTo("p:lab");
  expect(h.following()).toEqual([]);
  w.chats["p:lab"] = saved;
  h.tick();
  expect(h.following()).toEqual(["p:lab"]);
  h.stop();
});

test("someone talking: loud 16-bit samples are, silence isn't", () => {
  const loud = new Int16Array(1600).map((_, i) => (i % 2 ? 4000 : -4000));
  expect(talking(new Uint8Array(loud.buffer))).toBe(true);
  expect(talking(new Uint8Array(3200))).toBe(false);
});

test("a reply already in a chat before its first read came is not news; a later question of a chat still waiting is", async () => {
  const w = world();
  // the chat's history isn't read yet when the call starts following it
  let loaded!: () => void;
  const ready = new Promise<void>((r) => { loaded = r; });
  const real = w.chats["p:shop"].reply;
  w.chats["p:shop"].reply = null;
  const h = hearing({ ...w.io, follow: (key) => ({ stop: () => {}, ready: key === "p:shop" ? ready : undefined }) });
  h.onScreen({ client: "web", place: "shop" });
  h.tick();
  // its history comes in: the old reply shows up, and isn't said
  w.chats["p:shop"].reply = real;
  loaded();
  await Bun.sleep(0);
  h.tick();
  expect(h.take()).toEqual([]);
  // it waits on the person: said once (its status), its need not again
  w.chats["p:shop"].status = "blocked";
  w.chats["p:shop"].asking = "Deploy now?";
  h.tick();
  w.snap.needs = [{ id: "q1", chat: "p:shop", place: "shop", at: 1, text: "Deploy now?" }];
  h.tick();
  expect(texts(h.take()).match(/Deploy now/g)).toHaveLength(1);
  // still waiting, a second question comes: said
  w.snap.needs.push({ id: "q2", chat: "p:shop", place: "shop", at: 2, question: { id: "q2", title: "Which branch?", kind: "Question" } });
  h.tick();
  // (within the window of the status line, the first need took its one skip)
  expect(texts(h.take())).toContain("Which branch?");
  h.stop();
});

test("a quick answer to the call's send, there by the chat's first read, is still said", async () => {
  const w = world();
  let loaded!: () => void;
  const ready = new Promise<void>((r) => { loaded = r; });
  const h = hearing({ ...w.io, follow: (key) => ({ stop: () => {}, ready: key === "p:lab" ? ready : undefined }) });
  const asked = Date.now();
  h.sentTo("p:lab", asked);
  w.chats["p:lab"].reply = { id: "r9", text: "Port 5173.", at: asked + 50 } as any;
  loaded();
  await Bun.sleep(0);
  h.tick();
  expect(texts(h.take())).toContain('A reply in #lab: """Port 5173."""');
  h.stop();
});

test("the chat on screen read just before a send answered quickly: still said; a need that comes back is said again", async () => {
  const w = world();
  let loaded!: () => void;
  const ready = new Promise<void>((r) => { loaded = r; });
  const h = hearing({ ...w.io, follow: (key) => ({ stop: () => {}, ready: key === "p:lab" ? ready : undefined }) });
  h.onScreen({ client: "web", place: "lab" });
  const asked = Date.now();
  // its first read comes with the answer while the send is still on its way
  w.chats["p:lab"].reply = { id: "r5", text: "Done.", at: asked + 20 } as any;
  loaded();
  await Bun.sleep(0);
  h.sentTo("p:lab", asked);
  h.tick();
  expect(texts(h.take())).toContain('A reply in #lab: """Done."""');
  // a task waits ("attention"), is answered, then waits again: said both times
  const need = { id: "attention", chat: "TEST-7/worker", place: "shop", task: "TEST-7", at: 1, text: "Stuck on a prompt" };
  w.snap.needs = [need];
  h.tick();
  expect(texts(h.take())).toContain('The task "Fix the login" needs the person: Stuck on a prompt');
  w.snap.needs = [];
  h.tick();
  w.snap.needs = [{ ...need, at: 2 }];
  h.tick();
  expect(texts(h.take())).toContain('The task "Fix the login" needs the person: Stuck on a prompt');
  h.stop();
});

test("3.2: a command to allow, a step for the person's hands, a task Stopped: each said once, in the app's words", () => {
  const w = world();
  const h = hearing(w.io);
  h.onScreen({ client: "web", place: "home" });
  // a task wants to run a command
  w.snap.needs = [{ id: "p1", chat: "TEST-7/worker", place: "shop", task: "TEST-7", at: 1, question: { id: "p1", title: "Run a command", command: "npm test", kind: "Question", choices: [{ label: "Allow once" }, { label: "Decline" }] } }];
  w.snap.tasks[0].status = "need";
  h.tick();
  expect(texts(h.take())).toContain('The task "Fix the login" wants to run a command: npm test. Tell the person in one short line.');
  // answered; then it needs the person's hands on its Screen (its plain wait is not said beside it)
  w.snap.needs = [{ id: "attention", chat: "TEST-7/worker", place: "shop", task: "TEST-7", at: 2, text: "" }];
  w.snap.screens = { "task:TEST-7": { b: { url: "https://store.example" }, hands: { what: "Sign in to the store" } } };
  h.tick();
  const hands = h.take();
  expect(hands).toHaveLength(1);
  expect(hands[0].text).toContain('The task "Fix the login" needs your hands on its Screen: Sign in to the store');
  expect(hands[0].text).not.toContain("things came in together");
  // done by hand: settled is not said again
  w.snap.screens["task:TEST-7"].hands.settled = "done";
  w.snap.needs = [];
  h.tick();
  expect(h.take()).toEqual([]);
  // it crashes: Stopped, with why; Stopped by you is the person's own doing and is not news
  w.snap.tasks[0].stopped = { by: "error", why: "Its agent is no longer running." };
  h.tick();
  expect(texts(h.take())).toContain('The task "Fix the login" stopped: Its agent is no longer running.');
  h.tick();
  expect(h.take()).toEqual([]);
  w.snap.tasks.push({ id: "TEST-8", name: "Tidy up", status: "need", place: "lab", stopped: { by: "you" } });
  w.snap.needs = [{ id: "attention", chat: "TEST-8/worker", place: "lab", task: "TEST-8", at: 3, text: "" }];
  h.tick();
  expect(h.take()).toEqual([]);
  // Everything's own chat asks for a secret: its name, never by voice
  w.snap.needs = [{ id: "secret:t1:API_TOKEN", chat: "p:home", place: "home", at: 4, secret: { id: "s", name: "API_TOKEN", levels: [] } }];
  h.tick();
  expect(texts(h.take())).toContain("Everything needs the secret API_TOKEN. Tell the person");
  h.stop();
});

test("what needed the person before the call started is not news; archived tasks never are", () => {
  const w = world();
  w.snap.tasks[0].status = "ready";
  w.snap.tasks.push({ id: "TEST-9", name: "Put away", status: "ready", place: "lab", archived: 5 });
  expect([...needsNow(w.snap).keys()]).toEqual(["ready:TEST-7"]);
  const h = hearing(w.io);
  h.tick();
  expect(h.take()).toEqual([]);
  h.stop();
});
