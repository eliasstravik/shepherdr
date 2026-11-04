// What an agent runs on (agent, model, effort, speed, context) and how to start it again with other choices: the
// rules both the window's model menu (lib/agent.js, mods/chat-models) and the web app's use. Reading an agent's own
// settings and restarting it run where each side runs commands (lib/agent.js, service/agents.ts).
// Shared core: the source is core/agents.js; bin/sync-shared copies it into the mods in lib/COPIES.
import { KINDS } from "./kinds.js";

// The agent kinds (lib/kinds.json, written to core/kinds.js by bin/sync-shared): Claude Code and Codex, which this
// file knows in depth (their settings, permission modes and session logs), and the other CLIs (pi, pii, grok,
// hermes, amp, cursor), started and resumed as the table spells their flags.
export { KINDS };
export const AGENTS = Object.keys(KINDS);
export const NAMES = Object.fromEntries(AGENTS.map((k) => [k, KINDS[k].name]));
// The kind an argv runs ("cursor-agent" -> "cursor"), or null.
export function kindOf(argv) {
  const prog = String((argv ?? [])[0] ?? "").split("/").pop();
  return AGENTS.find((k) => KINDS[k].run[0] === prog) ?? null;
}
const PROGS = new Set(AGENTS.map((k) => KINDS[k].run[0]));
// The permission mode a new agent of a kind gets unless picked: Claude Code's settings mode (dflt.mode), Codex's
// sandbox and approvals ("auto"), the first the table lists for the others (null when it has none).
export function permDefault(kind, dflt) {
  return kind === "claude" ? dflt?.mode ?? "manual" : kind === "codex" ? "auto" : KINDS[kind]?.perms?.[0]?.id ?? null;
}
// Which kinds are installed on a machine: Herdr's word on the program (`known`, knownAgents) when it has one; else
// Claude Code yes, Codex no (as before: no entry, no Codex), the others whether their command was found
// (dflts[k].installed, DEFAULTS' line).
export function installedOf(known, dflts) {
  const prog = (k) => (known ?? []).find((a) => a.key === k || (a.run ?? [])[0] === KINDS[k].run[0]);
  return Object.fromEntries(AGENTS.map((k) => [k, prog(k) ? prog(k).installed !== false : k === "claude" || Boolean(dflts?.[k]?.installed)]));
}

