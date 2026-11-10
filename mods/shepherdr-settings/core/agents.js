// What an agent runs on (agent, model, effort, speed, context) and how to start it again with other choices: the
// rules both the window's model menu (lib/agent.js, mods/chat-models) and the web app's use. Reading an agent's own
// settings and restarting it run where each side runs commands (lib/agent.js, service/agents.ts).
// Shared core: the source is core/agents.js; bin/sync-shared copies it into the mods in lib/COPIES.
export const NAMES = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };

// Claude Code's current models, as its /model menu offers them. `id` is what --model gets;
// `match` the names a running agent may report for it.
const CLAUDE_MODELS = [
  { id: "opus", name: "Opus 5.5", match: ["opus", "claude-opus-5-5"] },
  { id: "opus[1m]", name: "Opus 5.5 · 1M", match: ["opus[1m]", "claude-opus-5-5[1m]"] },
  { id: "claude-fable-5-1", name: "Fable 5.1", match: ["fable", "claude-fable-5-1"] },
  { id: "sonnet", name: "Sonnet 5.5", match: ["sonnet", "claude-sonnet-5-5"] },
  { id: "haiku", name: "Haiku 5.5", match: ["haiku", "claude-haiku-5-5"] },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// Permission modes as each CLI has them (Claude: --permission-mode, or
// --dangerously-skip-permissions for full access; Codex: its sandbox and approvals).
const PERMS = {
  claude: [{ id: "manual", label: "Ask for approval", icon: "ask" }, { id: "auto", label: "Approve for me", icon: "approve" },
    { id: "bypassPermissions", label: "Full access", icon: "full" }, { id: "plan", label: "Read only", icon: "read", custom: true },
    { id: "acceptEdits", label: "Custom", icon: "ask", custom: true }],
  codex: [{ id: "ask", label: "Ask for approval", icon: "ask" }, { id: "approve", label: "Approve for me", icon: "approve" },
    { id: "full", label: "Full access", icon: "full" }, { id: "read-only", label: "Read only", icon: "read", custom: true },
    { id: "auto", label: "Custom", icon: "ask", custom: true }],
  cursor: [{ id: "ask", label: "Ask for approval", icon: "ask" }, { id: "auto", label: "Approve for me", icon: "approve" },
    { id: "full", label: "Full access", icon: "full" }, { id: "read-only", label: "Read only", icon: "read", custom: true }],
};

// Keep saved CLI-specific modes valid without offering them as shared permission presets.
/** @param {{id: string, label: string, icon?: string, custom?: boolean}[] | undefined} perms
 * @param {string | null | undefined} current */
export function permissionOptions(perms, current) {
  return (perms ?? []).filter((p) => !p.custom || p.id === current);
}

/** @param {string | null | undefined} fallback */
export function mapPermission(from, perm, to, fallback = null) {
  if (from === to) return perm;
  if (!perm) return fallback;
  if (perm === "plan" || perm === "read-only") return to === "claude" ? "plan" : "read-only";
  if (perm === "bypassPermissions" || perm === "full") return to === "claude" ? "bypassPermissions" : "full";
  if (perm === "approve" || perm === "auto" && from !== "codex") return to === "codex" ? "approve" : "auto";
  return to === "claude" ? "manual" : "ask";
}

export function permissionHelp(agent, current) {
  const ask = {
    claude: "Asks before edits and commands unless your saved rules already allow them.",
    codex: "Can edit and run commands in the workspace. Asks you before actions needing broader access, including blocked network access.",
    cursor: "Uses Cursor's normal approval flow without forced or automatic approval flags. Saved Cursor approval settings and allow rules still apply.",
  };
  const approve = {
    claude: "Claude reviews actions in the background and asks when it cannot approve them. Requires Auto mode support for your account and model.",
    codex: "Keeps workspace restrictions and sends eligible approval requests to automatic review. Some actions still need you; availability depends on your Codex version and policy.",
    cursor: "Cursor's Auto-review checks actions in the background and asks for the rest. Requires a supported model and team policy.",
  };
  const full = {
    claude: "Skips normal permission prompts. Required interaction and managed restrictions can still apply.",
    codex: "Bypasses approval prompts and the sandbox, allowing access outside the workspace and to the network.",
    cursor: "Force-allows commands unless explicitly denied. Cursor's sandbox and organization restrictions still apply.",
  };
  const rows = [{ label: "Ask for approval", icon: "ask", about: ask[agent] }, { label: "Approve for me", icon: "approve", about: approve[agent] },
    { label: "Full access", icon: "full", about: full[agent] }];
  if (["plan", "read-only"].includes(current)) rows.push({ label: "Read only", icon: "read", about: "This agent is set to inspect and review without editing source files. HolyCow Review always keeps this restriction." });
  if (agent === "claude" && current === "acceptEdits") rows.push({ label: "Custom (saved)", icon: "ask", about: "Your saved Claude Accept edits mode allows file edits and common file commands without asking. It stays unchanged until you select another mode." });
  if (agent === "codex" && current === "auto") rows.push({ label: "Custom (saved)", icon: "ask", about: "Your saved mode allows workspace changes and inherits the approval reviewer from Codex settings. Select Ask for approval or Approve for me to choose it explicitly." });
  return rows;
}


// What a model id says, in words: "claude-opus-5-5" → "Opus 5.5", "opus[1m]" → "Opus 1M".
export function modelName(id) {
  if (!id) return null;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  const a = /^([a-z]+)(\[1m\])?$/.exec(id);
  if (a) return `${a[1][0].toUpperCase()}${a[1].slice(1)}${a[2] ? " 1M" : ""}`;
  return id;
}

// A flag's value in argv: --model x, --model=x, or -m x.
function flag(argv, ...names) {
  for (let i = argv.length - 1; i >= 0; i--) {
    for (const n of names) {
      if (argv[i] === n && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(n + "=")) return argv[i].slice(n.length + 1);
    }
  }
  return null;
}
// Codex's -c key=value overrides.
function overrides(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] !== "-c" && argv[i] !== "--config") continue;
    const m = /^([\w.]+)=(.*)$/.exec(argv[i + 1]);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// The agent's own settings on its machine: Claude's settings.json, Codex's config.toml and
