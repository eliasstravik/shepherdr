import { expect, test } from "bun:test";
import { expand, expandTasks, hasMention, match, matchTasks, parseTask, pickInto, pickTaskInto, plain, reachable, split, taskToken, token, typing, typingTask } from "./mentions.js";
import { mentionedIn } from "./send.js";

// A reach map as herdr-task draws it: here (mini) links to vm-demo over herdr-core, and through it to vm-x; laptop is a
// Tailscale peer it can't log into (no next); vm-demo's document also mirrors mini's space (machine set: not its own).
const graph = {
  core: { id: "c-mini", name: "mini" }, host: "mini",
  spaces: [{ id: "sp-home", name: "home" }, { id: "sp-web", name: "web", icon: "🌐" }],
  assistants: [{ address: "t1", space: "sp-web" }],
  links: [
    { how: "tailscale", to: "laptop", ok: true },
    { how: "ssh", to: "vm-demo.example", ok: true, id: "c-demo", next: { core: { id: "c-demo", name: "vm-demo" }, links: [], spaces: [] } },
    { how: "herdr-core", to: "vm-demo", ok: true, id: "c-demo", next: {
      core: { id: "c-demo", name: "vm-demo" },
      spaces: [{ id: "sp-shop", name: "shop" }, { id: "sp-web", name: "web", machine: "mini" }],
      links: [{ how: "herdr-core", to: "vm-x", ok: true, id: "c-x", next: { core: { id: "c-x", name: "vm-x" }, links: [], spaces: [{ id: "sp-lab", name: "lab" }] } }],
    } },
  ],
};

test("the spaces a reach map reaches: here first, each machine's own, the route tell-assistant takes", () => {
  const got = reachable(graph);
  expect(got.map((s) => [s.name, s.machine, s.target, s.assistant])).toEqual([
    ["home", "mini", "sp-home", false], ["web", "mini", "sp-web", true],
    ["shop", "vm-demo", "vm-demo/sp-shop", false], ["lab", "vm-x", "vm-demo>vm-x/sp-lab", false],
  ]);
  expect(got[1].emoji).toBe("🌐");
  expect(reachable(null)).toEqual([]);
});

// SHEP-185: the map reached two machines over herdr-core, but their saved documents listed no spaces, and
// vm-b's one space had no name: the # list left them out (or showed its id). Each machine's spaces come from the
// service's known list too, and an unnamed space is named as Herdr names it.
test("a machine whose document lists no spaces still lists the spaces the service knows, named, and pickable", () => {
  const map = {
    core: { id: "c-x", name: "mac-x" }, host: "mac-x", home: "/base/alpha", spaces: [], assistants: [],
    links: [
      { how: "herdr-core", to: "vm-a", ok: true, id: "c-vs", next: { core: { id: "c-vs", name: "vm-a" }, home: "/base/alpha", spaces: [], links: [] } },
      { how: "herdr-core", to: "vm-b", ok: true, id: "c-plu", next: { core: { id: "c-plu", name: "vm-b" }, home: "/base/gamma",
        spaces: [{ id: "sp8c0069b90399cae8fb2944eccc07150a", name: "", folder: "/base/gamma" }], links: [] } },
    ],
  };
  const known = [
    { id: "spHOME1", name: "", folder: "/base/alpha", machine: "vm-a", assistant: true },
    { id: "spM3", name: "Home", folder: "/base/beta", machine: "box-c" },
    { id: "spMAC", name: "Home", folder: "/base/alpha", machine: null },
  ];
  const got = reachable(map, known);
  expect(got.map((s) => [s.name, s.machine, s.target, s.assistant])).toEqual([
    ["Home", "mac-x", "spMAC", false],
    ["Home", "vm-a", "vm-a/spHOME1", true],
    ["Home", "vm-b", "vm-b/sp8c0069b90399cae8fb2944eccc07150a", false],
  ]);
  // box-c is not in the map, so its space is not reachable: left out (the list shows it locked)
  expect(got.some((s) => s.id === "spM3")).toBe(false);
  // a space that is nobody's name and not at home: its folder's name, never its id
  const plain = reachable({ core: { id: "c", name: "mac-x" }, spaces: [{ id: "sp-x", name: "", folder: "/base/alpha/dev/shop/" }], links: [] });
  expect(plain.map((s) => s.name)).toEqual(["shop"]);
  // the same space known and in the map: listed once, with the map's own entry
  expect(reachable(map, [{ id: "sp8c0069b90399cae8fb2944eccc07150a", name: "Plu home", folder: "/base/gamma", machine: "vm-b" }]).length).toBe(1);
});

test("what is typed after #, and the spaces that match it", () => {
  expect(typing("tell #sh")).toBe("sh");
  expect(typing("#")).toBe("");
  expect(typing("issue#4")).toBe(null);
  expect(typing("tell #shop now")).toBe(null);
  const list = reachable(graph);
  expect(match(list, "s").map((s) => s.name)).toEqual(["shop"]);
  expect(match(list, "vm-x").map((s) => s.name)).toEqual(["lab"]);
});

test("a pick goes in short, and at send becomes its mention; one never picked stays as typed", () => {
  const shop = reachable(graph)[2];
  const box = pickInto("tell #sh", shop);
  expect(box).toBe("tell #shop ");
  expect(expand(`${box}to ship it. Ask #shop. #shopping #other`, [shop])).toBe(
    "tell [#shop](space:vm-demo/sp-shop) to ship it. Ask [#shop](space:vm-demo/sp-shop). #shopping #other");
  expect(expand("tell #shop", [])).toBe("tell #shop");
  expect(expand(token(shop), [shop])).toBe(token(shop));
});