// Claude Code's current models, as its /model menu offers them. `id` is what --model gets;
// `match` the names a running agent may report for it.
const CLAUDE_MODELS = KINDS.claude.models;
const CLAUDE_EFFORTS = KINDS.claude.effort.levels;
// Permission modes as each CLI has them (Claude: --permission-mode, or
// --dangerously-skip-permissions for full access; Codex: its sandbox and approvals; the others
// ask, or get their one full-access flag).
const PERMS = Object.fromEntries(AGENTS.map((k) => [k, KINDS[k].perms]));

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
// model list; for the other kinds, whether their command ($2, the kind's program) is on PATH.
// Read once per agent process. Run as: sh -c DEFAULTS defaults <kind> <program>.
export const DEFAULTS = `
if [ "$1" = claude ]; then
  f="$HOME/.claude/settings.json"
  command -v jq >/dev/null && [ -f "$f" ] && jq -r '"model\\t\\(.model // "")", "effort\\t\\(.effortLevel // "")", "fast\\t\\(if .fastMode == true then "on" else "" end)", "per\\t\\(.modelSettings // {} | with_entries(.value |= (.effortLevel // null)) | tojson)", "mode\\t\\(.permissions.defaultMode // "")"' "$f" 2>/dev/null
elif [ "$1" = codex ]; then
  f="$HOME/.codex/config.toml"
  for k in model model_reasoning_effort service_tier sandbox_mode approval_policy; do
    printf '%s\\t%s\\n' "$k" "$(sed -n "s/^$k[[:space:]]*=[[:space:]]*\\"\\{0,1\\}\\([^\\"]*\\)\\"\\{0,1\\}.*/\\1/p" "$f" 2>/dev/null | head -1)"
  done
  c="$HOME/.codex/models_cache.json"
  [ -f "$c" ] && { printf 'models\\t'; tr -d '\\n' < "$c"; echo; }
else
  command -v "\${2:-$1}" >/dev/null 2>&1 && printf 'installed\\t1\\n'
fi
true`;
// DEFAULTS' arguments for a kind: ["defaults", kind, program].
export const defaultsArgs = (kind) => ["defaults", kind, KINDS[kind]?.run?.[0] ?? kind];

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
  if (kind !== "claude" && kind !== "codex") return { installed: Boolean(out.installed), effort: KINDS[kind]?.defaultEffort ?? null };
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
  if (kind !== "codex") {
    // One of the other kinds: its flags say what it runs on.
    const k = KINDS[kind] ?? {};
    let model = flag(argv, ...(k.model ? [k.model] : []));
    let effort = k.effort?.style === "flag" && k.effort.flag ? flag(argv, k.effort.flag) : null;
    const br = k.effort?.style === "bracket" && model ? /^(.*)\[effort=([^\]]*)\]$/.exec(model) : null;
    if (br) [model, effort] = [br[1], br[2]];
    const full = (k.full ?? []).length > 0 && k.full.every((f) => argv.includes(f));
    const plan = kind === "cursor" && flag(argv, "--mode") === "plan";
    return { agent: kind, model: meta.model ?? model, effort: meta.effort ?? effort ?? dflt.effort ?? k.defaultEffort ?? null, fast: false,
      perm: full ? "full" : plan ? "plan" : k.perms?.[0]?.id ?? null, used: meta.used ?? null, window: meta.window ?? null };
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
  if (agent !== "codex") {
    // The other kinds: the table's models (and the one running now, typed or not), its levels.
    const k = KINDS[agent];
    if (!k) return { name: agent, perms: [], fastLocked: false, models: [] };
    const models = k.models.map((m) => ({ id: m.id, name: m.name }));
    if (current && !models.some((m) => m.id === current)) models.push({ id: current, name: current });
    if (!models.length) models.push({ id: "", name: `${k.name}'s default` });
    return { name: k.name, perms: k.perms ?? [], fastLocked: true,
      models: models.map((m) => ({ ...m, efforts: k.effort?.levels ?? [], defaultEffort: dflt?.effort ?? k.defaultEffort ?? null, fast: false })) };
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
  if (kind !== "claude" && kind !== "codex") {
    // The other kinds: every flag but the model, effort, session and full-access ones (their
    // values go with them); a bare word is the session id or a first message.
    const k = KINDS[kind] ?? {};
    const drop = new Set([k.model, k.effort?.style === "flag" ? k.effort.flag : null, k.resume?.flag, forkFlag(k), "--mode",
      ...(k.resume?.style === "thread" ? k.resume.sub : []), ...(k.full ?? [])].filter(Boolean));
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (drop.has(a)) { if (!(k.full ?? []).includes(a) && rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if ([...drop].some((f) => a.startsWith(f + "="))) continue;
      // A flag, with the word after it when that is its value (not another flag).
      if (a.startsWith("-")) { out.push(a); if (rest[i + 1] && !rest[i + 1].startsWith("-")) out.push(rest[++i]); }
    }
    return out;
  }
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
  const at = argv.findIndex((a, i) => (i === 0 || !a.startsWith("-")) && PROGS.has(String(a).split("/").pop()));
  if (at < 0) return null;
  const rest = argv.slice(at + 1), out = [argv[at]];
  let resumed = false;
  if (kind !== "claude" && kind !== "codex") {
    const k = KINDS[kind] ?? {}, r = k.resume ?? {};
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (r.style === "flag" && (a === r.flag || a.startsWith(r.flag + "="))) { resumed = true; if (a === r.flag && rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if (r.style === "thread" && i === 0 && a === r.sub[0]) { resumed = true; i += r.sub.length; continue; }
      if (a === forkFlag(k)) { if (typeof k.fork === "string" && rest[i + 1] && !rest[i + 1].startsWith("-")) i++; continue; }
      if (a.startsWith("-")) { out.push(a); if (!(k.full ?? []).includes(a) && rest[i + 1] && !rest[i + 1].startsWith("-")) out.push(rest[++i]); }
    }
    return resumed ? out : null;
  }
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
  if (pick.agent !== "codex") {
    // The other kinds, as kinds.json spells them (herdr-task's kinds.start_argv builds the same).
    const k = KINDS[pick.agent];
    if (!k) return { argv: [pick.agent], resume: false, base: [pick.agent] };
    const a = [...k.run, ...flags];
    let model = pick.model || null;
    if (model && k.model) {
      if (k.effort?.style === "bracket" && pick.effort) model = model.replace(/\[effort=[^\]]*\]$/, "") + `[effort=${pick.effort}]`;
      a.push(k.model, model);
    }
    if (pick.effort && k.effort?.style === "flag" && k.effort.flag) a.push(k.effort.flag, pick.effort);
    if (pick.perm === "full" && k.full?.length) a.push(...k.full);
    else if (pick.perm === "plan" && pick.agent === "cursor") a.push("--mode", "plan");
    if (same && old.session && k.resume) {
      const r = k.resume;
      const argv = r.style === "flag" ? [...a, r.flag, old.session] : r.style === "thread" ? [a[0], ...r.sub, old.session, ...a.slice(1)] : [a[0], r.sub, ...a.slice(1), old.session];
      return { argv, resume: true, base: a };
    }
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
  const pat = KINDS[kind]?.sessions?.id;
  const m = pat ? new RegExp(pat).exec(path ?? "") : null;
  return m ? m[1] : null;
}

// A kind's fork flag, however the table spells it.
const forkFlag = (k) => (typeof k.fork === "string" ? k.fork : k.fork?.flag ?? null);
// A copy of the conversation in a new tab beside this one, through the CLI's own fork.
export function forkArgv(kind, argv, session) {
  argv = argv ?? [];
  if (kind !== "claude" && kind !== "codex") {
    // The other kinds: their fork flag with the same model and effort, or null when they have none. A string takes
    // the id (pi --fork <id>); a switch goes with resume (grok --resume <id> --fork-session).
    const k = KINDS[kind];
    if (!k?.fork) return null;
    const same = [k.model, k.effort?.style === "flag" ? k.effort.flag : null].filter(Boolean).flatMap((f) => { const v = flag(argv, f); return v ? [f, v] : []; });
    const fork = typeof k.fork === "string" ? [k.fork, session] : k.resume?.style === "flag" ? [k.resume.flag, session, k.fork.flag] : null;
    return fork && [...k.run, ...kept(kind, argv), ...same, ...fork];
  }
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
