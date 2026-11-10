import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as S from "./settings.js";

const ROOT = join(import.meta.dir, "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
// Every file that shows Settings: the window's mod, the service that builds the web's rows, and the web's pages
// (Autopilot's page has its own words, core/autopilot.js).
const MOD = readdirSync(join(ROOT, "mods/shepherdr-settings")).filter((f) => f.endsWith(".js") && f !== "autopilot-section.js").map((f) => `mods/shepherdr-settings/${f}`);
const SHOWN = [...MOD, "service/settings.ts", "service/window.ts", "service/compat.ts", "web/src/Settings.tsx", "web/src/screens/Role.tsx"];

// The words each side used to write out for itself: now only core/settings.js has them.
const WORDS = [
  ...Object.values(S.ABOUT), S.BACKUP.about, S.NOTIFY_ABOUT, S.BASE.about, S.SECRETS.about, S.SECRETS.hint, S.SECRETS.none,
  S.SECRETS.badName, S.MACHINES.heading, S.MACHINES.low.about, S.MACHINES.cap.about, ...S.MACHINES.limits.map((l) => l.about),
  ...S.SWITCHES.map((s) => s.about), ...S.ROLES.map((r) => r.about), ...S.ROLES.map((r) => r.told), ...S.NOTES.map((n) => n.example),
  ...Object.values(S.INSTRUCTIONS.notes), "Only for ", "use their own", "On, private to your tailnet.", "Its home space's Assistant watches",
];

test("the window's mod, the service and the web read Settings' words from core/settings.js, never their own copy", () => {
  for (const f of SHOWN) {
    // the code, not what its comments say
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const w of WORDS) expect({ file: f, has: src.includes(w) ? w : null }).toEqual({ file: f, has: null });
  }
  // and each of them reads core/settings.js
  for (const f of ["mods/shepherdr-settings/main.js", "mods/shepherdr-settings/layout.js", "mods/shepherdr-settings/machines-section.js",
    "mods/shepherdr-settings/secrets-section.js", "mods/shepherdr-settings/web-section.js", "mods/shepherdr-settings/base-branch.js", "lib/settings.js"])
    expect(read(f)).toContain('from "./core/settings.js"');
  for (const f of ["service/settings.ts", "service/window.ts", "service/compat.ts"]) expect(read(f)).toContain('from "../core/settings.js"');
  for (const f of ["web/src/Settings.tsx", "web/src/screens/Role.tsx"]) expect(read(f)).toContain("from '@core/settings.js'");
});

test("the model menu's headings are the window's (mods/chat-models)", () => {
  const src = read("mods/chat-models/main.js");
  for (const w of Object.values(S.MODEL_MENU)) expect(src).toContain(`"${w}"`);
});

test("the model button says what the window's does", () => {
  const { menus, defaults } = S.choicesFrom({ claude: { model: "opus[1m]", effort: "high", per: {} }, codex: { models: [{ id: "gpt-5", label: "GPT-5", efforts: ["low", "high"] }] } });
  expect(S.modelLabel(menus, defaults)).toBe("Opus 5.5 · 1M · High");
  expect(S.modelLabel(menus, { agent: "claude", model: "opus", effort: "xhigh", fast: true })).toBe("Opus 5.5 · Extra high · Fast");
  expect(S.roleSel("reviewer", null, { menus, defaults, permDefault: { codex: "auto" } }, "claude")).toMatchObject({ unset: true, sel: { agent: "codex", model: "gpt-5" } });
  expect(S.otherCliWords(S.otherCli("claude"))).toBe("Other CLI (Codex)");
  // another CLI's model: its own permission modes, full access staying full access
  expect(S.chooseModel(menus, { codex: "auto" }, { agent: "claude", model: "opus", effort: "max", perm: "bypassPermissions" }, "codex", "gpt-5"))
    .toMatchObject({ agent: "codex", model: "gpt-5", effort: null, perm: "full" });
});

test("switching the worker's agent there and back keeps auto (#758)", () => {
  const { menus, permDefault } = S.choicesFrom({ claude: { model: "opus", per: {} }, codex: { models: [{ id: "gpt-5", label: "GPT-5", efforts: ["low", "high"] }] } });
  expect(permDefault.claude).toBe("manual");
  const toCodex = S.chooseModel(menus, permDefault, { agent: "claude", model: "opus", perm: "auto" }, "codex", "gpt-5");
  expect(toCodex.perm).toBe("auto");
  expect(S.chooseModel(menus, permDefault, toCodex, "claude", "opus").perm).toBe("auto");
  // nearest mode: plan and read only swap, accept edits is Codex's auto, ask (no match) takes the default
  expect(S.chooseModel(menus, permDefault, { agent: "claude", model: "opus", perm: "plan" }, "codex", "gpt-5").perm).toBe("read-only");
  expect(S.chooseModel(menus, permDefault, { agent: "codex", model: "gpt-5", perm: "read-only" }, "claude", "opus").perm).toBe("plan");
  expect(S.chooseModel(menus, permDefault, { agent: "claude", model: "opus", perm: "acceptEdits" }, "codex", "gpt-5").perm).toBe("auto");
  expect(S.chooseModel(menus, permDefault, { agent: "claude", model: "opus", perm: "manual" }, "codex", "gpt-5").perm).toBe("auto");
  expect(S.chooseModel(menus, permDefault, { agent: "codex", model: "gpt-5", perm: "full" }, "claude", "opus").perm).toBe("bypassPermissions");
});

