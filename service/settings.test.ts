import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a throwaway settings file, never ~/.herdr/shepherdr.json
const file = join(mkdtempSync(join(tmpdir(), "shep-settings-")), "shepherdr.json");
writeFileSync(file, JSON.stringify({ everywhere: { machine: { start_load: 2 } }, spaces: { sp1: { folder: "/x" } } }));
process.env.HERDR_TASK_SETTINGS = file;
const { Settings } = await import("./settings.ts");
const CORE: any = await import("../core/settings.js");

test("macOS web peer exceptions come from the owner's settings file and default to empty", () => {
  const before = readFileSync(file, "utf8");
  const s = new Settings();
  const set = (ignore_accounts: unknown) =>
    writeFileSync(file, JSON.stringify({ everywhere: { web: { ignore_accounts } } }));
  try {
    expect(s.webIgnoreAccounts()).toEqual([]);
    set(["mfe", "_another_service"]);
    expect(s.webIgnoreAccounts()).toEqual(["mfe", "_another_service"]);
    set("mfe");
    expect(s.webIgnoreAccounts()).toEqual([]);
    set(["mfe", 503]);
    expect(s.webIgnoreAccounts()).toEqual([]);
    set(["503"]);
    expect(s.webIgnoreAccounts()).toEqual([]);
    set([]);
    expect(s.webIgnoreAccounts()).toEqual([]);
  } finally {
    writeFileSync(file, before);
  }
});

test("the Tasks rows say the window's words, and a change keeps the rest of the file", () => {
  const s = new Settings();
  s.start();
  const tasks = s.sections("https://box/shepherdr/").find((x) => x.name === "Tasks" && x.level === "all")!;
  expect(tasks.rows.find((r) => r.key === "tasks.merge")).toMatchObject({ value: "On Accept", options: ["On Accept", "After all checks pass", "Right away"] });
  s.set("tasks.merge", "After all checks pass");
  s.set("tasks.proof", "Off");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.tasks).toEqual({ merge: "checks", proof: false });
  expect(f.everywhere.machine).toEqual({ start_load: 2 });
  expect(f.spaces.sp1.folder).toBe("/x");
  expect(() => s.set("tasks.merge", "Whenever")).toThrow();
  expect(() => s.set("secrets.vault", "x")).toThrow();
});

test("a space's own values go in its layer with its folder, and Reset drops them", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp2", name: "web", machine: null, folder: "/repo", repo: "/repo" };
  s.set("tasks.merge", "Right away", "sp2", scope);
  s.set("role.worker", JSON.stringify({ agent: "codex", model: "gpt-5", effort: "high" }), "sp2", scope);
  let f = JSON.parse(readFileSync(file, "utf8"));
  // SHEP-335: a task's settings set from a space are the repo's it sits on; the space keeps none of them
  expect(f.repos["/repo"]).toEqual({ tasks: { merge: "auto" }, worker: { agent: "codex", model: "gpt-5", effort: "high", fast: false, perm: null } });
  expect(f.spaces.sp2).toBeUndefined();
  const tasks = s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === "sp2")!;
  // as the window's: "Set for this space · Reset", Reset back to Everywhere's; Base branch only in a space's own
  expect(tasks.rows.find((r) => r.key === "tasks.merge")).toMatchObject({ value: "Right away", inherits: { from: "Everywhere" } });
  expect(tasks.rows.find((r) => r.key === "tasks.base")).toMatchObject({ label: "Base branch", text: true, placeholder: "Its current branch" });
  s.set("tasks.merge", null, "sp2", scope);
  f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.repos["/repo"].tasks).toBeUndefined();
  expect(() => s.set("tasks.merge", "Right away", "sp3", null)).toThrow();
  expect(() => s.set("tasks.merge", "Right away", "sp3", { id: "sp3", name: "x", machine: null })).toThrow("isn't in a repo");
});

