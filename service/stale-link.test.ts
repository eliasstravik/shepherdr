// SHEP-310: a machine whose link holds another herdr-core's id ("a different core answers there") says so on the
// Machines page, in plain words with what to do, rather than just "can't reach".
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { downWords, STALE_LINK, staleLink } from "../web/shared/view.ts";
import { warningsOf } from "./next.ts";

const machinesOf = (machines: { name: string; here: boolean; state: string; why?: string }[]) => {
  const c = new Compat() as any;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  return c.snapshot({ host: "mini", user: "me", machines, spaces: [], sections: [], rows: [] }).machines;
};

test("herdr-core's why for a link another core answers on is told apart from a plain outage", () => {
  expect(staleLink('a different core answers there ("e5a90f")')).toBe(true);
  expect(staleLink("ssh: connect to host vm port 22: Connection timed out")).toBe(false);
  expect(staleLink(undefined)).toBe(false);
});

test("the Machines data carries the reason and what to do, only for that link", () => {
  const ms = machinesOf([
    { name: "mini", here: true, state: "connected" },
    { name: "vm-demo", here: false, state: "unreachable", why: 'a different core answers there ("e5a90f")' },
    { name: "vm-off", here: false, state: "unreachable", why: "ssh: connect timed out" },
  ]);
  const demo = ms.find((m: any) => m.machine === "vm-demo"), off = ms.find((m: any) => m.machine === "vm-off");
  expect(demo.status).toBe("off");
  expect(demo.linkWhy).toBe(STALE_LINK);
  expect(STALE_LINK).toContain("A different herdr-core answers there now");
  expect(STALE_LINK).toContain("herdr-task carry-over");
  expect(off.linkWhy).toBeUndefined();
  expect(downWords(demo)).toBe("Can't reach vm-demo · its link is broken");
  expect(downWords(off)).toBe("Can't reach vm-off");
});

test("the warnings line says the link is broken and how to fix it", () => {
  const [demo] = machinesOf([{ name: "vm-demo", here: false, state: "unreachable", why: 'a different core answers there ("e5a90f")' }]);
  const [w] = warningsOf({ machines: [demo] } as any, []);
  expect(w.text).toBe("Can't reach vm-demo · its link is broken: run herdr-task carry-over to link it again");
});
