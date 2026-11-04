// Who opened a connection to 127.0.0.1. Tailscale's login header is only believed on a connection opened by
// tailscaled (root) or by this machine's owner: another user on the machine could reach 127.0.0.1 and send the
// header itself. Linux reads the kernel's socket table; macOS asks lsof. Only the exact connection counts (caller
// 127.0.0.1:<port> to the service's 127.0.0.1:<service>, established); none, or more than one owner: not believed.
import { existsSync, readFileSync } from "node:fs";

const ME = process.getuid?.() ?? -1;
const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof"].find((p) => existsSync(p)) ?? "lsof";
const LOOP4 = "0100007F";                              // 127.0.0.1 as /proc/net/tcp writes it
const LOOP6 = "0000000000000000FFFF00000100007F";      // ::ffff:127.0.0.1 in tcp6
const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** The uid owning the caller's side of the connection 127.0.0.1:<port> -> 127.0.0.1:<service>, or null. */
export function peerUid(port: number, service: number): number | null {
  const uids = new Set<number>();
  if (process.platform === "linux") {
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text = "";
      try { text = readFileSync(table, "utf8"); } catch { continue; }
      for (const line of text.split("\n").slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f.length < 8 || f[3] !== "01") continue; // ESTABLISHED only
        const ok = (a: string, p: number) => a === `${LOOP4}:${hex(p)}` || a === `${LOOP6}:${hex(p)}`;
        if (ok(f[1], port) && ok(f[2], service)) uids.add(Number(f[7]));
      }
    }
  } else if (process.platform === "darwin") {
    // lsof is in /usr/sbin, which launchd's PATH for the service may lack; none at all: not believed
    let out = "";
    try { out = Bun.spawnSync([LSOF, "-nP", "-a", "-p", `^${process.pid}`, `-iTCP@127.0.0.1:${port}`, "-sTCP:ESTABLISHED", "-Fun"], { stdout: "pipe", stderr: "ignore" }).stdout.toString(); } catch {}
    let uid: number | null = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("u")) uid = Number(line.slice(1));
      else if (line === `n127.0.0.1:${port}->127.0.0.1:${service}` && uid !== null) uids.add(uid);
    }
  }
  return uids.size === 1 ? [...uids][0] : null;
}

/** Tailscale (root) or the owner. */
export const trustedPeer = (port: number | undefined, service: number) => {
  if (!port) return false;
  const uid = peerUid(port, service);
  return uid === 0 || (uid !== null && uid === ME);
};
