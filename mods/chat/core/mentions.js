// #-mentions of spaces in a chat, the window's and the web app's: typing "#" lists the spaces the machine that runs this
// chat's agent can reach (herdr-task's reach map, the same one `herdr-task assistants` and `tell-assistant` follow:
// herdr-core links and ssh it can log into, one way as each machine sees it), and a picked one goes to the agent as
// `[#shop](space:vm-demo/sp1)`: its name, then the target `herdr-task tell-assistant` takes (the route from the agent's
// machine, then the space's id; a space on the agent's own machine is just its id). Rows show it as a chip; a space the
// agent can't reach (or the viewer doesn't see) shows locked, like Slack's private channel links.
// Shared core: the source is core/mentions.js; bin/sync-shared copies it into the mods in lib/COPIES.

// Where each machine's herdr-task keeps its reach map (refreshed by its scheduler every 5 minutes).
export const REACH_FILE = 'cat "${HERDR_TASK_STORE:-$HOME/.herdr/tasks}/.reach.json" 2>/dev/null';

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
// Only each machine's own spaces (another machine's, mirrored in its document, carry a machine and are left out).
export function reachable(graph) {
  const out = [], seen = new Set();
  for (const { node, route } of nodes(graph)) {
    const r = route.join(">");
    const live = new Set((node.assistants ?? []).map((a) => a.space).filter(Boolean));
    for (const s of node.spaces ?? []) {
      if (!s?.id || s.machine || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({ id: s.id, name: s.name || s.id, route: r, machine: node.core?.name || route[route.length - 1] || node.host || "",
        target: targetOf(r, s.id), ...(s.icon ? { emoji: s.icon } : {}), assistant: live.has(s.id) });
    }
  }
  return out;
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

const RE = /\[#([^\]\n]{1,80})\]\(space:([^)\s]+)\)/g;

// A message's words and the mentions in it: [{ text } | { mention: { name, target, id, route } }].
export function split(text) {
  const out = [], s = String(text ?? "");
  let at = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push({ mention: parse(m[1], m[2]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

export function parse(name, target) {
  const i = target.lastIndexOf("/");
  return { name, target, id: i < 0 ? target : target.slice(i + 1), route: i < 0 ? "" : target.slice(0, i) };
}

export const hasMention = (text) => /\[#[^\]\n]+\]\(space:[^)\s]+\)/.test(String(text ?? ""));

// The words a locked chip says, and why (its tooltip).
export const LOCKED = { label: "Out of reach", why: "This chat's agent can't reach that space, so it can't act on it." };
export const UNSEEN = "That space isn't in your sidebar here.";

// A mention as plain markdown, for a place that draws no chips (the window's message text): reachable as its name and
// machine in code style, locked with the words saying so.
export function plain(text, reach, machineOf) {
  return split(text).map((p) => {
    if (p.text !== undefined) return p.text;
    const m = p.mention, ok = !reach || reach.has(m.id);
    const where = machineOf?.(m) || m.route.split(">").pop() || "";
    return "`#" + m.name + (where ? ` · ${where}` : "") + (ok ? "" : ` · ${LOCKED.label.toLowerCase()}`) + "`";
  }).join("");
}
