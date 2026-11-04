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
