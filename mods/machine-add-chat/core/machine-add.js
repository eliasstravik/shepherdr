// Add machine: its words and rules, the same in the window (mods/machine-add-chat) and on the web
// (web/src/screens/AddMachine.tsx, service/actions.ts): the hosts in ~/.ssh/config to pick from (or one typed),
// each added with `hc machine add <target> --json`; one that needs something only the person can answer goes to a
// terminal; an added Mac gets a note about Full Disk Access.
// Plain JS (no herdr or node imports): bin/sync-shared copies it into mods/machine-add-chat/core/.

export const WORDS = {
  title: "Add machine",
  about: "A VPS, a Mac mini, a box at home: Herdr reaches it over ssh, and agents there keep running while your laptop sleeps.",
  fromConfig: "From your ssh config",
  noHosts: "Your ssh config lists no hosts",
  reading: "Reading your ssh config…",
  orType: "Or type how ssh reaches it",
  placeholder: "user@host",
  add: "Add",
  added: "Added",
  connecting: "Connecting",
  waiting: "Waiting in its terminal",
  also: (aliases) => `also ${aliases.join(", ")}`,
  manual: "Herdr couldn't open a terminal for this. Copy the command, then run it in any terminal.",
  copy: "Copy command",
  copied: "Copied",
  noAnswer: "It didn't answer.",
  failed: "It didn't work.",
  bar: (target) => `Adding ${target}: answer it here`,
  macTitle: (name) => `${name} is a Mac: allow its folders once`,
  macAbout: "macOS asks on the Mac's own screen before an agent reads Desktop, Documents or Downloads, and waits until someone answers. Give herdr-core Full Disk Access there and it never asks again: in the list, press + and pick this file:",
  macOpen: (name) => `Open the setting on ${name}`,
  macOpened: "It's open on the Mac's screen.",
};

// The command that adds one, as a person runs it in a terminal.
export const command = (target) => `hc machine add ${target}`;

// Host entries people can pick: named ones, not patterns. [{ alias, aliases, hostname, user }]
export function parseConfig(text) {
  const hosts = [];
  let cur = null;
  for (const raw of (text ?? "").split("\n")) {
    const m = raw.trim().match(/^([^\s#=]+)\s*=?\s*(.*)$/);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "host" || key === "match") {
      const names = key === "host" ? value.split(/\s+/).filter((h) => h && !/[*?!]/.test(h)) : [];
      cur = names.length ? { alias: names[0], aliases: names.slice(1), hostname: null, user: null } : null;
      if (cur) hosts.push(cur);
    } else if (cur && key === "hostname") cur.hostname = value;
    else if (cur && key === "user") cur.user = value;
  }
  return hosts;
}

// What a host's row says beside its name: user@hostname, else its other names.
export const hostSub = (h) => [h.user, h.hostname].filter(Boolean).join("@") || (h.aliases.length ? WORDS.also(h.aliases) : "");

// Why `hc machine add --json` failed ({ kind, message }), or null when it worked.
export function failure(r) {
  if (r.code === 0) return null;
  try { return JSON.parse(r.stdout || r.stderr).error ?? { message: (r.stderr || r.stdout).trim() }; }
  catch { return { message: (r.stderr || r.stdout || WORDS.noAnswer).trim() }; }
}

// Whether only the person can answer it (a password, a new host key, herdr-core to install): a terminal.
export const needsTerminal = (why) => ["hc_missing", "incompatible", "login_needed", "auth_failed", "host_key"].includes(why?.kind)
  || /password|passphrase|host key|permission denied|login/i.test(why?.message ?? "");

// An added machine (hc machine ls) by any name it was added under.
export const isAdded = (added, target) => added.some((m) => m.target === target || m.name === target || m.host === target);

// The terminal's name for an add: add-<target>.
export const terminalName = (target) => `add-${target.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 32);

// On the machine: its OS, and where herdr-core is (sh -c MAC_CHECK).
export const MAC_CHECK = 'uname; command -v herdr-core || echo "$HOME/.local/bin/herdr-core"';
export const MAC_SETTING = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
