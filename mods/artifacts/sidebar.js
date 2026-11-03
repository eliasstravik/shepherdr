// An artifact inside the Artifacts sidebar (the person's decision: drill in, same pane, like a
// task's chat inside the Tasks panel). The layout's "artifacts" stack holds the list
// ("artifacts-list", this mod) and the view ("artifacts-view"): a header (this mod with props
// { head: true }: ‹ Artifacts back to the list, the title and version) over a block that shows
// the artifact's own mod ("artifacts-view-body"). Which artifact: shared "artifacts.view" =
// { mod, id, title, version, machine, at }; the body block's mod is swapped in the layout file.
// Also used by the chat's artifact viewer (mods/chat-image) for its "Open in the sidebar".

import { layout, run, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
import { toast, plainError } from "./ui.js";

export const STACK = "artifacts", LIST = "artifacts-list", VIEW = "artifacts-view", BODY = "artifacts-view-body";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// Whether the shown layout has the drill-in view.
export const hasSidebarView = () => Boolean(find(layout(), BODY));

// The body block gets the artifact's mod: an edit of that one block in the layout's file (not
// layout.set: a mod's run() refuses arguments nested over 16 levels, which this block is, and
// layout.set would write the person's clicked sizes into the file). Only if the file is unchanged
// since it was read; else read again.
async function setBody(mod) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, BODY);
    if (!body) throw new Error("This layout has no artifact view.");
    body.content = { mod };
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); return; }
    catch (e) { if (i >= 2) throw e; }
  }
}

// Shows the artifact (its mod already in this app) in the sidebar: false when the layout can't,
// else a promise of whether it did.
export function showInSidebar(view) {
  const l = layout(), body = find(l, BODY);
  if (!body) return false;
  // base: the latest version's mod (art-<id>); mod may be an older one (art-<id>--v<n>).
  setShared("artifacts.view", { mod: view.mod, base: view.base ?? view.mod, id: view.id, title: view.title, version: view.version, latest: view.latest ?? view.version, machine: view.machine ?? null, at: Date.now() });
  const show = () => {
    run("layout.select", { stack: "panel-body", child: STACK });
    run("layout.select", { stack: STACK, child: VIEW });
    run("layout.show", { id: "panel" });
  };
  if (body.content?.mod === view.mod && !body.content?.props) { show(); return Promise.resolve(true); }
  return setBody(view.mod)
    .then(() => { show(); return true; })
    .catch((e) => { toast({ title: "Artifact didn't open", body: plainError(e), level: "error" }); return false; });
}

export const backToList = () => run("layout.select", { stack: STACK, child: LIST });


