import { expect, test } from "bun:test";
import { lastWords, nextWords, scheduleAgentArgs, scheduleId, scheduleOf, schedulesOf, warningsOf, whenWords, catalogOf } from "./next.ts";

test("a schedule says when it runs in words", () => {
  expect(whenWords({ every: { kind: "every", text: "mondays 9:00" } })).toBe("Mondays 9:00");
  expect(whenWords({ on: ["merged"] })).toBe("When a task is merged");
  expect(whenWords({ every: { kind: "once", at: "2026-11-27 09:00", text: "once fri 9:00" } })).toBe("Once · Fri 27 Nov 9:00");
  expect(whenWords({ every: { text: "every 30 minutes" }, on: ["checks-fail"] })).toBe("Every 30 minutes, When checks fail");
});

test("when it runs next, and how its last run ended", () => {
  const now = new Date(2026, 10, 22, 10, 0).getTime();
  expect(nextWords(now + 12 * 60_000, now)).toBe("in 12 min");
  expect(nextWords(now + 9 * 3_600_000, now)).toBe("in 9h");
  expect(nextWords(new Date(2026, 10, 23, 7, 30).getTime(), now)).toBe("tomorrow 7:30");
  expect(nextWords(now + 7 * 86_400_000, now)).toBe("in 7 days");
  expect(nextWords(now - 1, now)).toBe("");
  expect(lastWords({ runs: [{ at: new Date(2026, 10, 22, 9, 0).getTime(), ended: "nothing" }] }, now)).toBe("today 9:00 · nothing to do");
  expect(lastWords({}, now)).toBe("");
});

test("a schedule's id carries its machine, folder and own id, and nothing else passes", () => {
  const id = scheduleId({ machine: "vm", folder: "/home/x/shop", id: 3 });
  expect(scheduleOf(id)).toEqual({ machine: "vm", folder: "/home/x/shop", id: "3" });
  expect(scheduleOf(scheduleId({ machine: null, folder: "/a", id: 1 }))).toEqual({ machine: null, folder: "/a", id: "1" });
  expect(scheduleOf("vm|relative|1")).toBeNull();
  expect(scheduleOf("vm|/a|1; rm -rf")).toBeNull();
});

test("schedules sit under the space they were made for, else the one in their folder, else Everything", () => {
  const spaces = [{ id: "home", folder: "/home/x", machine: null }, { id: "sp1", folder: "/home/x/shop", machine: null }, { id: "vm/sp2", folder: "/srv/garden", machine: "vm" }];
  const out = schedulesOf([
    { id: 1, title: "Dependency check", prompt: "Check", folder: "/home/x/shop", machine: null, every: { text: "mondays 9:00" }, paused: false },
    { id: 2, title: "Morning brief", prompt: "Tell me", folder: "/home/x/shop", machine: null, space: "home", paused: true },
    { id: 1, title: "Water", prompt: "", folder: "/srv/garden", machine: "vm", space: "sp2", every: { kind: "once", at: "2026-11-27 09:00" } },
    { id: 9, title: "Lost", prompt: "", folder: "/nowhere", machine: null },
  ], spaces, "home", () => undefined);
  expect(out.sp1!.map((a) => [a.name, a.on, a.when])).toEqual([["Dependency check", true, "Mondays 9:00"]]);
  expect(out.home!.map((a) => [a.name, a.on])).toEqual([["Morning brief", false], ["Lost", true]]);
  expect(out["vm/sp2"]![0]!.once).toBe(true);
});

test("a schedule's tier is read from the settings its runs inherit, and Standard clears a faster tier", () => {
  const [schedule] = schedulesOf([
    { id: 1, folder: "/repo", agent: "claude", set: { agent: "codex", model: "gpt-6.2-sol", effort: "high", speed: "ultrafast" } },
  ], [], "home", () => undefined).home!;
  expect(schedule!.agent).toMatchObject({ agent: "codex", model: "gpt-6.2-sol", effort: "high", fast: "ultrafast" });
  expect(scheduleAgentArgs({ ...schedule!.agent, fast: false })).toContain("speed=regular");
});

test("the warnings line: a plan past 75%, a disk nearly full, a machine out of reach", () => {
  const snap: any = { machines: [
    { machine: "mini", name: "mini", status: "idle", health: { meters: [{ name: "Disk", pct: 58 }] } },
    { machine: "vm", name: "vm", status: "idle", health: { meters: [{ name: "Disk", pct: 91 }] } },
    { machine: "old", name: "old", status: "off", unreachableSince: "14:02" },
  ] };
  const w = warningsOf(snap, [{ name: "Claude Max", windows: [{ name: "This week", used: 76 }, { name: "These 5 hours", used: 40 }] }, { name: "Codex Pro", windows: [{ name: "This week", used: 12 }] }]);
  expect(w.map((x) => x.text)).toEqual(["You've used 76% of this week's Claude plan", "vm: disk nearly full", "Can't reach old · last seen 14:02"]);
});

test("the picker's lists come from each agent's own menus; an agent Shepherdr can't hold a chat with is greyed", () => {
  const c = catalogOf("mini", [{ kind: "claude", name: "Claude Code", models: [{ id: "opus", label: "Opus 5.5", efforts: ["low", "high"], fast: true }], perms: [{ id: "manual", label: "Manual" }, { id: "plan", label: "Plan" }], permDefault: "manual" }], { claude: true }, [{ key: "pi", name: "Pi" }]);
  expect(c.agents[0]!.models[0]).toEqual({ id: "opus", name: "Opus 5.5", speeds: ["regular", "fast"], efforts: ["low", "high"] });
  expect(c.agents[0]!.perms[0]).toEqual({ id: "manual", label: "Default", about: "Asks before edits and commands" });
  expect(c.agents[1]).toMatchObject({ id: "pi", installed: false, why: "No chat yet" });
});

