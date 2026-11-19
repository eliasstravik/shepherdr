"""The window chat's model button before the first message (mods/chat/main.js loadChoice, freshPick) shares its choice
(SHEP-263): the web app's chat box said "Claude Code · Not known yet" for an Assistant that hadn't started, because
what it would start on lived only in this chat (its props and its own storage). Now the choice is kept in shared
"coordinator.choice" by space: a pick here is told there, a pick made on the web is followed here, and one kept
here before choices were shared is told once.
The methods are run as they are written in main.js, in node, with the window's helpers stubbed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "mods", "chat", "main.js")
SRC = open(MAIN, encoding="utf-8").read()
LOAD = re.search(r"\n  loadChoice\(cx\) \{\n.*?\n  \}\n", SRC, re.S)
PICK = re.search(r"\n  freshPick\(t, cx\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
import { CHOICE_KEY, choiceOf, sameChoice, withChoice } from %(agents)s;
const input = %(input)s;
const doc = input.shared ?? {};
const shared = (k) => doc[k];
const setShared = (k, v) => { doc[k] = v; };
const store = input.local ?? {};
const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
const props = () => input.props ?? {};
const spaces = () => [{ id: "sp1", machine: null }];
const menus = { codex: { models: [{ id: "gpt-6.2-sol" }, { id: "gpt-6-luna" }] }, claude: { models: [{ id: "opus" }] } };
const data = { menus, permDefault: { claude: "manual", codex: "auto" }, defaults: { agent: "claude", model: "opus", effort: null, fast: false, perm: "manual" } };
const choices = { loadChoices: async () => data, modelButton: () => "button" };
const obj = { %(load)s, %(pick)s };
const self = Object.assign(obj, { slot: "slot1", choice: null, slotRec: () => ({ space: "sp1" }) });
const timers = [], jobs = [];
const cx = { notify: () => {}, spawn: (fn) => jobs.push(fn(cx)), timer: { after: (ms, fn) => timers.push(fn) } };
const settle = async () => { await Promise.all(jobs.splice(0)); for (const fn of timers.splice(0)) fn(cx); };
self.loadChoice(cx);
await settle();
const out = { loaded: { ...self.choice.sel } };
for (const step of input.steps ?? []) {
  if (step.pick) self.choice.sel = { ...self.choice.sel, ...step.pick };
  if (step.web) doc[CHOICE_KEY] = withChoice(doc[CHOICE_KEY], "sp1", step.web, step.at);
  self.freshPick({}, cx);
  await settle();
}
out.sel = self.choice.sel;
out.shared = choiceOf(doc[CHOICE_KEY], "sp1");
out.local = store["choice:slot1"] ? JSON.parse(store["choice:slot1"]) : null;
console.log(JSON.stringify(out));
"""

SOL = {"agent": "codex", "model": "gpt-6.2-sol", "effort": None, "fast": "ultrafast", "perm": "full"}


def run(inp):
    agents = json.dumps("file://" + os.path.join(ROOT, "core", "agents.js"))
    script = HARNESS % {"agents": agents, "input": json.dumps(inp), "load": LOAD.group(0).strip(), "pick": PICK.group(0).strip()}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "fresh.mjs")
        with open(path, "w") as f:
            f.write(script)
        return json.loads(subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout)


class FreshChoiceIsShared(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if LOAD is None or PICK is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js loadChoice()/freshPick() not found or no node")

    def test_it_opens_on_settings_and_shares_nothing_until_a_pick(self):
        out = run({"props": {"space": "sp1", "settings": SOL}, "steps": [{}, {}]})
        self.assertEqual(out["loaded"], {**SOL})
        self.assertIsNone(out["shared"])

    def test_a_pick_here_is_shared_for_the_web_and_kept_for_a_reload(self):
        out = run({"props": {"space": "sp1", "settings": SOL}, "steps": [{}, {"pick": {"model": "gpt-6-luna", "fast": True}}, {}]})
        want = {**SOL, "model": "gpt-6-luna", "fast": True}
        self.assertEqual(out["shared"], want)
        self.assertEqual(out["local"], want)

    def test_a_pick_made_on_the_web_is_followed_here(self):
        web = {"agent": "claude", "model": "opus", "effort": "high", "fast": False, "perm": "manual"}
        out = run({"props": {"space": "sp1", "settings": SOL}, "steps": [{}, {"web": web, "at": 50}, {}]})
        self.assertEqual(out["sel"], web)
        self.assertEqual(out["shared"], web)

    def test_it_opens_on_a_choice_shared_before_it_loaded(self):
        web = {"agent": "codex", "model": "gpt-6-luna", "effort": None, "fast": False, "perm": "auto"}
        out = run({"props": {"space": "sp1", "settings": SOL}, "shared": {"coordinator.choice": {"sp1": {**web, "at": 7}}}, "steps": [{}]})
        self.assertEqual(out["loaded"], web)
        self.assertEqual(out["shared"], web)

    def test_a_pick_kept_here_before_choices_were_shared_is_told_once(self):
        kept = {**SOL, "model": "gpt-6-luna"}
        out = run({"props": {"space": "sp1", "settings": SOL}, "local": {"choice:slot1": json.dumps(kept)}, "steps": [{}]})
        self.assertEqual(out["loaded"], kept)
        self.assertEqual(out["shared"], kept)

    def test_a_choice_whose_agent_is_not_installed_there_is_not_followed(self):
        out = run({"props": {"space": "sp1", "settings": SOL}, "steps": [{}, {"web": {"agent": "claude", "model": "opus"}, "at": 9}]})
        self.assertEqual(out["sel"]["agent"], "claude")
        gone = run({"props": {"space": "sp1"}, "shared": {"coordinator.choice": {"sp1": {"agent": "vim", "at": 3}}}, "steps": [{}]})
        self.assertEqual(gone["loaded"]["agent"], "claude")


if __name__ == "__main__":
    unittest.main()
