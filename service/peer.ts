// Who opened a connection to 127.0.0.1. Tailscale's login header is only believed on a connection opened by
// tailscaled (root) or by this machine's owner: another user on the machine could reach 127.0.0.1 and send the
// header itself. Linux reads the kernel's socket table; macOS asks netstat and ps. Only the exact connection counts (caller
// 127.0.0.1:<port> to the service's 127.0.0.1:<service>, established); none, or more than one owner: not believed.
import { existsSync, readFileSync } from "node:fs";

const ME = process.getuid?.() ?? -1;
const NETSTAT = ["/usr/sbin/netstat", "/usr/bin/netstat"].find((p) => existsSync(p)) ?? "netstat";
const PS = ["/bin/ps", "/usr/bin/ps"].find((p) => existsSync(p)) ?? "ps";
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
    // lsof sees only this user's sockets, and Tailscale's network extension runs as root: netstat -anv names the
    // process of every socket (process:pid), and ps says whose it is. Both in /usr/sbin and /bin, which launchd's PATH
    // for the service may lack; neither answering: not believed.
    for (const pid of darwinPids(port, service)) {
      let out = "";
      try { out = Bun.spawnSync([PS, "-o", "uid=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim(); } catch {}
      if (/^\d+$/.test(out)) uids.add(Number(out));
    }
  }
  return uids.size === 1 ? [...uids][0] : null;
}

/** macOS: the pids holding the caller's side, 127.0.0.1.<port> -> 127.0.0.1.<service>, established (netstat -anv's
 *  process:pid column, after the state). */
export function darwinPids(port: number, service: number, text?: string): number[] {
  let out = text ?? "";
  if (text === undefined) try { out = Bun.spawnSync([NETSTAT, "-anv", "-p", "tcp"], { stdout: "pipe", stderr: "ignore" }).stdout.toString(); } catch {}
  const pids: number[] = [];
  for (const line of out.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[3] !== `127.0.0.1.${port}` || f[4] !== `127.0.0.1.${service}` || f[5] !== "ESTABLISHED") continue;
    const owner = f.slice(6).find((x) => /:\d+$/.test(x));
    if (owner) pids.push(Number(owner.split(":").pop()));
  }
  return pids;
}

/** Tailscale (root) or the owner. */
export const trustedPeer = (port: number | undefined, service: number) => {
  if (!port) return false;
  const uid = peerUid(port, service);
  return uid === 0 || (uid !== null && uid === ME);
};
