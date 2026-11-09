// The voice call's screen protocol (core/screen.js): its parameters checked, the screen as short words with refs, the
// answers the voice agent hears, and risky clicks held for a yes.
import { expect, test } from "bun:test";
import { screenParams, screenText, screenWords, nodeLine, refOf, keyOf, risky, MAX, DOS } from "./screen.js";
import { TOOLS, OPENS, prompt } from "./voice.js";

test("refs as said, keys as said", () => {
  expect(refOf("e12")).toBe("e12");
  expect(refOf("@e7")).toBe("e7");
  expect(refOf("E 3")).toBe("e3");
  expect(refOf("12")).toBe("e12");
  expect(refOf("button")).toBe("");
  expect(keyOf("esc")).toBe("Escape");
  expect(keyOf("enter")).toBe("Enter");
  expect(keyOf("page down")).toBe("PageDown");
  expect(keyOf("down")).toBe("ArrowDown");
  expect(keyOf("f13")).toBe(null);
});

test("params: each action's needs, checked in words", () => {
  expect(screenParams({}).do).toBe("look");
  expect(screenParams({ do: "click" }).error).toContain("needs a ref");
  expect(screenParams({ do: "click", ref: "e4" })).toMatchObject({ do: "click", ref: "e4", confirmed: false });
  expect(screenParams({ do: "type", ref: "e2" }).error).toContain("text");
  expect(screenParams({ do: "type", ref: "e2", text: "voice", submit: true })).toMatchObject({ text: "voice", submit: true });
  expect(screenParams({ do: "scroll" }).direction).toBe("down");
  expect(screenParams({ do: "scroll", direction: "to the top" }).direction).toBe("top");
  expect(screenParams({ do: "scroll", direction: "sideways" }).error).toBeTruthy();
  expect(screenParams({ do: "key", text: "esc" }).text).toBe("Escape");
  expect(screenParams({ do: "key", text: "hyper" }).error).toContain("key presses");
  expect(screenParams({ do: "dance" }).error).toContain("screen can");
  expect(screenParams({ do: "close" })).toMatchObject({ do: "close" });
});

test("the screen as lines: ref, role, name, states; a dialog over it; cut short with how many more", () => {
  expect(nodeLine({ ref: "e7", role: "tab", name: "Artifacts", selected: true })).toBe('e7 tab "Artifacts" selected');
  expect(nodeLine({ ref: "e9", role: "textbox", name: "Filter tasks", value: "voice", depth: 1 })).toBe('  e9 textbox "Filter tasks" value "voice"');
  expect(nodeLine({ ref: "", role: "heading", name: "Spaces", level: 2 })).toBe('heading "Spaces" level 2');
  const text = screenText({ head: { app: "the web app on a phone", shows: "Settings › Secrets", dialog: "Delete secret?" }, nodes: [{ ref: "e1", role: "button", name: "Cancel" }], hidden: 3 });
  expect(text).toContain("Screen: the web app on a phone, showing Settings › Secrets.");
  expect(text).toContain('A dialog is open over it: "Delete secret?"');
  expect(text).toContain('e1 button "Cancel"');
  expect(text).toContain("3 more off screen: scroll");
  const many = Array.from({ length: 500 }, (_, i) => ({ ref: `e${i + 1}`, role: "button", name: `Row number ${i + 1} with a long enough name` }));
  const long = screenText({ nodes: many });
  expect(long.length).toBeLessThanOrEqual(MAX);
  expect(long).toMatch(/\d+ more not listed: look with find/);
  // find narrows it
  const found = screenText({ nodes: many, find: "number 250" });
  expect(found).toContain("e250");
  expect(found).not.toContain("e249 ");
  expect(screenText({ nodes: many.slice(0, 2), find: "zebra" })).toContain("Nothing on screen matches");
  // a state is found too ("what has the focus")
  expect(screenText({ nodes: [{ ref: "e1", role: "button", name: "Mute" }, { ref: "e2", role: "button", name: "End call", focused: true }], find: "focused" })).toContain('e2 button "End call" focused');
});

test("moving around (back, close, scroll) answers only that it worked, never the screen (SHEP-83)", () => {
  for (const d of ["back", "close", "scroll"]) {
    const r = screenWords({ ok: true, did: "Went back", screen: "Screen: x\ne1 button \"Close\"" }, d);
    expect(JSON.parse(r.result)).toEqual({ ok: true, did: "Went back" });
    expect(r.result).not.toContain("Screen");
  }
  expect(JSON.parse(screenWords({ ok: true }, "close").result)).toEqual({ ok: true, did: "close" });
  // a failure still says why, with the screen
  expect(screenWords({ ok: false, why: "nothing to go back to", screen: "Screen: y" }, "back").result).toContain("Screen: y");
});

test("risky clicks: delete, merge, accept, stop, end call; not open, close or back", () => {
  for (const n of ["Delete task", "Accept", "Merge", "Stop agent", "End call", "Remove space", "Forget secret"]) expect(risky(n)).toBe(true);
  for (const n of ["Artifacts", "Close", "Back", "Settings", "Filter tasks", "Secrets"]) expect(risky(n)).toBe(false);
});

test("answers: the new screen after an action, a held click to ask about, a failure, no answer", () => {
  expect(screenWords({ ok: true, did: "Pressed the tab \"Artifacts\"", screen: "Screen: x" }, "click").result).toBe('Pressed the tab "Artifacts". The screen now, for your next step only (don\'t read it out):\nScreen: x');
  expect(screenWords({ ok: true, screen: "Screen: x" }, "look").result).toBe("Screen: x");
  const ask = screenWords({ ok: false, ask: "Press Delete task?" });
  expect(ask.result).toContain('Ask the person first: "Press Delete task?"');
  expect(ask.error).toBeUndefined();
  const bad = screenWords({ ok: false, why: "e4 isn't on the screen any more", screen: "Screen: y" });
  expect(bad.error).toBe(true);
  expect(bad.result).toContain("isn't on the screen any more");
  expect(bad.result).toContain("Screen: y");
  expect(screenWords(null).error).toBe(true);
});

test("the voice agent: a screen tool beside look, open, send and act; told to use the tools first", () => {
  const names = TOOLS.map((t) => t.name);
  expect(names).toEqual(["look", "open", "send", "screen", "act", "call_view", "hang_up"]);
  const screen = TOOLS.find((t) => t.name === "screen");
  expect(screen.parameters.properties.do.enum).toEqual(DOS);
  expect(OPENS).toEqual(expect.arrayContaining(["artifacts", "files", "changes", "terminal"]));
  const p = prompt();
  expect(p).toContain("Prefer look, open, send and act");
  expect(p).toContain("Use screen only when none of them fits");
  expect(p).toMatch(/a screen click that deletes, merges, accepts, stops or can't be undone: say in a few words what it will do and ask\. Set confirmed true only after a clear yes/);
  // the tool list stays small enough for ElevenLabs
  expect(JSON.stringify(TOOLS).length).toBeLessThan(9000);
});