// model list. Read once per agent process.
export const DEFAULTS = `
if [ "$1" = claude ]; then
  f="$HOME/.claude/settings.json"
  command -v jq >/dev/null && [ -f "$f" ] && jq -r '"model\\t\\(.model // "")", "effort\\t\\(.effortLevel // "")", "fast\\t\\(if .fastMode == true then "on" else "" end)", "per\\t\\(.modelSettings // {} | with_entries(.value |= (.effortLevel // null)) | tojson)", "mode\\t\\(.permissions.defaultMode // "")"' "$f" 2>/dev/null
elif [ "$1" = cursor ]; then
  command -v cursor-agent >/dev/null 2>&1 || exit 0
  echo 'installed	true'
  f="$HOME/.cursor/cli-config.json"
  command -v jq >/dev/null && [ -f "$f" ] && jq -r '"model\\t\\(.model | if type == "object" then (.displayModelId // .modelId) else . end)", "mode\\t\\(.approvalMode // "")"' "$f" 2>/dev/null
  python3 -c 'import subprocess
try:
 r=subprocess.run(["cursor-agent", "--list-models"], capture_output=True, text=True, timeout=8)
 for line in r.stdout.splitlines():
  if " - " in line: print("cursor-model\\t" + line)
except (OSError, subprocess.TimeoutExpired): pass'
else
  f="$HOME/.codex/config.toml"
  for k in model model_reasoning_effort service_tier sandbox_mode approval_policy; do
    printf '%s\\t%s\\n' "$k" "$(sed -n "s/^$k[[:space:]]*=[[:space:]]*\\"\\{0,1\\}\\([^\\"]*\\)\\"\\{0,1\\}.*/\\1/p" "$f" 2>/dev/null | head -1)"
  done
  c="$HOME/.codex/models_cache.json"
  [ -f "$c" ] && { printf 'models\\t'; tr -d '\\n' < "$c"; echo; }
fi
true`;

function parsePer(text) {
  try { return JSON.parse(text || "{}") ?? {}; } catch { return {}; }
}

