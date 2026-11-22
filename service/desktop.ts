// A desktop's live picture (3.2 Screens): the service relays a screen server's own bytes (RFB, what VNC speaks)
// between the page's client (noVNC) and the server on 127.0.0.1 of this machine. Nothing here captures or encodes a
// screen: the picture is the screen server's. One small interface (DesktopDriver) with the VNC driver now; Vercel
// Labs' screen-relay can become a second one without the callers changing.
//   Linux: each agent's own virtual display (bin/herdr-desktop starts Xvnc on a loopback port, no password).
//   macOS: the built-in Screen Sharing on 5900, the Mac's one real screen (its password comes from the caller).
// The service ends the screen server's handshake itself (so a password never reaches the page, and the page always
// sees a server that asks for none), then passes bytes both ways. What the page sends is read message by message:
// while the person isn't driving, its keys, pointer and clipboard are dropped here, whatever the page's client does.
// This machine's desktops only: herdr-core's exec returns a command's output when it ends, so it can't carry a live
// stream from another machine.
import { createCipheriv } from "node:crypto";
import { deflateSync } from "node:zlib";

export type Bytes = Uint8Array<ArrayBufferLike>;
/** the page's end of api/desktop: binary both ways */
export type DesktopPage = { send(bytes: Bytes): void; close(): void; buffered(): number };
/** where a desktop's screen server listens on this machine, or why there is none to show */
export type DesktopTarget = { ok: true; port: number; own: boolean; password?: string } | { ok: false; why: string };
/** The one interface a desktop's picture comes through. */
export interface DesktopDriver {
  name: string;
  /** one page's view of the screen server at `target`: its bytes out, the page's in */
  relay(target: Extract<DesktopTarget, { ok: true }>, page: DesktopPage, gate: Gate): { message(bytes: Bytes): void; end(): void };
  /** the screen now, as a PNG */
  shot(target: Extract<DesktopTarget, { ok: true }>): Promise<Bytes | null>;
}
/** who may act: driving() is asked for every key, click and paste; input() is told of each one let through */
export type Gate = { driving(): boolean; input?(): void };

const cat = (a: Bytes, b: Bytes) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

/** A TCP connection read a known number of bytes at a time. */
class Wire {
  private buf: Bytes = new Uint8Array(0);
  private waiting: { n: number; done: (b: Bytes | null) => void } | null = null;
  private sock: any = null;
  closed = false;
  /** once set, bytes go here as they come instead of being kept */
  flow: ((b: Bytes) => void) | null = null;
  onClose: (() => void) | null = null;

  static open(port: number, host = "127.0.0.1"): Promise<Wire> {
    const w = new Wire();
    return new Promise((ok, fail) => {
      Bun.connect({
        hostname: host, port,
        socket: {
          open(s) { w.sock = s; ok(w); },
          data(_s, d) { w.got(new Uint8Array(d)); },
          close() { w.end(); },
          error(_s, e) { w.end(); fail(e); },
          connectError(_s, e) { fail(e); },
        },
      }).catch(fail);
    });
  }
  private got(d: Bytes) {
    if (this.flow) return this.flow(d);
    this.buf = cat(this.buf, d);
    this.feed();
  }
  private feed() {
    const w = this.waiting;
    if (w && this.buf.length >= w.n) { this.waiting = null; const out = this.buf.slice(0, w.n); this.buf = this.buf.slice(w.n); w.done(out); }
  }
  private end() {
    if (this.closed) return;
    this.closed = true;
    this.waiting?.done(null);
    this.onClose?.();
  }
  /** the next n bytes; throws when the other end closed first */
  async read(n: number): Promise<Bytes> {
    if (n === 0) return new Uint8Array(0);
    const b = await new Promise<Bytes | null>((done) => { this.waiting = { n, done }; if (this.closed) done(null); else this.feed(); });
    if (!b) throw new Error("the screen server closed the connection");
    return b;
  }
  /** what was read past the handshake, then every byte as it comes */
  pipe(to: (b: Bytes) => void) { if (this.buf.length) to(this.buf); this.buf = new Uint8Array(0); this.flow = to; }
  write(b: Bytes) { if (!this.closed) this.sock?.write(b); }
  close() { try { this.sock?.end(); } catch {} this.end(); }
}

const u32 = (b: Bytes, at = 0) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const text = (s: string) => new TextEncoder().encode(s);

/** VNC's password answer: the 16-byte challenge under DES, the key being the password's first 8 bytes, each with its
 *  bits in reverse order (RFC 6143, 7.2.2). */
export function vncAnswer(password: string, challenge: Bytes): Bytes {
  const key = new Uint8Array(8);
  const pw = text(password);
  for (let i = 0; i < 8; i++) { let c = pw[i] ?? 0, r = 0; for (let k = 0; k < 8; k++) { r = (r << 1) | (c & 1); c >>= 1; } key[i] = r; }
  const c = createCipheriv("des-ecb", key, null);
  c.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([c.update(challenge), c.final()]));
}

