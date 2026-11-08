// SHEP-105: what a call with Shepherdr hears: the chats it sent to and the one on screen, and what needs the person
// anywhere, said once and several as one.
import { expect, test } from "bun:test";
import { hearing, type ChatView } from "./voice-hear.ts";
import { talking } from "./voice.ts";

function world() {
  const snap: any = {
    machines: [{ id: "m:box", machine: "box", name: "This computer", here: true }],
    places: [{ id: "shop", name: "shop", machine: "box", chat: "p:shop" }, { id: "lab", name: "lab", machine: "box", chat: "p:lab" }],
    tasks: [{ id: "TEST-7", name: "Fix the login", status: "work", place: "shop", agent: { chat: "TEST-7/worker" } }],
    needs: [],
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
    follow: (key: string) => { followed.push(key); return () => { followed.splice(followed.indexOf(key), 1); }; },
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
  expect(texts(h.take())).toContain('the shop Assistant replied: """The build is fixed."""');
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
  // lab (not followed) asks a question, and TEST-7 turns Ready
  w.snap.needs = [{ id: "q1", chat: "p:lab", place: "lab", at: 1, question: { id: "q1", title: "Which port?", kind: "Question" } }];
  w.snap.tasks[0].status = "ready";
  h.tick();
  const out = h.take();
  expect(out).toHaveLength(1);
  expect(out[0].type).toBe("user_message");
  expect(out[0].text).toContain("2 things came in together");
  expect(out[0].text).toContain("the lab Assistant needs the person: Which port?");
  expect(out[0].text).toContain('TEST 7, "Fix the login", is ready for review');
  // said once
  h.tick();
  expect(h.take()).toEqual([]);
  // the shop Assistant (on screen) asks: its status says it, not a second line
  w.chats["p:shop"].status = "blocked";
  w.chats["p:shop"].asking = "Deploy now?";
  w.snap.needs.push({ id: "q2", chat: "p:shop", place: "shop", at: 2, text: "Deploy now?" });
  h.tick();
  const said = texts(h.take());
  expect(said).toContain("the shop Assistant needs the person: Deploy now?");
  expect(said.match(/needs the person/g)).toHaveLength(1);
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