// The agent's own settings, from DEFAULTS' output on its machine.
export function parseDefaults(kind, stdout) {
  const out = {};
  for (const line of (stdout ?? "").split("\n")) {
    const t = line.indexOf("\t");
    if (t > 0) out[line.slice(0, t)] = line.slice(t + 1);
  }
  if (kind === "cursor") {
    const models = [{ id: "auto", label: "Cursor Auto" }];
    for (const line of (stdout ?? "").split("\n")) {
      const m = /^cursor-model\t([\w.\[\]=,/-]+) - (.+)$/.exec(line.replace(/\x1b\[[0-9;]*m/g, ""));
      if (m && !models.some((x) => x.id === m[1])) models.push({ id: m[1], label: m[2].replace(/ \((?:current|default|current, default)\)$/, "") });
    }
    return { installed: out.installed === "true", model: out.model && !["null", "default"].includes(out.model) ? out.model : "auto", mode: out.mode, models };
  }
  let models = null;
  if (out.models) {
    try {
      models = (JSON.parse(out.models).models ?? []).filter((m) => m.visibility !== "hide").map((m) => ({
        id: m.slug, label: m.display_name || m.slug,
        efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter(Boolean),
        fast: (m.service_tiers ?? []).length > 0,
        defaultEffort: m.default_reasoning_level ?? null,
      }));
    } catch {}
  }
  return kind === "claude"
    ? { model: out.model || null, effort: out.effort || null, fast: Boolean(out.fast), per: parsePer(out.per), mode: out.mode || null }
    : { model: out.model || null, effort: out.model_reasoning_effort || null, fast: ["fast", "priority"].includes(out.service_tier),
      sandbox: out.sandbox_mode || null, approval: out.approval_policy || null, models };
}

// What the agent runs on now: { agent, model, effort, fast, used, window, alias }.
export function current(kind, argv, meta, dflt) {
  argv = argv ?? [];
  meta = meta ?? {};
  dflt = dflt ?? {};
  if (kind === "claude") {
    const alias = flag(argv, "--model") ?? dflt.model;
    let fast = dflt.fast;
    const s = flag(argv, "--settings");
    if (s && /"fastMode"\s*:\s*(true|false)/.test(s)) fast = /"fastMode"\s*:\s*true/.test(s);
    if (meta.speed) fast = meta.speed === "fast";
    const big = /\[1m\]/.test(alias ?? "") || (meta.used ?? 0) > 200000;
    // Claude keeps an effort per model (modelSettings), known once the log names the model.
    const per = meta.model ? dflt.per?.[meta.model] ?? dflt.per?.[meta.model.replace(/-\d+$/, "")] : null;
    const perm = argv.includes("--dangerously-skip-permissions") ? "bypassPermissions" : flag(argv, "--permission-mode") ?? dflt.mode ?? "manual";
    return { agent: "claude", model: meta.model ?? alias, alias, effort: meta.effort ?? flag(argv, "--effort") ?? per ?? dflt.effort,
      fast: Boolean(fast), perm: perm === "default" ? "manual" : perm, used: meta.used ?? null, window: meta.window ?? (big ? 1000000 : 200000) };
  }
  if (kind === "cursor") {
    const model = flag(argv, "--model") ?? dflt.model ?? "auto";
    const mode = flag(argv, "--mode");
    const perm = argv.includes("--plan") || ["ask", "plan"].includes(mode) ? "read-only"
      : argv.some((a) => ["--force", "-f", "--yolo"].includes(a)) ? "full"
      : argv.includes("--auto-review") ? "auto" : dflt.mode === "unrestricted" ? "full" : dflt.mode === "auto-review" ? "auto" : "ask";
    return { agent: "cursor", model, label: model === "auto" ? "Cursor Auto" : dflt.models?.find((m) => m.id === model)?.label ?? model,
      effort: null, fast: false, perm, used: null, window: null };
  }
  const o = overrides(argv);
  const tier = o.service_tier;
  const model = meta.model ?? flag(argv, "-m", "--model") ?? o.model ?? dflt.model;
  const sandbox = flag(argv, "-s", "--sandbox") ?? o.sandbox_mode ?? dflt.sandbox;
  const perm = argv.includes("--dangerously-bypass-approvals-and-sandbox") || sandbox === "danger-full-access" ? "full"
    : sandbox === "read-only" ? "read-only" : o.approvals_reviewer === "auto_review" ? "approve" : o.approvals_reviewer === "user" ? "ask" : "auto";
  return { agent: "codex", model, label: dflt.models?.find((m) => m.id === model)?.label ?? null, perm,
    effort: meta.effort ?? o.model_reasoning_effort ?? dflt.effort,
    fast: tier ? ["fast", "priority"].includes(tier) : Boolean(dflt.fast), used: meta.used ?? null, window: meta.window ?? null };
}

// An effort level as the person reads it: "xhigh" -> "Extra high". The CLIs still get the raw value.
const LEVELS = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", none: "None" };
export function levelName(e) {
  return e ? LEVELS[e] ?? e[0].toUpperCase() + e.slice(1) : null;
}

// "Claude Code · Opus 5.5 · High · Fast"
export function line(c) {
  if (!c) return "";
  return [NAMES[c.agent], c.label ?? modelName(c.model), levelName(c.effort), c.fast ? "Fast" : null].filter(Boolean).join(" · ");
}

// How full the context window is: "38% context", or null.
export function contextWords(c) {
  if (!c?.used || !c.window) return null;
  return `${Math.min(100, Math.round((c.used / c.window) * 100))}% context`;
}

// What the model picker (mods/chat-models, the web's restart.tsx) shows for one agent, as plain data:
// { name, models: [{ id, name, efforts, defaultEffort, fast }], perms }: every model the CLI
// offers (Codex: its own models_cache.json; Claude Code: its /model menu), the picker searches them.
// `dflt` is that agent's settings (defaults()); `current` its running model, kept in the list.
export function menuFor(agent, dflt, current = null) {
  if (agent === "cursor") {
    const all = dflt?.models?.length ? dflt.models : [{ id: "auto", label: "Cursor Auto" }];
    const models = all.map((m) => ({ id: m.id, name: m.id === "auto" ? "Cursor Auto" : m.label, efforts: [], defaultEffort: null, fast: false }));
    if (current && !models.some((m) => m.id === current)) models.unshift(typedModel(agent, current));
    return { name: NAMES.cursor, perms: PERMS.cursor, models };
  }
  if (agent === "claude") {
    const models = CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name, efforts: CLAUDE_EFFORTS,
      defaultEffort: dflt?.per?.[m.match[1].replace(/\[1m\]$/, "")] ?? dflt?.effort ?? null, fast: m.id.startsWith("opus") }));
    // a model typed by id (an older one it still takes) stays in the list while it runs
    if (current && !models.some((m) => m.id === current)) models.unshift({ id: current, name: modelName(current), efforts: CLAUDE_EFFORTS, defaultEffort: dflt?.effort ?? null, fast: false });
    return { name: NAMES.claude, perms: PERMS.claude, models };
  }
  const all = (dflt?.models ?? []).map((m) => ({ id: m.id, name: m.label, efforts: m.efforts?.length ? m.efforts : ["low", "medium", "high", "xhigh"],
    defaultEffort: m.defaultEffort ?? dflt?.effort ?? null, fast: m.fast }));
  if (current && !all.some((m) => m.id === current)) all.unshift({ id: current, name: current, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: dflt?.effort ?? null, fast: false });
  return { name: NAMES.codex, perms: PERMS.codex, models: all };
}

