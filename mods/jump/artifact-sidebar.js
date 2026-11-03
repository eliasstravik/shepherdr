// "Open in the sidebar" for the artifact viewer, and Ctrl+K's artifact when no chat pane shows
// (mods/jump): the same steps as mods/artifacts/sidebar.js (mods can't import each other's files;
// keep the two in step). Shared: the source is lib/artifact-sidebar.js; edit it, never a mod's
// copy, then run bin/sync-shared. The layout's "artifacts" stack
// shows "artifacts-view", whose body block ("artifacts-view-body") gets the artifact's mod;
// shared "artifacts.view" says which artifact its header names.

import { layout, run, shared, setShared, appHome, readTextFile, writeTextFile } from "herdr";
import { toast, plainError } from "./ui.js";

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

export const hasSidebarView = () => Boolean(find(layout(), "artifacts-view-body"));

// The body block gets the artifact's mod: an edit of that one block in the layout's file (not
// layout.set: a mod's run() refuses arguments nested over 16 levels, which this block is, and
// layout.set would write the person's clicked sizes into the file). Only if the file is unchanged
// since it was read; else read again.
async function setBody(mod) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; ; i++) {
    const text = await readTextFile(path);
    const tree = JSON.parse(text ?? "null"), body = find(tree, "artifacts-view-body");
    if (!body) throw new Error("This layout has no artifact view.");
    body.content = { mod };
    try { await writeTextFile(path, JSON.stringify(tree, null, 2), text); return; }
    catch (e) { if (i >= 2) throw e; }
  }
}

export function showInSidebar(view) {
  const l = layout(), body = find(l, "artifacts-view-body");
  if (!body) return false;
  // base: the latest version's mod (art-<id>); mod may be an older one (art-<id>--v<n>).
  setShared("artifacts.view", { mod: view.mod, base: view.base ?? view.mod, id: view.id, title: view.title, version: view.version, latest: view.latest ?? view.version, machine: view.machine ?? null, at: Date.now() });
  const show = () => {
    run("layout.select", { stack: "panel-body", child: "artifacts" });
    run("layout.select", { stack: "artifacts", child: "artifacts-view" });
    run("layout.show", { id: "panel" });
  };
  if (body.content?.mod === view.mod && !body.content?.props) { show(); return Promise.resolve(true); }
  return setBody(view.mod)
    .then(() => { show(); return true; })
    .catch((e) => { toast({ title: "Artifact didn't open", body: plainError(e), level: "error" }); return false; });
}
