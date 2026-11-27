// Changing a running agent's model, reasoning level or Fast in place (SHEP-181): no restart, the same conversation.
// Both CLIs switch mid-session through their own commands, typed into the agent's terminal as a person would:
//   Claude Code: /model <id>, /effort <level>, /fast on|off. Each also saves the choice as the default for new
//   sessions in ~/.claude/settings.json, so the keys it touched are put back afterwards (the running agent keeps the
//   new choice: it doesn't reread them).
//   Codex: /model opens a picker (model, then its reasoning level); "s" there applies it to this session only. /fast
//   and /ultrafast toggle (the active one again: back to Standard) and save service_tier in ~/.codex/config.toml, put
//   back the same way.
// Another CLI or a Claude permission preset uses Restart.
// `io` is where it runs: { send(text), keys(...names), screen(), readFile(rel), writeFile(rel, text), sleep(ms) }, rel
// under the agent's machine's home.

import { claudeSwitch } from "./chat-log.js";
import { rowFor, speedOf } from "./agents.js";

export const CLAUDE_SETTINGS = ".claude/settings.json";
export const CODEX_CONFIG = ".codex/config.toml";
const CLAUDE_KEYS = ["model", "effortLevel", "fastMode", "modelSettings"];
const CODEX_KEYS = ["model", "model_reasoning_effort", "service_tier"];
const LEVEL = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", none: "None" };

/** Codex can select exact permission presets in its own menu. Claude's launch modes use Restart. */
export function liveOK(from, to) {
  return !!from && !!to && from.agent === to.agent && (from.agent === "codex" || !to.perm || to.perm === from.perm);
}

/** What changes: { model, effort, fast } (each only when it differs; model/effort '' for the CLI's default; fast
 *  true, false or "ultrafast", with `wasFast` what ran). A new model always says its level again: Claude Code keeps a
 *  level per model, so a model switch can move it. */
export function liveChanges(from, to) {
  const out = {};
  const model = to.model ?? "", effort = to.effort ?? "";
  if (model !== (from.model ?? "")) out.model = model;
  if (out.model !== undefined || effort !== (from.effort ?? "")) out.effort = effort;
  const speed = (f) => (f === "ultrafast" ? "ultrafast" : !!f);
  if (speed(to.fast) !== speed(from.fast)) { out.fast = speed(to.fast); if (from.fast === "ultrafast") out.wasFast = "ultrafast"; }
  if (to.perm && to.perm !== from.perm) out.perm = to.perm;
  return out;
}