/** The service's own handshake with a screen server, up to the point where the client says hello (ClientInit). */
export async function handshake(w: Wire, password?: string) {
  const ver = new TextDecoder().decode(await w.read(12));
  if (!ver.startsWith("RFB ")) throw new Error("not a screen server");
  const old = ver < "RFB 003.007";
  w.write(text(old ? "RFB 003.003\n" : "RFB 003.008\n"));
  let type: number;
  if (old) type = u32(await w.read(4));
  else {
    const n = (await w.read(1))[0]!;
    if (!n) throw new Error(new TextDecoder().decode(await w.read(u32(await w.read(4)))) || "the screen server refused");
    const types = [...(await w.read(n))];
    type = types.includes(1) ? 1 : types.includes(2) ? 2 : 0;
    if (!type) throw new Error(`the screen server wants a sign-in Shepherdr doesn't speak (types ${types.join(", ")}): on a Mac, turn on "VNC viewers may control screen with password"`);
    w.write(new Uint8Array([type]));
  }
  if (type === 2) {
    if (!password) throw new Error("the screen server wants a password, and none is set for this machine");
    w.write(vncAnswer(password, await w.read(16)));
  } else if (type !== 1) throw new Error("the screen server refused");
  if (!(old && type === 1) && u32(await w.read(4)) !== 0) throw new Error(type === 2 ? "the screen server refused the password" : "the screen server refused");
}

/** How long the client's next message is, once enough of it is here to know; 0: more bytes needed; -1: unknown. */
export function clientMessageLength(b: Bytes): number {
  if (!b.length) return 0;
  switch (b[0]) {
    case 0: return 20;                                              // SetPixelFormat
    case 2: return b.length < 4 ? 0 : 4 + 4 * ((b[2]! << 8) | b[3]!); // SetEncodings
    case 3: return 10;                                              // FramebufferUpdateRequest
    case 4: return 8;                                               // KeyEvent
    case 5: return 6;                                               // PointerEvent
    case 6: { if (b.length < 8) return 0; const n = u32(b, 4) | 0; return 8 + Math.abs(n); } // ClientCutText (extended: negative)
    case 150: return 10;                                            // EnableContinuousUpdates
    case 248: return b.length < 9 ? 0 : 9 + b[8]!;                  // ClientFence
    case 251: return b.length < 8 ? 0 : 8 + 16 * b[6]!;             // SetDesktopSize
    case 252: return 4;                                             // xvp
    case 255: return 12;                                            // QEMU extended key
    default: return -1;
  }
}
/** keys, pointer, clipboard, a resize of the desktop: what only a driver may send */
const ACTS = new Set([4, 5, 6, 251, 255]);

/** The page's bytes, message by message: what a viewer may send goes on; what acts goes on only while driving. */
export function clientGate(gate: Gate, out: (b: Bytes) => void, fail: () => void) {
  let buf: Bytes = new Uint8Array(0);
  return (d: Bytes) => {
    buf = buf.length ? cat(buf, d) : d;
    for (;;) {
      const n = clientMessageLength(buf);
      if (n < 0) return fail();            // a message Shepherdr can't measure: it can't tell what follows, so it stops
      if (n === 0 || buf.length < n) return;
      const m = buf.slice(0, n);
      buf = buf.slice(n);
      if (!ACTS.has(m[0]!)) out(m);
      else if (gate.driving()) { out(m); gate.input?.(); }
    }
  };
}