test("two home spaces on this computer: Everything is always the same one, and neither is listed (SHEP-296)", async () => {
  const { enrich } = await import("./next.ts");
  const { HOME } = await import("./paths.ts");
  const spaces = [{ id: "spH", folder: HOME, machine: null }, { id: "home", folder: `${HOME}/`, machine: null }, { id: "sp1", folder: "/srv/app", machine: null }];
  const snap: any = { places: spaces.map((s) => ({ id: s.id, chat: `p:${s.id}`, name: s.id, machine: "mini" })), tasks: [], machines: [] };
  const f: any = { spaces, rows: [], archived: [], asked: () => null, reportOf: () => null, config: { plans: [] } };
  for (const order of [spaces, [...spaces].reverse()]) {
    const out: any = enrich({ ...snap, places: [...snap.places] }, { ...f, spaces: order });
    expect(out.everything).toBe("home");
    expect(out.places.filter((p: any) => p.home).map((p: any) => p.id).sort()).toEqual(["home", "spH"]);
  }
});

test("another machine's home space keeps the name given it; unnamed it is home, and Everything always is", async () => {
  const { enrich } = await import("./next.ts");
  const { HOME } = await import("./paths.ts");
  const spaces = [{ id: "home", folder: HOME, machine: null }, { id: "vm/a", folder: "/home/x", machine: "vm" }, { id: "pi/b", folder: "/home/y", machine: "pi" }];
  const places = [{ id: "home", name: "Home", unnamed: true }, { id: "vm/a", name: "box" }, { id: "pi/b", name: "Home", unnamed: true }].map((p) => ({ ...p, chat: `p:${p.id}`, machine: "mini" }));
  const out: any = enrich({ places, tasks: [], machines: [] } as any, { spaces, rows: [], archived: ["vm/a"], asked: () => null, reportOf: () => null, config: { plans: [] } } as any);
  expect(out.places.map((p: any) => [p.id, p.name, !!p.home, !!p.archived])).toEqual([["home", "home", true, false], ["vm/a", "box", true, true], ["pi/b", "home", true, false]]);
});

test("Up next: it waits for the tasks not done yet, the first by title and the rest counted (SHEP-356)", async () => {
  const { enrich } = await import("./next.ts");
  const spaces = [{ id: "sp1", folder: "/srv/app", machine: null }];
  const row = (id: number, title: string, section: string, x: any = {}) => ({ ref: `APP-${id}`, id, title, folder: "/srv/app", machine: null, section, x });
  const snapTask = (id: number) => ({ id: `APP-${id}`, name: "", place: "sp1", status: "queued", state: "queued", on: "mini", created: "", age: "" });
  const rows = [row(1, "Old one", "done"), row(2, "Desktop tab: starts by itself", "working"), row(3, "Tasks filter menu", "working"), row(4, "Swap control", "queued"),
    row(9, "Release", "queued", { after: [1, 2, 3, 4], pick: { speed: "regular" } }), row(10, "Docs", "queued", { after: [2] }), row(11, "After a done one", "queued", { after: [1] })];
  const snap: any = { places: [{ id: "sp1", chat: "p:sp1", name: "app", machine: "mini" }], tasks: [9, 10, 11].map(snapTask), machines: [] };
  const f: any = { spaces, rows, archived: [], asked: () => null, reportOf: () => null, config: { plans: [], all: { agents: { Tasks: { agent: "codex", model: "gpt-6.2-sol", fast: "ultrafast" } } } } };
  const out: any = enrich(snap, f);
  const by = (id: string) => out.tasks.find((t: any) => t.id === id);
  expect(by("APP-9")).toMatchObject({ afterTitle: "Desktop tab: starts by itself", afterMore: 2 });
  expect(by("APP-9").plannedAgent).toMatchObject({ agent: "codex", model: "gpt-6.2-sol", fast: false });
  expect(by("APP-10").plannedAgent.fast).toBe("ultrafast");
  expect(by("APP-10").afterTitle).toBe("Desktop tab: starts by itself");
  expect(by("APP-10").afterMore).toBeUndefined();
  // everything it waited for is done: its title still says which, nothing counted
  expect(by("APP-11")).toMatchObject({ afterTitle: "Old one" });
  expect(by("APP-11").afterMore).toBeUndefined();
});

test("a browser sign-in request takes over the task's inferred wait until it is settled", async () => {
  const { enrich } = await import("./next.ts");
  const task = { id: "APP-1", place: "sp1", status: "need", at: 500 };
  const inferred = { id: "attention", task: task.id, place: task.place, chat: "APP-1/worker", at: 500, assistantFirst: true as const };
  const snap: any = { places: [], tasks: [task], needs: [inferred], machines: [] };
  const hands: { what: string; settled?: string } = { what: "Sign in to the shop" };
  const f: any = { spaces: [], rows: [{ ref: task.id }], archived: [], asked: () => null, reportOf: () => null,
    config: { plans: [], all: { agents: { Tasks: { agent: "claude" } } } }, screens: { "task:APP-1": { hands } } };
  expect(enrich(snap, f).needs).toMatchObject([{ id: "hands", hands: true, text: hands.what }]);
  hands.settled = "done";
  expect(enrich(snap, f).needs).toEqual([inferred]);
});