test("Before the agent starts (#1197): a space's own command, in a monospace box before the notes", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp7", name: "pi", machine: null, folder: "/pi", repo: "/pi" };
  const rows = () => s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === "sp7")!.rows;
  const row = () => rows().find((r) => r.key === "tasks.setup")!;
  expect(row()).toMatchObject({ label: "Before the agent starts", multiline: true, mono: true, value: "", placeholder: "bun install" });
  // first of the boxes: it runs before the agent reads the notes
  const keys = rows().map((r) => r.key);
  expect(keys.indexOf("tasks.setup")).toBe(keys.indexOf("tasks.start_notes") - 1);
  s.set("tasks.setup", "ln -s ../../node_modules .", "sp7", scope);
  expect(JSON.parse(readFileSync(file, "utf8")).repos["/pi"].tasks.setup).toBe("ln -s ../../node_modules .");
  expect(row()).toMatchObject({ value: "ln -s ../../node_modules ." });
  s.set("tasks.setup", null, "sp7", scope);
  expect(JSON.parse(readFileSync(file, "utf8")).repos["/pi"].tasks).toBeUndefined();
  // the notes keep their keys
  s.set("tasks.start_notes", "Read the README", "all");
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere.tasks.start_notes).toBe("Read the README");
  s.set("tasks.start_notes", null, "all");
});

test("Branch names (#570): Everywhere's or a space's own pattern, checked before it's kept", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp6", name: "api", machine: null, folder: "/api", repo: "/api" };
  const row = (level: string) => s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === level)!.rows.find((r) => r.key === "tasks.branch")!;
  expect(row("all")).toMatchObject({ label: "Branch names", text: true, value: "", placeholder: "task/{slug}" });
  s.set("tasks.branch", "feat/{key}-{slug}", "all");
  s.set("tasks.branch", " {key} ", "sp6", scope);
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.tasks.branch).toBe("feat/{key}-{slug}");
  expect(f.repos["/api"].tasks.branch).toBe("{key}");
  expect(row("sp6")).toMatchObject({ value: "{key}", inherits: { value: "feat/{key}-{slug}", from: "Everywhere" } });
  // SHEP-322: {slug} alone is enough (a name taken gets -2); nothing of the task in it is refused
  expect(() => s.set("tasks.branch", "feat/x", "all")).toThrow("Put {slug} in it");
  expect(() => s.set("tasks.branch", "a b/{n}", "all")).toThrow("isn't a name git allows");
  s.set("tasks.branch", "", "sp6", scope);
  expect(JSON.parse(readFileSync(file, "utf8")).repos["/api"].tasks).toBeUndefined();
});

test("3.2: Autopilot, Tasks at once and the add-ons' switches are gone; what a file still keeps of them is ignored, never an error", () => {
  const f = JSON.parse(readFileSync(file, "utf8"));
  f.everywhere = { ...f.everywhere, autopilot: { every: "every 60 minutes", events: ["ready"] }, off: ["web", "voice", "autopilot"], tasks: { ...f.everywhere.tasks, max_running: 3 } };
  f.spaces = { ...f.spaces, sp4: { folder: "/web", autopilot: { direction: "Launch the shop" } } };
  writeFileSync(file, JSON.stringify(f));
  const s = new Settings();
  s.start();
  const web = { id: "sp4", name: "web", machine: null, folder: "/web", repo: "/web" };
  const all = s.sections(null, [web], [], "box");
  expect([...new Set(all.map((x) => x.name))]).toEqual(["Agents", "Tasks", "Machines", "Web"]);
  expect(all.flatMap((x) => x.rows).some((r) => /^(autopilot|window|addon|notify)|max_running/.test(r.key))).toBe(false);
  // they can't be set any more, and a change of something else keeps the old values in the file as they were
  expect(() => s.set("autopilot.every", "weekdays 9:00", "all")).toThrow("can't be changed");
  expect(() => s.set("tasks.max_running", "4", "all")).toThrow("can't be changed");
  s.set("tasks.proof", "On", "sp4", web);
  const after = JSON.parse(readFileSync(file, "utf8"));
  expect(after.everywhere.autopilot).toEqual({ every: "every 60 minutes", events: ["ready"] });
  expect(after.spaces.sp4).toMatchObject({ autopilot: { direction: "Launch the shop" } });
  expect(after.repos["/web"]).toEqual({ tasks: { proof: true } });
});