// The levels a model typed by id gets: its agent's usual ones.
export function typedModel(agent, id) {
  return { id, name: agent === "cursor" && id === "auto" ? "Cursor Auto" : agent === "claude" ? modelName(id) : id, efforts: agent === "cursor" ? [] : agent === "claude" ? CLAUDE_EFFORTS : ["low", "medium", "high", "xhigh"], defaultEffort: null, fast: false, typed: true };
}

// The person's picks in the model menus (the window's and the web's alike), in PICKS_FILE under the
// home of the machine the menu runs on: { pinned: ["codex:gpt-6-sol"], recent: [...] }, recent newest first.
export const PICKS_FILE = ".herdr/model-picks.json";
const RECENT = 5;
export const pickKey = (agent, id) => `${agent}:${id}`;
export function parsePicks(text) {
  let d = {};
  try { d = JSON.parse(text || "{}") ?? {}; } catch {}
  const list = (x) => (Array.isArray(x) ? x.filter((k) => typeof k === "string" && k.includes(":")) : []);
  return { pinned: list(d.pinned), recent: list(d.recent).slice(0, RECENT) };
}
// Restarted on it: first among the recent ones.
export function withRecent(picks, key) {
  return { ...picks, recent: [key, ...picks.recent.filter((k) => k !== key)].slice(0, RECENT) };
}
// The star: pinned to the top of its agent's list, or not any more.
export function withPin(picks, key) {
  return { ...picks, pinned: picks.pinned.includes(key) ? picks.pinned.filter((k) => k !== key) : [...picks.pinned, key] };
}

