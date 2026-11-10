// #-mentions of spaces in a chat, the window's and the web app's: typing "#" lists the spaces the machine that runs this
// chat's agent can reach (herdr-task's reach map, the same one `herdr-task assistants` and `tell-assistant` follow:
// herdr-core links and ssh it can log into, one way as each machine sees it), and a picked one goes to the agent as
// `[#shop](space:vm-demo/sp1)`: its name, then the target `herdr-task tell-assistant` takes (the route from the agent's
// machine, then the space's id; a space on the agent's own machine is just its id). Rows show it as a chip; a space the
// agent can't reach (or the viewer doesn't see) shows locked, like Slack's private channel links.
// Shared core: the source is core/mentions.js; bin/sync-shared copies it into the mods in lib/COPIES.

// Where each machine's herdr-task keeps its reach map (refreshed by its scheduler every 5 minutes).
import { SH } from "./paths.js";
export const REACH_FILE = SH + 'cat "${HERDR_TASK_STORE:-$SHEP_TASKS}/.reach.json" 2>/dev/null';

// Every machine in a reach map once, nearest first, with the route that reaches it from the map's start (as
// herdr_task/machines.py nodes(): herdr-core links before ssh).
export function nodes(graph) {
  const out = [], seen = new Set();
  let level = graph ? [[graph, []]] : [];
  while (level.length) {
    const next = [];
    for (const [node, route] of level) {
      const key = node.core?.id ?? `host:${node.host}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ node, route });
      const links = [...(node.links ?? [])].sort((a, b) => (a.how !== "herdr-core") - (b.how !== "herdr-core"));
      for (const l of links) if (l.next && typeof l.next === "object" && Array.isArray(l.next.links)) next.push([l.next, [...route, l.to]]);
    }
    level = next;
  }
  return out;
}

// The spaces a reach map's start can reach, its own first: [{ id, name, route, machine, target, emoji?, assistant }].
// route: "" here, "vm-demo" or "laptop>vm-x"; machine: that machine's own name; target: what tell-assistant takes.
// Each machine's own spaces (another machine's, mirrored in its document, carry a machine and are left out), then the
// spaces the service already knows on that machine (known: [{ id, name, folder, machine, emoji, assistant }], the
// sidebar's list): a machine whose herdr-core document the map read as empty still lists its spaces. A space with no
// name of its own is named as Herdr names it (SHEP-185): "Home" in its machine's home folder, else its folder's name.
export function reachable(graph, known = []) {
  const out = [], seen = new Set();
  for (const { node, route } of nodes(graph)) {
    const r = route.join(">");
    const name = node.core?.name || route[route.length - 1] || node.host || "";
    const live = new Set((node.assistants ?? []).map((a) => a.space).filter(Boolean));
    const own = (node.spaces ?? []).filter((s) => s?.id && !s.machine);
    const called = [name, route[route.length - 1]].filter(Boolean);  // the machine's core name, or the name its link gave
    const mine = known.filter((k) => k?.id && (route.length ? called.includes(k.machine) : !k.machine || called.includes(k.machine)));
    for (const s of [...own, ...mine]) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      const emoji = s.icon || s.emoji;
      out.push({ id: s.id, name: spaceName(s, node.home), route: r, machine: name, target: targetOf(r, s.id),
        ...(emoji ? { emoji } : {}), assistant: live.has(s.id) || !!s.assistant });
    }
  }
  return out;
}

// A space's name as the window shows it: its own, else Herdr's name for an unnamed one (its folder's, "Home" at home).
export function spaceName(s, home) {
  if (s.name) return s.name;
  const f = String(s.folder ?? "").replace(/\/+$/, "");
  if (f) return f === home ? "Home" : f.split("/").pop() || f;
  return "Space";
}

export const targetOf = (route, id) => (route ? `${route}/${id}` : id);

// The "#word" being typed at the end of the box, else null.
export function typing(text) {
  const m = /(?:^|\s)#([\w.-]*)$/.exec(String(text ?? "").replace(/\n+$/, ""));
  return m ? m[1] : null;
}

// Spaces for what is typed: names that start with it first, then names or machines that contain it.
export function match(list, word, n = 6) {
  const w = String(word ?? "").toLowerCase();
  const starts = list.filter((s) => s.name.toLowerCase().startsWith(w));
  const has = list.filter((s) => !s.name.toLowerCase().startsWith(w) && (s.name.toLowerCase().includes(w) || s.machine.toLowerCase().includes(w)));
  return [...starts, ...has].slice(0, n);
}

// What a picked space puts in the message.
export const token = (s) => `[#${s.name}](space:${s.target})`;

// The box with the "#word" being typed swapped for a picked space's short form ("#shop "); the full token goes in at
// send (expand()), so the box stays readable.
export const pickInto = (text, s) => String(text ?? "").replace(/\n+$/, "").replace(/#[\w.-]*$/, `#${s.name} `);

// At send: each "#name" the person picked becomes its token (picked: [{ name, target }], the last pick of a name wins).
export function expand(text, picked) {
  if (!picked?.length) return text;
  const by = new Map(picked.map((s) => [s.name, s]));
  return String(text).replace(/(^|[\s(])#([\w.-]+)(?![\w.-]|\]\()/g, (all, pre, name) => {
    const s = by.get(name) ?? by.get(name.replace(/[.]+$/, ""));
    if (!s) return all;
    const tail = name.slice(s.name.length);
    return `${pre}${token(s)}${tail}`;
  });
}

// Spaces as [#name](space:target), tasks as [@REF](task:target) (taskTarget()).
const RE = /\[([#@])([^\]\n]{1,80})\]\((space|task):([^)\s]+)\)/g;

// A message's words and the mentions in it: [{ text } | { mention: { name, target, id, route } } | { task: { ref, target,
// route, folder } }].
export function split(text) {
  const out = [], s = String(text ?? "");
  let at = 0;
  for (const m of s.matchAll(RE)) {
    if ((m[1] === "#") !== (m[3] === "space")) continue;
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(m[3] === "space" ? { mention: parse(m[2], m[4]) } : { task: parseTask(m[4]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

export function parse(name, target) {
  const i = target.lastIndexOf("/");
  return { name, target, id: i < 0 ? target : target.slice(i + 1), route: i < 0 ? "" : target.slice(0, i) };
}

export const hasMention = (text) => /\[#[^\]\n]+\]\(space:[^)\s]+\)|\[@[^\]\n]+\]\(task:[^)\s]+\)/.test(String(text ?? ""));

// The words a locked chip says, and why (in its label).
export const LOCKED = { label: "Out of reach", why: "This chat's agent can't reach that space, so it can't act on it." };
export const UNSEEN = "That space isn't in your sidebar here.";
export const LOCKED_TASK = "This chat's agent can't reach that task's space, so it can't act on it.";
export const UNSEEN_TASK = "That task isn't in your lists here.";

// A mention as plain markdown, for a place that draws no chips (the window's message text): reachable as its name and
// machine in code style, locked with the words saying so. A task: "@REF · its title" (titleOf(task), when known).
export function plain(text, reach, machineOf, titleOf) {
  return split(text).map((p) => {
    if (p.text !== undefined) return p.text;
    if (p.task) {
      const title = titleOf?.(p.task), where = p.task.route.split(">").pop();
      return "`@" + p.task.ref + (title ? ` · ${short(title)}` : "") + (where ? ` · ${where}` : "") + "`";
    }
    const m = p.mention, ok = !reach || reach.has(m.id);
    const where = machineOf?.(m) || m.route.split(">").pop() || "";
    return "`#" + m.name + (where ? ` · ${where}` : "") + (ok ? "" : ` · ${LOCKED.label.toLowerCase()}`) + "`";
  }).join("");
}

/* ---------- tasks: @SHEP-4 ---------- */
// "@" lists the tasks in the spaces this chat's agent reaches (the same reach map: a task is reachable when its space
// is), and a picked one goes to the agent as `[@SHEP-4](task:vm-demo/SHEP-4?folder=~/dev/shop)`: the route from the
// agent's machine ("" here, "laptop>vm-x" through a hop), then its ID, then the folder whose tasks it is, which
// `herdr-task show SHEP-4 --folder <folder>` takes (`herdr-task --on vm-demo show ...` on another machine). A task in the
// chat's own space leaves the folder out: `[@SHEP-4](task:SHEP-4)`. "@" and not "#": # is spaces, and a task is its
// agent, like mentioning a person. Agent CLIs' own @file pickers never see it: hc send pastes the words.

// The "@word" being typed at the end of the box, else null (an email's "a@b" isn't one).
export function typingTask(text) {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(String(text ?? "").replace(/\n+$/, ""));
  return m ? m[1] : null;
}

// Its words in a target: a folder with a space or ")" can't break the link.
const enc = (folder) => String(folder).split("/").map(encodeURIComponent).join("/");

// What tell a task's agent takes after "task:": [route/]REF[?folder=<folder>].
export const taskTarget = ({ route = "", ref, folder = "" }) => `${route ? `${route}/` : ""}${ref}${folder ? `?folder=${enc(folder)}` : ""}`;

// What a picked task puts in the message.
export const taskToken = (t) => `[@${t.ref}](task:${taskTarget(t)})`;

export function parseTask(target) {
  const q = target.indexOf("?folder="), head = q < 0 ? target : target.slice(0, q);
  let folder = q < 0 ? "" : target.slice(q + 8);
  try { folder = decodeURIComponent(folder); } catch {}
  const i = head.lastIndexOf("/");
  return { ref: i < 0 ? head : head.slice(i + 1), target, route: i < 0 ? "" : head.slice(0, i), folder };
}

// The box with the "@word" being typed swapped for a picked task's short form ("@SHEP-4 "); its token goes in at send.
export const pickTaskInto = (text, t) => String(text ?? "").replace(/\n+$/, "").replace(/@[\w.-]*$/, `@${t.ref} `);

// At send: each "@REF" the person picked becomes its token (picked: [{ ref, route, folder }]).
export function expandTasks(text, picked) {
  if (!picked?.length) return text;
  const by = new Map(picked.map((t) => [t.ref.toLowerCase(), t]));
  return String(text).replace(/(^|[\s(])@([\w.-]+)(?![\w.-]|\]\()/g, (all, pre, word) => {
    const t = by.get(word.toLowerCase()) ?? by.get(word.replace(/[.]+$/, "").toLowerCase());
    return t ? `${pre}${taskToken(t)}${word.slice(t.ref.length)}` : all;
  });
}

// How sure a task is wanted near the top of the list: waiting on you, at work, then ready; done last.
export const TASK_RANK = { need: 0, work: 1, ready: 2, merging: 3, queued: 4, todo: 5, done: 9 };

// Tasks for what is typed: [{ ref, title, status, at?, space?, machine? }]. IDs that start with it first, then IDs,
// titles, spaces or machines that contain it; within each, by TASK_RANK then newest, so Done ones come last.
export function matchTasks(list, word, n = 8) {
  const w = String(word ?? "").toLowerCase();
  const order = (a, b) => (TASK_RANK[a.status] ?? 6) - (TASK_RANK[b.status] ?? 6) || (b.at ?? 0) - (a.at ?? 0);
  const starts = list.filter((t) => t.ref.toLowerCase().startsWith(w)).sort(order);
  const has = list.filter((t) => !t.ref.toLowerCase().startsWith(w) && [t.ref, t.title, t.space, t.machine].some((x) => String(x ?? "").toLowerCase().includes(w))).sort(order);
  const all = [...starts, ...has];
  const live = all.filter((t) => t.status !== "done");
  return (w ? all : [...live, ...all.filter((t) => t.status === "done")]).slice(0, n);
}

// A title short enough for a chip.
export const short = (title, n = 28) => { const t = String(title ?? "").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
