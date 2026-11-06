#!/bin/sh
# Cursor uses additional_context, while the shared note returns Claude/Codex's hook envelope.
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
sh "$(dirname "$0")/session-note.sh" | python3 -c '
import json, sys
try:
    note = json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]
    print(json.dumps({"additional_context": note}))
except (ValueError, KeyError, TypeError):
    print("{}")
'
