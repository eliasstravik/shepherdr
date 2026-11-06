"""The Tasks panel's own logic (mods/tasks/main.js), run for real under node with Herdr's runtime modules
("herdr", "gpui-kit", "gpui-base") stubbed: every name a mod imports from them is a function that records its
calls, so a test can set what layout() or shared() returns and see what run() and setShared() were asked."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = ("herdr", "gpui-kit", "gpui-base")

# The loader: Herdr's runtime modules resolve to stubs, each export the name the mods import.
HOOKS = r"""
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const ROOT = process.env.SHEP_ROOT, RUNTIME = %s;
const names = Object.fromEntries(RUNTIME.map((m) => [m, new Set()]));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
for (const f of walk(join(ROOT, "mods")))
  for (const m of readFileSync(f, "utf8").matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g))
    if (names[m[2]]) for (const n of m[1].split(",")) { const x = n.trim().split(/\s+as\s+/)[0]; if (x) names[m[2]].add(x); }
export async function resolve(spec, ctx, next) {
  return RUNTIME.includes(spec) ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith("stub:")) return next(url, ctx);
  const src = [...names[url.slice(5)]].map((n) =>
    `export function ${n}(...a) { (globalThis.calls ??= []).push([${JSON.stringify(n)}, a]); const f = globalThis.stub?.[${JSON.stringify(n)}]; return f ? f(...a) : undefined; }`).join("\n");
  return { format: "module", source: src, shortCircuit: true };
}
""" % json.dumps(list(RUNTIME))


def run_node(script):
    d = tempfile.mkdtemp()
    try:
        files = {"hooks.mjs": HOOKS, "main.mjs": script,
                 "register.mjs": 'import { register } from "node:module"; import { pathToFileURL } from "node:url";\n'
                                 f'register(pathToFileURL({json.dumps(os.path.join(d, "hooks.mjs"))}));\n'}
        for name, text in files.items():
            with open(os.path.join(d, name), "w") as f:
                f.write(text)
        r = subprocess.run(["node", "--import", os.path.join(d, "register.mjs"), os.path.join(d, "main.mjs")],
                           capture_output=True, text=True, env=dict(os.environ, SHEP_ROOT=ROOT), timeout=60)
        if r.returncode != 0:
            raise AssertionError(f"node failed:\n{r.stderr}")
        return json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        shutil.rmtree(d, ignore_errors=True)


@unittest.skipUnless(shutil.which("node"), "needs node")
class TaskThread(unittest.TestCase):
    def test_a_task_opens_on_its_chat_not_the_last_terminal(self):
        """Clicking a task in the list drills in on its chat. The drill-in's Terminal is one layout block, pointed at
        a worker only when its Terminal is picked (mods/chat/panel.js toTerminal): left on Terminal from the task
        before, the next task opened over the old worker's terminal (a click on one task showed the worker of the task opened before it)."""
        main = os.path.join(ROOT, "mods", "tasks", "main.js")
        out = run_node(f"""
const layoutTree = {{ id: "root", children: [{{ id: "tasks", type: "stack", active: "tasks-thread", children: [
  {{ id: "tasks-list" }},
  {{ id: "tasks-thread", children: [{{ id: "tasks-thread-body", type: "stack", active: "tasks-thread-term", children: [
    {{ id: "tasks-thread-chat" }}, {{ id: "tasks-thread-term", type: "block", content: {{ terminal: "vm-b/t15" }} }}] }}] }}] }}] }};
globalThis.stub = {{ layout: () => layoutTree, terminals: () => [], agents: () => [], panes: () => [], machines: () => [] }};
const {{ default: Tasks }} = await import({json.dumps("file://" + main)});
const panel = Object.create(Tasks.prototype);
const list = {{ machine: "vm-b", folder: "/f/app", slug: "Developer-app", prefix: "APP", tasks: [] }};
const task = {{ id: 3, title: "Make passkey changes single-use", state: "running", agents: [{{ address: "t16" }}] }};
const live = [{{ address: "vm-b/t16", status: "working", role: "worker" }}];
globalThis.calls = [];
panel.target({{ list, task, live, section: "working" }})();
const sel = calls.filter(([n]) => n === "run").map(([, a]) => a).filter(([c]) => c === "layout.select").map(([, x]) => x);
const thread = calls.find(([n, a]) => n === "setShared" && a[0] === "tasks.thread")?.[1][1];
console.log(JSON.stringify({{ sel, terminal: thread?.terminal }}));
""")
        self.assertEqual(out["terminal"], "vm-b/t16")
        self.assertIn({"stack": "tasks-thread-body", "child": "tasks-thread-chat"}, out["sel"],
                      "a task opened from the list keeps the body on Terminal, still showing the task before's worker")


if __name__ == "__main__":
    unittest.main()
