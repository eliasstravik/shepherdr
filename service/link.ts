// Another machine's screens (SHEP-347): its browser stream and its desktop's screen server listen on that machine's
// 127.0.0.1 only. herdr-core's own link can't carry them (its exec returns a command's output when it ends, and a
// terminal's stream is drawn screen text, not bytes), so the service goes the way herdr-core itself dials that
// machine: the same ssh target, or the same `via` command (hc machine ls), running one small program there that joins
// its stdin and stdout to a port on that machine's 127.0.0.1. Here, a forward listens on this machine's 127.0.0.1
// only (a port the system picks) and gives each connection its own such program. Nothing listens beyond loopback on
// either machine, and nothing is opened to the network: the bytes go through the link's own ssh (or command).
// Commands there (herdr-desktop --own --up, herdr-browser --own ...) go the same way, so a display they start keeps
// running after them (herdr-core's exec ends everything a command started).
import { spawn } from "./spawn.ts";

/** a machine as hc machine ls names it: how it is reached and whether its line is up */
export type Link = { name: string; target: string; via?: boolean; state?: string };

/** quoted for sh */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The argv that runs one shell line on that machine, as herdr-core reaches it. */
export function lineArgv(m: Link, line: string): string[] {
  // `via`: a command given the line as its last argument, like ssh (hc runs it as an sh line on Unix)
  if (m.via) return ["sh", "-c", `${m.target} ${shq(line)}`];
  // an ssh target: host, user@host, user@host:port, or a Host from ~/.ssh/config
  const at = /^(.*?)(?::(\d+))?$/.exec(m.target)!;
  return ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ...(at[2] ? ["-p", at[2]] : []), "--", at[1]!, line];
}

/** a line that finds Shepherdr's helpers there (~/.local/bin) and runs argv */
export const helperLine = (argv: string[], env: Record<string, string> = {}) =>
  `PATH="$HOME/.local/bin:$PATH"; ${Object.entries(env).map(([k, v]) => `${k}=${shq(v)} `).join("")}exec ${argv.map(shq).join(" ")}`;

/** Runs argv on that machine (its helpers on PATH). code 255 with no output: the link itself failed. */
export async function runThere(m: Link, argv: string[], opts: { env?: Record<string, string>; input?: Uint8Array; ms?: number } = {}) {
  const p = spawn(lineArgv(m, helperLine(argv, opts.env)), { stdin: opts.input ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" });
  if (opts.input) { (p.stdin as any).write(opts.input); (p.stdin as any).end(); }
  const timer = setTimeout(() => p.kill(), opts.ms ?? 60_000);
  const [out, err] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text()]);
  await p.exited;
  clearTimeout(timer);
  return { code: p.exitCode ?? 1, out, err: err.trim() };
}

// There: joins stdin and stdout to 127.0.0.1:<port> of that machine (python3, as herdr-desktop needs). Exit 3: nothing
// listens there. Sent as base64, so no quoting can change it on the way.
const PUMP = `import os, socket, sys, threading
try:
    s = socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=5)
except Exception:
    sys.stderr.write("nothing listens on that port\\n"); sys.exit(3)
s.settimeout(None)
def up():
    while True:
        d = os.read(0, 65536)
        if not d: break
        s.sendall(d)
    try: s.shutdown(socket.SHUT_WR)
    except Exception: pass
threading.Thread(target=up, daemon=True).start()
out = sys.stdout.buffer
while True:
    d = s.recv(65536)
    if not d: break
    out.write(d); out.flush()
`;
export const pumpLine = (port: number) => `exec python3 -c "import base64;exec(base64.b64decode('${Buffer.from(PUMP).toString("base64")}'))" ${Math.floor(port)}`;

export type Forward = { port: number; close(): void };

/** A port on this machine's 127.0.0.1 that reaches `port` on that machine's 127.0.0.1, one link program for each
 *  connection. close() ends the listener and every connection through it. */
export function forward(m: Link, port: number): Forward {
  const procs = new Set<ReturnType<typeof spawn>>();
  type Data = { proc: ReturnType<typeof spawn<"pipe", "pipe", "ignore">> | null; wake: (() => void) | null };
  const srv = Bun.listen<Data>({
    hostname: "127.0.0.1", port: 0,
    socket: {
      open(sock) {
        const proc = spawn(lineArgv(m, pumpLine(port)), { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
        procs.add(proc);
        sock.data = { proc, wake: null };
        // that machine's bytes to this connection, waiting for the socket to drain when it is full
        void (async () => {
          const r = (proc.stdout as ReadableStream<Uint8Array>).getReader();
          try {
            for (;;) {
              const { value, done } = await r.read();
              if (done) break;
              let rest = value;
              while (rest.length) {
                const n = sock.write(rest);
                rest = rest.subarray(Math.max(n, 0));
                if (rest.length) await new Promise<void>((ok) => { sock.data.wake = ok; setTimeout(ok, 1000); });
              }
            }
          } catch {}
          sock.end();
        })();
        void proc.exited.then(() => { procs.delete(proc); sock.end(); });
      },
      drain(sock) { const w = sock.data?.wake; if (w) { sock.data.wake = null; w(); } },
      data(sock, d) { try { (sock.data.proc!.stdin as any).write(d); (sock.data.proc!.stdin as any).flush?.(); } catch { sock.end(); } },
      close(sock) { const p = sock.data?.proc; if (p) { try { (p.stdin as any).end(); } catch {} p.kill(); } },
      error(sock) { sock.data?.proc?.kill(); },
    },
  });
  return { port: srv.port, close() { srv.stop(true); for (const p of procs) p.kill(); procs.clear(); } };
}
