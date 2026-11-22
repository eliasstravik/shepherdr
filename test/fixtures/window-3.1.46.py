# A Shepherdr 3.1.46 Herdr-window install, as its installer left a home (bin/shepherdr 3.1.46, cmd_install), kept here for
# test/test_install.py's switch tests: 3.2 finds its record (.config/herdr-app/data/shepherdr/installed.json) and takes
# out what 3.1 put in the Herdr app. The names, the record's shape and the hooks' and keys' form are 3.1.46's own; the
# files' contents are short stand-ins. Never edited to fit a newer installer: it is what older installs really look like.
#
#   build(root) -> the record it wrote. The home it builds:
#     the person's own, from before 3.1: a Herdr mod (mods/changes), two keys, a Claude setting, an older herdr-task
#     3.1's: the 28 mods, layouts/shepherdr.json, lib/, core/, bin/, 31 keys merged into keys.json (one took over the
#     person's alt-1 with --keys ours, their ctrl-k was kept), the chat hooks, the --guard link, the helpers' links,
#     the service's folder, the role instructions, the service's unit

import hashlib, json, os

APP, BIN, SHARE, TPL = ".config/herdr-app", ".local/bin", ".local/share/shepherdr", ".config/herdr-core/templates"
UNIT = ".config/systemd/user/shepherdr.service"
MODS = ["accept-card", "artifacts", "chat", "chat-call", "chat-image", "chat-models", "chat-react", "confirm-chat", "coordinator",
        "jump", "keybinds", "machine-add-chat", "menu-tasks", "new-menu-tasks", "newspace", "pane-chat", "prompt-chat",
        "shepherdr-settings", "spaces-chat", "tabs-tasks", "task-artifacts", "task-browser", "task-pr", "tasks", "tasks-menu",
        "toasts", "workspace-chrome-shepherdr", "workspace-status-chat"]
KEYS = {
    "global": {**{f"alt-{n}": f"tab.select:{n}" for n in range(1, 10)}, "alt-left": "tab.prev", "alt-right": "tab.next",
               "alt-down": "space.next", "alt-up": "space.prev", "alt-enter": "pane.split:right", "alt-shift-enter": "pane.split:down",
               "alt-escape": "pane.close", "ctrl-alt-left": "pane.go:left", "ctrl-alt-down": "pane.go:down", "ctrl-alt-up": "pane.go:up",
               "ctrl-alt-right": "pane.go:right", "ctrl-k": "mod.open:jump", "ctrl-shift-k": "mod.open:jump",
               "ctrl-shift-/": "mod.open:keybinds", "ctrl-shift-?": "mod.open:keybinds"},
    "terminal": {"ctrl-v": "terminal.paste"},
    "mod:chat": {"ctrl-shift-d": "chat.dictate", "ctrl-shift-space": "chat.call", "ctrl-f": "chat.find"},
    "layout:shepherdr": {"ctrl-shift-w": "tabs-tasks.close", "ctrl-shift-n": "tabs-tasks.newspace", "f2": "tabs-tasks.rename-tab",
                         "shift-f2": "tabs-tasks.rename-space"},
}
LIVE_BLOCKS = ("tasks-thread-term", "artifacts-view-body")
LAYOUT = {"id": "root", "type": "row", "children": [
    {"id": "sidebar", "type": "column", "size": {"px": 280}, "children": [
        {"id": "brand", "content": {"mod": "workspace-chrome-shepherdr"}}, {"id": "spaces", "content": {"mod": "spaces-chat"}}]},
    {"id": "work", "type": "column", "children": [
        {"id": "tabs", "content": {"mod": "tabs-tasks"}}, {"id": "main", "content": {"mod": "pane-chat"}},
        {"id": "tasks-thread-term", "content": None}, {"id": "artifacts-view-body", "content": None}]}]}


def sha(rel, data):
    """3.1's fsha: a layout is compared without its live blocks."""
    if rel.startswith(f"{APP}/layouts/"):
        d = json.loads(data)

        def walk(n):
            if isinstance(n, dict):
                if n.get("id") in LIVE_BLOCKS:
                    n["content"] = None
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(d)
        data = json.dumps(d, sort_keys=True).encode()
    return hashlib.sha256(data).hexdigest()