test("Backup's warning, an add-on's line and Web's state, in the window's words", () => {
  const checks = { "": { codex: "ok" }, "vm-ssa": { codex: "signed-out" }, box: { codex: "missing" } };
  expect(S.backupProblem(checks, null, "codex")).toBe("Can't on vm-ssa: Codex is signed out. Can't on box: Codex is not installed.");
  expect(S.backupProblem(checks, "local", "codex")).toBe("");
  expect(S.backupProblem(checks, "vm-ssa", "codex")).toBe("Can't on vm-ssa: Codex is signed out.");
  expect(S.addonAbout("Calls.", true, ["Voice"])).toBe("Calls. Voice needs it: turn that off first.");
  expect(S.addonAbout("Calls.", false, ["Voice", "Chat"])).toBe("Calls. Needs Voice, Chat: turn them on first.");
  expect(S.webState(true, true, null)).toBe("Off. Turn it on under Window › Add-ons.");
  expect(S.onlyFor("web", "This computer")).toBe("Only for web on This computer");
  expect(S.spacesOwn(1)).toBe("1 space sets its own");
  expect(S.sameAs("everywhere", null)).toBe("Inherited from Everywhere");
  expect(S.sameAs("machine", "vm")).toBe("Inherited from vm");
});

// SHEP-48: Reactions, for every agent: on unless a level turns it off, the same default everywhere it's read.
test("Reactions are on by default, in the core, the window's chain and herdr-task", () => {
  expect(S.DEFAULTS.agents.reactions).toBe(true);
  expect(S.DEFAULTS.assistant).toBeUndefined();
  // lib/coordinator.js needs the window's runtime: its defaults and its chain, as written
  const lib = read("lib/coordinator.js");
  expect(lib).toMatch(/SHEPHERDR_DEFAULTS = \{[^;]*agents: \{ reactions: true, suggestions: true, feedback: true, feedback_repo: "" \}/);
  expect(lib).toContain('for (const k of ["tasks", "automations", "agents"])');
  // SHEP-42's key still counts in the window's chain where a layer has no agents'
  expect(lib).toContain('typeof l.obj.assistant?.reactions === "boolean" ? { reactions: l.obj.assistant.reactions, ...l.obj.agents }');
  expect(read("mods/tasks/bin/herdr_task/settings.py")).toContain('"agents": {"reactions": True, "suggestions": True, "feedback": True, "feedback_repo": "eliasstravik/shepherdr"}');
  expect(S.REACTIONS.title).toBe("Reactions");
});

// SHEP-48: SHEP-42's assistant.reactions moves to agents.reactions in every layer; agents' own wins; the rest stays.
test("upgradeReactions moves the Assistant's Reactions to every agent's", () => {
  const cfg = { version: 1, everywhere: { assistant: { reactions: false }, tasks: { merge: "auto" } },
    machines: { vm: { assistant: { reactions: true, other: 1 } } },
    spaces: { sp1: { folder: "/a", assistant: { reactions: true }, agents: { reactions: false } }, sp2: { folder: "/b" } } };
  expect(S.upgradeReactions(cfg)).toBe(cfg);
  expect(cfg).toEqual({ version: 1, everywhere: { tasks: { merge: "auto" }, agents: { reactions: false } },
    machines: { vm: { assistant: { other: 1 }, agents: { reactions: true } } },
    spaces: { sp1: { folder: "/a", agents: { reactions: false } }, sp2: { folder: "/b" } } });
  expect(S.upgradeReactions({})).toEqual({});
});

// SHEP-78: Feedback offers on by default; the repo as owner/name, a github.com link made one, anything else refused.
test("Feedback offers and the repo they file to", () => {
  expect(S.DEFAULTS.agents.feedback).toBe(true);
  expect(S.FEEDBACK.repo).toBe("eliasstravik/shepherdr");
  expect(S.feedbackRepo(" acme/shep ")).toBe("acme/shep");
  expect(S.feedbackRepo("https://github.com/acme/shep.git")).toBe("acme/shep");
  expect(S.feedbackRepo("")).toBe("");
  expect(S.feedbackRepo("not a repo")).toBeNull();
  expect(read("mods/shepherdr-settings/main.js")).toContain("feedbackRow(this, t)");
});
