// Who opened a connection to 127.0.0.1. Tailscale's login header is only believed on a connection opened by
// tailscaled (root) or by this machine's owner: another user on the machine could reach 127.0.0.1 and send the
// header itself. Linux reads the kernel's socket table; macOS asks lsof. Unknown means not believed.
import { readFileSync } from "node:fs";

const ME = process.getuid?.() ?? -1;

/** The uid owning the local TCP socket bound to 127.0.0.1:<port> (the caller's side of the connection). */
export function peerUid(port: number): number | null {
  if (process.platform === "linux") {
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text = "";
      try { text = readFileSync(table, "utf8"); } catch { continue; }
      for (const line of text.split("\n").slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f.length < 8) continue;
        const local = f[1].split(":");
        if (parseInt(local[local.length - 1], 16) === port) return Number(f[7]);
      }
    }
    return null;
  }
  if (process.platform === "darwin") {
    const r = Bun.spawnSync(["lsof", "-nP", "-a", "-p", `^${process.pid}`, `-iTCP@127.0.0.1:${port}`, "-sTCP:ESTABLISHED", "-Fu"], { stdout: "pipe", stderr: "ignore" });
    const m = r.stdout.toString().match(/^u(\d+)$/m);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/** Tailscale (root) or the owner. */
export const trustedPeer = (port: number | undefined) => {
  if (!port) return false;
  const uid = peerUid(port);
  return uid === 0 || (uid !== null && uid === ME);
};
