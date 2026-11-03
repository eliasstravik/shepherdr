// What the agent runs on (agent, model, effort, speed, context), for the line under the
// message box, and restarting it with other choices. The log says what it really runs on
// (log.js `meta`); its arguments and settings fill in what the log doesn't say.
// Restarting reuses Herdr's own ways: `herdr-task switch` for a task's agent, else the
// coordinator's restart.sh. The same agent resumes its conversation; another gets a handoff.
// Either way the new agent starts parked behind this chat (core label herdr.chat).
// Shared: the source is lib/agent.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/agent.js, never a mod's copy, then run bin/sync-shared.

import { exec, hc, appHome } from "herdr";

export const NAMES = { claude: "Claude Code", codex: "Codex" };

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
  claude: [{ id: "manual", label: "Ask" }, { id: "auto", label: "Auto" }, { id: "acceptEdits", label: "Accept edits" },
    { id: "plan", label: "Plan" }, { id: "bypassPermissions", label: "Full access" }],
  codex: [{ id: "read-only", label: "Read only" }, { id: "auto", label: "Auto" }, { id: "full", label: "Full access" }],
};

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
const DEFAULTS = `
if [ "$1" = claude ]; then
  f="$HOME/.claude/settings.json"
  command -v jq >/dev/null && [ -f "$f" ] && jq -r '"model\\t\\(.model // "")", "effort\\t\\(.effortLevel // "")", "fast\\t\\(if .fastMode == true then "on" else "" end)", "per\\t\\(.modelSettings // {} | with_entries(.value |= (.effortLevel // null)) | tojson)", "mode\\t\\(.permissions.defaultMode // "")"' "$f" 2>/dev/null
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

export async function defaults(kind, machine) {
  const r = await exec("sh", ["-c", DEFAULTS, "defaults", kind], { on: machine }).catch(() => null);
  const out = {};
  for (const line of (r?.stdout ?? "").split("\n")) {
    const t = line.indexOf("\t");
    if (t > 0) out[line.slice(0, t)] = line.slice(t + 1);
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
    : { model: out.model || null, effort: out.model_reasoning_effort || null, fast: ["fast", "priority"].includes(out.service_tier), fastInConfig: Boolean(out.service_tier),
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
  const o = overrides(argv);
  const tier = o.service_tier;
  const model = meta.model ?? flag(argv, "-m", "--model") ?? o.model ?? dflt.model;
  const sandbox = flag(argv, "-s", "--sandbox") ?? o.sandbox_mode ?? dflt.sandbox;
  const perm = argv.includes("--dangerously-bypass-approvals-and-sandbox") || sandbox === "danger-full-access" ? "full"
    : sandbox === "read-only" ? "read-only" : "auto";
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

// What the model picker (mods/chat-models) shows for one agent, as plain data:
// { name, models: [{ id, name, efforts, defaultEffort, fast }], perms, fastLocked }.
// `dflt` is that agent's settings (defaults()); `current` its running model, kept in the list.
export function menuFor(agent, dflt, current = null) {
  if (agent === "claude") {
    return { name: NAMES.claude, perms: PERMS.claude, fastLocked: false,
      models: CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name, efforts: CLAUDE_EFFORTS,
        defaultEffort: dflt?.per?.[m.match[1].replace(/\[1m\]$/, "")] ?? dflt?.effort ?? null, fast: m.id.startsWith("opus") })) };
  }
  // Codex lists many: its first few (the cache's order), and the one running now.
  const all = dflt?.models ?? [];
  const shown = all.filter((m, i) => i < 5 || m.id === current);
  return { name: NAMES.codex, perms: PERMS.codex, fastLocked: Boolean(dflt?.fastInConfig),
    models: shown.map((m) => ({ id: m.id, name: m.label, efforts: m.efforts?.length ? m.efforts : ["low", "medium", "high", "xhigh"],
      defaultEffort: m.defaultEffort ?? dflt?.effort ?? null, fast: m.fast })) };
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
const CLAUDE_DROP = new Set(["--model", "--effort", "--settings", "--session-id", "--resume", "-r", "--permission-mode"]);
const CLAUDE_BARE = new Set(["--continue", "-c", "--fork-session", "--dangerously-skip-permissions"]);
// Flags whose next word is their value (so it isn't taken for a first message).
const CLAUDE_VALUE = new Set(["--add-dir", "--mcp-config", "--append-system-prompt", "--system-prompt",
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
    if (kind === "claude") {
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
  const at = argv.findIndex((a, i) => (i === 0 || !a.startsWith("-")) && /^(claude|codex)$/.test(String(a).split("/").pop()));
  if (at < 0) return null;
  const rest = argv.slice(at + 1), out = [argv[at]];
  let resumed = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (kind === "claude") {
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
  // Codex runs its commands outside hc without --no-daemon (as herdr-task and restart.sh add).
  const a = [...flags, "--no-daemon"];
  if (pick.model) a.push("-m", pick.model);
  if (pick.effort) a.push("-c", `model_reasoning_effort="${pick.effort}"`);
  if (pick.fast) a.push("-c", 'service_tier="fast"');
  if (pick.perm === "full") a.push("--dangerously-bypass-approvals-and-sandbox");
  else if (pick.perm === "read-only") a.push("-s", "read-only", "-a", "on-request");
  else if (pick.perm) a.push("-s", "workspace-write", "-a", "on-request");
  if (same && old.session) return { argv: ["codex", "resume", ...a, old.session], resume: true, base: ["codex", ...a] };
  return { argv: ["codex", ...a], resume: false, base: ["codex", ...a] };
}

// The conversation's id, from its log's file name.
export function sessionOf(kind, path) {
  const m = kind === "claude" ? /([0-9a-f-]{36})\.jsonl$/.exec(path ?? "") : /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(path ?? "");
  return m ? m[1] : null;
}

// Restarts the agent `t` (hc get's record) with `argv`, parked behind chat pane `pane`.
// Resolves with the new agent's address.
export async function restart(t, built, pane) {
  const task = t.labels?.["herdr.task"];
  if (task) {
    // herdr-task resumes its own session when the agent stays the same.
    const r = await exec("herdr-task", ["switch", task, "--folder", t.foreground?.cwd ?? t.cwd, "--argv", JSON.stringify(built.base), "--json"]);
    let out = {};
    try { out = JSON.parse(r.stdout || "{}"); } catch {}
    if (r.code !== 0 || !out.terminal) throw new Error((r.stderr || r.stdout).trim() || "herdr-task switch failed");
    const origin = t.labels?.["herdr.chat.origin"] || t.address;
    await hc(["label", out.terminal, `herdr.chat=${pane}`, `herdr.chat.origin=${origin}`]);
    // It started in the tab: park it behind this chat, as the Chat switch does.
    await exec("herdr-app", ["do", "terminal.park", "--terminal", out.terminal]);
    return out.terminal;
  }
  const env = `HERDR_RESTART_CHAT="$1"${built.resume ? " HERDR_RESTART_RESUME=1" : ""}`;
  const r = await exec("sh", ["-c", `${env} bash "$2" "$3" "$4"`, "x", pane, `${appHome()}/mods/coordinator/restart.sh`, t.address, JSON.stringify(built.argv)]);
  const addr = r.stdout.trim().split("\n").pop();
  if (r.code !== 0 || !addr) throw new Error(r.stderr.trim() || "The agent didn't restart.");
  return addr;
}

// A copy of the conversation in a new tab beside this one, through the CLI's own fork.
export function forkArgv(kind, argv, session) {
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
