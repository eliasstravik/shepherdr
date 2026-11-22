# How a PermissionRequest went in the terminal (ask-hook.sh), from Claude's own log: the tool
# call the request (argv[1]) asks about, the latest with its name and input, and its result
# there. Prints "declined" (refused or interrupted), "answered", or nothing (no result yet).
import json, sys

req = json.load(open(sys.argv[1]))
name, inp = req.get("tool_name"), req.get("tool_input")
with open(req.get("transcript_path") or "", "rb") as f:
    f.seek(0, 2)
    f.seek(max(0, f.tell() - 1048576))
    rows = f.read().decode("utf-8", "replace").split("\n")
use, last, results = None, None, {}
for row in rows:
    try:
        c = (json.loads(row).get("message") or {}).get("content")
    except (ValueError, AttributeError):
        continue
    for x in c if isinstance(c, list) else []:
        if not isinstance(x, dict):
            continue
        if x.get("type") == "tool_use" and x.get("name") == name:
            last = x.get("id")
            if x.get("input") == inp:
                use = x.get("id")
        elif x.get("type") == "tool_result":
            results[x.get("tool_use_id")] = x
x = results.get(use or last)
if x:
    words = json.dumps(x.get("content"))
    refused = x.get("is_error") and any(w in words for w in ("doesn't want to proceed", "rejected", "interrupted"))
    print("declined" if refused else "answered")
