import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as N from "./newspace.js";
import * as MA from "./machine-add.js";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("New space's words are the window's", () => {
  expect([N.WORDS.title, N.WORDS.label, N.WORDS.placeholder, N.WORDS.browse, N.WORDS.create, N.WORDS.creating]).toEqual(
    ["New space", "Icon and folder", "~/path/to/folder", "Browse…", "Create space", "Creating…"]);
  expect(N.WORDS.missing).toBe("This folder doesn't exist. It will be created.");
  expect([N.WORDS.makeRepo, N.WORDS.makeRepoWhy, N.WORDS.isRepo]).toEqual(
    ["Make it a git repo", "so each task gets its own worktree", "A git repo: each task gets its own worktree"]);
  expect(N.WORDS.cantList("~/x", "vm")).toBe("Couldn't list ~/x on vm.");
  expect(N.WORDS.cantRepo("")).toBe("Couldn't make it a git repo: git failed");
});

test("the field, its suggestions and where it starts", () => {
  const home = "/h/me";
  expect(N.pathOf("~/dev/x/", home)).toBe("/h/me/dev/x");
  expect(N.pathOf("~", home)).toBe(home);
  expect(N.pathOf("shep", home)).toBe(null);
  expect(N.tilde("/h/me/dev", home)).toBe("~/dev");
  expect(N.base(home, home)).toBe("Home");
  const recent = ["/h/me/dev/a", "/h/me/dev/b", "/srv/c", "/h/me/x", "/h/me/y", "/h/me/z"];
  expect(N.suggestions(recent, "", home)).toHaveLength(N.SHOWN);
  expect(N.suggestions(recent, "~/dev/a", home)).not.toContain("/h/me/dev/a");
  expect(N.suggestions(recent, "c", home)).toEqual(["/srv/c"]);
  expect(N.startFolder("/h/me/dev/a/src", recent, home)).toBe("/h/me/dev/a");
  expect(N.startFolder("/tmp/scratch", recent, home)).toBe(home);
  expect(N.startFolder(null, recent, home)).toBe(home);
  expect(N.offersRepo("/h/me/new", false, home)).toBe(true);
  expect(N.offersRepo(home, false, home)).toBe(false);
  expect(N.offersRepo("/h/me/r", true, home)).toBe(false);
  expect(N.placeName(home, "", home)).toBe("Home");
  expect(N.placeName("/h/me/r/sub", "/h/me/r", home)).toBe("r");
  expect(N.recentFrom("/a\n/a\n/h/.herdr/worktrees/r/b\n/b\n")).toEqual(["/a", "/b"]);
  expect(N.recentCandidates([{ cwd: "/a", at: 1 }, { cwd: "/b", at: 3 }, { cwd: "/a", at: 5 }, { cwd: "/w/.herdr/worktrees/x", at: 9 }])).toEqual(["/a", "/b"]);
});

test("the field's list follows the typed path, as a shell completes one", () => {
  const home = "/h/me";
  expect(N.typedDir("~/dev/", home)).toEqual({ dir: "/h/me/dev", word: "" });
  expect(N.typedDir("~/dev/sh", home)).toEqual({ dir: "/h/me/dev", word: "sh" });
  expect(N.typedDir("~/dev/shepherdr/", home)).toEqual({ dir: "/h/me/dev/shepherdr", word: "" });
  expect(N.typedDir("~/", home)).toEqual({ dir: home, word: "" });
  expect(N.typedDir("~/de", home)).toEqual({ dir: home, word: "de" });
  expect(N.typedDir("/", home)).toEqual({ dir: "/", word: "" });
  expect(N.typedDir("/us", home)).toEqual({ dir: "/", word: "us" });
  expect(N.typedDir("/srv//x", home)).toEqual({ dir: "/srv", word: "x" });
  for (const t of ["", "~", "shep", "dev/sh"]) expect(N.typedDir(t, home)).toBe(null);
  expect(N.asDir(home, home)).toBe("~/");
  expect(N.asDir("/h/me/dev", home)).toBe("~/dev/");
  expect(N.asDir("/", home)).toBe("/");
  expect(N.asDir("/srv", home)).toBe("/srv/");
  const kids = ["/h/me/dev/Ashes", "/h/me/dev/notes", "/h/me/dev/Shepherdr", "/h/me/dev/shell", "/h/me/dev/x"];
  expect(N.matching(kids, "")).toEqual(kids);
  expect(N.matching(kids, "sh")).toEqual(["/h/me/dev/Shepherdr", "/h/me/dev/shell", "/h/me/dev/Ashes"]);
  expect(N.matching(kids, "SHE")).toEqual(["/h/me/dev/Shepherdr", "/h/me/dev/shell", "/h/me/dev/Ashes"]);
  expect(N.matching(kids, "zz")).toEqual([]);
});

