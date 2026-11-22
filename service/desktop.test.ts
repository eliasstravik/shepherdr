// 3.2 Screens: a desktop's picture is its screen server's own bytes, relayed. Against a stand-in screen server on
// 127.0.0.1: the service ends the handshake itself (a password never reaches the page), a viewer's keys and clicks
// are dropped until the person drives, and a thumbnail is read as a PNG.
import { afterAll, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { clientGate, clientMessageLength, desktopRelay, vnc, vncAnswer, type Bytes } from "./desktop.ts";

const servers: { stop(): void }[] = [];
afterAll(() => servers.forEach((s) => s.stop()));
const hex = (b: Bytes) => Buffer.from(b).toString("hex");
const until = async (ok: () => boolean, ms = 3000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timed out"); await Bun.sleep(10); } };

/** marks the client's hello among what the stand-in kept */
const HELLO = 999;
/** A screen server of 2x2 pixels: asks for no sign-in, or for a password; keeps what a client sent after its hello. */
function fakeVnc(password?: string) {
  const got: number[][] = [];
  const challenge = new Uint8Array(16).map((_, i) => i * 7);
  const srv = Bun.listen<{ buf: number[]; stage: string }>({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(s) { s.data = { buf: [], stage: "version" }; s.write("RFB 003.008\n"); },
      data(s, d) {
        s.data.buf.push(...d);
        const b = s.data.buf, take = (n: number) => b.splice(0, n);
        for (;;) {
          if (s.data.stage === "version" && b.length >= 12) { take(12); s.write(new Uint8Array([1, password ? 2 : 1])); s.data.stage = "type"; }
          else if (s.data.stage === "type" && b.length >= 1) { take(1); if (password) { s.write(challenge); s.data.stage = "auth"; } else { s.write(new Uint8Array(4)); s.data.stage = "init"; } }
          else if (s.data.stage === "auth" && b.length >= 16) { const ok = hex(new Uint8Array(take(16))) === hex(vncAnswer(password!, challenge)); s.write(new Uint8Array([0, 0, 0, ok ? 0 : 1])); if (!ok) return void s.end(); s.data.stage = "init"; }
          else if (s.data.stage === "init" && b.length >= 1) {
            got.push([HELLO, ...take(1)]);
            s.write(new Uint8Array([0, 2, 0, 2, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0, 0, 0, 0, 4, 102, 97, 107, 101]));
            s.data.stage = "run";
          } else if (s.data.stage === "run" && b.length) {
            const n = clientMessageLength(new Uint8Array(b));
            if (n <= 0 || b.length < n) return;
            const m = take(n);
            got.push(m);
            // a picture asked for: one rectangle of raw pixels, red green / blue white
            if (m[0] === 3) s.write(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0]));
          } else return;
        }
      },
    },
  });
  servers.push(srv);
  return { port: srv.port, got };
}
function page() {
  const sent: number[] = [];
  let closed = false;
  return { sent, get closed() { return closed; }, send: (b: Bytes) => void sent.push(...b), close: () => { closed = true; }, buffered: () => 0 };
}

test("how long each client message is", () => {
  expect(clientMessageLength(new Uint8Array([4, 1, 0, 0, 0, 0, 0, 65]))).toBe(8);
  expect(clientMessageLength(new Uint8Array([5]))).toBe(6);
  expect(clientMessageLength(new Uint8Array([2, 0, 0, 3]))).toBe(16);
  expect(clientMessageLength(new Uint8Array([2, 0]))).toBe(0);
  expect(clientMessageLength(new Uint8Array([6, 0, 0, 0, 0, 0, 0, 5]))).toBe(13);
  expect(clientMessageLength(new Uint8Array([6, 0, 0, 0, 0xff, 0xff, 0xff, 0xfc]))).toBe(12);   // extended clipboard: -4
  expect(clientMessageLength(new Uint8Array([99]))).toBe(-1);
});

