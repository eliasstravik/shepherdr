// @ts-nocheck: WebCrypto buffer types are too narrow for a test written byte by byte
import { expect, test } from "bun:test";
import { encrypt, alertsOf, agentAlerts } from "./push.ts";

// decrypting as the browser would (RFC 8291) gives back the alert
test("an alert encrypted for a subscription decrypts with its keys", async () => {
  const s = crypto.subtle;
  const ua = (await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPub = new Uint8Array(await s.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
  const body = await encrypt(new TextEncoder().encode('{"title":"SHEP-7 needs you"}'), b64(uaPub), b64(auth));
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), sealed = body.slice(21 + idlen);
  const hmac = async (k: Uint8Array, d: Uint8Array) => new Uint8Array(await s.sign("HMAC", await s.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
  const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  const e = (t: string) => new TextEncoder().encode(t);
  const asKey = await s.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await s.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), cat(e("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(e("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(e("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const plain = new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce }, await s.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), sealed));
  expect(plain[plain.length - 1]).toBe(2);
  expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"SHEP-7 needs you"}');
});

// the window's toast words: who and what, an Assistant by its space, its Notify followed
test("alerts say what the window's toasts say", () => {
  const place = (level: string) => ({ name: "Notify", level: "sp1", rows: [{ key: "notify", value: level }] });
  const snap = (level = "Needs me") => ({
    places: [{ id: "sp1", name: "tt-repo", chat: "sp1" }],
    tasks: [{ id: "HERD-4", name: "Fix login", status: "ready", place: "sp1" }],
    needs: [{ id: "q1", chat: "sp1", place: "sp1", question: { kind: "Question", title: "Rerun CI?" } }, { id: "q2", chat: "HERD-5/worker", place: "sp1", task: "HERD-5" }],
    settings: [place(level)],
    alerts: [{ id: "a1", title: "HERD-4 · Stuck", body: "why", notify: true }],
  });
  const a = [...alertsOf(snap()).values()];
  expect(a.map((x) => x.title)).toEqual(["tt-repo Assistant · Needs you", "HERD-5 · Needs you", "HERD-4 · Finished", "HERD-4 · Stuck"]);
  expect(a[0].body).toBe("Rerun CI?");
  // another machine's task by its machine's name, never its raw id ("m3:HERD-6")
  const far = { ...snap(), machines: [{ machine: "m3", name: "MacBook" }], needs: [{ id: "q3", chat: "m3:HERD-6/worker", place: "sp1", task: "m3:HERD-6" }], tasks: [], alerts: [] };
  expect([...alertsOf(far).values()].map((x) => x.title)).toEqual(["HERD-6 on MacBook · Needs you"]);
  // Notify Off: nothing from its Assistant; tasks as always
  expect([...alertsOf(snap("Off")).values()].map((x) => x.title)).toEqual(["HERD-5 · Needs you", "HERD-4 · Finished", "HERD-4 · Stuck"]);
});

test("an agent's own alert, from its label", () => {
  const snap = { places: [{ id: "sp1", name: "tt-repo", chat: "sp1" }], tasks: [], settings: [] };
  const terms = [{ address: "t1", state: "live", labels: { "herdr.role": "coordinator", "herdr.alert": JSON.stringify({ id: "x", at: 5, title: "Can't wait", body: "Look now" }) } }];
  const out = agentAlerts(terms, snap, (a) => (a === "t1" ? "sp1" : null), "/nonexistent");
  expect(out).toEqual([{ id: "x", at: 5, title: "tt-repo Assistant · Can't wait", body: "Look now", chat: "sp1", place: "sp1", notify: true }]);
});

// SHEP-243: each alert's buttons do the thing from the phone or the watch, in words that fit a watch
const watch = (snap: any) => [...alertsOf(snap, new Set(), (c) => (c === "sp1" ? "Merged **SHEP-9**, all green.\n\nNext: the login page." : undefined)).values()];
test("a ready task's alert offers Accept, the Tasks panel's Accept", () => {
  const [a] = watch({ places: [], tasks: [{ id: "m3:HERD-4", name: "Fix login", status: "ready", place: "sp1" }], needs: [], settings: [] });
  // one button: Chrome on Android hands every site button over as the last one's action
  expect(a.actions).toEqual([{ action: "accept", title: "Accept" }]);
  expect(a.accept).toEqual({ task: "m3:HERD-4" });
  // it goes once the task isn't ready any more (accepted from the app)
  expect(a.waits).toBe(true);
});

test("a question's first sendable choice is its button: never a grant for good", () => {
  const perm = { id: "r1", kind: "Question", title: "Run: npm test", choices: [{ label: "Yes" }, { label: "Yes, and don't ask again" }, { label: "No" }], always: 1 };
  const [a] = watch({ places: [], tasks: [], settings: [], needs: [{ id: "r1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", question: perm }] });
  expect(a.actions).toEqual([{ action: "0", title: "Yes" }]);
  expect(a.answer).toEqual({ chat: "HERD-5/worker", question: "r1" });
  expect(a.url).toBe("./?place=sp1&task=HERD-5&focus=r1");
  const three = { id: "q", kind: "Question", title: "Which?", choices: [{ label: "Red" }, { label: "Green" }, { label: "Blue" }] };
  const [b] = watch({ places: [], tasks: [], settings: [], needs: [{ id: "q", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", question: three }] });
  expect(b.actions).toEqual([{ action: "0", title: "Red" }]);
  // a plan, a pick of several and a terminal menu stay in the app
  for (const q of [{ ...three, kind: "Plan" }, { ...three, multi: true }, { ...three, id: "menu:x" }]) {
    const [c] = watch({ places: [], tasks: [], settings: [], needs: [{ id: "q", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", question: q }] });
    expect(c.actions).toBeUndefined();
  }
});

test("an agent waiting for words, and an Assistant's message, take a reply", () => {
  const snap = { places: [{ id: "sp1", name: "tt-repo", chat: "sp1" }], tasks: [], settings: [{ name: "Notify", level: "sp1", rows: [{ key: "notify", value: "All" }] }],
    needs: [{ id: "attention", chat: "HERD-5/worker", place: "sp1", task: "HERD-5", text: "Which branch should I use?", reply: "m9" }], last: { sp1: 9 }, read: { sp1: 1 } };
  const [need, msg] = watch(snap);
  expect(need.actions?.map((x) => x.action)).toEqual(["reply"]);
  expect(need.reply).toEqual({ chat: "HERD-5/worker", to: "m9" });
  // the Assistant's own words, short and plain
  expect(msg.title).toBe("tt-repo · New message");
  expect(msg.body).toBe("Merged SHEP-9, all green. Next: the login page.");
  expect(msg.reply).toEqual({ chat: "sp1" });
});

test("every title and body fits a watch", () => {
  const long = "x".repeat(200);
  const all = watch({ places: [{ id: "sp1", name: "a-very-long-space-name-indeed", chat: "sp1" }], tasks: [{ id: "HERD-4", name: long, status: "ready", place: "sp1" }], settings: [],
    needs: [{ id: "q1", chat: "sp1", place: "sp1", question: { id: "q1", kind: "Question", title: long, choices: [{ label: long }] } }], alerts: [{ id: "a", title: long, body: long, notify: true }] });
  expect(all.length).toBe(3);
  for (const a of all) { expect(a.title.length).toBeLessThanOrEqual(30); expect(a.body.length).toBeLessThanOrEqual(80); }
  expect(all[0].title).toBe("a-very-long-space… · Needs you");
  expect(all[0].actions?.[0].title.length).toBeLessThanOrEqual(24);
});