test("the window's New space and the web's read the same core", () => {
  expect(read("mods/newspace/main.js")).toContain('from "./core/newspace.js"');
  expect(read("web/plugins/places/add.tsx")).toContain("from '@core/newspace.js'");
  expect(read("service/spaces.ts")).toContain('from "../core/newspace.js"');
  // the dialog's height (lib/coordinator.js) counts as many suggestions as it shows
  expect(read("lib/coordinator.js")).toContain(`export const NEWSPACE_SHOWN = ${N.SHOWN};`);
  for (const w of ["New space", "Icon and folder", "Make it a git repo", "Create space"]) expect(read("web/plugins/places/add.tsx")).not.toContain(`'${w}'`);
});

test("Add machine: the ssh config's hosts, when it needs a terminal, its words", () => {
  const hosts = MA.parseConfig("Host *\n  User x\nHost vps box\n  HostName 10.0.0.7\n  User me\nHost mini\nMatch host y\n  User z\n");
  expect(hosts).toEqual([{ alias: "vps", aliases: ["box"], hostname: "10.0.0.7", user: "me" }, { alias: "mini", aliases: [], hostname: null, user: null }]);
  expect(MA.hostSub(hosts[0])).toBe("me@10.0.0.7");
  expect(MA.hostSub({ alias: "a", aliases: ["b", "c"], hostname: null, user: null })).toBe("also b, c");
  expect(MA.needsTerminal({ kind: "host_key" })).toBe(true);
  expect(MA.needsTerminal({ message: "Permission denied (publickey)" })).toBe(true);
  expect(MA.needsTerminal({ message: "No route to host" })).toBe(false);
  expect(MA.failure({ code: 0 })).toBe(null);
  expect(MA.failure({ code: 1, stdout: '{"error":{"kind":"auth_failed","message":"no"}}', stderr: "" })).toEqual({ kind: "auth_failed", message: "no" });
  expect(MA.isAdded([{ target: "me@vps", name: "vps" }], "vps")).toBe(true);
  expect(MA.terminalName("Me@Box.local")).toBe("add-me-box-local");
  expect([MA.WORDS.title, MA.WORDS.fromConfig, MA.WORDS.noHosts, MA.WORDS.orType, MA.WORDS.placeholder]).toEqual(
    ["Add machine", "From your ssh config", "Your ssh config lists no hosts", "Or type how ssh reaches it", "user@host"]);
  expect(read("mods/machine-add-chat/main.js")).toContain('from "./core/machine-add.js"');
  expect(read("web/src/screens/AddMachine.tsx")).toContain("from '@core/machine-add.js'");
  expect(read("service/actions.ts")).toContain('from "../core/machine-add.js"');
});

test("the Machine choice: only reachable machines, shown for two or more, preselected as asked", () => {
  const keys = N.reachable([{ key: null, on: true }, { key: "vm", on: false }, { key: "mini", on: true }]);
  expect(keys).toEqual([null, "mini"]);
  expect(N.choosesMachine(keys)).toBe(true);
  expect(N.choosesMachine([null])).toBe(false);
  expect(N.WORDS.machine).toBe("Machine");
  // a machine's + wins, then the shown space's, then the first reachable
  expect(N.startMachine(keys, "mini", null)).toBe("mini");
  expect(N.startMachine(keys, undefined, "mini")).toBe("mini");
  expect(N.startMachine(keys, "vm", "mini")).toBe("mini");
  expect(N.startMachine(keys, "vm", "vm")).toBe(null);
  expect(N.startMachine([], null, null)).toBe(undefined);
});
