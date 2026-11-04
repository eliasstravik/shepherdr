// One service per machine. The lock is a Unix socket: while a service runs it answers there, so a second copy
// sees it and leaves; a socket file nobody answers on is left over from a crash and is taken over.
import { existsSync, unlinkSync } from "node:fs";
import { connect } from "node:net";

function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path);
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 1000);
  });
}

/** Holds the lock and returns a release function, or null when another service already holds it. */
export async function holdLock(path: string): Promise<(() => void) | null> {
  if (existsSync(path)) {
    if (await answers(path)) return null;
    unlinkSync(path);
  }
  try {
    const server = Bun.listen({ unix: path, socket: { data() {}, open(s) { s.end(); } } });
    return () => { server.stop(true); try { unlinkSync(path); } catch {} };
  } catch {
    return null; // lost a race with another copy starting at the same moment
  }
}