// Every word typed is in the model's name or id somewhere, any case ("op 1m" finds Opus 5.5 · 1M).
export function modelMatches(m, q) {
  const hay = `${m.name ?? ""} ${m.id}`.toLowerCase().replace(/[^a-z0-9.\[\] ]+/g, " ");
  return String(q ?? "").toLowerCase().split(/[^a-z0-9.\[\]]+/).filter(Boolean).every((w) => hay.includes(w));
}

// The model list as the picker shows it: sections of rows, at most CAP rows each (`more` counts the rest).
// Nothing typed: the agent shown (`agent`), its pinned models, then its recent ones, then all the rest in the
// CLI's order. Typed: every agent's matches, an agent to a section (its pinned and recent first), and, for one
// word no model of an agent has as its id, a row per such agent to start it on that id (`typed`).
// Each row: { agent, ...model, pinned }; a section: { key, title, agent, rows, more }.
export const CAP = 200;
export function modelSections(menus, agent, picks, q) {
  picks = picks ?? { pinned: [], recent: [] };
  const query = String(q ?? "").trim();
  const order = (k, models) => {
    const rank = (m) => {
      const key = pickKey(k, m.id), p = picks.pinned.indexOf(key), r = picks.recent.indexOf(key);
      return p >= 0 ? p : r >= 0 ? 1000 + r : 2000;
    };
    return models.map((m, i) => ({ m, i, r: rank(m) })).sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ m }) => ({ agent: k, ...m, pinned: picks.pinned.includes(pickKey(k, m.id)) }));
  };
  // a pinned or recent model typed by id (no CLI lists it) stays on offer
  const saved = (k) => {
    const models = menus?.[k]?.models ?? [], known = new Set(models.map((m) => m.id));
    const ids = [...new Set([...picks.pinned, ...picks.recent].filter((x) => x.startsWith(`${k}:`)).map((x) => x.slice(k.length + 1)))];
    return [...models, ...ids.filter((id) => !known.has(id)).map((id) => ({ ...typedModel(k, id), typed: false }))];
  };
  const capped = (key, title, k, rows) => ({ key, title, agent: k, rows: rows.slice(0, CAP), more: Math.max(0, rows.length - CAP) });
  if (!query) {
    const rows = order(agent, saved(agent));
    const pinned = rows.filter((r) => r.pinned);
    const recent = rows.filter((r) => !r.pinned && picks.recent.includes(pickKey(agent, r.id)));
    const rest = rows.filter((r) => !r.pinned && !picks.recent.includes(pickKey(agent, r.id)));
    return [
      ...(pinned.length ? [capped("pinned", "Pinned", agent, pinned)] : []),
      ...(recent.length ? [capped("recent", "Recent", agent, recent)] : []),
      ...(rest.length ? [capped("all", pinned.length || recent.length ? "All models" : "Models", agent, rest)] : []),
    ];
  }
  const out = [];
  // the agent shown first, then the others in their usual order
  for (const k of [agent, ...Object.keys(menus ?? {}).filter((x) => x !== agent)]) {
    const m = menus?.[k];
    if (!m) continue;
    const rows = order(k, saved(k).filter((x) => modelMatches(x, query)));
    if (rows.length) out.push(capped(k, m.name, k, rows));
  }
  // one word that could be an id, and no model has it: start any agent on it as typed
  if (/^[\w.\[\]-]{2,60}$/.test(query)) {
    const rows = [agent, ...Object.keys(menus ?? {}).filter((x) => x !== agent)]
      .filter((k) => menus?.[k] && !saved(k).some((m) => m.id === query)).map((k) => ({ agent: k, ...typedModel(k, query), pinned: false }));
    if (rows.length) out.push({ key: "typed", title: "Use the id typed", agent, rows, more: 0 });
  }
  return out;
}

// The picker row that is what runs now (`c` from current()), or the model as it is.
export function rowFor(agent, c) {
  if (agent !== "claude") return c?.model ?? null;
  const has = (m, x) => (m.match ?? [m.id]).includes(x);
  // What runs (the log's model) wins; the alias it was started with only tells which row of
  // that model (Opus or Opus 1M), since the log names both alike.
  const byAlias = c?.alias ? CLAUDE_MODELS.find((m) => has(m, c.alias)) : null;
  const byModel = c?.model ? CLAUDE_MODELS.find((m) => has(m, c.model)) : null;
  const same = byAlias && (!c?.model || (byAlias.match ?? [byAlias.id]).some((x) => x.replace(/\[1m\]$/, "") === c.model));
  return (same ? byAlias : byModel ?? byAlias)?.id ?? c?.model ?? null;
}

