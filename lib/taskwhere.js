// A task's side views inside the Tasks panel's task view (mods/chat/panel.js): Pull request
// (mods/task-pr) and Browser (mods/task-browser), each a child
// of the view's body stack beside the worker's chat and terminal, picked in its header.
// Which task: shared "tasks.thread.where", published by the header from the task's record =
// { terminal, ref, folder (its worktree, else its list's folder), machine (null: here), branch,
//   base, start (the commit it started from), pr ({ number, url, repo } once herdr-task made one) }.
import { shared, layout } from "herdr";

export const BODY = "tasks-thread-body";
export const PR = "tasks-thread-pr";
export const BROWSER = "tasks-thread-browser";

// Only the shown task's: while another opens, its place isn't read yet (null).
export function where() {
  const w = shared("tasks.thread.where");
  return w && w.terminal === shared("tasks.thread")?.terminal ? w : null;
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const hit = find(c, id); if (hit) return hit; }
  return null;
}

// On screen: the panel shows, on the Tasks stack's task view, with this child picked. A copy
// stays alive hidden (the list, another child): it reads git only while shown.
export function shown(child) {
  const l = layout();
  return !find(l, "panel")?.hidden && find(l, "panel-body")?.active === "tasks"
    && find(l, "tasks")?.active === "tasks-thread" && find(l, BODY)?.active === child;
}