test("a message's mentions, and the window's plain form: out of reach says so", () => {
  const text = "ask [#shop](space:vm-demo/sp-shop) and [#lab](space:vm-demo>vm-x/sp-lab).";
  expect(split(text)).toEqual([
    { text: "ask " }, { mention: { name: "shop", target: "vm-demo/sp-shop", id: "sp-shop", route: "vm-demo" } },
    { text: " and " }, { mention: { name: "lab", target: "vm-demo>vm-x/sp-lab", id: "sp-lab", route: "vm-demo>vm-x" } }, { text: "." },
  ]);
  expect(plain(text, new Set(["sp-shop"]))).toBe("ask `#shop · vm-demo` and `#lab · vm-x · out of reach`.");
});

// ---- tasks: @SHEP-4 ----

test("what is typed after @: never inside an email", () => {
  expect(typingTask("ask @SH")).toBe("SH");
  expect(typingTask("@")).toBe("");
  expect(typingTask("mail me@host")).toBe(null);
  expect(typingTask("ask @SHEP-4 now")).toBe(null);
  expect(typing("ask @SH")).toBe(null);
});

test("the agent gets the exact task: its ID, the route from its machine, and the folder off its own space", () => {
  const here = { ref: "SHEP-4", route: "", folder: "" };
  const away = { ref: "SHOP-2", route: "vm-demo", folder: "~/dev/shop" };
  const far = { ref: "LAB-9", route: "vm-demo>vm-x", folder: "/srv/my lab" };
  expect(taskToken(here)).toBe("[@SHEP-4](task:SHEP-4)");
  expect(taskToken(away)).toBe("[@SHOP-2](task:vm-demo/SHOP-2?folder=~/dev/shop)");
  expect(taskToken(far)).toBe("[@LAB-9](task:vm-demo>vm-x/LAB-9?folder=/srv/my%20lab)");
  const box = pickTaskInto("ask @sho", away);
  expect(box).toBe("ask @SHOP-2 ");
  expect(expandTasks(`${box}to rebase, then @SHEP-4. @SHEP-40 @nobody me@SHEP-4`, [away, here])).toBe(
    "ask [@SHOP-2](task:vm-demo/SHOP-2?folder=~/dev/shop) to rebase, then [@SHEP-4](task:SHEP-4). @SHEP-40 @nobody me@SHEP-4");
  expect(expandTasks(taskToken(here), [here])).toBe(taskToken(here));
  expect(parseTask("vm-demo>vm-x/LAB-9?folder=/srv/my%20lab")).toEqual({ ref: "LAB-9", target: "vm-demo>vm-x/LAB-9?folder=/srv/my%20lab", route: "vm-demo>vm-x", folder: "/srv/my lab" });
});

test("a message with both kinds splits into spaces and tasks; the window's plain form names each", () => {
  const text = `tell [#shop](space:vm-demo/sp-shop) about ${taskToken({ ref: "SHOP-2", route: "vm-demo", folder: "~/dev/shop" })}.`;
  expect(hasMention(text)).toBe(true);
  expect(hasMention("[@x](space:y) [#y](task:z)")).toBe(false);
  expect(split(text)).toEqual([
    { text: "tell " }, { mention: { name: "shop", target: "vm-demo/sp-shop", id: "sp-shop", route: "vm-demo" } },
    { text: " about " }, { task: { ref: "SHOP-2", target: "vm-demo/SHOP-2?folder=~/dev/shop", route: "vm-demo", folder: "~/dev/shop" } }, { text: "." },
  ]);
  expect(plain(text, new Set(["sp-shop"]), null, (t) => (t.ref === "SHOP-2" ? "Fix the checkout total rounding" : null))).toBe(
    "tell `#shop · vm-demo` about `@SHOP-2 · Fix the checkout total roun… · vm-demo`.");
});

test("the list puts tasks waiting on you and at work first, Done last; IDs before titles", () => {
  const list = [
    { ref: "SHEP-1", title: "Old work", status: "done", at: 9 },
    { ref: "SHEP-2", title: "Queue it", status: "queued", at: 5 },
    { ref: "SHEP-3", title: "Asks you", status: "need", at: 1 },
    { ref: "SHEP-4", title: "Working", status: "work", at: 3 },
    { ref: "SHEP-5", title: "Also working", status: "work", at: 7 },
    { ref: "GTM-1", title: "SHEP style copy", status: "todo", at: 2 },
  ];
  expect(matchTasks(list, "").map((t) => t.ref)).toEqual(["SHEP-3", "SHEP-5", "SHEP-4", "SHEP-2", "GTM-1", "SHEP-1"]);
  expect(matchTasks(list, "shep").map((t) => t.ref)).toEqual(["SHEP-3", "SHEP-5", "SHEP-4", "SHEP-2", "SHEP-1", "GTM-1"]);
  expect(matchTasks(list, "", 2).map((t) => t.ref)).toEqual(["SHEP-3", "SHEP-5"]);
});

test("a picked task still gets its tag line: @SHEP-4 and its token count as mentions, an email doesn't", () => {
  const tasks = [{ ref: "SHEP-4", id: 4, title: "t" }];
  expect(mentionedIn("ask [@SHEP-4](task:SHEP-4)", tasks)).toHaveLength(1);
  expect(mentionedIn("ask @SHEP-4", tasks)).toHaveLength(1);
  expect(mentionedIn("me@SHEP-4", tasks)).toHaveLength(0);
});