test("a viewer's keys, clicks and clipboard never pass; a driver's do, split across packets or not", () => {
  let drive = false, inputs = 0;
  const out: number[][] = [];
  let failed = false;
  const gate = clientGate({ driving: () => drive, input: () => inputs++ }, (b) => void out.push([...b]), () => { failed = true; });
  const key = [4, 1, 0, 0, 0, 0, 0, 65], ask = [3, 1, 0, 0, 0, 0, 0, 2, 0, 2], click = [5, 1, 0, 1, 0, 1];
  gate(new Uint8Array([...ask, ...key, ...click]));
  expect(out).toEqual([ask]);
  drive = true;
  gate(new Uint8Array(key.slice(0, 3)));
  gate(new Uint8Array([...key.slice(3), ...click.slice(0, 2)]));
  gate(new Uint8Array(click.slice(2)));
  expect(out).toEqual([ask, key, click]);
  expect(inputs).toBe(2);
  expect(failed).toBe(false);
  gate(new Uint8Array([99, 1, 2]));
  expect(failed).toBe(true);
});

test("the page sees a server that asks for no sign-in, then the screen server's own bytes", async () => {
  const srv = fakeVnc(), p = page();
  let drive = false;
  const r = desktopRelay({ ok: true, port: srv.port, own: true }, p, { driving: () => drive });
  await until(() => p.sent.length >= 12);
  expect(Buffer.from(p.sent).toString()).toBe("RFB 003.008\n");
  r.message(new TextEncoder().encode("RFB 003.008\n"));
  await until(() => p.sent.length >= 14);
  expect(p.sent.slice(12)).toEqual([1, 1]);
  r.message(new Uint8Array([1]));
  await until(() => p.sent.length >= 18);
  r.message(new Uint8Array([0]));                         // the page asks for the screen to itself: it is shared anyway
  await until(() => p.sent.length >= 18 + 28);
  expect(srv.got[0]).toEqual([HELLO, 1]);
  expect(p.sent.slice(18, 22)).toEqual([0, 2, 0, 2]);     // the server's own hello: 2x2
  // view-only: a key goes nowhere, a request for the picture does
  r.message(new Uint8Array([4, 1, 0, 0, 0, 0, 0, 65]));
  r.message(new Uint8Array([3, 0, 0, 0, 0, 0, 0, 2, 0, 2]));
  await until(() => srv.got.length === 2);
  expect(srv.got[1]![0]).toBe(3);
  await until(() => p.sent.length >= 18 + 28 + 32);
  drive = true;
  r.message(new Uint8Array([4, 1, 0, 0, 0, 0, 0, 65]));
  await until(() => srv.got.length === 3);
  expect(srv.got[2]).toEqual([4, 1, 0, 0, 0, 0, 0, 65]);
  r.end();
  expect(p.closed).toBe(true);
});

test("a password is answered by the service, never by the page", async () => {
  const srv = fakeVnc("s3cret"), p = page();
  const r = desktopRelay({ ok: true, port: srv.port, own: false, password: "s3cret" }, p, { driving: () => false });
  await until(() => p.sent.length >= 12);
  r.message(new TextEncoder().encode("RFB 003.008\n"));
  await until(() => p.sent.length >= 14);
  expect(p.sent.slice(12)).toEqual([1, 1]);               // one choice: none
  r.end();
  const wrong = page();
  desktopRelay({ ok: true, port: srv.port, own: false, password: "nope" }, wrong, { driving: () => false });
  await until(() => wrong.closed);
  expect(wrong.sent.length).toBe(0);
});

test("a desktop that can't be shown closes at once, and one that isn't there too", async () => {
  const a = page();
  desktopRelay({ ok: false, why: "This machine has no Xvnc." }, a, { driving: () => true });
  await until(() => a.closed);
  const b = page();
  const gone = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = gone.port;
  gone.stop();
  desktopRelay({ ok: true, port, own: true }, b, { driving: () => true });
  await until(() => b.closed);
});

test("the screen now, as a PNG", async () => {
  const srv = fakeVnc();
  const png = (await vnc.shot({ ok: true, port: srv.port, own: true }))!;
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(png.buffer, png.byteOffset);
  expect([v.getUint32(16), v.getUint32(20)]).toEqual([2, 2]);
  const at = Buffer.from(png).indexOf("IDAT"), len = v.getUint32(at - 4);
  expect([...inflateSync(png.slice(at + 4, at + 4 + len))]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
});