// Flags that are about what to resume, which model, effort or speed: set again by a restart.
const CURSOR_VALUE = new Set(["--model", "--mode", "--sandbox", "--workspace", "--add-dir", "--plugin-dir", "--output-format", "--api-key", "--endpoint", "--header", "-H", "-e"]);
const CURSOR_DROP = new Set(["--model", "--mode", "--resume"]);
const CURSOR_BARE = new Set(["--continue", "--plan", "--force", "-f", "--yolo", "--auto-review"]);
const CLAUDE_DROP = new Set(["--model", "--effort", "--settings", "--session-id", "--resume", "-r", "--permission-mode"]);
const CLAUDE_BARE = new Set(["--continue", "-c", "--fork-session", "--dangerously-skip-permissions"]);
// Flags whose next word is their value (so it isn't taken for a first message).
const CLAUDE_VALUE = new Set(["--add-dir", "--mcp-config", "--append-system-prompt", "--append-system-prompt-file", "--system-prompt", "--system-prompt-file", "--system-prompt-snapshot",
  "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools", "--agent", "--agents", "--plugin-dir",
  "--fallback-model", "--output-format", "--input-format", "--name", "--setting-sources", "--betas", "--debug-file"]);
const CODEX_VALUE = new Set(["-c", "--config", "-m", "--model", "-p", "--profile", "-s", "--sandbox", "-a", "--ask-for-approval",
  "-C", "--cd", "--add-dir", "-i", "--image", "--enable", "--disable", "--local-provider", "--oss"]);