/** Claude Code's commands for the changes, in order: [{ text, done: RegExp, fail?: RegExp }]. */
export function claudeCommands(ch) {
  const out = [];
  const speed = { text: `/fast ${ch.fast ? "on" : "off"}`, done: /Fast mode (?:ON|OFF)\b/,
    fail: /Fast mode (?:unavailable|is (?:not available|disabled)|has been disabled|requires)[^\n]*/i };
  // Turning Fast off before leaving a model keeps /fast on a model that supports it.
  if (ch.fast === false) out.push(speed);
  if (ch.model !== undefined) out.push({ text: `/model ${ch.model || "default"}`, done: /Set model to /, fail: /(?:Model .*not (?:found|available)|Invalid model|isn't available|not a valid model)[^\n]*/i });
  if (ch.effort !== undefined) out.push({ text: `/effort ${ch.effort || "auto"}`, done: /Set effort level to |Effort level set to /, fail: /Invalid (?:effort|argument)[^\n]*/i });
  if (ch.fast) out.push(speed);
  return out;
}

/** How many lines match the CLI's confirmation. */
export const count = (screen, re) => String(screen ?? "").split("\n").filter((l) => re.test(l)).length;

/** Claude Code asking whether to switch a model whose conversation is cached ("Switch model?"): its Yes is first. */
export const claudeAsksSwitch = (screen) => /Switch model\?/.test(screen ?? "") && /❯\s*1\.\s*Yes/.test(screen ?? "");

/** The latest composer line from the agent's own terminal. Preserve any draft already there. */
function composer(kind, screen) {
  const prompt = String(screen).split("\n").findLast((line) => kind === "codex" ? /^\s*[›»](?:\s|$)/.test(line) : /^❯(?:\s|$)/.test(line));
  return prompt?.replace(/^\s*[›»❯]\s*/, "").trim();
}

export function emptyPrompt(kind, screen) {
  const text = composer(kind, screen);
  if (kind === "claude") return text === "" || /^Try ["“].+["”]$/.test(text ?? "");
  return !codexPicker(screen) && (text === "" || text === "Ask Codex to do anything");
}

/** Model, effort and speed as rendered by a newly started interactive CLI. */
export function restartReport(kind, screen, names) {
  if (kind === "codex") {
    for (const line of String(screen).split("\n").slice(-15).reverse()) {
      if (!/^\s{2}\S/.test(line) || !line.includes(" · ")) continue;
      const fields = line.trim().split(" · ")[0];
      const match = /^(.+?)(?: (minimal|low|medium|high|xhigh|max|ultra|none|extra high))?(?: (fast|ultrafast))?$/i.exec(fields);
      const model = match && Object.keys(names).find((id) => [id, names[id]].some((name) => squash(name) === squash(match[1])));
      if (!model) continue;
      const effort = match[2]?.toLowerCase().replace("extra high", "xhigh");
      return { model, ...(effort ? { effort } : {}), speed: match[3]?.toLowerCase() ?? "standard" };
    }
    return null;
  }
  const lines = String(screen).split("\n");
  const banner = lines.findLast((line) => /▝▜/.test(line));
  const modelName = banner?.match(/▝▜[^ ]*\s+(.+?)(?: with | · |$)/)?.[1];
  const answer = modelName && claudeSwitch("Set model to " + modelName);
  if (!answer?.model || !emptyPrompt(kind, screen)) return null;
  const effort = banner.match(/ with (\w+) effort/)?.[1];
  const mode = lines.findLast((line) => /(?:plan mode|auto mode|accept edits|bypass permissions) on/.test(line));
  const perm = mode?.includes("plan mode") ? "plan" : mode?.includes("auto mode") ? "auto" :
    mode?.includes("accept edits") ? "acceptEdits" : mode?.includes("bypass permissions") ? "bypassPermissions" : "manual";
  const speed = lines.some((line) => /^[─ ]+↯/.test(line)) ? "fast" : "standard";
  return { ...answer, ...(effort ? { effort } : {}), speed, perm };
}

/** The settings file with the keys a command touched as they were before (null: nothing to put back). Only those
 *  keys: anything else written meanwhile stays. */
export function claudeRestore(before, now) {
  let b, n;
  try { b = JSON.parse(before || "{}"); n = JSON.parse(now || "{}"); } catch { return null; }
  if (!n || typeof n !== "object" || !b || typeof b !== "object") return null;
  let changed = false;
  for (const k of CLAUDE_KEYS) {
    if (JSON.stringify(b[k]) === JSON.stringify(n[k])) continue;
    changed = true;
    if (k in b) n[k] = b[k]; else delete n[k];
  }
  return changed ? JSON.stringify(n, null, 2) + (String(now).endsWith("\n") ? "\n" : "") : null;
}

/** config.toml's top-level lines for `keys` as they were before (null: nothing to put back). */
export function codexRestore(before, now) {
  const top = (text) => {
    const lines = String(text ?? "").split("\n"), end = lines.findIndex((l) => /^\s*\[/.test(l));
    return { lines, end: end < 0 ? lines.length : end };
  };
  const key = (l) => /^\s*([\w.-]+)\s*=/.exec(l)?.[1];
  const b = top(before), n = top(now);
  const was = new Map(b.lines.slice(0, b.end).filter((l) => CODEX_KEYS.includes(key(l))).map((l) => [key(l), l]));
  const head = n.lines.slice(0, n.end), out = [];
  let changed = false;
  for (const l of head) {
    const k = key(l);
    if (!CODEX_KEYS.includes(k)) { out.push(l); continue; }
    if (was.get(k) !== l) changed = true;
    if (was.has(k)) { out.push(was.get(k)); was.delete(k); }
  }
  // a key it removed: back where the top-level lines end (before the first table)
  if (was.size) {
    changed = true;
    let at = out.length;
    while (at > 0 && out[at - 1].trim() === "") at--;
    out.splice(at, 0, ...was.values());
  }
  return changed ? [...out, ...n.lines.slice(n.end)].join("\n") : null;
}

/** A Codex picker's numbered rows on screen: [{ n, label, sel, current, dflt }] (the newest picker only). */
export function codexRows(screen) {
  const lines = String(screen ?? "").split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*(Select Model|Select Reasoning|Advanced Reasoning|Update Model Permissions)/.test(lines[i])) { start = i; break; }
  if (start < 0) return [];
  const rows = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^\s*(›)?\s*(\d+)\.\s+(.+?)(?:\s{2,}.*)?$/.exec(l);
    if (!m) continue;
    const words = m[3].trim();
    rows.push({ n: Number(m[2]), sel: !!m[1], label: words.replace(/\s*\((current|default)\)/g, "").trim(), current: /\(current\)/.test(words), dflt: /\(default\)/.test(words) });
  }
  return rows;
}

/** Which picker shows: "model", "effort", "more" (Max and Ultra) or null. */
export function codexPicker(screen) {
  const lines = String(screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*Select Model/.test(lines[i])) return "model";
    if (/^\s*Select Reasoning/.test(lines[i])) return "effort";
    if (/^\s*Advanced Reasoning/.test(lines[i])) return "more";
    if (/^\s*›\s*Ask Codex|^\s*[›»]\s*$/.test(lines[i])) return null;
  }
  return null;
}

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The row of Codex's model picker for a model (by its id or its label as the picker says it). */
export function codexModelRow(rows, id, label) {
  const want = [squash(id), squash(label)].filter(Boolean);
  return rows.find((r) => want.includes(squash(r.label))) ?? null;
}
/** The row of Codex's level picker for a level ('' the model's default); "more" when it is behind More reasoning. */
export function codexEffortRow(rows, effort) {
  if (!effort) return rows.find((r) => r.dflt) ?? null;
  const name = squash(LEVEL[effort] ?? effort);
  return rows.find((r) => squash(r.label) === name) ?? (rows.find((r) => /^More reasoning/i.test(r.label)) ? "more" : null);
}

/** The keys that move a picker's highlight from its row to row n. */
export function moveTo(rows, n) {
  const at = rows.find((r) => r.sel)?.n ?? rows[0]?.n ?? n;
  return Array(Math.abs(n - at)).fill(n > at ? "down" : "up");
}

async function waitFor(io, test, ms = 8000) {
  for (let t = 0; t < ms; t += 250) {
    const s = await io.screen();
    if (await test(s)) return s;
    await io.sleep(250);
  }
  return null;
}

/** Read the effective preset from Codex's public /status display. */
export async function codexPermission(io) {
  const permission = /^\s*Permissions:\s+/;
  const before = await io.screen();
  await io.send("/status");
  const s = await waitFor(io, (s) => freshAnswer(before, s, permission));
  const value = freshAnswer(before, s, permission)?.replace(permission, "");
  if (/^Read Only\b/i.test(value ?? "")) return "read-only";
  if (/^(?:Full Access|Danger Full Access)\b/i.test(value ?? "")) return "full";
  if (/^Workspace.*Approve for me\b/i.test(value ?? "")) return "approve";
  if (/^Workspace\b/i.test(value ?? "")) return "auto";
  return null;
}

const matches = (screen, re) => String(screen ?? "").split("\n").flatMap((line) => {
  const match = re?.exec(line);
  return match ? [line.slice(match.index).trim()] : [];
});

// Claude reports local commands in a transient footer during a turn, without echoing the command.
function freshAnswer(before, screen, re) {
  const old = matches(before, re), now = matches(screen, re);
  const last = now.at(-1);
  return last && (now.length > old.length || last !== old.at(-1)) ? last : null;
}

// Exclude model-generated text from the CLI's command echo and footer.
function claudeFeedback(screen) {
  const lines = String(screen).split("\n");
  const border = lines.findLastIndex((line) => /^[─]{8,}/.test(line));
  return lines.filter((line, i) => i > border && border >= 0 || /^\s*⎿\s/.test(line)).join("\n");
}

/** Claude Code: run one command at a time, read its answer, and restore the defaults it saved. */
async function claude(io, ch, { confirmed, model }) {
  const before = await io.readFile(CLAUDE_SETTINGS).catch(() => null);
  try {
    for (const c of claudeCommands(ch)) {
      const beforeCommand = await io.screen();
      await io.send(c.text);
      let asked = false, answer, bad;
      await waitFor(io, async (s) => {
        bad = freshAnswer(claudeFeedback(beforeCommand), claudeFeedback(s), c.fail);
        answer = freshAnswer(claudeFeedback(beforeCommand), claudeFeedback(s), c.done);
        if (bad || answer) return true;
        // A cached conversation asks before switching models.
        if (!asked && !claudeAsksSwitch(beforeCommand) && claudeAsksSwitch(s)) { asked = true; await io.keys("enter"); }
        return false;
      });
      if (bad) throw new Error(bad);
      const actual = claudeSwitch(answer);
      if (!actual) throw new Error("Claude Code didn't answer " + c.text.split(" ")[0] + ".");
      confirmed?.(actual);
      const actualModel = actual.model && rowFor("claude", actual);
      const expectedModel = c.text.startsWith("/model ") ? ch.model : actualModel && (ch.model ?? model);
      if (expectedModel && expectedModel !== actualModel && expectedModel !== actual.model && expectedModel !== actual.alias)
        throw new Error("Claude Code switched to a different model.");
      if (c.text.startsWith("/effort ") && ch.effort && actual.effort !== ch.effort)
        throw new Error("Claude Code selected a different effort.");
      if (c.text.startsWith("/fast ") && speedOf(actual.speed) !== ch.fast)
        throw new Error("Claude Code selected a different speed.");
    }
  } finally {
    if (before !== null) {
      // its save lands with its answer; a moment more, then the keys it touched go back
      await io.sleep(300);
      const now = await io.readFile(CLAUDE_SETTINGS).catch(() => null);
      const back = now === null ? null : claudeRestore(before, now);
      if (back !== null) await io.writeFile(CLAUDE_SETTINGS, back);
    }
  }
}

/** Codex: /model's two pickers (its level for this session only, "s"), then /fast; config.toml put back. */
async function codex(io, ch, labels) {
  const before = await io.readFile(CODEX_CONFIG).catch(() => null);
  const pick = async (rows, n) => {
    for (const k of moveTo(rows, n)) await io.keys(k);
    await io.sleep(150);
  };
  try {
    const CHANGED = /^\s*•\s*Model changed to /, TIER = /^\s*•\s*Service tier set to /;
    let fast = labels.fromFast;
    if (ch.model !== undefined || ch.effort !== undefined) {
      const was = count(await io.screen(), CHANGED);
      await io.send("/model");
      let s = await waitFor(io, (s) => codexPicker(s) === "model");
      if (!s) throw new Error("Codex didn't open its model list.");
      let rows = codexRows(s);
      const want = ch.model !== undefined ? ch.model : labels.model;
      const row = want ? codexModelRow(rows, want, labels.names?.[want]) : rows.find((r) => r.current) ?? rows.find((r) => r.dflt);
      if (!row) { await io.keys("esc"); throw new Error(`${labels.names?.[want] ?? want ?? "That model"} isn't in Codex's list.`); }
      await pick(rows, row.n);
      await io.keys("enter");
      s = await waitFor(io, (s) => codexPicker(s) === "effort" || count(s, CHANGED) > was);
      if (!s) { await io.keys("esc"); throw new Error("Codex didn't offer its levels."); }
      if (codexPicker(s) === "effort") {
        rows = codexRows(s);
        let r = codexEffortRow(rows, ch.effort ?? labels.effort ?? "");
        if (r === "more") {
          await pick(rows, rows.find((x) => /^More reasoning/i.test(x.label)).n);
          await io.keys("enter");
          s = await waitFor(io, (s) => codexPicker(s) === "more");
          rows = s ? codexRows(s) : [];
          r = codexEffortRow(rows, ch.effort);
        }
        if (!r || r === "more") { await io.keys("esc", "esc", "esc"); throw new Error(`Codex doesn't offer ${LEVEL[ch.effort] ?? ch.effort} for that model.`); }
        await pick(rows, r.n);
        // s: this session only (Enter would save it as the default too)
        await io.keys("s");
        s = await waitFor(io, (s) => count(s, CHANGED) > was);
        if (!s) throw new Error("Codex didn't confirm the change.");
      }
      const line = matches(s, CHANGED).at(-1);
      const applied = /Model changed to ([\w.-]+)(?:\s+(minimal|low|medium|high|xhigh|max|ultra|none)\b)?/.exec(line ?? "");
      if (!applied) throw new Error("Codex didn't confirm its model and effort.");
      const [, model, effort] = applied;
      labels.confirmed?.({ model, ...(effort ? { effort } : {}) });
      const report = restartReport("codex", s, { [model]: model, ...labels.names });
      if (report?.model === model) {
        fast = speedOf(report.speed);
        labels.confirmed?.({ speed: report.speed });
      }
      if ((want && model !== want) || (labels.effort && effort !== labels.effort))
        throw new Error("Codex selected a different model or effort.");
    }
    if (fast !== labels.toFast && (ch.fast !== undefined || ch.model !== undefined)) {
      // A toggle can land on Standard first when the active tier was changed outside Shepherdr.
      const cmd = labels.toFast === "ultrafast" || (!labels.toFast && fast === "ultrafast") ? "/ultrafast" : "/fast";
      const setTier = async () => {
        const beforeCommand = await io.screen();
        await io.send(cmd);
        const refused = /^\s*•\s*(?:Unrecognized command|.*(?:unavailable|not supported))/i;
        const screen = await waitFor(io, (s) => freshAnswer(beforeCommand, s, TIER) || freshAnswer(beforeCommand, s, refused));
        if (screen && freshAnswer(beforeCommand, screen, refused)) {
          if (composer("codex", screen) === cmd) await io.keys("ctrl+u");
          throw new Error("Codex didn't offer that speed for this model.");
        }
        const word = /set to (\w+)/i.exec(freshAnswer(beforeCommand, screen, TIER) ?? "")?.[1]?.toLowerCase();
        if (!["default", "standard", "fast", "priority", "ultrafast"].includes(word))
          throw new Error("Codex didn't confirm its speed.");
        const actual = speedOf(word);
        labels.confirmed?.({ speed: actual === "ultrafast" ? "ultrafast" : actual ? "fast" : "standard" });
        return actual;
      };
      if (await setTier() !== labels.toFast && await setTier() !== labels.toFast)
        throw new Error("Codex selected a different speed.");
    }
    if (ch.perm) {
      const name = { auto: "Ask for approval", approve: "Approve for me", full: "Full Access", "read-only": "Read Only" }[ch.perm];
      if (!name) throw new Error("Codex doesn't offer that permission mode.");
      await io.send("/permissions");
      const rows = codexRows(await waitFor(io, (s) => /Update Model Permissions[^]*enter select · esc back/.test(s)));
      const row = rows.find((r) => r.label === name);
      if (!row) throw new Error("Codex didn't open that permission mode.");
      await pick(rows, row.n);
      await io.keys("enter");
      if (ch.perm === "full" && !row.current) {
        const warning = await waitFor(io, (s) => /Enable full access\?[^]*›\s*1\. Yes, continue anyway/.test(s));
        if (!warning) throw new Error("Codex didn't ask to confirm full access.");
        await io.keys("enter");
      }
      if (!await waitFor(io, (s) => emptyPrompt("codex", s))) throw new Error("Codex didn't finish changing permissions.");
      const perm = await codexPermission(io);
      if (perm) labels.confirmed?.({ perm });
      if (perm !== ch.perm) throw new Error("Codex didn't confirm the new permissions.");
    }
  } finally {
    if (before !== null) {
      await io.sleep(300);
      const now = await io.readFile(CODEX_CONFIG).catch(() => null);
      const back = now === null ? null : codexRestore(before, now);
      if (back !== null) await io.writeFile(CODEX_CONFIG, back);
    }
  }
}

/** Switches the agent in place. `labels`: Codex's { names: { id: label }, model, effort } (the picker's words for
 *  its models, and what runs now). Throws with plain words when it can't. */
export async function switchLive(io, kind, from, to, labels = {}) {
  const ch = liveChanges(from, to);
  if (!Object.keys(ch).length) return ch;
  if (kind === "claude") {
    // A model switch can reset Fast (for example switching to Fable), even when the selected tier stays the same.
    await claude(io, ch.model !== undefined && to.fast ? { ...ch, fast: true } : ch, { ...labels, model: from.model });
  }
  else await codex(io, ch, { ...labels, model: from.model, effort: to.effort, fromFast: from.fast ?? false, toFast: to.fast ?? false });
  return ch;
}
