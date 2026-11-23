// SHEP-302: the web app shows each space's folder. A space in the snapshot says its whole folder, and as it shows: its
// own machine's home as ~ (another machine's home is not this one's). Fake data.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { HOME } from "./paths.ts";

const snap = (spaces: any[]) => {
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  return c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows: [] }).places;
};

test("a space says its folder: whole, and with its own machine's home as ~", () => {
  const [home, here, out, there] = snap([
    { id: "home", name: "Home", folder: HOME, machine: null, assistant: null },
    { id: "sp1", name: "shop", folder: `${HOME}/dev/shop`, machine: null, assistant: null },
    { id: "sp2", name: "srv", folder: "/srv/app", machine: null, assistant: null },
    { id: "vm-b/sp3", name: "shop", folder: "/home/someone/clients/shop", machine: "vm-b", assistant: null },
  ]);
  expect([home.where, home.folder]).toEqual(["~", HOME]);
  expect([here.where, here.folder]).toEqual(["~/dev/shop", `${HOME}/dev/shop`]);
  expect([out.where, out.folder]).toEqual(["/srv/app", "/srv/app"]);
  // another machine's home, by where homes live there
  expect([there.where, there.folder, there.machine]).toEqual(["~/clients/shop", "/home/someone/clients/shop", "vm-b"]);
});
