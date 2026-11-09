// @ts-nocheck
// Shepherdr's chat for Pi: names the session log each Pi process writes, as Claude Code's ~/.claude/sessions/<pid>.json
// does, so the chat finds it exactly (core/chat-log.js FIND). Pi keeps no file open and writes no pid file of its own.
// One line per pid: ~/.pi/agent/shepherdr/sessions/<pid> holds the log's path. Only in terminals Herdr runs.
// Installed by Shepherdr into ~/.pi/agent/extensions/shepherdr-session.ts (bin/shepherdr); edit mods/chat/pi-session.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".pi", "agent", "shepherdr", "sessions");
const mine = path.join(dir, String(process.pid));

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; } };

export default function (pi) {
  if (!process.env.HC_TERMINAL_ID) return;
  pi.on("session_start", (_e, ctx) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // what ended without a quit (killed) goes now
      for (const f of fs.readdirSync(dir)) if (/^\d+$/.test(f) && !alive(Number(f))) fs.rmSync(path.join(dir, f), { force: true });
      const file = ctx.sessionManager.getSessionFile();
      if (file) fs.writeFileSync(mine, file + "\n");
      else fs.rmSync(mine, { force: true });
    } catch {}
  });
  pi.on("session_shutdown", (e) => {
    if (e?.reason === "quit") try { fs.rmSync(mine, { force: true }); } catch {}
  });
}
