// A web page's live terminal (2.1's terminal bridge, on this service's herdr-core link): one watch-only attach per
// socket. herdr-core sends every stream the same bytes, drawn for the terminal's own size, and a full attach moves
// that size for the agent and every viewer, so a page never says a size: it's told the terminal's, before a first
// paint at that size, and again whenever something else moves it. Typed text alone needs a full attach, at the size
// the terminal already has, so it moves nothing; it ends 2 s after the last key. Input lost to a disconnect is
// never replayed.
import type { Hub } from "./hub.ts";

type Stream = { input(b: Uint8Array): void; close(): void };

// The key names a web page sends (web/plugins/terminal) as the bytes a keyboard types for them. Typed text and keys go
// down the same typing stream, so they arrive in the order they were sent. herdr-core holds a terminal.keys call until
// the person has paused typing there (~3 s after the last typed text), so keys sent that way lag typed text by 3 s.
const NAMED: Record<string, string> = {
  enter: "\r", esc: "\x1b", tab: "\t", "shift+tab": "\x1b[Z", backspace: "\x7f", delete: "\x1b[3~",
  up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", home: "\x1b[H", end: "\x1b[F",
  pageup: "\x1b[5~", pagedown: "\x1b[6~",
};

/** the bytes for keys as a web page names them, or null when one isn't known here: those go as herdr's own key press */
export function keyBytes(keys: string[]): string | null {
  let out = "";
  for (const k of keys) {
    if (k in NAMED) { out += NAMED[k]; continue; }
    const ctrl = /^ctrl\+([a-z])$/.exec(k);
    if (ctrl) { out += String.fromCharCode(ctrl[1].charCodeAt(0) & 0x1f); continue; }
    const alt = /^alt\+([\x20-\x7e])$/.exec(k);
    if (alt) { out += "\x1b" + alt[1]; continue; }
    return null;
  }
  return out;
}
type Socket = { send(data: Uint8Array | string): void; close(): void; buffered(): number };

export function terminalBridge(hub: Hub, address: string, ws: Socket) {
  let ended = false, opened = false, pending = 0, last = 0, repainting = false, watches = 0;
  let stream: Stream | undefined, typist: { stream: Stream; cols: number; rows: number } | undefined;
  let shown: { cols: number; rows: number } | undefined, idle: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  const first = hub.terminals.get(address);
  const live = () => hub.terminals.get(address);
  const valid = () => !ended && !!first && live()?.state === "live" && live()?.pid === first.pid;
  const fail = () => { if (!ended) { finish(); ws.close(); } };
  const moved = () => { const now = live(); return !!now && !!shown && (now.cols !== shown.cols || now.rows !== shown.rows); };
  const unwatch = hub.on((e) => {
    if (ended || !("terminal" in e) || e.terminal !== address || repainting || !moved()) return;
    repainting = true;
    chain = chain.then(() => { repainting = false; return moved() ? watch() : undefined; }).catch(fail);
  });
  const stopTyping = () => { clearTimeout(idle); typist?.stream.close(); typist = undefined; };
  function finish() { ended = true; unwatch(); stopTyping(); stream?.close(); }

  async function watch() {
    const { cols, rows } = live()!, mine = ++watches;
    stream?.close(); stream = undefined;
    shown = { cols, rows };
    ws.send(JSON.stringify({ type: "size", cols, rows }));
    const core = await hub.core();
    const next = await core.attach(address, {
      data(bytes) { if (mine !== watches) return; if (!valid() || ws.buffered() > 1024 * 1024) return fail(); ws.send(bytes); },
      close() { if (mine === watches) fail(); },
    }, cols, rows, { observe: true });
    if (ended || mine !== watches) { next.close(); return; }
    stream = next;
  }

  async function type(bytes: Uint8Array) {
    const { cols, rows } = live()!;
    if (typist?.cols !== cols || typist.rows !== rows) {
      stopTyping();
      const core = await hub.core();
      const mine: NonNullable<typeof typist> = { cols, rows, stream: await core.attach(address, { data() {}, close() { if (typist === mine) typist = undefined; } }, cols, rows) };
      typist = mine;
    }
    typist.stream.input(bytes);
    clearTimeout(idle); idle = setTimeout(stopTyping, 2000);
  }

  return {
    message(raw: string) {
      if (ended) return;
      if (raw.length > 32_768 || pending >= 64) return fail();
      pending++;
      chain = chain.then(async () => {
        if (!valid()) return fail();
        const m = JSON.parse(raw);
        if (!Number.isSafeInteger(m.id) || m.id <= last) return fail();
        last = m.id;
        if (m.type === "open" && !opened) { opened = true; await watch(); }
        else if (!opened) return fail();
        else if (m.type === "text" && typeof m.text === "string") await type(new TextEncoder().encode(m.text));
        else if (m.type === "keys" && Array.isArray(m.keys) && m.keys.length <= 32 && m.keys.every((k: unknown) => typeof k === "string" && k.length <= 40)) {
          const bytes = keyBytes(m.keys);
          if (bytes !== null) await type(new TextEncoder().encode(bytes));
          else await hub.call("terminal.keys", { terminal: address, keys: m.keys });
        } else if (m.type !== "resize") return fail();
        if (!ended) ws.send(JSON.stringify({ type: "ack", id: m.id }));
      }).catch(fail).finally(() => { pending--; });
    },
    end() { if (!ended) finish(); },
  };
}