test("machine limits: percents on the page, the file's own units, and this computer as local", () => {
  const s = new Settings();
  s.start();
  s.sections(null, [], [], "box");
  s.set("machine.start_load", "150", "all");
  s.set("machine.start_memory", "off", "m:box");
  s.set("machine.worker_memory", "4 GB", "m:box");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.machine.start_load).toBe(1.5);
  expect(f.machines.local.machine).toEqual({ start_memory: null, worker_memory: 4 });
  expect(() => s.set("machine.worker_memory", "3 GB", "all")).toThrow();
});

test("another machine's space keeps its machine/id key, and its machine is sent only its own", async () => {
  const { pushBody } = await import("./settings.ts");
  const s = new Settings();
  s.start();
  s.set("agents.reactions", "off", "vm/sp9", { id: "vm/sp9", name: "api", machine: "vm", folder: "/srv/api", repo: "vm:/srv/api" });
  s.set("tasks.merge", "Right away", "vm/sp9", { id: "vm/sp9", name: "api", machine: "vm", folder: "/srv/api", repo: "vm:/srv/api" });
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces["vm/sp9"]).toMatchObject({ machine: "vm", folder: "/srv/api", agents: { reactions: false } });
  // SHEP-335: its repo's task settings as <machine>:<folder>, sent to that machine by the bare folder
  expect(f.repos["vm:/srv/api"]).toEqual({ tasks: { merge: "auto" } });
  const sent = JSON.parse(pushBody(f, "vm"));
  expect(sent).toMatchObject({ pushed_from: "herdr-app", here: "vm", spaces: { sp9: { folder: "/srv/api" } }, repos: { "/srv/api": { tasks: { merge: "auto" } } } });
  expect(Object.keys(sent.spaces)).toEqual(["sp9"]);
  expect(Object.keys(sent.repos)).toEqual(["/srv/api"]);
  expect(JSON.parse(pushBody(f, "other")).repos).toBeUndefined();
});

test("a machine that isn't connected, a prototype key, or an unreadable file is refused, and nothing is written", () => {
  const s = new Settings();
  s.start();
  s.sections(null, [], ["vm"], "box");
  const before = readFileSync(file, "utf8");
  expect(() => s.set("machine.start_load", "150", "m:__proto__")).toThrow();
  expect(() => s.set("machine.start_load", "150", "m:typo")).toThrow();
  expect(({} as any).machine).toBeUndefined();
  expect(readFileSync(file, "utf8")).toBe(before);
  writeFileSync(file, "{ half");
  expect(() => s.set("tasks.merge", "Right away")).toThrow();
  expect(readFileSync(file, "utf8")).toBe("{ half");
  writeFileSync(file, before);
});

test("Machines is one page as the window's: every machine's limits, then each machine's block (key@machine)", () => {
  const s = new Settings();
  s.start();
  const page = s.sections(null, [], ["vm"], "box").filter((x) => x.name === "Machines");
  expect(page.length).toBe(1);
  expect(page[0].rows.find((r) => r.key === "machine.home@local")).toMatchObject({ group: "This computer", value: "on" });
  expect(page[0].rows.find((r) => r.key === "machine.home@vm")).toMatchObject({ group: "vm", value: "off" });
  s.set("machine.worker_memory@vm", "8 GB");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.machines.vm.machine.worker_memory).toBe(8);
  // the window's steppers: "Off"/"80%" stepping through percents; a percent back from the page sets the file's units
  const load = s.sections(null, [], ["vm"], "box").find((x) => x.name === "Machines")!.rows.find((r) => r.key === "machine.start_load")!;
  expect(load.steps?.[0]).toBe("25%");
  s.set("machine.start_load", "175%", "all");
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere.machine.start_load).toBe(1.75);
});