// The old agent's flags worth keeping (permissions, folders, ...), without what is chosen again
// or a first message.
function kept(kind, argv) {
  const out = [];
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (kind === "cursor") {
      if (CURSOR_BARE.has(a)) continue;
      if (CURSOR_DROP.has(a)) { if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if ([...CURSOR_DROP].some((f) => a.startsWith(f + "="))) continue;
      if (CURSOR_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
      if (a.startsWith("-")) out.push(a);
    } else if (kind === "claude") {
      if (CLAUDE_BARE.has(a)) continue;
      if (CLAUDE_DROP.has(a)) { if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if ([...CLAUDE_DROP].some((f) => a.startsWith(f + "="))) continue;
      if (CLAUDE_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
      if (a.startsWith("-")) out.push(a);
    } else {
      if (i === 0 && (a === "resume" || a === "fork")) { if (rest[1] && !rest[1].startsWith("-")) i++; continue; }
      if (a === "--no-daemon" || a === "--dangerously-bypass-approvals-and-sandbox" || a === "--full-auto") continue;
      if (["-m", "--model", "-s", "--sandbox", "-a", "--ask-for-approval"].includes(a)) { i++; continue; }
      if ((a === "-c" || a === "--config") && /^(model|model_reasoning_effort|service_tier)=/.test(rest[i + 1] ?? "")) { i++; continue; }
      if (CODEX_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
      if (a.startsWith("-")) out.push(a);
    }
  }
  return out.filter((x) => x !== undefined);
}

// The same agent, model and flags as `argv`, without what resumed a conversation (and without a
// first message), or null when argv resumed none: for a fresh start once that session is gone.
export function freshArgv(kind, argv) {
  argv = argv ?? [];
  const at = argv.findIndex((a, i) => (i === 0 || !a.startsWith("-")) && /^(claude|codex|cursor-agent|agent)$/.test(String(a).split("/").pop()));
  if (at < 0) return null;
  const rest = argv.slice(at + 1), out = [argv[at]];
  let resumed = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (kind === "cursor") {
      if (a === "--resume") { resumed = true; if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if (a.startsWith("--resume=") || a === "--continue") { resumed = true; continue; }
      if (CURSOR_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
    } else if (kind === "claude") {
      if (a === "--resume" || a === "-r" || a === "--session-id") { resumed ||= a !== "--session-id"; if (rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if (/^--(resume|session-id)=/.test(a)) { resumed ||= a.startsWith("--resume"); continue; }
      if (a === "--continue" || a === "-c") { resumed = true; continue; }
      if (a === "--fork-session") continue;
      if (CLAUDE_VALUE.has(a) || ["--model", "--effort", "--settings", "--permission-mode"].includes(a)) { out.push(a, rest[++i]); continue; }
    } else {
      if (i === 0 && (a === "resume" || a === "fork")) { resumed = true; continue; }
      if (a === "--last") continue;
      if (CODEX_VALUE.has(a)) { out.push(a, rest[++i]); continue; }
    }
    // A word that isn't a flag or a flag's value: the session's id or a first message.
    if (a.startsWith("-")) out.push(a);
  }
  return resumed ? out.filter((x) => x !== undefined) : null;
}

// How to start the chosen agent: { argv, resume } (resume: argv already continues the session).
// `session`: the old conversation's id when it can be resumed (same agent only).
export function argvFor(pick, old) {
  const same = pick.agent === old.agent;
  const flags = same ? kept(pick.agent, old.argv ?? []) : [];
  if (pick.agent === "claude") {
    const a = ["claude", ...flags];
    if (pick.model) a.push("--model", pick.model);
    if (pick.effort) a.push("--effort", pick.effort);
    a.push("--settings", JSON.stringify({ fastMode: Boolean(pick.fast) }));
    if (pick.perm === "bypassPermissions") a.push("--dangerously-skip-permissions");
    else if (pick.perm) a.push("--permission-mode", pick.perm === "manual" ? "default" : pick.perm);
    if (same && old.session) return { argv: [...a, "--resume", old.session], resume: true, base: a };
    return { argv: a, resume: false, base: a };
  }
  if (pick.agent === "cursor") {
    if (pick.effort || pick.fast) throw new Error("Choose Cursor reasoning and speed through its model ID.");
    const a = ["cursor-agent", ...flags, "--model", pick.model || "auto"];
    if (pick.perm === "full") a.push("--force");
    else if (pick.perm === "read-only") a.push("--mode", "ask");
    else if (pick.perm !== "ask") a.push("--auto-review");
    return { argv: same && old.session ? [...a, "--resume", old.session] : a, resume: Boolean(same && old.session), base: a };
  }
  if (pick.agent !== "codex") throw new Error("Unknown agent: " + pick.agent);
  // Codex runs its commands outside hc without --no-daemon (as herdr-task and restart.sh add).
  const a = [...flags, "--no-daemon"];
  if (pick.model) a.push("-m", pick.model);
  if (pick.effort) a.push("-c", `model_reasoning_effort="${pick.effort}"`);
  // always said, so Fast off wins over a service_tier in config.toml (default: the standard tier)
  a.push("-c", `service_tier="${pick.fast ? "fast" : "default"}"`);
  if (pick.perm === "full") a.push("--dangerously-bypass-approvals-and-sandbox");
  else if (pick.perm === "read-only") a.push("-s", "read-only", "-a", "on-request");
  else if (pick.perm) a.push("-s", "workspace-write", "-a", "on-request");
  if (["ask", "approve"].includes(pick.perm)) a.push("-c", `approvals_reviewer="${pick.perm === "approve" ? "auto_review" : "user"}"`);
  if (same && old.session) return { argv: ["codex", "resume", ...a, old.session], resume: true, base: ["codex", ...a] };
  return { argv: ["codex", ...a], resume: false, base: ["codex", ...a] };
}

// The conversation's id, from its log's file name.
export function sessionOf(kind, path) {
  const m = kind === "claude" ? /([0-9a-f-]{36})\.jsonl$/.exec(path ?? "") : /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(path ?? "");
  return m ? m[1] : null;
}

// A copy of the conversation in a new tab beside this one, through the CLI's own fork.
export function forkArgv(kind, argv, session) {
  if (kind === "cursor") return null;
  argv = argv ?? [];
  // The same model, effort and speed as the original.
  const same = kind === "claude"
    ? ["--model", "--effort", "--settings"].flatMap((f) => { const v = flag(argv, f); return v ? [f, v] : []; })
    : (() => {
      const m = flag(argv, "-m", "--model"), o = overrides(argv);
      return [...(m ? ["-m", m] : []), "--no-daemon",
        ...["model_reasoning_effort", "service_tier"].flatMap((k) => (o[k] ? ["-c", `${k}="${o[k]}"`] : []))];
    })();
  const flags = [...kept(kind, argv), ...same];
  return kind === "claude" ? ["claude", ...flags, "--resume", session, "--fork-session"] : ["codex", "fork", ...flags, session];
}
