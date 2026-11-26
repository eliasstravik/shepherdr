// Update an agent's CLI (Claude Code, Codex) its own official way, then reopen the chat on the same conversation.
// Shepherdr only notices a newer version and runs the CLI's own update command: each CLI knows how it was installed
// (its own installer, npm, Homebrew) and updates itself that way. An agent not listed here shows no Update.

/** each CLI that can update itself: its package on npm (where its newest version is read) and its own update command */
export const UPDATERS = {
  claude: { name: "Claude Code", pkg: "@anthropic-ai/claude-code", update: ["claude", "update"] },
  codex: { name: "Codex", pkg: "@openai/codex", update: ["codex", "update"] },
};

/** the version a CLI's --version prints ("2.1.332 (Claude Code)", "codex-cli 0.163.0"), else null */
export function versionOf(text) {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(String(text ?? ""))?.[1] ?? null;
}

/** a > b, by their numbers (a pre-release counts as older than its release) */
export function newer(a, b) {
  if (!a || !b) return false;
  const parts = (v) => { const [main, pre] = String(v).split("-"); return { n: main.split(".").map((x) => Number(x) || 0), pre: pre ?? null }; };
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0);
  if (x.pre === y.pre) return false;
  return x.pre === null ? true : y.pre === null ? false : x.pre > y.pre;
}

/** the npm tag a CLI updates from: Claude Code's own setting autoUpdatesChannel ("stable" lags "latest") */
export function channelOf(kind, settingsText) {
  if (kind !== "claude") return "latest";
  try { return JSON.parse(settingsText || "{}")?.autoUpdatesChannel === "stable" ? "stable" : "latest"; } catch { return "latest"; }
}

/** What a chat's agent runs: the version its own log says this process wrote (meta.version, written after it
 *  started), else what is installed on its machine (a process just started runs that). */
export function runningVersion(meta, startedMs, installed) {
  if (meta?.version && (!startedMs || (meta.versionAt ?? 0) >= startedMs)) return meta.version;
  return installed ?? null;
}

/** the version a chat can update to, or null: the newest is newer than what it runs now */
export function updateTo(running, latest) {
  return running && latest && newer(latest, running) ? latest : null;
}

/** The toast after an update: the new version, and what the other chats of that agent on that machine do. */
export function doneWords(name, version, others) {
  const first = `${name} is now ${version}.`;
  if (!others) return first;
  return `${first} ${others === 1 ? "1 other chat" : `${others} other chats`} on this machine get${others === 1 ? "s" : ""} it when ${others === 1 ? "it restarts" : "they restart"}.`;
}