test("Agents and Tasks say the window's words: the model button, Other CLI, Must fix only with a review", async () => {
  const C: any = await import("../core/settings.js");
  const s = new Settings();
  s.start();
  s.choices = C.choicesFrom({ claude: { model: "opus[1m]", effort: "high", per: {} }, codex: { models: [{ id: "gpt-5", label: "GPT-5", efforts: ["low", "high"] }] } });
  const agents = s.sections(null).find((x) => x.name === "Agents" && x.level === "all")!;
  expect(agents.rows.map((r) => r.label)).toEqual(["Assistant", "Workers", "Reviewer", "Backup agent", "Reactions", "Suggested replies", "Feedback offers", "Feedback repo"]);
  expect(agents.rows[0].value).toBe("Opus 5.5 · 1M · High");
  expect(agents.rows[2]).toMatchObject({ value: "Other CLI (Codex)", agent: { unset: true, other: false } });
  const tasks = s.sections(null).find((x) => x.name === "Tasks" && x.level === "all")!;
  expect(tasks.rows.some((r) => r.key === "tasks.must_fix")).toBe(false);
  expect(tasks.rows.some((r) => r.key === "tasks.max_running")).toBe(false);
  const web = s.sections({ on: true, link: "https://box/shepherdr/", why: null }).find((x) => x.name === "Web")!;
  expect(web.rows.map((r) => r.label)).toEqual(["Shepherdr on the web", "Link"]);
  expect(web.rows[0].hint).toBe("On, private to your tailnet.");
});

// SHEP-48: Reactions, one Agents row for every agent: on by default, off Everywhere, a space's own on, Reset back
test("Reactions: on by default for every agent, Everywhere's or a space's own", () => {
  writeFileSync(file, "{}");
  const s = new Settings();
  s.start();
  const sp = { id: "sp7", name: "shop", machine: null, folder: "/shop" };
  const row = (level: string) => s.sections(null, [sp]).find((x) => x.name === "Agents" && x.level === level)!.rows;
  expect(row("all").find((r) => r.key === "agents.reactions")).toMatchObject({ key: "agents.reactions", label: "Reactions", value: "on", options: ["on", "off"], hint: CORE.REACTIONS.about });
  expect(CORE.REACTIONS.about).not.toMatch(/Assistant/);
  s.set("agents.reactions", "off", "all");
  let f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.agents).toEqual({ reactions: false });
  expect(row("sp7").find((r) => r.key === "agents.reactions")).toMatchObject({ value: "off", from: "Everywhere" });
  s.set("agents.reactions", "on", "sp7", sp);
  f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces.sp7.agents).toEqual({ reactions: true });
  expect(row("sp7").find((r) => r.key === "agents.reactions")).toMatchObject({ value: "on", inherits: { value: "off", from: "Everywhere" } });
  expect(row("all").find((r) => r.key === "agents.reactions")?.others).toEqual([{ id: "sp7", name: "shop" }]);
  // the same as what it would inherit unsets it; Reset too; back on Everywhere is the default again
  s.set("agents.reactions", null, "sp7", sp);
  s.set("agents.reactions", "on", "all");
  f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces.sp7.agents).toBeUndefined();
  expect(f.everywhere.agents).toBeUndefined();
  expect(() => s.set("agents.reactions", "maybe", "all")).toThrow();
});

// SHEP-48: SHEP-42 kept it as the Assistant's (assistant.reactions): read as the Agents row, moved on the next change
test("Reactions set as the Assistant's before still apply, and move to agents on a change", () => {
  writeFileSync(file, JSON.stringify({ everywhere: { assistant: { reactions: false } }, spaces: { sp7: { folder: "/shop", assistant: { reactions: true } } } }));
  const s = new Settings();
  s.start();
  const sp = { id: "sp7", name: "shop", machine: null, folder: "/shop" };
  const row = (level: string) => s.sections(null, [sp]).find((x) => x.name === "Agents" && x.level === level)!.rows.find((r) => r.key === "agents.reactions");
  expect(row("all")).toMatchObject({ value: "off" });
  expect(row("sp7")).toMatchObject({ value: "on", inherits: { value: "off", from: "Everywhere" } });
  // its old key still sets it (a page from before), written as agents'
  s.set("assistant.reactions", "on", "all");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere).toEqual({});
  expect(f.spaces.sp7).toEqual({ folder: "/shop", agents: { reactions: true } });
  expect(CORE.upgradeReactions({ everywhere: { assistant: { reactions: false }, agents: { reactions: true } } })).toEqual({ everywhere: { agents: { reactions: true } } });
});