def build(root, stamp="20260101-120000"):
    P = lambda *rel: os.path.join(root, *rel)
    files = {}

    def write(rel, text, mode=0o644, record=True):
        os.makedirs(os.path.dirname(P(rel)), exist_ok=True)
        with open(P(rel), "w") as f:
            f.write(text)
        os.chmod(P(rel), mode)
        if record:
            files[rel] = sha(rel, text.encode())

    backup = P(APP, ".shepherdr-backup", stamp)
    # ---- the person's own, from before 3.1
    write(f"{APP}/mods/changes/main.js", "// Herdr's own mod\n", record=False)
    write(".claude/settings.json", json.dumps({"model": "x"}), record=False)
    os.makedirs(P(".codex"), exist_ok=True)
    os.makedirs(os.path.join(backup, BIN), exist_ok=True)
    with open(os.path.join(backup, BIN, "herdr-task"), "w") as f:   # an older herdr-task, set aside for 3.1's link
        f.write("#!/bin/sh\necho the old one\n")
    # ---- the mods (571 files in a real one), with the shared copies each carried
    for m in MODS:
        write(f"{APP}/mods/{m}/mod.json", '{ "place": "none", "title": "%s" }\n' % m)
        write(f"{APP}/mods/{m}/main.js", f"// {m}\nexport default class {{}}\n")
        write(f"{APP}/mods/{m}/ui.js", "// Shared: the source is lib/ui.js\n")
        write(f"{APP}/mods/{m}/gpui-kit.d.ts", "// written by Herdr\n", record=False)
    write(f"{APP}/mods/tasks/bin/herdr-task", "#!/usr/bin/env python3\nprint('herdr-task 3.1.46')\n", 0o755)
    write(f"{APP}/mods/tasks/bin/herdr_task/__init__.py", "")
    write(f"{APP}/mods/artifacts/bin/herdr-artifact", "#!/usr/bin/env python3\nprint('herdr-artifact 3.1.46')\n", 0o755)
    write(f"{APP}/mods/chat/ask-hook.sh", "#!/bin/sh\nexit 0\n", 0o755)
    write(f"{APP}/mods/chat/session-note.sh", "#!/bin/sh\nexit 0\n", 0o755)
    write(f"{APP}/mods/coordinator/restart.sh", "#!/bin/bash\nexit 0\n", 0o755)
    # ---- the layout, lib/, core/, bin/
    write(f"{APP}/layouts/shepherdr.json", json.dumps(LAYOUT, indent=2) + "\n")
    for f in ("addons.json", "features.json", "COPIES", "ui.js", "dirs.js"):
        write(f"{APP}/lib/{f}", "{}\n" if f.endswith(".json") else f"// lib/{f}\n")
    for f in ("paths.js", "tasks.js"):
        write(f"{APP}/core/{f}", f"// core/{f}\n")
    for f in ("shepherdr", "herdr-secret", "herdr-browser", "herdr-browser-view", "sync-shared"):
        write(f"{APP}/bin/{f}", f"#!/bin/sh\necho {f} 3.1.46\n", 0o755)
    # ---- the service's folder (a whole source for a web-only install), the role instructions, the unit
    for f in ("package.json", "lib/addons.json", "service/main.ts", "service/layout-scripts.ts", "core/paths.js", "web/shared/types.ts",
              "mods/tasks/bin/herdr-task", "mods/artifacts/bin/herdr-artifact", "mods/artifacts/recipe-view.js", "mods/artifacts/markup.js",
              "mods/artifacts/core/recipe.js", "mods/coordinator/restart.sh", "bin/shepherdr", "templates/worker.md", "install.sh"):
        write(f"{SHARE}/{f}", f"// 3.1.46 {f}\n")
    for f in ("assistant.md", "worker.md", "reviewer.md"):
        write(f"{TPL}/{f}", f"# {f} 3.1.46\n")
    write(UNIT, "[Service]\nExecStart=bun 3.1.46\n")
    # ---- the keys: 3.1's merged into the person's (their ctrl-k kept; their alt-1 taken with --keys ours)
    mine = {"global": {"ctrl-k": "mine.open", "alt-1": "space.select:1"}}
    have = json.loads(json.dumps(mine))
    keys = {}
    for ctx, ks in KEYS.items():
        for key, value in ks.items():
            cur = mine.get(ctx, {}).get(key)
            if key == "ctrl-k":
                continue
            have.setdefault(ctx, {})[key] = value
            keys[f"{ctx} {key}"] = {"value": value, "was": cur, "added": cur is None}
    write(f"{APP}/keys.json", json.dumps(have, indent=2, ensure_ascii=False) + "\n", record=False)
    # ---- the chat hooks, in Claude Code's settings and a hooks.json it made for Codex
    app = P(APP)
    note, ask = f"sh '{app}/mods/chat/session-note.sh'", f"sh '{app}/mods/chat/ask-hook.sh'"
    with open(P(".claude/settings.json"), "w") as f:
        json.dump({"model": "x", "hooks": {
            "SessionStart": [{"matcher": "^(startup|resume|clear|compact)$", "hooks": [{"type": "command", "command": note, "timeout": 10}]}],
            "PermissionRequest": [{"hooks": [{"type": "command", "command": "mine --ask"}]},
                                  {"hooks": [{"type": "command", "command": ask, "timeout": 1800}]}]}}, f, indent=2)
    with open(P(".codex/hooks.json"), "w") as f:
        json.dump({"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": note, "timeout": 10}]}],
                             "PermissionRequest": [{"hooks": [{"type": "command", "command": ask, "timeout": 1800}]}]}}, f, indent=2)
    hooks = [[".claude/settings.json", "SessionStart", note], [".claude/settings.json", "PermissionRequest", ask],
             [".codex/hooks.json", "SessionStart", note], [".codex/hooks.json", "PermissionRequest", ask]]
    # ---- the helpers' links into the app, and the --guard
    links = {"herdr-task": P(APP, "mods/tasks/bin/herdr-task"), "herdr-artifact": P(APP, "mods/artifacts/bin/herdr-artifact"),
             "herdr-secret": P(APP, "bin/herdr-secret"), "herdr-browser": P(APP, "bin/herdr-browser"), "shepherdr": P(APP, "bin/shepherdr")}
    os.makedirs(P(BIN), exist_ok=True)
    for name, dest in links.items():
        os.symlink(dest, P(BIN, name))
    write(f"{BIN}/herdr-app", "#!/bin/sh\n# herdr-app guard (HERD-55)\n", 0o755)
    rec = {"version": "3.1.46", "source": P("src", "shepherdr"), "at": stamp, "root": root, "files": files,
           "mods": {m: True for m in MODS}, "keys": keys, "links": links, "hooks": hooks, "created": [".codex/hooks.json"],
           "replaced": {f"{BIN}/herdr-task": os.path.join(backup, BIN, "herdr-task")}}
    os.makedirs(P(APP, "data", "shepherdr"), exist_ok=True)
    with open(P(APP, "data", "shepherdr", "installed.json"), "w") as f:
        f.write(json.dumps(rec, indent=2, sort_keys=True) + "\n")
    return rec
