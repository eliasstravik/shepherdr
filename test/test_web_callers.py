"""Nothing the service takes goes quiet unnoticed: every action (POST /api/action's `type`) and endpoint (/api/...) it
accepts has a caller, or sits on NO_WEB_CALLER below with why. 3.2's rebuild dropped many buttons silently (#1560):
the service still did the work, only the web stopped asking. A new entry here is a choice, said out loud."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)

# Accepted with no caller in this repo, on purpose. "back:" ones are being brought back by tasks running now; take
# them off once their button lands. The rest: dropped on purpose (docs/upgrading.md, "What
# does not"), or called from outside this repo.
NO_WEB_CALLER = {
    # being brought back by tasks running now (Ask cards, Restart, undo group, remove secret and task search ride
    # actions the web already sends: answer, restart, section, secret, and the state it has)
    "steer": "back: queued messages' Send now",
    "held-now": "back: queued messages' Send now, for one held while its agent was stopped",
    "held-drop": "back: queued messages' remove",
    "stop-job": "back: helper and job rows, with Stop",
    "/api/activity": "back: helper and job rows, with their output",
    "/api/commands": "back: the / command list",
    "assistant-close": "back if End comes with Restart a running Assistant",
    # later (#1560's accepted plan)
    # dropped on purpose: a line each in docs/upgrading.md, What does not
    "schedule": "dropped: Start later and Reschedule",
    "pin": "dropped: Pin a task",
    "machine-add": "dropped: add a machine by clicking",
    "machine-mac-open": "dropped: the Mac's Full Disk Access card",
    "/api/machines/find": "dropped: add a machine by clicking",
    "serve-from": "dropped with Settings › Web: shepherdr web serve-from",
    "secrets-move": "dropped with Settings › Web: shepherdr secrets move-to",
    # no caller and not on #1560's list: 3.1's, replaced in 3.2 or quietly gone
    "model-menu": "3.1's model menu; 3.2's picker reads the catalog",
    "model-pin": "3.1's model menu; 3.2's picker reads the catalog",
    "artifact-send": "3.1's answer from an artifact; 3.2 sends artifact-say",
    "call": "a no-op: a call's audio goes over /api/voice",
    "space-commit": "3.1's Commit in a space's menu",
    "reopen": "reopen a Done task (3.1's voice and window)",
    "/api/push/test": "3.1's Send a test alert",
    # called from outside this repo
    "/api/voice/wake": "Shepherdr Wake, the Android app",
    "/api/voice/handoff": "Shepherdr Wake, the Android app",
    "/api/state": "GET: people and agents reading the state with curl (AGENTS.md); POST: 3.1's store, no caller",
}

TS = re.compile(r"\.(ts|tsx|js)$")


def files(*tops, keep=TS):
    for top in tops:
        p = J(top)
        if os.path.isfile(p):
            yield p
            continue
        for d, dirs, names in os.walk(p):
            dirs[:] = [x for x in dirs if x not in ("node_modules", "__pycache__", "demo", "generated", "vendor")]
            for n in names:
                if keep.search(n) and ".test." not in n:
                    yield os.path.join(d, n)


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def accepted():
    """Every action type and endpoint the service takes."""
    actions, act = set(), read(J("service/actions.ts")) + read(J("service/main.ts"))
    actions |= set(re.findall(r'\b(?:b|body)\??\.type === "([a-z-]+)"', act))
    switch = act.split("switch (b?.type) {", 1)[1].split("\n}\n", 1)[0]
    actions |= set(re.findall(r'case "([a-z-]+)":', switch))
    arts = read(J("service/artifacts.ts")).split("export async function artifactAction", 1)[1]
    actions |= set(re.findall(r'"(artifact-[a-z]+)"', arts.split(".includes(type)", 1)[0]))
    actions.discard("string")
    ends = set(re.findall(r'path(?: === |\.startsWith\()"(/api/[a-z/-]*[a-z])"', read(J("service/main.ts"))))
    return actions, ends


def callers():
    """The text of everything that calls the service: the web app, the voice agent, the command line and herdr-task,
    and the phone and watch apps' contract (docs/glance.md, docs/native-chat.md)."""
    web = [read(p) for p in files("web/src", "web/plugins", "web/shared", "web/public")]
    voice = [read(p) for p in files("service") if os.path.basename(p).startswith("voice-")]
    voice.append(",\n".join(re.findall(r'\baction\(\{ type: "[a-z-]+"', read(J("service/main.ts")))) + ",")
    other = [read(p) for p in files("bin", "mods", keep=re.compile(r"(\.py|^[a-z-]+)$"))]
    other += [read(J("docs", d)) for d in ("glance.md", "native-chat.md")]
    return web, voice + other


def called(name, texts):
    if not name.startswith("/"):
        q = re.escape(name)
        return any(re.search(rf"""type["']?: ['"]{q}['"]\s*[,}}]""", t) for t in texts)
    path = name[1:]
    head, _, last = path.rpartition("/")
    for t in texts:
        if re.search(rf"{re.escape(path)}(?![a-z/-])", t):
            return True
        # a family reached through one helper: fetch(`api/push/${path}`) with post('state', …)
        if head != "api" and f"{head}/${{" in t and re.search(rf"""\(['"]{re.escape(last)}['"]""", t):
            return True
    return False


class WebCallers(unittest.TestCase):
    def test_every_action_and_endpoint_has_a_caller(self):
        actions, ends = accepted()
        self.assertGreater(len(actions), 40, "the action list wasn't found: did act() or doAction move?")
        self.assertGreater(len(ends), 20, "the endpoint list wasn't found: did main.ts's routes move?")
        web, other = callers()
        quiet = sorted(n for n in actions | ends if not called(n, web) and not called(n, other))
        missing = [n for n in quiet if n not in NO_WEB_CALLER]
        self.assertEqual(missing, [], "Nothing calls these any more. Bring the button back, or add each to "
                         "NO_WEB_CALLER with why (and a line in docs/upgrading.md if people lose it), or delete it from the service.")
        # "back:" ones may get their caller from a task merged without knowing this list: never red for that
        stale = sorted(n for n, why in NO_WEB_CALLER.items() if n not in quiet and not why.startswith("back"))
        self.assertEqual(stale, [], "Called again, or gone from the service: take these off NO_WEB_CALLER.")


if __name__ == "__main__":
    unittest.main()