// SHEP-78: Feedback offers, on by default, per space as Reactions; the repo Everywhere's only, checked
test("Feedback offers and its repo", () => {
  writeFileSync(file, "{}");
  const s = new Settings();
  s.start();
  const sp = { id: "sp7", name: "shop", machine: null, folder: "/shop" };
  const row = (level: string) => s.sections(null, [sp]).find((x) => x.name === "Agents" && x.level === level)!.rows;
  expect(row("all").find((r) => r.key === "agents.feedback")).toMatchObject({ label: "Feedback offers", value: "on", options: ["on", "off"] });
  expect(row("all").find((r) => r.key === "agents.feedback_repo")).toMatchObject({ label: "Feedback repo", value: "", text: true, placeholder: "eliasstravik/shepherdr" });
  expect(row("sp7").find((r) => r.key === "agents.feedback_repo")).toBeUndefined();
  s.set("agents.feedback", "off", "sp7", sp);
  s.set("agents.feedback_repo", "https://github.com/acme/shep", "all");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces.sp7.agents).toEqual({ feedback: false });
  expect(f.everywhere.agents).toEqual({ feedback_repo: "acme/shep" });
  expect(() => s.set("agents.feedback_repo", "nope nope", "all")).toThrow();
  expect(() => s.set("agents.feedback_repo", "acme/x", "sp7", sp)).toThrow();
  s.set("agents.feedback_repo", "", "all");
  expect(JSON.parse(readFileSync(file, "utf8")).everywhere?.agents).toBeUndefined();
});

test("Extra flags (#1222): a box per CLI, Everywhere's or a space's own, kept as herdr-task's list", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp7", name: "api", machine: null, folder: "/api", repo: "/api" };
  const row = (level: string, cli: string) => s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === level)!.rows.find((r) => r.key === `tasks.${cli}_flags`)!;
  expect(row("all", "claude")).toMatchObject({ label: "Claude Code flags", text: true, value: "", placeholder: "--advisor opus" });
  expect(row("all", "codex")).toMatchObject({ label: "Codex flags", text: true, value: "" });
  s.set("tasks.claude_flags", JSON.stringify(["--advisor=opus", "--name=a b"]), "all");
  s.set("tasks.claude_flags", "[]", "sp7", scope);
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.tasks.claude_flags).toEqual(["--advisor=opus", "--name=a b"]);
  expect(f.repos["/api"].tasks.claude_flags).toEqual([]);
  expect(row("all", "claude").value).toBe("--advisor=opus '--name=a b'");
  expect(row("sp7", "claude")).toMatchObject({ value: "none", inherits: { value: "--advisor=opus '--name=a b'", from: "Everywhere" } });
  expect(() => s.set("tasks.codex_flags", JSON.stringify(["a prompt"]), "all")).toThrow("Not a list of flags.");
  s.set("tasks.claude_flags", null, "sp7", scope);
  expect(JSON.parse(readFileSync(file, "utf8")).repos["/api"].tasks).toBeUndefined();
});

test("SHEP-275: When a task is accepted is a command box under the notes, Everywhere's or a space's own", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp3", name: "api", machine: null, folder: "/api", repo: "/api" };
  s.set("tasks.accept_command", 'dropdb --if-exists "test_$HERDR_TASK_ID"', "sp3", scope);
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.repos["/api"].tasks).toEqual({ accept_command: 'dropdb --if-exists "test_$HERDR_TASK_ID"' });
  const tasks = s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === "sp3")!;
  const keys = tasks.rows.map((r) => r.key);
  expect(keys.slice(-3)).toEqual(["tasks.start_notes", "tasks.finish_notes", "tasks.accept_command"]);
  expect(tasks.rows.at(-1)).toMatchObject({ label: "When a task is accepted", multiline: true, mono: true, value: 'dropdb --if-exists "test_$HERDR_TASK_ID"' });
  s.set("tasks.accept_command", null, "sp3", scope);
  expect(JSON.parse(readFileSync(file, "utf8")).repos["/api"].tasks?.accept_command).toBeUndefined();
});