/** The VNC driver: a screen server on 127.0.0.1 that speaks RFB (Xvnc, x11vnc, macOS Screen Sharing). */
export const vnc: DesktopDriver = {
  name: "vnc",
  relay(target, page, gate) {
    let ended = false, wire: Wire | null = null, toServer: ((b: Bytes) => void) | null = null;
    // the page's side of the handshake, answered here: version, "no sign-in", then its hello
    let stage: "version" | "type" | "init" | "run" = "version";
    let early: Bytes = new Uint8Array(0);
    const end = () => { if (ended) return; ended = true; wire?.close(); try { page.close(); } catch {} };
    const send = (b: Bytes) => { if (!ended) page.send(b); };
    const step = () => {
      if (stage === "version" && early.length >= 12) { early = early.slice(12); stage = "type"; send(new Uint8Array([1, 1])); }
      if (stage === "type" && early.length >= 1) { early = early.slice(1); stage = "init"; send(new Uint8Array([0, 0, 0, 0])); }
      if (stage === "init" && early.length >= 1 && wire) {
        early = early.slice(1);
        stage = "run";
        wire.write(new Uint8Array([1]));    // shared: never throw another viewer (or the agent's own tools) off
        // a page that falls behind loses the connection instead of filling the service's memory
        wire.pipe((b) => { if (page.buffered() > 32 << 20) end(); else send(b); });
        toServer = clientGate(gate, (b) => wire!.write(b), end);
        if (early.length) toServer(early);
        early = new Uint8Array(0);
      }
    };
    void (async () => {
      try {
        const w = await Wire.open(target.port);
        if (ended) return w.close();
        w.onClose = end;
        await handshake(w, target.password);
        wire = w;
        send(text("RFB 003.008\n"));
        step();
      } catch { end(); }
    })();
    return {
      message(b: Bytes) {
        if (ended) return;
        if (stage === "run") return toServer?.(b);
        early = cat(early, b);
        if (early.length > 4096) return end();
        step();
      },
      end,
    };
  },
  async shot(target) {
    let w: Wire | null = null;
    const timer = setTimeout(() => w?.close(), 8000);
    try {
      w = await Wire.open(target.port);
      await handshake(w, target.password);
      w.write(new Uint8Array([1]));
      const init = await w.read(24);
      const width = (init[0]! << 8) | init[1]!, height = (init[2]! << 8) | init[3]!;
      await w.read(u32(init, 20));
      if (!width || !height || width * height > 64_000_000) return null;
      // 32 bits a pixel, little-endian, red in the low byte: R G B x in memory
      w.write(new Uint8Array([0, 0, 0, 0, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0]));
      w.write(new Uint8Array([2, 0, 0, 1, 0, 0, 0, 0]));                 // raw pixels only
      w.write(new Uint8Array([3, 0, 0, 0, 0, 0, width >> 8, width & 255, height >> 8, height & 255]));
      const px = new Uint8Array(width * height * 4);
      let got = 0;
      while (got < width * height) {
        const t = (await w.read(1))[0]!;
        if (t === 2) continue;                                             // bell
        if (t === 3) { const h = await w.read(7); await w.read(u32(h, 3)); continue; } // the server's clipboard
        if (t === 1) { const h = await w.read(5); await w.read(((h[4]! | (h[3]! << 8)) || 0) * 6); continue; } // colour map
        if (t !== 0) return null;
        const rects = await w.read(3);
        for (let i = ((rects[1]! << 8) | rects[2]!); i > 0; i--) {
          const r = await w.read(12);
          const x = (r[0]! << 8) | r[1]!, y = (r[2]! << 8) | r[3]!, rw = (r[4]! << 8) | r[5]!, rh = (r[6]! << 8) | r[7]!;
          if (u32(r, 8) !== 0 || x + rw > width || y + rh > height) return null;
          const data = await w.read(rw * rh * 4);
          for (let row = 0; row < rh; row++) px.set(data.subarray(row * rw * 4, (row + 1) * rw * 4), ((y + row) * width + x) * 4);
          got += rw * rh;
        }
      }
      return png(px, width, height);
    } catch { return null; }
    finally { clearTimeout(timer); w?.close(); }
  },
};

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(b: Bytes) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** R G B x pixels as a PNG (no library: a header, the rows deflated, an end) */
export function png(px: Bytes, width: number, height: number): Bytes {
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0, o = 0; y < height; y++) {
    rows[o++] = 0;
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) { rows[o++] = px[i]!; rows[o++] = px[i + 1]!; rows[o++] = px[i + 2]!; }
  }
  const chunk = (type: string, data: Bytes) => {
    const body = cat(text(type), data), out = new Uint8Array(8 + body.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length); out.set(body, 4); v.setUint32(4 + body.length, crc(body));
    return out;
  };
  const head = new Uint8Array(13), hv = new DataView(head.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); head.set([8, 2, 0, 0, 0], 8);
  return [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", new Uint8Array(deflateSync(rows))), chunk("IEND", new Uint8Array(0))].reduce(cat);
}

/** One page's view of a desktop (ws api/desktop): `target` says where its screen server is (bin/herdr-desktop --own
 *  --up, through service/screens.ts); a desktop that can't be shown closes the page's connection at once. */
export function desktopRelay(target: DesktopTarget | Promise<DesktopTarget>, page: DesktopPage, gate: Gate, driver: DesktopDriver = vnc) {
  let ended = false, inner: { message(b: Bytes): void; end(): void } | null = null;
  const early: Bytes[] = [];
  void Promise.resolve(target).then((t) => {
    if (ended) return;
    if (!t.ok) { ended = true; try { page.close(); } catch {} return; }
    inner = driver.relay(t, page, gate);
    for (const b of early) inner.message(b);
  }).catch(() => { ended = true; try { page.close(); } catch {} });
  return {
    message(b: Bytes | ArrayBuffer | string) {
      if (ended || typeof b === "string") return;
      const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
      if (inner) inner.message(bytes); else if (early.length < 64) early.push(bytes);
    },
    end() { ended = true; inner?.end(); },
  };
}
